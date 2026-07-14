// Headless-browser HMI engine. The WECON HMI only streams the live *numeric* temperature
// values to a full rendering client and allows just ONE remote client — so Pulse runs a
// headless Chrome as that sole client, hooks its websocket, decodes frames with the page's
// own protobuf, and navigates TEMP-1/TEMP-2 to collect all 16 zones. See
// reference_wecon_hmi_protocol.
const puppeteer = require('puppeteer-core');
const { ZONES, NAV, nearestColumn, nearestZone } = require('./warehouse-map');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HMI = `http://${process.env.HMI_HOST || '192.168.0.51'}/`;

class HmiBrowser {
  constructor(opts = {}) {
    this.log = opts.log || ((...a) => console.log('[hmi]', ...a));
    this.browser = null;
    this.page = null;
    this.connected = false;
    this.currentScreen = null;
    this.lastFrameAt = 0;
    this.zones = {};
    for (const z of ZONES) this.zones[z.id] = { actual: null, setLow: null, setHigh: null, updatedAt: 0 };
    this.lastSeen = { temp1: 0, temp2: 0 }; // last successful harvest per temp screen
    this._stopped = false;
  }

  async start() {
    this._stopped = false;
    this._startWatchdog();
    while (!this._stopped) {
      try {
        await this._run();
      } catch (e) {
        this.log('engine error:', e.message);
      }
      this.connected = false;
      // Always tear the browser down before restarting, or the old (possibly hung) instance
      // keeps holding the HMI's single client slot and the new one gets nomore_client.
      try { if (this.browser) await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
      this._shot_temp1 = this._shot_temp2 = false;
      this._seen_temp1 = this._seen_temp2 = false;
      this.lastSeen = { temp1: 0, temp2: 0 };
      if (this._stopped) break;
      this.log('restarting engine in 8s');
      await this._sleep(8000);
    }
  }

  async stop() {
    this._stopped = true;
    if (this._wd) clearInterval(this._wd);
    if (this.browser) { try { await this.browser.close(); } catch {} }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Reject if a page operation hangs, so one stuck call can't stall the whole loop forever.
  _withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
    ]);
  }

  // Watchdog: if the harvest loop makes no progress for a while, force a full engine restart.
  _startWatchdog() {
    this.lastProgress = Date.now();
    if (this._wd) clearInterval(this._wd);
    this._wd = setInterval(() => {
      if (this._stopped || !this.connected) return;
      const now = Date.now();
      // (a) total stall: no loop progress at all.
      if (now - this.lastProgress > 75000) {
        this.log('watchdog: no progress for 75s — restarting engine');
        this.lastProgress = now;
        this.connected = false;
        try { if (this.browser) this.browser.close(); } catch {}
        return;
      }
      // (b) partial stall: one temp screen keeps updating but the other went stale (navigation
      // stuck on a single screen, e.g. a popup ate the nav click). Restart to re-navigate both.
      const { temp1, temp2 } = this.lastSeen;
      if (temp1 && temp2 && now - Math.min(temp1, temp2) > 150000) {
        this.log('watchdog: a temp screen went stale (stuck navigation) — restarting engine');
        this.lastSeen = { temp1: 0, temp2: 0 };
        this.connected = false;
        try { if (this.browser) this.browser.close(); } catch {}
      }
    }, 15000);
  }

  async _run() {
    this.log('launching Chrome');
    this.browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio'],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1024, height: 768 });

    // Seed login cookie (skip the login redirect) + hook the canvas text rendering.
    // The HMI draws the live numbers via canvas fillText (they are NOT in the websocket
    // part data), so we intercept fillText to capture exactly what the operator sees.
    await this.page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('weconLANCookie' + location.host, '1'); } catch (e) {}
      window.__texts = {}; // key "x,y" -> { t, x, y, at }
      window.__diag = { fillText: 0, strokeText: 0, drawImage: 0 };
      try {
        const proto = CanvasRenderingContext2D.prototype;
        const capture = (text, x, y) => { try { window.__texts[Math.round(x) + ',' + Math.round(y)] = { t: String(text), x: Math.round(x), y: Math.round(y), at: Date.now() }; } catch (e) {} };
        const oFill = proto.fillText;
        proto.fillText = function (t, x, y) { window.__diag.fillText++; capture(t, x, y); return oFill.apply(this, arguments); };
        const oStroke = proto.strokeText;
        proto.strokeText = function (t, x, y) { window.__diag.strokeText++; capture(t, x, y); return oStroke.apply(this, arguments); };
        const oDraw = proto.drawImage;
        proto.drawImage = function () { window.__diag.drawImage++; return oDraw.apply(this, arguments); };
      } catch (e) {}
    });

    // Claim the single client slot. IMPORTANT: this WECON server holds a slot for recently
    // closed/refused connections and only drains after ~2 min of NO attempts — so retries
    // must be spaced far apart (short retries perpetuate the busy state). Wait 90s between.
    const RETRY_MS = 90000;
    let claimed = false;
    for (let attempt = 0; attempt < 20 && !this._stopped; attempt++) {
      await this.page.goto(HMI, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
      await this._sleep(3000);
      const url = this.page.url();
      if (url.includes('nomore_client')) {
        this.log(`slot busy (attempt ${attempt + 1}) — waiting ${RETRY_MS / 1000}s for the HMI to release it (close any HMI browser tabs)`);
        await this._sleep(RETRY_MS);
        continue;
      }
      // Confirm the HMI actually reached the device: its protobuf global only initialises once
      // the page's websocket connects to the PLC. If it never appears the VPN/PLC is
      // unreachable — don't falsely claim "connected"; retry (shorter wait than nomore_client).
      let ok = false;
      for (let i = 0; i < 20; i++) { ok = await this.page.evaluate(() => !!(window.proto && window.proto.hmiproto)).catch(() => false); if (ok) break; await this._sleep(500); }
      if (ok) { claimed = true; break; }
      this.log('HMI not reachable yet (VPN/PLC down?) — retrying in 12s');
      await this._sleep(12000);
    }
    if (!claimed) throw new Error('could not claim HMI slot / protobuf not ready');

    this.connected = true;
    this.log('claimed HMI slot — rendering client active');

    // Navigation + harvest loop. As a full client, entering a temp screen loads its numerics.
    // Every page op is time-boxed so a single hung call can't freeze the loop (which would
    // silently stop updates while still holding the slot).
    let target = 'temp1';
    while (!this._stopped) {
      this.lastProgress = Date.now(); // feed the watchdog: this iteration is alive
      await this._withTimeout(this._navigate(target), 15000, 'navigate');
      await this._sleep(1500);
      await this._withTimeout(this._harvest(target), 15000, 'harvest');
      await this._sleep(3500);
      target = target === 'temp1' ? 'temp2' : 'temp1';
      // detect if we got bounced (reload to nomore_client / login)
      const url = await this._withTimeout(Promise.resolve(this.page.url()), 5000, 'url').catch(() => '');
      if (url.includes('nomore_client') || url.includes('login')) { this.log('bounced off HMI, restarting'); break; }
    }
  }

  async _navigate(target) {
    const nav = target === 'temp1' ? NAV.temp1 : NAV.temp2;
    // The nav buttons live on the base temp screen (1/2); target the screen we're currently
    // on rather than SCRSTACK.Top(), which can be a popup that would swallow the click.
    const scrHint = this.currentScreen || 1;
    // clear captured text so we only read the screen we're about to enter
    await this.page.evaluate(() => { window.__texts = {}; }).catch(() => {});
    await this.page.evaluate((nav, scrHint) => {
      // Prefer the HMI's own event sender; fall back to canvas pointer events.
      let scr = scrHint;
      try { const top = window.SCRSTACK && SCRSTACK.Top && SCRSTACK.Top().ScrNo; if (top === 1 || top === 2) scr = top; } catch (e) {}
      try {
        if (typeof window.SendEvent === 'function' && typeof window.EVENT_CLICKDOWN !== 'undefined') {
          window.SendEvent(scr, '', window.EVENT_CLICKDOWN, `${nav.x},${nav.y}`);
          setTimeout(() => window.SendEvent(scr, '', window.EVENT_CLICKUP, `${nav.x},${nav.y}`), 90);
          return 'sendevent';
        }
      } catch (e) {}
      // fallback: dispatch pointer events on the body at logical≈pixel coords
      const el = document.body;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: nav.x, clientY: nav.y };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', opts)), 90);
      return 'pointer';
    }, nav, scrHint).catch(() => {});
  }

  async _harvest(target) {
    // The HMI overlays the live values as HTML elements on top of the canvas — read them
    // from the DOM with their on-screen centre positions. Also detect which temp screen is
    // actually showing (from its "(1-8)"/"(9-16)" title) so we never map to the wrong screen.
    const data = await this.page.evaluate(() => {
      // Only trust an element that is actually visible AND the topmost thing at its centre —
      // the HMI keeps BOTH temp screens' elements in the DOM (inactive one hidden/underneath),
      // so a naive read mixes the two screens together.
      const isVisibleTop = (el) => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0)) return null;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity || '1') < 0.1) return null;
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        if (!top || !(top === el || el.contains(top) || top.contains(el))) return null;
        return { cx, cy };
      };

      // screen = the visible "(1-8)"/"(9-16)" title
      let screen = null;
      document.querySelectorAll('input, div, span, p, td').forEach((el) => {
        if (el.childElementCount > 0) return;
        const txt = ((el.value != null && el.value !== '') ? el.value : el.textContent || '').trim();
        const m = /\((1-8|9-16)\)/.exec(txt);
        if (!m) return;
        if (!isVisibleTop(el)) return;
        screen = m[1] === '1-8' ? 'temp1' : 'temp2';
      });

      const out = [];
      document.querySelectorAll('input, div, span, p, td').forEach((el) => {
        if (el.childElementCount > 0) return;
        let t = (el.value != null && el.value !== '') ? el.value : el.textContent;
        t = (t || '').trim();
        if (!/^-?\d+(\.\d+)?$/.test(t)) return;
        const pos = isVisibleTop(el);
        if (!pos) return;
        out.push({ t, x: pos.cx, y: pos.cy });
      });
      return { screen, nums: out };
    }).catch(() => ({ screen: null, nums: [] }));

    const screenName = data.screen; // trust the DOM title, not the nav target
    const nums = data.nums;
    if (screenName === 'temp1') this.currentScreen = 1;
    else if (screenName === 'temp2') this.currentScreen = 2;

    if (process.env.DEBUG_HMI && screenName && !this[`_shot_${screenName}`]) {
      this[`_shot_${screenName}`] = true;
      try { await this.page.screenshot({ path: require('path').join(__dirname, `debug-${screenName}.png`) }); } catch {}
      this.log(`DOM screen=${screenName} NUMBERS: ` + JSON.stringify(nums.map((n) => `${n.t}@${n.x},${n.y}`)));
    }
    if (!screenName) return;

    if (!nums.length) { this.log(`harvest[${screenName}] no rendered numbers yet`); return; }
    this.lastFrameAt = Date.now();

    let harvested = 0;
    for (const n of nums) {
      const val = parseFloat(n.t);
      if (!isFinite(val)) continue;
      const column = nearestColumn(n.x);          // canvas x -> ACTUAL / SET LOW / SET HIGH
      const zoneId = nearestZone(screenName, n.y); // canvas y -> room row
      if (!column || !zoneId) continue;
      const z = this.zones[zoneId];
      if (process.env.DEBUG_HMI && z[column] !== val) this.log(`  ${zoneId}.${column} = ${val}`);
      z[column] = val;
      z.updatedAt = Date.now();
      harvested++;
    }
    if (harvested) this.lastSeen[screenName] = Date.now();
    // Log a concise confirmation the first time each screen yields data, then stay quiet.
    if (harvested && !this[`_seen_${screenName}`]) {
      this[`_seen_${screenName}`] = true;
      this.log(`reading ${screenName}: ${harvested} live values (set DEBUG_HMI=1 for per-value logs)`);
    }
  }

  getState() {
    const now = Date.now();
    const rooms = {};
    for (const z of ZONES) {
      const s = this.zones[z.id];
      const stale = s.updatedAt === 0 || (now - s.updatedAt) > 120000;
      let alarm = false;
      if (s.actual != null && s.setLow != null && s.setHigh != null) alarm = s.actual < s.setLow || s.actual > s.setHigh;
      rooms[z.id] = {
        label: z.label, type: z.type,
        temperature: s.actual, setLow: s.setLow, setHigh: s.setHigh,
        alarm, offline: stale, updatedAt: s.updatedAt || null,
      };
    }
    return {
      ok: this.connected, connected: this.connected, host: HMI,
      currentScreen: this.currentScreen, lastFrameAt: this.lastFrameAt || null,
      timestamp: new Date(now).toISOString(), rooms,
    };
  }
}

module.exports = { HmiBrowser };

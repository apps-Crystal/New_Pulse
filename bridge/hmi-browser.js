// Headless-browser HMI engine. The WECON HMI only streams the live *numeric* temperature
// values to a full rendering client and allows just ONE remote client — so Pulse runs a
// headless Chrome as that sole client, navigates TEMP-1/TEMP-2, and reads the values the
// HMI overlays onto the page as HTML elements. See reference_wecon_hmi_protocol.
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
    this._stopped = false;
  }

  async start() {
    this._stopped = false;
    while (!this._stopped) {
      try { await this._run(); } catch (e) { this.log('engine error:', e.message); }
      this.connected = false;
      if (this._stopped) break;
      this.log('restarting engine in 8s');
      await this._sleep(8000);
    }
  }

  async stop() {
    this._stopped = true;
    if (this.browser) { try { await this.browser.close(); } catch {} }
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async _run() {
    this.log('launching Chrome');
    this.browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio'],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1024, height: 768 });

    // Seed login cookie so the HMI's login redirect is skipped.
    await this.page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('weconLANCookie' + location.host, '1'); } catch (e) {}
    });

    // Claim the single client slot (the HMI holds a slot for recently closed/refused
    // connections, so retries are spaced far apart).
    const RETRY_MS = 90000;
    let claimed = false;
    for (let attempt = 0; attempt < 20 && !this._stopped; attempt++) {
      await this.page.goto(HMI, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
      await this._sleep(3000);
      const url = this.page.url();
      if (url.includes('nomore_client')) {
        this.log(`slot busy (attempt ${attempt + 1}) — waiting ${RETRY_MS / 1000}s for the HMI to release it`);
        await this._sleep(RETRY_MS);
        continue;
      }
      claimed = true;
      break;
    }
    if (!claimed) throw new Error('could not claim HMI slot');

    this.connected = true;
    this.log('claimed HMI slot — rendering client active');

    // Navigation + harvest loop. As a full client, entering a temp screen loads its numbers.
    let target = 'temp1';
    while (!this._stopped) {
      await this._navigate(target);
      await this._sleep(1500);
      await this._harvest(target);
      await this._sleep(3500);
      target = target === 'temp1' ? 'temp2' : 'temp1';
      const url = this.page.url();
      if (url.includes('nomore_client') || url.includes('login')) { this.log('bounced off HMI, restarting'); break; }
    }
  }

  async _navigate(target) {
    const nav = target === 'temp1' ? NAV.temp1 : NAV.temp2;
    await this.page.evaluate((nav) => {
      const scr = (function () {
        try { if (window.SCRSTACK && SCRSTACK.Top) return SCRSTACK.Top().ScrNo; } catch (e) {}
        return 0;
      })();
      try {
        if (typeof window.SendEvent === 'function' && typeof window.EVENT_CLICKDOWN !== 'undefined') {
          window.SendEvent(scr, '', window.EVENT_CLICKDOWN, `${nav.x},${nav.y}`);
          setTimeout(() => window.SendEvent(scr, '', window.EVENT_CLICKUP, `${nav.x},${nav.y}`), 90);
          return;
        }
      } catch (e) {}
      const el = document.body;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: nav.x, clientY: nav.y };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', opts)), 90);
    }, nav).catch(() => {});
  }

  async _harvest(target) {
    // The HMI overlays live values as HTML elements — read them from the DOM by position.
    const data = await this.page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : '';
      let screen = null;
      if (/\(1-8\)/.test(bodyText)) screen = 'temp1';
      else if (/\(9-16\)/.test(bodyText)) screen = 'temp2';
      const out = [];
      document.querySelectorAll('input, div, span, p, td').forEach((el) => {
        let t = (el.value != null && el.value !== '') ? el.value : (el.childElementCount === 0 ? el.textContent : '');
        t = (t || '').trim();
        if (!/^-?\d+(\.\d+)?$/.test(t)) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0) out.push({ t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      });
      return { screen, nums: out };
    }).catch(() => ({ screen: null, nums: [] }));

    const screenName = data.screen;
    if (screenName === 'temp1') this.currentScreen = 1;
    else if (screenName === 'temp2') this.currentScreen = 2;
    if (!screenName) return;
    this.lastFrameAt = Date.now();

    for (const n of data.nums) {
      const val = parseFloat(n.t);
      if (!isFinite(val)) continue;
      const column = nearestColumn(n.x);
      const zoneId = nearestZone(screenName, n.y);
      if (!column || !zoneId) continue;
      this.zones[zoneId][column] = val;
      this.zones[zoneId].updatedAt = Date.now();
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

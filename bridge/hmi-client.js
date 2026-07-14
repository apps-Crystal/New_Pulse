// Persistent WECON-HMI websocket client for the Crystal cold-storage PLC.
// Holds ONE long-lived connection (the server enforces a small client limit),
// cycles the TEMP-1 / TEMP-2 screens, parses Numeric temperature values by screen
// position, and keeps a cache of all 16 zones. See reference_wecon_hmi_protocol.
require('./hmiproto.js');
const WebSocket = require('ws');
const { ZONES, NAV, nearestColumn, nearestZone } = require('./warehouse-map');

const P = global.proto.hmiproto;
const EVENT = { CLICKDOWN: 0, CLICKUP: 1, SCRINIT: 2 };
const EV = { INIT: 0, UPDATE: 1, CHANGESCR: 2, POPSCR: 3, JUMPHTML: 13 };

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const bstr = (v) => { try { return v == null ? '' : (typeof v === 'string' ? Buffer.from(v, 'base64') : Buffer.from(v)).toString('utf8'); } catch { return ''; } };

function buildEvent(scrno, type, buffer) {
  const e = new P.hmievent();
  e.setScrno(Number(scrno) || 0);
  e.setPartname(b64(''));
  e.setType(type);
  e.setEventbuffer(b64(buffer || ''));
  return Buffer.from(e.serializeBinary());
}

class HmiClient {
  constructor(opts = {}) {
    this.host = opts.host || process.env.HMI_HOST || '192.168.0.51';
    this.url = `ws://${this.host}/`;
    this.log = opts.log || ((...a) => console.log('[hmi]', ...a));
    this.dwellMs = opts.dwellMs || 6000;      // time spent collecting on each screen
    this.navPausedUntil = 0;                   // suppress navigation after a nomore_client
    this.ws = null;
    this.connected = false;
    this.currentScreen = null;                // hmi scrno we believe we're on
    this.currentTarget = 'temp1';             // which temp screen we're cycling toward
    this.backoff = 2000;
    this.lastFrameAt = 0;
    this.clientId = null;

    // zone state cache: id -> { actual, setLow, setHigh, updatedAt }
    this.zones = {};
    for (const z of ZONES) this.zones[z.id] = { actual: null, setLow: null, setHigh: null, updatedAt: 0 };

    // per-screen index -> {column, zoneId} learned from part positions
    this._timers = [];
  }

  start() { this._connect(); }

  stop() {
    this._clearTimers();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }

  _clearTimers() { this._timers.forEach(clearTimeout); this._timers = []; }
  _later(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); return t; }

  _connect() {
    this.log(`connecting ${this.url}`);
    let ws;
    try {
      ws = new WebSocket(this.url, { perMessageDeflate: false, handshakeTimeout: 8000 });
    } catch (e) { this.log('ctor error', e.message); return this._scheduleReconnect(); }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.on('open', () => {
      this.connected = true;
      this.backoff = 2000;
      this.log('OPEN');
      // bootstrap: ask for a screen; server replies with whatever is current (full INIT if
      // we're the sole client — that's the frame that carries the numeric temperature group).
      this._send(buildEvent(1, EVENT.SCRINIT, ''));
      // gently try to cover both temp screens; navigation self-suppresses if the HMI is full.
      this._later(() => this._cycle('temp1'), 1500);
    });

    ws.on('message', (data) => this._onMessage(data));
    ws.on('error', (e) => this.log('WS error', e.message));
    ws.on('close', () => {
      this.connected = false;
      this.log('CLOSE');
      this._clearTimers();
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 1.6, 30000);
    this.log(`reconnect in ${Math.round(wait)}ms`);
    setTimeout(() => this._connect(), wait);
  }

  _send(buf) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(buf); } catch (e) { this.log('send error', e.message); }
    }
  }

  _click(x, y) {
    const scr = this.currentScreen || 0;
    this._send(buildEvent(scr, EVENT.CLICKDOWN, `${x},${y}`));
    this._later(() => this._send(buildEvent(scr, EVENT.CLICKUP, `${x},${y}`)), 90);
  }

  // Gently cover both temp screens. Navigation is skipped while paused (after a nomore_client)
  // so we never storm the HMI — we just keep our slot and harvest whatever INIT it sends.
  _cycle(target) {
    if (!this.connected) return;
    const paused = Date.now() < this.navPausedUntil;
    if (!paused) {
      this.currentTarget = target;
      const nav = target === 'temp1' ? NAV.temp1 : NAV.temp2;
      this.log(`cycle -> ${target} (click ${nav.x},${nav.y})`);
      this._click(nav.x, nav.y);
    }
    const next = this.currentTarget === 'temp1' ? 'temp2' : 'temp1';
    this._later(() => this._cycle(next), this.dwellMs);
  }

  _screenNameFor(scrno) {
    if (scrno === 1) return 'temp1';
    if (scrno === 2) return 'temp2';
    return null;
  }

  _onMessage(data) {
    this.lastFrameAt = Date.now();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let act;
    try { act = P.hmiact.deserializeBinary(new Uint8Array(buf)); } catch (e) { return; }
    if (act.hasId && act.hasId() && this.clientId == null) this.clientId = act.getId();

    const ev = act.getEvent();
    const evo = ev ? ev.toObject() : {};
    if (evo.type === EV.INIT || evo.type === EV.CHANGESCR) {
      if (evo.scrno != null) this.currentScreen = evo.scrno;
    }
    if (evo.type === EV.JUMPHTML) {
      const html = bstr(evo.html);
      if (html.includes('nomore_client')) {
        // The HMI won't grant a new screen resource (another client — e.g. the operator's
        // browser — holds a slot). This frame does NOT kill our socket, so we keep it and
        // just stop navigating for a while, continuing to harvest whatever it streams.
        if (Date.now() > this.navPausedUntil) this.log('server: nomore_client — pausing navigation, keeping slot (close other HMI sessions for full data)');
        this.navPausedUntil = Date.now() + 60000;
      }
      return;
    }

    const screenName = this._screenNameFor(this.currentScreen);
    if (!screenName) return; // only harvest on temp screens

    const common = act.getCommonList() || [];
    let harvested = 0;
    for (const c of common) {
      const b = c.getBasic && c.getBasic();
      if (!b) continue;
      const type = bstr(b.getType_asU8 ? b.getType_asU8() : b.getType());
      if (type !== 'Numeric') continue;
      const text = bstr(b.getText_asU8 ? b.getText_asU8() : b.getText());
      const num = parseFloat(text);
      if (!isFinite(num)) continue;
      const left = b.getLeft && b.getLeft();
      const top = b.getTop && b.getTop();
      const column = nearestColumn(left);
      const zoneId = nearestZone(screenName, top);
      if (!column || !zoneId) continue;
      const z = this.zones[zoneId];
      if (z[column] !== num) this.log(`  ${zoneId}.${column} = ${num}`);
      z[column] = num;
      z.updatedAt = Date.now();
      harvested++;
    }
    if (harvested) this.log(`harvested ${harvested} numerics from ${screenName}`);
  }

  // Snapshot for the HTTP API
  getState() {
    const now = Date.now();
    const rooms = {};
    for (const z of ZONES) {
      const s = this.zones[z.id];
      const stale = s.updatedAt === 0 || (now - s.updatedAt) > 60000;
      const actual = s.actual;
      const setLow = s.setLow;
      const setHigh = s.setHigh;
      let alarm = false;
      if (actual != null && setLow != null && setHigh != null) {
        alarm = actual < setLow || actual > setHigh;
      }
      rooms[z.id] = {
        label: z.label,
        type: z.type,
        temperature: actual,
        setLow, setHigh,
        alarm,
        offline: stale,
        updatedAt: s.updatedAt || null,
      };
    }
    return {
      ok: this.connected,
      connected: this.connected,
      host: this.host,
      clientId: this.clientId,
      currentScreen: this.currentScreen,
      lastFrameAt: this.lastFrameAt || null,
      timestamp: new Date(now).toISOString(),
      rooms,
    };
  }
}

module.exports = { HmiClient };

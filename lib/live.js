// Pulse live feed hub (server side, self-hosted deployments only).
//
// When the dashboard runs as a long-lived process (`node server.js` on a plant PC) the collector can
// push readings straight to it over a WebSocket, and this hub relays snapshots to every open tab. On
// Vercel there is no long-lived process, so this file is never attached; there the browser subscribes
// to the collector's broadcasts through Supabase Realtime instead (see lib/live-client.js). Either way
// the database remains the durable record and the fallback.
//
// Endpoint: ws(s)://<host>/ws
//   ?role=publisher&token=<PULSE_LIVE_TOKEN>   the collector (must present the shared token)
//   anything else                              a dashboard (same trust level as GET /api/plc)
//
// Frames are JSON text:
//   publisher -> hub : { type: 'hello', agent, version }
//                      { type: 'readings', at: ISO, readings: [{ tag, value, ts }] }
//   hub -> publisher : { type: 'ack', received }
//   hub -> dashboard : { type: 'snapshot', ...same shape as GET /api/plc, source: 'live' }
//                      { type: 'status', publisher: boolean }
//
// CommonJS on purpose: required by server.js and by Next route handlers. Requiring it never opens a
// socket; `ws` is only loaded inside attach(), so this module is harmless in a serverless bundle.

const crypto = require('crypto');
const setpointsLib = require('./setpoints');
const snap = require('./live-snapshot');

function envInt(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
function envStr(name) {
  const v = process.env[name];
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

function getConfig() {
  return {
    token: envStr('PULSE_LIVE_TOKEN'),
    path: envStr('PULSE_LIVE_PATH') || '/ws',
    staleMs: envInt('PULSE_STALE_MS', 600000),
    // No readings from the collector for this long -> the feed is considered down and `connected` goes
    // false, which is the dashboard's cue to poll the database. The collector visits each screen roughly
    // every 35 s, so 90 s means at least two missed rounds.
    liveStaleMs: envInt('PULSE_LIVE_STALE_MS', 90000),
    maxSubscribers: envInt('PULSE_LIVE_MAX_SUBSCRIBERS', 50),
    heartbeatMs: envInt('PULSE_LIVE_HEARTBEAT_MS', 25000),
  };
}

// One hub per process, whoever loads this file. server.js requires it as plain Node, while Next.js
// compiles its own copy into the /api/live and /api/health route bundles - two module instances in the
// same process. Keeping the state on globalThis is what makes the routes see the hub that server.js
// attached instead of an empty twin (the same trick Next apps use for a shared pg pool).
const GLOBAL_KEY = '__pulseLiveHubState';
function freshState() {
  return {
    feed: snap.createLiveState(),
    publisher: null,        // the collector's socket, or null
    publisherSince: null,
    publisherAgent: null,
    rejected: 0,            // publisher attempts turned away (bad or missing token)
    subscribers: new Set(),
    wss: null,
    heartbeat: null,
    setpoints: null,
    setpointsSource: null,
    lastError: null,
  };
}
const state = globalThis[GLOBAL_KEY] || (globalThis[GLOBAL_KEY] = freshState());

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[live] ${msg}`);
}

// Operator set-points: same file / env contract as lib/db.js, read once per process.
function ensureSetpoints() {
  if (state.setpoints) return state.setpoints;
  const sp = setpointsLib.loadSetpointsFromEnv(process.env);
  state.setpoints = sp.setpoints || {};
  state.setpointsSource = sp.source || 'none';
  return state.setpoints;
}

// ---------------------------------------------------------------------------
// Ingest + snapshot
// ---------------------------------------------------------------------------

function ingest(list, receivedAt) {
  return snap.ingest(state.feed, list, receivedAt);
}

function feedAgeMs(now) {
  return snap.feedAgeMs(state.feed, now);
}

// Is the feed carrying fresh data right now?
function isLive(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const age = feedAgeMs(t);
  return state.publisher != null && age != null && age <= getConfig().liveStaleMs;
}

// buildSnapshot(now) -> the /api/plc shape, built from the in-memory readings.
function buildSnapshot(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const cfg = getConfig();
  const { rooms, stats } = snap.buildRooms(state.feed, { now: t, staleMs: cfg.staleMs, setpoints: ensureSetpoints() });
  const live = isLive(t);
  return {
    ok: true,
    connected: live,
    source: 'live',
    timestamp: new Date(t).toISOString(),
    detected: { ...snap.LIVE_DETECTED },
    rooms,
    stats,
    warning: stats.warning,
    live: {
      transport: 'ws',
      publisher: state.publisher != null,
      agent: state.publisherAgent,
      lastReadingsAt: state.feed.lastReadingsAt ? new Date(state.feed.lastReadingsAt).toISOString() : null,
      feedAgeMs: feedAgeMs(t),
      subscribers: state.subscribers.size,
    },
  };
}

// The latest snapshot for GET /api/live, or null when nothing has ever been received.
function getLatestSnapshot(now) {
  if (state.feed.latest.size === 0) return null;
  return buildSnapshot(now);
}

function getStatus(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const cfg = getConfig();
  return {
    attached: state.wss != null,
    path: cfg.path,
    tokenConfigured: Boolean(cfg.token),
    publisher: state.publisher != null,
    publisherAgent: state.publisherAgent,
    publisherSince: state.publisherSince ? new Date(state.publisherSince).toISOString() : null,
    live: isLive(t),
    lastReadingsAt: state.feed.lastReadingsAt ? new Date(state.feed.lastReadingsAt).toISOString() : null,
    feedAgeMs: feedAgeMs(t),
    liveStaleMs: cfg.liveStaleMs,
    tags: state.feed.latest.size,
    batches: state.feed.batches,
    readings: state.feed.readings,
    rejectedPublishers: state.rejected,
    subscribers: state.subscribers.size,
    lastError: state.lastError,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

// classifyConnection(url, cfg) -> { role: 'publisher' | 'subscriber' } | { role: 'reject', reason }
// A publisher must present the shared token. With no PULSE_LIVE_TOKEN configured, publishers are refused:
// the safe default is "nobody can push temperatures into the dashboard", not "anybody can".
function classifyConnection(url, cfg) {
  const role = (url.searchParams.get('role') || 'subscriber').toLowerCase();
  if (role !== 'publisher') return { role: 'subscriber' };
  if (!cfg.token) return { role: 'reject', reason: 'PULSE_LIVE_TOKEN is not set on the dashboard' };
  if (!safeEqual(url.searchParams.get('token'), cfg.token)) return { role: 'reject', reason: 'bad token' };
  return { role: 'publisher' };
}

// ---------------------------------------------------------------------------
// Socket handling
// ---------------------------------------------------------------------------

function send(ws, obj) {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  } catch (err) {
    state.lastError = err && err.message;
  }
}

function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of state.subscribers) {
    try { if (ws.readyState === 1) ws.send(text); } catch { /* dropped on close */ }
  }
}

function broadcastSnapshot() {
  if (state.subscribers.size === 0) return;
  broadcast({ type: 'snapshot', ...buildSnapshot(Date.now()) });
}

function onPublisherMessage(ws, data) {
  let msg;
  try { msg = JSON.parse(String(data)); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello') {
    state.publisherAgent = typeof msg.agent === 'string' ? msg.agent.slice(0, 80) : null;
    log(`collector connected${state.publisherAgent ? ` (${state.publisherAgent})` : ''}`);
    return;
  }
  if (msg.type === 'readings') {
    const n = ingest(msg.readings, Date.now());
    send(ws, { type: 'ack', received: n });
    if (n) broadcastSnapshot();
  }
}

function attachPublisher(ws, req) {
  if (state.publisher && state.publisher !== ws) {
    // A restarted collector reconnects before the old socket is noticed dead. Newest wins.
    log('replacing the previous collector connection');
    try { state.publisher.close(4000, 'replaced by a newer collector connection'); } catch { /* ignore */ }
  }
  state.publisher = ws;
  state.publisherSince = Date.now();
  state.publisherAgent = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => onPublisherMessage(ws, data));
  ws.on('close', () => {
    if (state.publisher === ws) {
      state.publisher = null;
      state.publisherSince = null;
      log('collector disconnected; dashboards fall back to the database');
      broadcast({ type: 'status', publisher: false });
    }
  });
  ws.on('error', (err) => { state.lastError = err && err.message; });
  send(ws, { type: 'welcome', role: 'publisher' });
  broadcast({ type: 'status', publisher: true });
  log(`collector attached from ${req.socket && req.socket.remoteAddress}`);
}

function attachSubscriber(ws) {
  const cfg = getConfig();
  if (state.subscribers.size >= cfg.maxSubscribers) {
    try { ws.close(1013, 'too many dashboards'); } catch { /* ignore */ }
    return;
  }
  state.subscribers.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => state.subscribers.delete(ws));
  ws.on('error', () => state.subscribers.delete(ws));
  send(ws, { type: 'status', publisher: state.publisher != null });
  if (state.feed.latest.size) send(ws, { type: 'snapshot', ...buildSnapshot(Date.now()) });
}

// attach(httpServer, { fallbackUpgrade }) - take over WebSocket upgrades on `path`; hand any other upgrade
// (Next.js dev HMR, for instance) to `fallbackUpgrade` when given.
function attach(server, opts) {
  // eslint-disable-next-line global-require
  const WebSocket = require('ws');
  const cfg = getConfig();
  const fallbackUpgrade = opts && typeof opts.fallbackUpgrade === 'function' ? opts.fallbackUpgrade : null;
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 256 * 1024 });
  state.wss = wss;
  ensureSetpoints();

  if (!cfg.token) log('PULSE_LIVE_TOKEN is not set: the collector will be refused and dashboards will poll the database');
  log(`live feed listening on ${cfg.path}`);

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== cfg.path) {
      if (fallbackUpgrade) fallbackUpgrade(req, socket, head);
      else socket.destroy();
      return;
    }
    const who = classifyConnection(url, cfg);
    if (who.role === 'reject') {
      state.rejected += 1;
      log(`publisher refused from ${socket.remoteAddress}: ${who.reason}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (who.role === 'publisher') attachPublisher(ws, req);
      else attachSubscriber(ws);
    });
  });

  // Standard ws liveness: ping everyone, drop whoever did not pong since the last round.
  state.heartbeat = setInterval(() => {
    const all = [...state.subscribers];
    if (state.publisher) all.push(state.publisher);
    for (const ws of all) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* ignore */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, cfg.heartbeatMs);
  if (state.heartbeat.unref) state.heartbeat.unref();

  return wss;
}

function detach() {
  if (state.heartbeat) clearInterval(state.heartbeat);
  state.heartbeat = null;
  for (const ws of state.subscribers) { try { ws.close(1001, 'server shutting down'); } catch { /* ignore */ } }
  state.subscribers.clear();
  if (state.publisher) { try { state.publisher.close(1001, 'server shutting down'); } catch { /* ignore */ } }
  state.publisher = null;
  if (state.wss) { try { state.wss.close(); } catch { /* ignore */ } }
  state.wss = null;
}

function _resetForTests() {
  detach();
  state.feed = snap.createLiveState();
  state.publisherSince = null;
  state.publisherAgent = null;
  state.rejected = 0;
  state.setpoints = null;
  state.setpointsSource = null;
  state.lastError = null;
}
function _setPublisherForTests(fake) { state.publisher = fake; }

module.exports = {
  attach,
  detach,
  ingest,
  buildSnapshot,
  getLatestSnapshot,
  getStatus,
  isLive,
  classifyConnection,
  getConfig,
  _resetForTests,
  _setPublisherForTests,
};

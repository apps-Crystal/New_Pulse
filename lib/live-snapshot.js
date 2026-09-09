// Live readings -> the /api/plc room shape.
//
// Isomorphic and pure: no I/O, no module-level state, no Node-only modules. The same code runs in two
// places: inside the self-hosted hub (lib/live.js, Node) and inside the browser when the dashboard
// receives the collector's broadcasts through Supabase Realtime - on Vercel there is no long-lived
// server, so the browser builds the snapshot itself.
//
// Readings go through rowsToSnapshot(), the same builder the database rows use, so the live view and
// the fallback view can never disagree about zone names, OFFLINE rules or alarm limits.

const { rowsToSnapshot, snapshotStats } = require('./schema-detect');
const { applySetpoints } = require('./setpoints');

const LIVE_DETECTED = Object.freeze({
  schema: null, table: null, mode: 'long', roomCol: 'tag', tempCol: 'value', tsCol: 'ts', via: 'live',
});

// The collector can be told to record each room's SET LOW / SET HIGH as their own tags
// ("Frozen Room 1 Set Low"). Fold those into the room's limits instead of showing them as extra rooms.
const RE_LIMIT_TAG = /^(.*?)\s+set\s*(low|high)$/i;

function createLiveState() {
  return {
    latest: new Map(),     // tag -> { value, ts, receivedAt }
    limits: new Map(),     // tag -> { setLow, setHigh }
    inputs: new Map(),     // tag -> { value, ts }   the panel's INPUT screen (doors, panic, phase)
    alarms: null,          // { active, recent, at }  the panel's own alarm log, as last broadcast
    lastReadingsAt: null,  // epoch ms of the last non-empty batch
    batches: 0,
    readings: 0,
  };
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function toMs(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : fallback;
}

// The collector sends { at, readings: [...] }; accept a bare array too.
function normalizeReadings(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.readings)) return payload.readings;
  return [];
}

// ingest(state, readings, receivedAt) -> number of readings accepted.
// Newest timestamp per tag wins; anything unparsable is skipped, never thrown.
function ingest(state, list, receivedAt) {
  const now = Number.isFinite(receivedAt) ? receivedAt : Date.now();
  let accepted = 0;
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.tag !== 'string' || !r.tag.trim()) continue;
    const value = toNum(r.value);
    if (value == null) continue;
    const ts = toMs(r.ts, now);
    const tag = r.tag.trim();

    const m = RE_LIMIT_TAG.exec(tag);
    if (m) {
      const base = m[1].trim();
      const cur = state.limits.get(base) || { setLow: null, setHigh: null };
      if (m[2].toLowerCase() === 'low') cur.setLow = value; else cur.setHigh = value;
      state.limits.set(base, cur);
      accepted += 1;
      continue;
    }

    const prev = state.latest.get(tag);
    if (prev && prev.ts > ts) continue; // out-of-order delivery: keep the newer one
    state.latest.set(tag, { value, ts, receivedAt: now });
    accepted += 1;
  }
  if (accepted) {
    state.lastReadingsAt = now;
    state.batches += 1;
    state.readings += accepted;
  }
  return accepted;
}

// The collector's INPUT screen and alarm log ride along with the readings:
//   { inputs: [{ tag, value, ts }], alarms: { active: [...], recent: [...], at } }
// ingestExtra(state, payload, receivedAt) -> number of things accepted (0 when the payload carries none).
function ingestExtra(state, payload, receivedAt) {
  const now = Number.isFinite(receivedAt) ? receivedAt : Date.now();
  let accepted = 0;
  if (payload && Array.isArray(payload.inputs)) {
    for (const i of payload.inputs) {
      if (!i || typeof i.tag !== 'string' || !i.tag.trim()) continue;
      const value = toNum(i.value);
      if (value == null) continue;
      const ts = toMs(i.ts, now);
      const tag = i.tag.trim();
      const prev = state.inputs.get(tag);
      if (prev && prev.ts > ts) continue;
      state.inputs.set(tag, { value, ts });
      accepted += 1;
    }
  }
  if (payload && payload.alarms && typeof payload.alarms === 'object') {
    const a = payload.alarms;
    const old = state.alarms || { active: [], recent: [] };
    state.alarms = {
      active: Array.isArray(a.active) ? a.active : old.active,
      recent: Array.isArray(a.recent) ? a.recent : old.recent,
      at: typeof a.at === 'string' ? a.at : new Date(now).toISOString(),
    };
    accepted += 1;
  }
  return accepted;
}

function shapePanelAlarms(alarms) {
  if (!alarms) return { active: [], recent: [], at: null };
  const clean = (list, active) => (Array.isArray(list) ? list : [])
    .filter((x) => x && Number.isInteger(Number(x.id)) && typeof x.message === 'string')
    .map((x) => ({ id: Number(x.id), at: x.at || null, message: x.message, state: x.state || '', resetAt: x.resetAt || null, active }));
  return { active: clean(alarms.active, true), recent: clean(alarms.recent, false), at: alarms.at || null };
}

function feedAgeMs(state, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  return state.lastReadingsAt == null ? null : t - state.lastReadingsAt;
}

// buildRooms(state, { now, staleMs, setpoints }) -> { rooms, stats, rowCount }
// `rooms` is exactly what /api/plc returns: all 16 zones in order, then any unknown tags.
function buildRooms(state, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const staleMs = o.staleMs == null ? 600000 : Number(o.staleMs);
  const rows = [];
  for (const [tag, r] of state.latest) {
    const lim = state.limits.get(tag) || {};
    rows.push({
      room: tag,
      temperature: r.value,
      set_low: lim.setLow == null ? null : lim.setLow,
      set_high: lim.setHigh == null ? null : lim.setHigh,
      ts_ms: r.ts,
    });
  }
  const rooms = rowsToSnapshot(LIVE_DETECTED, rows, { now, staleMs });
  applySetpoints(rooms, o.setpoints || {});
  const stats = snapshotStats(rooms, { now, rowCount: rows.length });
  const inputs = [...state.inputs].map(([tag, r]) => ({ tag, value: r.value, ts: new Date(r.ts).toISOString() }));
  return { rooms, stats, rowCount: rows.length, inputs, panelAlarms: shapePanelAlarms(state.alarms) };
}

module.exports = { LIVE_DETECTED, createLiveState, ingest, ingestExtra, buildRooms, feedAgeMs, normalizeReadings, shapePanelAlarms };

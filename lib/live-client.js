// Browser side of the live feed.
//
// Picks a transport and hands the dashboard ready-made snapshots in the /api/plc shape:
//
//   supabase - the collector broadcasts each batch on a Supabase Realtime channel; the browser subscribes
//              with the public anon key and builds the snapshot itself. This is the transport for the
//              Vercel deployment (no long-lived server there) and works anywhere.
//   ws       - the self-hosted hub in server.js pushes ready snapshots on ws://<host>/ws (only when the
//              dashboard runs as `node server.js` on a PC, and only when opted in).
//
// Whatever the transport, the caller (components/Dashboard.jsx) decides when the feed counts as healthy
// and when to fall back to polling the database. Reconnection is handled here: the Supabase client
// rejoins on its own after CHANNEL_ERROR / TIMED_OUT, but CLOSED is terminal in the library (the channel
// is dropped from the client), so that case rebuilds the channel with a backoff; the ws transport retries
// with backoff.

import { RealtimeClient } from '@supabase/realtime-js';

// CommonJS module shared with the Node hub; webpack handles the require in the client bundle.
const snap = require('./live-snapshot');

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const CHANNEL = process.env.NEXT_PUBLIC_PULSE_CHANNEL || 'pulse:readings';
// Private channels are gated by RLS on realtime.messages (see sql/realtime.sql in the collector repo):
// browsers may listen, only the collector's service-role key may publish. Public is opt-in.
export const CHANNEL_PRIVATE = (process.env.NEXT_PUBLIC_PULSE_CHANNEL_PRIVATE || 'true') !== 'false';
const WS_URL = process.env.NEXT_PUBLIC_LIVE_WS || '';
// The self-hosted hub only exists when the dashboard runs as `node server.js`. It is opt-in so a
// Vercel deployment without Supabase configured polls quietly instead of dialling a /ws that can
// never answer.
const HUB_ENABLED = process.env.NEXT_PUBLIC_LIVE_HUB === 'true' || Boolean(WS_URL);

const MAX_BACKOFF_MS = 30000;

export function liveTransport() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return 'supabase';
  if (HUB_ENABLED && typeof window !== 'undefined' && typeof window.WebSocket === 'function') return 'ws';
  return null;
}

/**
 * connectLive({ onSnapshot, onStatus, getSetpoints, getStaleMs }) -> { transport, close() }
 *   onSnapshot(snapshot)  a ready /api/plc-shaped object, source 'live'
 *   onStatus({ transport, up, detail })  up=false means "stop trusting the feed, poll the database now"
 *   getSetpoints()        operator limits to apply (supabase transport builds snapshots in the browser)
 *   getStaleMs()          OFFLINE threshold in ms, read per snapshot so it can follow the server's value
 */
export function connectLive(opts) {
  const t = liveTransport();
  if (t === 'supabase') return connectSupabase(opts);
  if (t === 'ws') return connectHub(opts);
  return { transport: null, close() {} };
}

// ---------------------------------------------------------------------------
// Supabase Realtime (broadcast)
// ---------------------------------------------------------------------------

// Explicit ws(s) scheme. Only recent browsers accept an http(s) URL in the WebSocket constructor, and the
// standalone realtime client hands the endpoint over untouched (supabase-js rewrites it the same way).
function realtimeEndpoint() {
  return `${SUPABASE_URL.replace(/^http/i, 'ws')}/realtime/v1`;
}

function connectSupabase({ onSnapshot, onStatus, getSetpoints, getStaleMs }) {
  const state = snap.createLiveState();
  let closed = false;
  let channel = null;
  let retryTimer = null;
  let backoff = 1000;

  const client = new RealtimeClient(realtimeEndpoint(), {
    params: { apikey: SUPABASE_ANON_KEY },
    heartbeatIntervalMs: 25000,
  });
  // The anon JWT doubles as the channel access token; private channels check it against RLS.
  try { client.setAuth(SUPABASE_ANON_KEY); } catch { /* older client: apikey param is enough */ }

  const staleMs = () => {
    const v = getStaleMs ? Number(getStaleMs()) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 600000;
  };

  const scheduleRejoin = () => {
    if (closed) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(join, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const join = () => {
    if (closed) return;
    const ch = client.channel(CHANNEL, { config: { broadcast: { self: false }, private: CHANNEL_PRIVATE } });
    channel = ch;

    ch.on('broadcast', { event: 'readings' }, (msg) => {
      if (closed || ch !== channel) return;
      const now = Date.now();
      const n = snap.ingest(state, snap.normalizeReadings(msg && msg.payload), now);
      if (!n) return;
      const { rooms, stats } = snap.buildRooms(state, { now, staleMs: staleMs(), setpoints: getSetpoints ? getSetpoints() : {} });
      onSnapshot({
        ok: true,
        connected: true,
        source: 'live',
        timestamp: new Date(now).toISOString(),
        detected: { ...snap.LIVE_DETECTED },
        rooms,
        stats,
        warning: stats.warning,
        live: { transport: 'supabase', channel: CHANNEL, feedAgeMs: 0, batches: state.batches },
      });
    });

    try {
      ch.subscribe((status, err) => {
        if (closed || ch !== channel) return; // our own close(), or a channel we already replaced
        if (status === 'SUBSCRIBED') {
          backoff = 1000;
          onStatus({ transport: 'supabase', up: true, detail: status });
          return;
        }
        onStatus({ transport: 'supabase', up: false, detail: err ? String(err.message || err) : status });
        // CHANNEL_ERROR and TIMED_OUT: the library rejoins on its own. CLOSED does not come back: the
        // channel has been removed from the client, so build a fresh one after a backoff.
        if (status === 'CLOSED') {
          channel = null;
          scheduleRejoin();
        }
      });
    } catch (err) {
      // A synchronous transport failure (bad URL, no WebSocket) must not escape into React.
      channel = null;
      onStatus({ transport: 'supabase', up: false, detail: String((err && err.message) || err) });
      scheduleRejoin();
    }
  };

  join();

  return {
    transport: 'supabase',
    close() {
      closed = true;
      clearTimeout(retryTimer);
      const ch = channel;
      channel = null;
      try { if (ch) ch.unsubscribe(); } catch { /* ignore */ }
      try { client.disconnect(); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Self-hosted hub (ws://<host>/ws)
// ---------------------------------------------------------------------------

function hubUrl() {
  if (WS_URL) return WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function connectHub({ onSnapshot, onStatus }) {
  const l = { ws: null, backoff: 1000, timer: null, stopped: false };

  const schedule = () => {
    if (l.stopped) return;
    clearTimeout(l.timer);
    l.timer = setTimeout(connect, l.backoff);
    l.backoff = Math.min(l.backoff * 2, MAX_BACKOFF_MS);
  };

  const connect = () => {
    if (l.stopped) return;
    let ws;
    try {
      ws = new WebSocket(hubUrl());
    } catch {
      schedule();
      return;
    }
    l.ws = ws;
    ws.onopen = () => {
      l.backoff = 1000;
      onStatus({ transport: 'ws', up: true, detail: 'open' });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg) return;
      if (msg.type === 'snapshot') onSnapshot(msg);
      // The collector dropped off the hub: stop trusting the feed right away.
      else if (msg.type === 'status' && msg.publisher === false) onStatus({ transport: 'ws', up: false, detail: 'collector disconnected' });
    };
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      l.ws = null;
      if (l.stopped) return;
      onStatus({ transport: 'ws', up: false, detail: 'closed' });
      schedule();
    };
  };

  connect();
  return {
    transport: 'ws',
    close() {
      l.stopped = true;
      clearTimeout(l.timer);
      const ws = l.ws;
      l.ws = null;
      if (ws) { try { ws.close(); } catch { /* ignore */ } }
    },
  };
}

// Browser side of the live feed.
//
// Picks a transport and hands the dashboard ready-made snapshots in the /api/plc shape:
//
//   supabase - the collector broadcasts each batch on a Supabase Realtime channel; the browser subscribes
//              with the public anon key and builds the snapshot itself. This is the transport for the
//              Vercel deployment (no long-lived server there) and works anywhere.
//   ws       - the self-hosted hub in server.js pushes ready snapshots on ws://<host>/ws (only when the
//              dashboard runs as `node server.js` on a PC).
//
// Whatever the transport, the caller (components/Dashboard.jsx) decides when the feed counts as healthy
// and when to fall back to polling the database. Reconnection is the transport's job: Supabase Realtime
// reconnects and rejoins on its own; the ws transport retries with backoff.

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

export function liveTransport() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return 'supabase';
  if (HUB_ENABLED && typeof window !== 'undefined' && typeof window.WebSocket === 'function') return 'ws';
  return null;
}

/**
 * connectLive({ onSnapshot, onStatus, getSetpoints, staleMs }) -> { transport, close() }
 *   onSnapshot(snapshot)  a ready /api/plc-shaped object, source 'live'
 *   onStatus({ transport, up, detail })  up=false means "stop trusting the feed, poll the database now"
 *   getSetpoints()        operator limits to apply (supabase transport builds snapshots in the browser)
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

function connectSupabase({ onSnapshot, onStatus, getSetpoints, staleMs = 600000 }) {
  const state = snap.createLiveState();
  const client = new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, {
    params: { apikey: SUPABASE_ANON_KEY },
    heartbeatIntervalMs: 25000,
  });
  // The anon JWT doubles as the channel access token; private channels check it against RLS.
  try { client.setAuth(SUPABASE_ANON_KEY); } catch { /* older client: apikey param is enough */ }

  const channel = client.channel(CHANNEL, { config: { broadcast: { self: false }, private: CHANNEL_PRIVATE } });

  channel.on('broadcast', { event: 'readings' }, (msg) => {
    const now = Date.now();
    const n = snap.ingest(state, snap.normalizeReadings(msg && msg.payload), now);
    if (!n) return;
    const { rooms, stats } = snap.buildRooms(state, { now, staleMs, setpoints: getSetpoints ? getSetpoints() : {} });
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

  channel.subscribe((status, err) => {
    // SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED. The client keeps retrying on its own; we only
    // tell the dashboard whether to trust the feed right now.
    const up = status === 'SUBSCRIBED';
    onStatus({ transport: 'supabase', up, detail: err ? String(err.message || err) : status });
  });

  return {
    transport: 'supabase',
    close() {
      try { channel.unsubscribe(); } catch { /* ignore */ }
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
    l.backoff = Math.min(l.backoff * 2, 30000);
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

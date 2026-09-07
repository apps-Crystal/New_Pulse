// GET /api/live - the newest snapshot the collector pushed over the WebSocket, in the /api/plc shape.
// Useful for a quick check and as a non-WebSocket fallback. 503 until the collector has sent something,
// and always 503 on Vercel (no long-lived server there, so no live feed - the dashboard polls /api/plc).
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getLatestSnapshot } from '../../../lib/live';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const snap = getLatestSnapshot();
    if (!snap) {
      return Response.json(
        { ok: false, connected: false, source: 'live', error: 'no live readings received yet', timestamp: new Date().toISOString(), detected: null, rooms: {} },
        { status: 503, headers: NO_STORE }
      );
    }
    return Response.json(snap, { status: snap.connected ? 200 : 503, headers: NO_STORE });
  } catch (err) {
    return Response.json(
      { ok: false, connected: false, source: 'live', error: (err && err.message) || String(err), timestamp: new Date().toISOString(), detected: null, rooms: {} },
      { status: 503, headers: NO_STORE }
    );
  }
}

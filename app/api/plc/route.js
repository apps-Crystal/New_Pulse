// GET /api/plc - live room snapshot from the Supabase Postgres data source.
// Polled by the dashboard every 2s. Must never return an HTML error page.
export const dynamic = 'force-dynamic';
export const maxDuration = 10; // seconds; Vercel serverless limit for this route
export const revalidate = 0;
export const runtime = 'nodejs';

import { getSnapshot } from '../../../lib/db';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const snap = await getSnapshot();
    return Response.json(snap, { status: snap.connected ? 200 : 503, headers: NO_STORE });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        connected: false,
        source: 'supabase',
        error: (err && err.message) || String(err),
        timestamp: new Date().toISOString(),
        detected: null,
        rooms: {},
      },
      { status: 503, headers: NO_STORE }
    );
  }
}

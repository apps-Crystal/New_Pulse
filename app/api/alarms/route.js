// GET /api/alarms?limit=300 - the panel's alarm log as the collector recorded it (panel_alarms), newest
// first, active alarms included. Server-only: reads Postgres with DATABASE_URL like /api/plc.
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getPanelAlarms } from '../../../lib/db';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 300));
    const alarms = await getPanelAlarms(limit);
    return Response.json({ ok: true, alarms, count: alarms.length }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, alarms: [], error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

// GET /api/setpoints - the operator alarm limits (PULSE_SETPOINTS / setpoints.json), keyed by zone id.
// The browser needs them to build snapshots from the collector's live broadcasts; they are the same
// values every room card already shows, so nothing new is exposed.
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getSetpoints, getStatus } from '../../../lib/db';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const setpoints = getSetpoints();
    return Response.json({ ok: true, setpoints, source: getStatus().setpointsSource }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, setpoints: {}, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

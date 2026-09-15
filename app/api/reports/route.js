// GET /api/reports            -> { ok, days: [{ day, zones }] }   the archived days, newest first
// GET /api/reports?day=YYYY-MM-DD -> { ok, day, zones: [...] }     that day's per-zone summaries
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getReportDays, getDailyReports } from '../../../lib/db';
import { shapeReportSummary } from '../../../lib/reports';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  const url = new URL(request.url);
  const day = String(url.searchParams.get('day') || '').trim();
  try {
    if (!day) {
      const days = await getReportDays();
      return Response.json({ ok: true, days }, { headers: NO_STORE });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ ok: false, error: 'day must be YYYY-MM-DD' }, { status: 400, headers: NO_STORE });
    const rows = await getDailyReports(day);
    return Response.json({ ok: true, day, zones: rows.map(shapeReportSummary) }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

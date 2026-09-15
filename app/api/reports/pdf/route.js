// GET /api/reports/pdf?day=YYYY-MM-DD&zone=all|<zone id>
// The archived day as a Crystal Group daily temperature report (PDF), one zone or all of them,
// computed from the 5-minute rows.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getDailySamples } from '../../../../lib/db';
import { buildZoneReports } from '../../../../lib/reports';
import { renderDayPdf, reportFileName } from '../../../../lib/report-pdf';
import { LOGO_PNG_BASE64 } from '../../../../lib/report-logo';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  const url = new URL(request.url);
  const day = String(url.searchParams.get('day') || '').trim();
  const zone = String(url.searchParams.get('zone') || 'all').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ ok: false, error: 'day must be YYYY-MM-DD' }, { status: 400, headers: NO_STORE });
  if (!/^[a-z0-9_]{1,80}$/.test(zone)) return Response.json({ ok: false, error: 'bad zone' }, { status: 400, headers: NO_STORE });
  try {
    const samples = await getDailySamples(day, zone === 'all' ? null : zone);
    const reports = buildZoneReports(day, samples);
    if (reports.length === 0) return Response.json({ ok: false, error: `no archived data for ${day}${zone === 'all' ? '' : ` / ${zone}`}` }, { status: 404, headers: NO_STORE });
    const bytes = await renderDayPdf({ day, reports, logoPng: Buffer.from(LOGO_PNG_BASE64, 'base64'), generatedAt: new Date() });
    const name = reportFileName(day, reports);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

// GET /api/health - data-layer status for monitoring / kiosk watchdogs.
export const dynamic = 'force-dynamic';
export const maxDuration = 10; // seconds; Vercel serverless limit for this route
export const revalidate = 0;
export const runtime = 'nodejs';

import { getStatus } from '../../../lib/db';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    return Response.json(
      { ok: true, ...getStatus(), uptime: process.uptime(), node: process.version },
      { headers: NO_STORE }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: (err && err.message) || String(err), uptime: process.uptime(), node: process.version },
      { status: 500, headers: NO_STORE }
    );
  }
}

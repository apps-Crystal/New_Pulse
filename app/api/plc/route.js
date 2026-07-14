// Same-origin proxy to the local bridge. Keeps the browser off cross-origin requests and
// gives a clean failure shape when the bridge is unreachable.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:4000';

export async function GET() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${BRIDGE_URL}/api/plc`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = await res.json();
    return Response.json(data, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        connected: false,
        source: 'hmi',
        error: `bridge unreachable: ${e.message}`,
        timestamp: new Date().toISOString(),
        rooms: {},
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

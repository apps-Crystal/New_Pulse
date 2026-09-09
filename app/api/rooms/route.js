// GET  /api/rooms                 -> { ok, rooms: { zoneId: { operational, updatedAt } } }
// PATCH /api/rooms { id, operational } -> the same map after the change
// Per-room "in service / out of service", stored in Postgres (room_settings) so every screen agrees.
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getRoomSettings, setRoomOperational } from '../../../lib/db';
import { isZoneId } from '../../../lib/rooms';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const rooms = await getRoomSettings();
    return Response.json({ ok: true, rooms }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, rooms: {}, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

export async function PATCH(request) {
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  const id = body && body.id;
  const operational = body && body.operational;
  if (!isZoneId(id) || typeof operational !== 'boolean') {
    return Response.json({ ok: false, error: 'expected { id: <zone id>, operational: true | false }' }, { status: 400, headers: NO_STORE });
  }
  try {
    const rooms = await setRoomOperational(id, operational);
    return Response.json({ ok: true, rooms }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

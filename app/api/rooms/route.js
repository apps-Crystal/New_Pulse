// GET  /api/rooms                 -> { ok, rooms: { zoneId: { operational, updatedAt } } }
// PATCH /api/rooms { id, operational } -> the same map after the change
// Per-room "in service / out of service", stored in Postgres (room_settings) so every screen agrees.
export const dynamic = 'force-dynamic';
export const maxDuration = 10;
export const revalidate = 0;
export const runtime = 'nodejs';

import { getRoomSettings, setRoomSettings } from '../../../lib/db';
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
  const patch = {};
  if (body && typeof body.operational === 'boolean') patch.operational = body.operational;
  if (body && typeof body.sensorFault === 'boolean') patch.sensorFault = body.sensorFault;
  if (body && body.note !== undefined) patch.note = body.note == null ? null : String(body.note);
  if (!isZoneId(id) || Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: 'expected { id: <zone id>, operational?: boolean, sensorFault?: boolean, note?: string | null }' }, { status: 400, headers: NO_STORE });
  }
  try {
    const rooms = await setRoomSettings(id, patch);
    return Response.json({ ok: true, rooms }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ ok: false, error: (err && err.message) || String(err) }, { status: 500, headers: NO_STORE });
  }
}

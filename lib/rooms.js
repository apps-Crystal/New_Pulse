// Per-room settings shared by every screen: today just "in service / out of service". A room marked out
// of service keeps showing its temperature and doors but can never raise an alarm or a warning.
// Pure and isomorphic; the database side lives in lib/db.js (table room_settings), the UI in RoomCard.

const { ZONES } = require('./zones');

const ZONE_IDS = new Set(ZONES.map((z) => z.id));

function isZoneId(id) {
  return typeof id === 'string' && ZONE_IDS.has(id);
}

function isOperational(room) {
  return !room || room.operational !== false;
}

// applyRoomSettings(rooms, settings) -> rooms. settings: { zoneId: { operational: boolean } }.
// Sets room.operational on every room (true when unset) and clears the alarm flag on rooms that are off.
function applyRoomSettings(rooms, settings) {
  if (!rooms) return rooms;
  const s = settings && typeof settings === 'object' ? settings : {};
  const entries = Array.isArray(rooms) ? rooms.map((r) => [r && r.id, r]) : Object.keys(rooms).map((id) => [id, rooms[id]]);
  for (const [id, room] of entries) {
    if (!room || typeof room !== 'object') continue;
    const entry = id != null ? s[id] : undefined;
    const operational = !(entry && entry.operational === false);
    room.operational = operational;
    if (!operational) room.alarm = false;
  }
  return rooms;
}

// Rows from room_settings -> { zoneId: { operational, updatedAt } }
function shapeRoomSettings(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isZoneId(r.zone_id)) continue;
    const ms = Number(r.updated_ms);
    out[r.zone_id] = { operational: r.operational !== false, updatedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
  }
  return out;
}

module.exports = { applyRoomSettings, isOperational, isZoneId, shapeRoomSettings, ZONE_IDS };

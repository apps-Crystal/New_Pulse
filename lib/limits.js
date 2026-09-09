// The band rules for a room's SET LOW / SET HIGH, in one place so every path that can put limits on a
// room applies them: database columns, folded "<room> Set Low/High" rows, the live feed, and the
// operator / database seed that applySetpoints fills in afterwards.
//
// Equal limits are the panel's "0 / 0" for a room nobody configured: no limits (an operator fallback may
// still fill them). Low above high is the panel's two numbers typed into each other's box (the plant's
// frozen rooms were entered as LOW -14 / HIGH -25): the band it means is the other way round, so it is
// shown and evaluated as -25 to -14 and marked `limitsSwapped` so the card can say so. `limitsInvalid`
// is kept for consumers that check it; nothing sets it any more.
function normaliseLimits(room) {
  if (!room || typeof room !== 'object') return room;
  const lo = room.setLow;
  const hi = room.setHigh;
  room.limitsInvalid = false;
  // Sticky within one snapshot: the rules run when the row is folded and again after the operator fallback
  // is applied, and the second pass sees an already-corrected band. Rooms are rebuilt for every snapshot.
  room.limitsSwapped = Boolean(room.limitsSwapped);
  if (lo == null || hi == null) return room;
  if (lo === hi) { room.setLow = null; room.setHigh = null; return room; }
  if (lo > hi) { room.setLow = hi; room.setHigh = lo; room.limitsSwapped = true; }
  return room;
}

// The plant's fixed alarm bands (9 Sep 2026): frozen rooms and blast freezers -22 to -18, chilled rooms
// +2 to +4, anterooms +2 to +8, nothing for the dock. They replace whatever the panel or an operator file
// says, on both paths, unless NEXT_PUBLIC_FIXED_LIMITS=false.
const FIXED_LIMITS_ENABLED = (() => {
  const v = typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_FIXED_LIMITS : undefined;
  return !(typeof v === 'string' && /^(false|0|off|no)$/i.test(v.trim()));
})();
function fixedLimitsFor(id, type) {
  if (/_anteroom$/.test(id)) return { setLow: 2, setHigh: 8 };
  if (type === 'frozen') return { setLow: -22, setHigh: -18 };
  if (type === 'chiller') return { setLow: 2, setHigh: 4 };
  return null;
}
function applyFixedLimits(rooms) {
  if (!FIXED_LIMITS_ENABLED || !rooms) return rooms;
  const entries = Array.isArray(rooms) ? rooms.map((r) => [r && r.id, r]) : Object.keys(rooms).map((id) => [id, rooms[id]]);
  for (const [id, room] of entries) {
    if (!room || typeof room !== 'object' || !id) continue;
    const fixed = fixedLimitsFor(String(id), room.type);
    if (!fixed) continue;
    room.setLow = fixed.setLow;
    room.setHigh = fixed.setHigh;
    room.limitsSwapped = false;
    room.limitsInvalid = false;
    room.limitsFixed = true;
    const t = room.temperature;
    room.alarm = t != null && !Number.isNaN(t) && (t < fixed.setLow || t > fixed.setHigh);
  }
  return rooms;
}

module.exports = { normaliseLimits, applyFixedLimits, fixedLimitsFor, FIXED_LIMITS_ENABLED };

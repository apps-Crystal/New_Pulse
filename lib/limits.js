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

module.exports = { normaliseLimits };

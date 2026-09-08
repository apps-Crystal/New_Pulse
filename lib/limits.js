// The band rules for a room's SET LOW / SET HIGH, in one place so every path that can put limits on a
// room applies them: database columns, folded "<room> Set Low/High" rows, the live feed, and the
// operator / database seed that applySetpoints fills in afterwards.
//
// A pair of limits that cannot be a band is not a band. Equal limits are the panel's "0 / 0" for a room
// nobody configured: no limits (an operator fallback may still fill them). Low above high is a
// data-entry slip on the panel: keep the numbers so the operator sees exactly what the panel says, flag
// the room, and never raise a temperature alarm from it.
function normaliseLimits(room) {
  if (!room || typeof room !== 'object') return room;
  const lo = room.setLow;
  const hi = room.setHigh;
  room.limitsInvalid = false;
  if (lo == null || hi == null) return room;
  if (lo === hi) { room.setLow = null; room.setHigh = null; return room; }
  if (lo > hi) room.limitsInvalid = true;
  return room;
}

module.exports = { normaliseLimits };

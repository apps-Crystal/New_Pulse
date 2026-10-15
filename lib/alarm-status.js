// What the panel alarm history shows for one alarm, from the fields the collector records
// (raised_at, reset_at, active, message). Plain JS so it can be tested without React.

export function kindOf(message) {
  if (/door/i.test(message)) return 'door';
  if (/panic/i.test(message)) return 'panic';
  if (/temp/i.test(message)) return 'temp';
  return 'other';
}

/** "45 s", "4 min 12 s", "1 h 05 min" -- the length of a door opening or an alarm. */
export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '\u2014';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h} h ${String(mm).padStart(2, '0')} min` : `${h} h`;
}

/** "low" / "high" from the panel's message ("Chiller Room 2 Temp Low"), else "out of range". */
export function tempWord(message) {
  if (/\blow\b/i.test(message)) return 'low';
  if (/\bhigh\b/i.test(message)) return 'high';
  return 'out of range';
}

/**
 * The Status cell. A door alarm says how long the door was open (or has been open so far); a
 * temperature alarm says whether it is resolved, how long the temperature was low / high and from
 * when to when; anything else keeps Active / Reset.
 * `now` is the client clock in ms, or null before the first client render (no live duration then).
 * `fmtWhen` formats an ISO time for the viewer.
 */
export function alarmStatus(a, now, fmtWhen = (iso) => iso) {
  const kind = kindOf(a.message || '');
  const at = Date.parse(a.at);
  const reset = a.resetAt ? Date.parse(a.resetAt) : NaN;
  if (kind === 'door') {
    if (a.active) return { text: Number.isFinite(now) && Number.isFinite(at) ? `Open for ${fmtDur(now - at)} \u00b7 still open` : 'Still open', tone: 'bad' };
    if (Number.isFinite(reset) && Number.isFinite(at)) return { text: `Open ${fmtDur(reset - at)}`, tone: 'ok' };
    return { text: a.state || 'cleared', tone: 'muted' };
  }
  if (kind === 'temp') {
    const word = tempWord(a.message || '');
    if (a.active) {
      const since = Number.isFinite(at) ? ` \u00b7 since ${fmtWhen(a.at)}` : '';
      return { text: Number.isFinite(now) && Number.isFinite(at) ? `Not resolved \u00b7 ${word} for ${fmtDur(now - at)}${since}` : `Not resolved${since}`, tone: 'bad' };
    }
    if (Number.isFinite(reset) && Number.isFinite(at)) return { text: `Resolved \u00b7 ${word} for ${fmtDur(reset - at)} \u00b7 ${fmtWhen(a.at)} to ${fmtWhen(a.resetAt)}`, tone: 'ok' };
    if (Number.isFinite(reset)) return { text: `Resolved ${fmtWhen(a.resetAt)}`, tone: 'ok' };
    return { text: a.state || 'cleared', tone: 'muted' };
  }
  if (a.active) return { text: 'Active', tone: 'bad' };
  if (Number.isFinite(reset)) return { text: `Reset ${fmtWhen(a.resetAt)}`, tone: 'muted' };
  return { text: a.state || 'cleared', tone: 'muted' };
}

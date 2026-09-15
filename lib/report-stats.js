// Recorder statistics for one zone-day, computed from its 5-minute rows (daily_samples) the way a LogTag
// recorder computes them from its own readings: each slot with data is one reading (its average) that
// stands for the slot's length. Lowest / highest come from the lowest / highest raw reading inside the
// slots; average, standard deviation and MKT weight each slot by how many raw readings it holds, so the
// average is exactly the raw average. Alarms are judged on the slot average: below the lower limit or
// above the upper limit. Pure and isomorphic; no database, no time zone (timestamps stay as they are).
'use strict';

const MS_MIN = 60000;
// LogTag prints "MKT (dH 83.144)": activation energy 83.144 kJ/mol, R = 8.314472 J/(mol K).
const DELTA_H = 83144;
const R_GAS = 8.314472;
const KELVIN = 273.15;

const num = (v) => (v == null ? null : Number(v));
const finite = (v) => v != null && Number.isFinite(Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const round = (x, dp) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp);

function countEvents(text) {
  if (!text) return 0;
  return String(text).split(';').filter((s) => s.trim()).length;
}

/**
 * rows: daily_samples rows of one zone-day ({ slot, ts, avg_temp, min_temp, max_temp, readings, events }).
 * limits: { low, high } or null. intervalMin: the slot length.
 */
function dayStats(rows, limits, { intervalMin = 5 } = {}) {
  const sorted = [...(rows || [])].sort((a, b) => Number(a.slot) - Number(b.slot));
  const lo = limits && finite(limits.low) ? Number(limits.low) : null;
  const hi = limits && finite(limits.high) ? Number(limits.high) : null;
  const block = () => ({ status: 'n/a', triggered: null, minutes: 0, occurrences: 0, degMinutes: 0 });
  const lower = block();
  const upper = block();
  if (lo != null) lower.status = 'ok';
  if (hi != null) upper.status = 'ok';

  const withData = sorted.filter((r) => finite(r.avg_temp));
  const readings = sorted.reduce((s, r) => s + (Number(r.readings) || 0), 0);
  const doorEvents = sorted.reduce((s, r) => s + countEvents(r.events), 0);

  // Gaps: runs of slots without data.
  const gaps = [];
  let run = null;
  const dayEndMs = sorted.length ? new Date(sorted[sorted.length - 1].ts).getTime() + intervalMin * MS_MIN : null;
  for (const r of sorted) {
    const has = finite(r.avg_temp);
    if (!has) { if (!run) run = { from: new Date(r.ts).getTime(), slots: 0 }; run.slots += 1; continue; }
    if (run) { gaps.push({ from: iso(run.from), to: iso(new Date(r.ts).getTime()), minutes: run.slots * intervalMin }); run = null; }
  }
  if (run) gaps.push({ from: iso(run.from), to: iso(dayEndMs), minutes: run.slots * intervalMin });
  const gapMinutes = gaps.reduce((s, g) => s + g.minutes, 0);

  const base = {
    readings, slots: sorted.length, slotsWithData: withData.length, intervalMin,
    first: null, last: null, elapsedMin: 0,
    lowest: null, lowestAt: null, highest: null, highestAt: null, average: null, stdDev: null, mkt: null,
    lower, upper, notInAlertMin: 0, gapMinutes, gaps, doorEvents,
  };
  if (withData.length === 0) return base;

  const k = DELTA_H / R_GAS;
  let W = 0;
  let sum = 0;
  let sumExp = 0;
  let lowest = null;
  let highest = null;
  for (const r of withData) {
    const a = Number(r.avg_temp);
    const w = Math.max(1, Number(r.readings) || 0);
    W += w;
    sum += a * w;
    sumExp += w * Math.exp(-k / (a + KELVIN));
    const mn = finite(r.min_temp) ? Number(r.min_temp) : a;
    const mx = finite(r.max_temp) ? Number(r.max_temp) : a;
    if (!lowest || mn < lowest.v) lowest = { v: mn, at: r.ts };
    if (!highest || mx > highest.v) highest = { v: mx, at: r.ts };
  }
  const mean = sum / W;
  let ss = 0;
  for (const r of withData) { const a = Number(r.avg_temp); const w = Math.max(1, Number(r.readings) || 0); ss += w * (a - mean) ** 2; }
  const sd = W > 1 ? Math.sqrt(ss / (W - 1)) : 0;
  const mkt = k / -Math.log(sumExp / W) - KELVIN;

  let inLow = false;
  let inHigh = false;
  let notInAlert = 0;
  for (const r of withData) {
    const a = Number(r.avg_temp);
    const below = lo != null && a < lo;
    const above = hi != null && a > hi;
    if (below) {
      if (!inLow) lower.occurrences += 1;
      if (lower.triggered == null) lower.triggered = iso(r.ts);
      lower.minutes += intervalMin;
      lower.degMinutes += (lo - a) * intervalMin;
    }
    inLow = below;
    if (above) {
      if (!inHigh) upper.occurrences += 1;
      if (upper.triggered == null) upper.triggered = iso(r.ts);
      upper.minutes += intervalMin;
      upper.degMinutes += (a - hi) * intervalMin;
    }
    inHigh = above;
    if (!below && !above) notInAlert += intervalMin;
  }
  if (lo != null) lower.status = lower.occurrences ? 'fail' : 'ok';
  if (hi != null) upper.status = upper.occurrences ? 'fail' : 'ok';
  lower.degMinutes = round(lower.degMinutes, 2);
  upper.degMinutes = round(upper.degMinutes, 2);

  const firstMs = new Date(withData[0].ts).getTime();
  const lastMs = new Date(withData[withData.length - 1].ts).getTime();
  return {
    ...base,
    first: iso(firstMs),
    last: iso(lastMs),
    // A recorder counts its last reading's interval too (313 readings at 5 min = 1 day 2 h 5 min).
    elapsedMin: Math.round((lastMs - firstMs) / MS_MIN) + intervalMin,
    lowest: lowest.v, lowestAt: iso(lowest.at),
    highest: highest.v, highestAt: iso(highest.at),
    // Full precision here; the page and the PDF round once, for display (rounding twice would print
    // the reference report's MKT of -15.45 as -15.4 where LogTag prints -15.5).
    average: mean, stdDev: sd, mkt,
    notInAlertMin: notInAlert,
  };
}

module.exports = { dayStats, countEvents };

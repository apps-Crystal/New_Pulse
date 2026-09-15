const test = require('node:test');
const assert = require('node:assert/strict');
const { dayStats, countEvents } = require('../lib/report-stats');

const MIN = 60000;

// ---------------------------------------------------------------------------------------------------
// A real LogTag report as the reference: "CR 2 Started 19-06-2026, Finished 20-06-2026" (COLD ROOM 2,
// TRIX-8 recorder, 313 readings every 5 minutes, alarms -22.0 / -18.0). Its summary page says:
//   Lowest -20.5 @ 20-06-2026 02:26:03, Highest 20.6 @ 19-06-2026 11:01:03, Average -19.5, SD 2.9 (S),
//   MKT (dH 83.144) -15.5, elapsed 1 Day 2 Hours 5 Minutes, upper alarm: triggered 19-06-2026 11:01:03,
//   15 minutes, 2 occurrences, 349.00 degC-minutes; lower alarm none; time not in alert 1 Day 1 Hour 50 Min.
// Each of its readings is one 5-minute row here (average = the reading, one reading per slot).
// ---------------------------------------------------------------------------------------------------
const LOGTAG_CR2 = [
  20.6, -14.8, -18.9, -19.5, -19.5, -19.5, -19.4, -19.4, -19.3, -19.5, -19.6, -19.6, -19.7, -19.9, -19.9, -19.8, -19.5, -19.1, -19.2, -19.5,
  -19.6, -19.7, -19.7, -19.8, -19.8, -19.8, -19.9, -19.7, -19.5, -19.6, -19.5, -19.5, -19.3, -19.3, -19.4, -19.3, -19.5, -19.6, -19.8, -19.9,
  -19.8, -19.9, -20.0, -20.1, -20.1, -20.1, -20.2, -20.1, -20.2, -20.2, -20.0, -19.8, -19.6, -19.5, -19.5, -19.4, -19.4, -19.6, -19.8, -19.9,
  -20.0, -20.0, -20.0, -19.7, -19.5, -19.0, -19.1, -19.4, -19.6, -19.7, -19.9, -20.0, -20.0, -20.1, -20.1, -20.1, -19.9, -19.8, -19.9, -19.9,
  -20.1, -19.9, -20.1, -20.0, -20.1, -20.1, -20.1, -20.0, -19.8, -20.0, -20.1, -20.1, -20.1, -20.2, -20.2, -20.2, -20.3, -20.3, -20.1, -19.8,
  -19.6, -19.7, -19.9, -19.9, -20.0, -20.0, -20.1, -20.1, -20.1, -20.1, -20.1, -20.1, -19.5, -19.6, -19.7, -19.8, -19.9, -20.0, -20.1, -20.0,
  -20.1, -20.1, -20.1, -20.0, -20.0, -20.1, -20.1, -20.1, -20.2, -20.2, -20.3, -20.2, -20.1, -20.2, -20.1, -20.2, -20.2, -20.1, -20.2, -20.2,
  -20.2, -20.2, -20.1, -20.2, -20.2, -20.2, -20.1, -19.9, -19.8, -20.0, -20.1, -20.2, -20.3, -20.2, -20.1, -20.2, -20.2, -20.2, -20.2, -19.8,
  -19.3, -19.4, -19.6, -19.8, -19.9, -20.0, -20.0, -20.1, -20.1, -20.1, -20.2, -20.1, -20.1, -19.9, -20.1, -20.1, -20.2, -20.2, -20.3, -20.3,
  -20.4, -20.4, -20.3, -20.4, -20.4, -20.5, -20.2, -19.7, -19.5, -19.3, -19.3, -19.2, -19.1, -19.1, -19.0, -19.0, -18.9, -19.1, -19.2, -19.1,
  -19.0, -19.0, -18.9, -18.9, -18.8, -18.8, -18.8, -18.8, -18.5, -18.8, -19.1, -19.4, -19.7, -19.7, -19.7, -19.8, -19.8, -19.9, -20.0, -19.8,
  -19.7, -19.8, -19.9, -19.9, -20.0, -20.0, -19.9, -19.9, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0, -20.0,
  -20.1, -20.0, -19.7, -19.7, -19.8, -19.9, -20.0, -20.1, -20.1, -20.2, -20.3, -20.3, -20.3, -19.8, -19.6, -20.0, -19.3, -19.1, -19.1, -19.1,
  -19.0, -19.0, -19.0, -19.0, -18.9, -19.0, -18.9, -18.8, -18.8, -18.8, -18.8, -18.8, -18.9, -18.9, -18.8, -18.9, -18.9, -18.9, -18.9, -18.9,
  -18.9, -18.9, -18.9, -18.9, -18.9, -18.9, -18.9, -18.9, -18.9, -18.9, -18.8, -18.7, -18.8, -18.8, -18.9, -19.1, -19.3, -19.4, -19.5, -19.6,
  -19.7, -19.8, -19.9, -19.8, -19.5, -19.1, -19.4, -19.6, -19.7, -19.8, -19.8, -19.9, 10.0,
];
const CR2_START = Date.UTC(2026, 5, 19, 5, 31, 3); // 19-06-2026 11:01:03 IST
const fmtIst = (isoStr) => { const d = new Date(new Date(isoStr).getTime() + 330 * MIN); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };

test('report-stats: the LogTag CR 2 recorder report is reproduced from its readings as 5-minute rows', () => {
  assert.equal(LOGTAG_CR2.length, 313);
  const rows = LOGTAG_CR2.map((v, i) => ({ slot: i * 5, ts: new Date(CR2_START + i * 5 * MIN), avg_temp: v, min_temp: v, max_temp: v, readings: 1, events: null }));
  const s = dayStats(rows, { low: -22, high: -18 });
  assert.equal(s.readings, 313);
  assert.equal(s.slotsWithData, 313);
  assert.equal(Math.round(s.average * 10) / 10, -19.5);
  assert.equal(Math.round(s.stdDev * 10) / 10, 2.9);
  assert.equal(Math.round(s.mkt * 10) / 10, -15.5);
  assert.equal(s.lowest, -20.5);
  assert.equal(fmtIst(s.lowestAt), '20-06-2026 02:26:03');
  assert.equal(s.highest, 20.6);
  assert.equal(fmtIst(s.highestAt), '19-06-2026 11:01:03');
  assert.equal(s.elapsedMin, 1565); // 1 Day 2 Hours 5 Minutes
  assert.equal(s.upper.status, 'fail');
  assert.equal(fmtIst(s.upper.triggered), '19-06-2026 11:01:03');
  assert.equal(s.upper.minutes, 15);
  assert.equal(s.upper.occurrences, 2);
  assert.equal(s.upper.degMinutes, 349);
  assert.equal(s.lower.status, 'ok');
  assert.equal(s.lower.triggered, null);
  assert.equal(s.lower.minutes, 0);
  assert.equal(s.notInAlertMin, 1550); // 1 Day 1 Hour 50 Minutes
  assert.equal(s.gapMinutes, 0);
});

test('report-stats: slots are weighted by their readings, extremes come from the slot min / max, gaps and door events are counted', () => {
  const t0 = Date.UTC(2026, 8, 13, 18, 30, 0);
  const row = (k, avg, n, extra = {}) => ({ slot: k * 5, ts: new Date(t0 + k * 5 * MIN), avg_temp: avg, min_temp: avg, max_temp: avg, readings: n, events: null, ...extra });
  const rows = [
    row(0, 3, 5, { min_temp: 2.6, max_temp: 3.4 }),
    row(1, 5, 1, { max_temp: 5.2 }),              // above 4: one excursion of one slot (5 min, 1 degC-min)
    row(2, null, 0),
    row(3, null, 0),
    row(4, 3, 4, { min_temp: 1.9 }),              // lowest raw reading inside a slot that averages fine
    row(5, 3, 4, { events: '00:26 Door opened; 00:27 Door closed (open 40 s)' }),
  ];
  const s = dayStats(rows, { low: 2, high: 4 });
  assert.equal(s.readings, 14);
  assert.equal(s.slots, 6);
  assert.equal(s.slotsWithData, 4);
  assert.equal(Math.round(s.average * 1000) / 1000, Math.round(((3 * 5 + 5 * 1 + 3 * 4 + 3 * 4) / 14) * 1000) / 1000, 'weighted by readings per slot');
  assert.equal(s.lowest, 1.9);
  assert.equal(s.lowestAt, new Date(t0 + 20 * MIN).toISOString());
  assert.equal(s.highest, 5.2);
  assert.equal(s.upper.status, 'fail');
  assert.equal(s.upper.occurrences, 1);
  assert.equal(s.upper.minutes, 5);
  assert.equal(s.upper.degMinutes, 5);
  assert.equal(s.lower.status, 'ok', 'alarms are judged on the slot average, not on a single reading inside it');
  assert.equal(s.notInAlertMin, 15);
  assert.deepEqual(s.gaps, [{ from: new Date(t0 + 10 * MIN).toISOString(), to: new Date(t0 + 20 * MIN).toISOString(), minutes: 10 }]);
  assert.equal(s.gapMinutes, 10);
  assert.equal(s.doorEvents, 2);
  assert.equal(s.elapsedMin, 30);
  assert.equal(countEvents(null), 0);
  const empty = dayStats([row(0, null, 0), row(1, null, 0)], null);
  assert.equal(empty.average, null);
  assert.equal(empty.lower.status, 'n/a');
  assert.equal(empty.gapMinutes, 10);
  assert.equal(empty.gaps[0].to, new Date(t0 + 10 * MIN).toISOString(), 'a trailing gap ends at the end of the last slot');
});

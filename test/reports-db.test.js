const test = require('node:test');
const assert = require('node:assert/strict');
const { zoneInfo, sortZoneIds, buildZoneReports, shapeReportSummary } = require('../lib/reports');

function fakePool(answers = {}) {
  const calls = [];
  return {
    calls,
    async query(q) {
      const text = typeof q === 'string' ? q : q.text;
      calls.push({ text, values: (q && q.values) || [] });
      for (const [marker, rows] of Object.entries(answers)) {
        if (text.includes(marker)) {
          if (rows instanceof Error) throw rows;
          return { rows, rowCount: rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
    on() {},
    async end() {},
  };
}

test('reports: zones carry the dashboard identity and fixed band; ids outside the 16 are unlisted; display order holds', () => {
  const cr2 = zoneInfo('chiller_room_2');
  assert.deepEqual(cr2, { id: 'chiller_room_2', label: 'Chiller Room 2', type: 'chiller', limits: { low: 2, high: 4 }, typeLabel: 'Chilled room' });
  assert.deepEqual(zoneInfo('frozen_anteroom').limits, { low: 2, high: 8 });
  assert.equal(zoneInfo('blast_freezer_1').typeLabel, 'Blast freezer');
  assert.equal(zoneInfo('dock_area').limits, null);
  const u = zoneInfo('unlisted_machineroom');
  assert.equal(u.label, 'Machineroom');
  assert.equal(u.typeLabel, 'Unlisted');
  assert.equal(u.limits, null);
  assert.deepEqual(sortZoneIds(['unlisted_x', 'dock_area', 'frozen_room_1']), ['frozen_room_1', 'dock_area', 'unlisted_x']);
});

test('reports: a day is built from the 5-minute rows per zone, and the summary shape is what the page needs', () => {
  const t0 = Date.UTC(2026, 8, 13, 18, 30, 0);
  const rows = [
    { zone_id: 'chiller_room_2', slot: 5, ts: new Date(t0 + 5 * 60000), avg_temp: 5, min_temp: 4.8, max_temp: 5.2, readings: 5, events: null },
    { zone_id: 'chiller_room_2', slot: 0, ts: new Date(t0), avg_temp: 3, min_temp: 2.9, max_temp: 3.1, readings: 5, events: '00:01 Door opened' },
  ];
  const reports = buildZoneReports('2026-09-14', new Map([['chiller_room_2', rows]]));
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].samples.map((r) => r.slot), [0, 5], 'sorted by slot');
  const s = shapeReportSummary(reports[0]);
  assert.equal(s.id, 'chiller_room_2');
  assert.equal(s.day, '2026-09-14');
  assert.equal(s.limitLow, 2);
  assert.equal(s.readings, 10);
  assert.equal(s.lowest, 2.9);
  assert.equal(s.lowestAt, new Date(t0).toISOString());
  assert.equal(s.highest, 5.2);
  assert.equal(s.average, 4);
  assert.equal(s.upperStatus, 'fail');
  assert.equal(s.lowerStatus, 'ok');
  assert.equal(s.upperMinutes, 5);
  assert.equal(s.upperOccurrences, 1);
  assert.equal(s.doorEvents, 1);
  assert.equal(s.gapMinutes, 0);
  assert.equal(buildZoneReports('2026-09-14', new Map()).length, 0);
});

test('reports: the database helpers read the 5-minute table and treat a missing table as empty', async () => {
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  const db = require('../lib/db');
  db._resetForTests();
  const pool = fakePool({
    'count(DISTINCT "zone_id")': [{ day: '2026-09-14', zones: 16 }, { day: '2026-09-13', zones: 16 }],
    'SELECT "zone_id", "slot"': [{ zone_id: 'frozen_room_2', slot: 0, avg_temp: -19.5 }, { zone_id: 'frozen_room_2', slot: 5, avg_temp: -19.6 }, { zone_id: 'dock_area', slot: 0, avg_temp: 0 }],
  });
  db._setPoolForTests(pool);
  assert.deepEqual(await db.getReportDays(), [{ day: '2026-09-14', zones: 16 }, { day: '2026-09-13', zones: 16 }]);
  assert.match(pool.calls[0].text, /\/\* daily_samples \*\//);
  assert.doesNotMatch(pool.calls[0].text, /daily_reports/);
  const samples = await db.getDailySamples('2026-09-14');
  assert.deepEqual([...samples.keys()].sort(), ['dock_area', 'frozen_room_2']);
  assert.equal(samples.get('frozen_room_2').length, 2);
  assert.deepEqual(pool.calls[1].values, ['2026-09-14', null]);
  await db.getDailySamples('2026-09-14', 'dock_area');
  assert.deepEqual(pool.calls[2].values, ['2026-09-14', 'dock_area']);
  assert.equal(typeof db.getDailyReports, 'undefined', 'no summary table any more');

  const missing = new Error('relation "public.daily_samples" does not exist');
  missing.code = '42P01';
  db._setPoolForTests(fakePool({ '/* daily_samples */': missing }));
  assert.deepEqual(await db.getReportDays(), []);
  assert.equal((await db.getDailySamples('2026-09-14')).size, 0);
  db._setPoolForTests(null);
});

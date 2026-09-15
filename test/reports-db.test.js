const test = require('node:test');
const assert = require('node:assert/strict');
const { sortReports, shapeReportSummary } = require('../lib/reports');

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

test('reports: rows come out in dashboard zone order, unlisted zones last; the summary shape is what the page needs', () => {
  const rows = [
    { zone_id: 'unlisted_machineroom', label: 'Machine Room' },
    { zone_id: 'dock_area', label: 'Dock Area' },
    { zone_id: 'frozen_room_1', label: 'Frozen Room 1' },
  ];
  assert.deepEqual(sortReports(rows).map((r) => r.zone_id), ['frozen_room_1', 'dock_area', 'unlisted_machineroom']);
  const s = shapeReportSummary({
    zone_id: 'chiller_room_2', label: 'Chiller Room 2', type: 'chiller', day: '2026-09-14', limit_low: 2, limit_high: 4, readings: '1319', slots_with_data: 286, slots: 288,
    lowest: -1.1, lowest_at: new Date('2026-09-14T03:20:00Z'), highest: 2.5, highest_at: null, average: 0.76, std_dev: 0.78, mkt: 0.79,
    lower_status: 'fail', upper_status: 'ok', lower_minutes: 1233.1, upper_minutes: 0, lower_occurrences: 3, upper_occurrences: 0, gap_minutes: 18, door_events: 536,
    operational: false, sensor_fault: false, note: null, generated_at: new Date('2026-09-15T07:00:00Z'),
  });
  assert.equal(s.id, 'chiller_room_2');
  assert.equal(s.readings, 1319);
  assert.equal(s.lowestAt, '2026-09-14T03:20:00.000Z');
  assert.equal(s.highestAt, null);
  assert.equal(s.lowerStatus, 'fail');
  assert.equal(s.operational, false);
  assert.equal(s.generatedAt, '2026-09-15T07:00:00.000Z');
});

test('reports: the database helpers query the archive tables and treat a missing table as empty', async () => {
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  const db = require('../lib/db');
  db._resetForTests();
  const pool = fakePool({
    '/* daily_reports */ SELECT to_char': [{ day: '2026-09-14', zones: 16 }, { day: '2026-09-13', zones: 16 }],
    '/* daily_reports */ SELECT *': [{ zone_id: 'dock_area', label: 'Dock Area', day: '2026-09-14' }, { zone_id: 'frozen_room_2', label: 'Frozen Room 2', day: '2026-09-14' }],
    '/* daily_samples */': [{ zone_id: 'frozen_room_2', slot: 0, avg_temp: -19.5 }, { zone_id: 'frozen_room_2', slot: 5, avg_temp: -19.6 }, { zone_id: 'dock_area', slot: 0, avg_temp: 0 }],
  });
  db._setPoolForTests(pool);
  assert.deepEqual(await db.getReportDays(), [{ day: '2026-09-14', zones: 16 }, { day: '2026-09-13', zones: 16 }]);
  const day = await db.getDailyReports('2026-09-14');
  assert.deepEqual(day.map((r) => r.zone_id), ['frozen_room_2', 'dock_area']);
  assert.deepEqual(pool.calls[1].values, ['2026-09-14']);
  const samples = await db.getDailySamples('2026-09-14');
  assert.deepEqual([...samples.keys()].sort(), ['dock_area', 'frozen_room_2']);
  assert.equal(samples.get('frozen_room_2').length, 2);
  assert.deepEqual(pool.calls[2].values, ['2026-09-14', null]);
  await db.getDailySamples('2026-09-14', 'dock_area');
  assert.deepEqual(pool.calls[3].values, ['2026-09-14', 'dock_area']);

  const missing = new Error('relation "public.daily_reports" does not exist');
  missing.code = '42P01';
  db._setPoolForTests(fakePool({ '/* daily_reports */': missing, '/* daily_samples */': missing }));
  assert.deepEqual(await db.getReportDays(), []);
  assert.deepEqual(await db.getDailyReports('2026-09-14'), []);
  assert.equal((await db.getDailySamples('2026-09-14')).size, 0);
  db._setPoolForTests(null);
});

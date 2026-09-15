const test = require('node:test');
const assert = require('node:assert/strict');
const { zoneInfo, sortZoneIds, buildZoneReports, buildInputsSummary, shapeReportSummary, shapeDoor, doorName } = require('../lib/reports');

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

test('reports: door rows attach to their zone with ok / long counts; panic and phase inputs and long openings are summarised for the day', () => {
  const t0 = Date.UTC(2026, 8, 13, 18, 30, 0);
  const samples = new Map([
    ['chiller_room_1', [{ zone_id: 'chiller_room_1', slot: 0, ts: new Date(t0), avg_temp: 3, min_temp: 3, max_temp: 3, readings: 5, events: null }]],
    ['frozen_room_2', [{ zone_id: 'frozen_room_2', slot: 0, ts: new Date(t0), avg_temp: -19, min_temp: -19, max_temp: -19, readings: 5, events: null }]],
  ]);
  const doors = [
    { tag: 'Chiller Room 1 Door 2', zone_id: 'chiller_room_1', kind: 'door', threshold_sec: 600, rows: 40, opens: 12, open_minutes: 30.5, ok_opens: 11, ok_minutes: 5.5, long_opens: 1, long_minutes: 25, longest_sec: 1500, open_at_start: false, open_at_end: false, long_events: [{ at: '2026-09-14T06:30:00.000Z', minutes: 25, until: '2026-09-14T06:55:00.000Z', ongoing: false }] },
    { tag: 'Chiller Room 1 Door 1', zone_id: 'chiller_room_1', kind: 'door', threshold_sec: 600, rows: 10, opens: '3', open_minutes: '1.2', ok_opens: 3, ok_minutes: 1.2, long_opens: 0, long_minutes: 0, longest_sec: 40, open_at_start: false, open_at_end: true, long_events: [] },
    { tag: 'Panic Button 1', zone_id: null, kind: 'panic', threshold_sec: 0, rows: 3, opens: 1, open_minutes: 2.4, ok_opens: 0, ok_minutes: 0, long_opens: 1, long_minutes: 2.4, longest_sec: 144, open_at_start: false, open_at_end: false, long_events: [{ at: '2026-09-14T04:00:00.000Z', minutes: 2.4, until: '2026-09-14T04:02:24.000Z', ongoing: false }] },
    { tag: 'Phase Preventer', zone_id: null, kind: 'phase', threshold_sec: 0, rows: 1, opens: 0, open_minutes: 0, ok_opens: 0, ok_minutes: 0, long_opens: 0, long_minutes: 0, longest_sec: 0, open_at_start: false, open_at_end: false, long_events: null },
  ];
  const reports = buildZoneReports('2026-09-14', samples, { doors });
  const cr1 = reports.find((r) => r.zone.id === 'chiller_room_1');
  assert.deepEqual(cr1.doors.map((d) => d.name), ['Door 1', 'Door 2']);
  assert.equal(cr1.doors[1].opens, 12);
  assert.equal(cr1.doors[1].longOpens, 1);
  assert.equal(cr1.doors[0].opens, 3, 'numeric strings from pg are numbers');
  assert.equal(cr1.doors[0].openAtEnd, true);
  assert.deepEqual(reports.find((r) => r.zone.id === 'frozen_room_2').doors, []);
  const s = shapeReportSummary(cr1);
  assert.equal(s.doorOpens, 15);
  assert.equal(s.doorOpenMinutes, 31.7);
  assert.equal(s.doorLongOpens, 1);
  assert.equal(s.doorLongMinutes, 25);
  assert.equal(s.doors.length, 2);
  const inputs = buildInputsSummary(doors, reports);
  assert.equal(inputs.panic.length, 1);
  assert.equal(inputs.panic[0].opens, 1);
  assert.equal(inputs.phase.length, 1);
  assert.deepEqual(inputs.phase[0].longEvents, []);
  assert.deepEqual(inputs.longOpenings, [{ zoneId: 'chiller_room_1', zone: 'Chiller Room 1', door: 'Door 2', at: '2026-09-14T06:30:00.000Z', until: '2026-09-14T06:55:00.000Z', minutes: 25, ongoing: false }]);
  assert.equal(doorName('Frozen Anteroom Door'), 'Door');
  assert.equal(doorName('Panic Button 3'), 'Panic Button 3');
  assert.equal(shapeDoor({ tag: 'X Door', long_events: 'bad' }).longEvents.length, 0);
});

test('reports: the database helpers read the 5-minute table and treat a missing table as empty', async () => {
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  const db = require('../lib/db');
  db._resetForTests();
  const pool = fakePool({
    'count(DISTINCT "zone_id")': [{ day: '2026-09-14', zones: 16 }, { day: '2026-09-13', zones: 16 }],
    'SELECT "zone_id", "slot"': [{ zone_id: 'frozen_room_2', slot: 0, avg_temp: -19.5 }, { zone_id: 'frozen_room_2', slot: 5, avg_temp: -19.6 }, { zone_id: 'dock_area', slot: 0, avg_temp: 0 }],
    '/* daily_doors */': [{ tag: 'Frozen Room 2 Door', zone_id: 'frozen_room_2', kind: 'door', opens: 252 }],
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
  const doors = await db.getDailyDoors('2026-09-14');
  assert.equal(doors.length, 1);
  assert.deepEqual(pool.calls[3].values, ['2026-09-14']);
  assert.match(pool.calls[3].text, /FROM "public"."daily_doors" WHERE "day" = \$1::date/);
  assert.equal(typeof db.getDailyReports, 'undefined', 'no summary table any more');

  const missing = new Error('relation "public.daily_samples" does not exist');
  missing.code = '42P01';
  db._setPoolForTests(fakePool({ '/* daily_samples */': missing, '/* daily_doors */': missing }));
  assert.deepEqual(await db.getReportDays(), []);
  assert.equal((await db.getDailySamples('2026-09-14')).size, 0);
  assert.deepEqual(await db.getDailyDoors('2026-09-14'), []);
  db._setPoolForTests(null);
});

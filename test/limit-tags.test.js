const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsToSnapshot, missingZones } = require('../lib/schema-detect');
const { applySetpoints } = require('../lib/setpoints');

const NOW = 1800000000000;
const long = { schema: 'public', table: 'readings', mode: 'long', roomCol: 'tag', tempCol: 'value', tsCol: 'ts' };

// The collector (RECORD_SETPOINTS=true) writes three rows per room with one shared timestamp:
// "Frozen Room 1", "Frozen Room 1 Set Low", "Frozen Room 1 Set High". The loose zone match used to read
// the limit rows as the room itself, and with the query's tag ordering the last one won - so a freezer
// could be displayed at its SET HIGH value. Limits are limits.
test('database path: "<room> Set Low/High" rows become the room limits, never its temperature', () => {
  const rows = [
    { room: 'Frozen Room 1', temperature: '-18.5', ts_ms: NOW },
    { room: 'Frozen Room 1 Set High', temperature: '0', ts_ms: NOW },
    { room: 'Frozen Room 1 Set Low', temperature: '-20', ts_ms: NOW },
  ];
  for (const order of [rows, [...rows].reverse()]) {
    const r = rowsToSnapshot(long, order, { now: NOW, staleMs: 600000});
    assert.equal(r.frozen_room_1.temperature, -18.5);
    assert.equal(r.frozen_room_1.setLow, -20);
    assert.equal(r.frozen_room_1.setHigh, 0);
    assert.equal(r.frozen_room_1.offline, false);
    assert.equal(r.frozen_room_1.alarm, false);
    assert.equal(Object.keys(r).length, 16, 'no extra "Set Low" card');
  }
});

test('database path: folded limits win over the operator file, like real set-point columns do', () => {
  const r = rowsToSnapshot(long, [
    { room: 'Chiller Room 2', temperature: 1.8, ts_ms: NOW },
    { room: 'Chiller Room 2 Set Low', temperature: -10, ts_ms: NOW },
    { room: 'Chiller Room 2 Set High', temperature: 10, ts_ms: NOW },
  ], { now: NOW, staleMs: 600000 });
  applySetpoints(r, { chiller_room_2: { setLow: 0, setHigh: 5 } });
  assert.equal(r.chiller_room_2.setLow, -10);
  assert.equal(r.chiller_room_2.setHigh, 10);
  assert.equal(r.chiller_room_2.alarm, false);
});

test('database path: a limit row for an unknown room is still an unknown room, not dropped', () => {
  const r = rowsToSnapshot(long, [{ room: 'Ripening Room 9 Set High', temperature: 30, ts_ms: NOW }], { now: NOW, staleMs: 600000 });
  assert.equal(Object.keys(r).length, 17);
  assert.equal(missingZones([{ room: 'Frozen Room 1 Set High' }]).includes('frozen_room_1'), false);
});

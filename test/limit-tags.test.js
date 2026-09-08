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

// What the panel actually holds today: Dock Area has 0 / 0 (nobody configured it) and Chiller Room 5 has
// SET LOW 0 above SET HIGH -15 (a slip on the panel). Neither may become a false alarm.
test('database path: equal limits mean "not configured", low above high is the band the other way round', () => {
  const r = rowsToSnapshot(long, [
    { room: 'Dock Area', temperature: 0, ts_ms: NOW },
    { room: 'Dock Area Set Low', temperature: 0, ts_ms: NOW },
    { room: 'Dock Area Set High', temperature: 0, ts_ms: NOW },
    { room: 'Chiller Room 5', temperature: -19.1, ts_ms: NOW },
    { room: 'Chiller Room 5 Set Low', temperature: 0, ts_ms: NOW },
    { room: 'Chiller Room 5 Set High', temperature: -15, ts_ms: NOW },
  ], { now: NOW, staleMs: 600000 });
  assert.equal(r.dock_area.setLow, null);
  assert.equal(r.dock_area.setHigh, null);
  assert.equal(r.dock_area.limitsInvalid, false);
  assert.equal(r.dock_area.alarm, false);
  assert.equal(r.chiller_room_5.setLow, -15);     // the panel's pair, the right way round
  assert.equal(r.chiller_room_5.setHigh, 0);
  assert.equal(r.chiller_room_5.limitsSwapped, true);
  assert.equal(r.chiller_room_5.alarm, true);      // -19.1 is below -15: evaluated on the corrected band
  // The operator file may still fill an unconfigured room; it never overrides a corrected one.
  applySetpoints(r, { dock_area: { setLow: -5, setHigh: 25 }, chiller_room_5: { setLow: -25, setHigh: -15 } });
  assert.equal(r.dock_area.setLow, -5);
  assert.equal(r.dock_area.alarm, false);
  assert.equal(r.chiller_room_5.setLow, -15);
  assert.equal(r.chiller_room_5.alarm, true);
});

// The live path builds rooms before a screen's limit rows have arrived, then fills them from the database
// seed through applySetpoints. Filled limits must obey the band rules too, or an impossible band from the
// panel raises a red alarm on the live path while the database path shows LIMITS INVALID.
test('applySetpoints: limits it fills in follow the band rules before the alarm is recomputed', () => {
  const r = rowsToSnapshot(long, [
    { room: 'Chiller Room 5', temperature: -20.5, ts_ms: NOW },
    { room: 'Dock Area', temperature: 0, ts_ms: NOW },
    { room: 'Frozen Room 3', temperature: 25, ts_ms: NOW },
  ], { now: NOW, staleMs: 600000 });
  applySetpoints(r, {
    chiller_room_5: { setLow: 0, setHigh: -15 },
    dock_area: { setLow: 0, setHigh: 0 },
    frozen_room_3: { setLow: -15, setHigh: 30 },
  });
  assert.equal(r.chiller_room_5.limitsSwapped, true);
  assert.equal(r.chiller_room_5.setLow, -15);
  assert.equal(r.chiller_room_5.setHigh, 0);
  assert.equal(r.chiller_room_5.alarm, true);      // -20.5 is below -15
  assert.equal(r.dock_area.setLow, null);
  assert.equal(r.dock_area.setHigh, null);
  assert.equal(r.dock_area.alarm, false);
  assert.equal(r.frozen_room_3.setLow, -15);
  assert.equal(r.frozen_room_3.alarm, false);
});

// Limits are read from the panel twice a day, so a browser opened between reads gets its bands from the
// last database snapshot, where a reversed pair has already been corrected. The mark must travel with it.
test('applySetpoints: a seeded band keeps its "swapped" mark', () => {
  const r = rowsToSnapshot(long, [{ room: 'Frozen Room 1', temperature: -18.8, ts_ms: NOW }], { now: NOW, staleMs: 600000 });
  applySetpoints(r, { frozen_room_1: { setLow: -25, setHigh: -14, limitsSwapped: true }, frozen_room_2: { setLow: -25, setHigh: -14 } });
  assert.equal(r.frozen_room_1.setLow, -25);
  assert.equal(r.frozen_room_1.limitsSwapped, true);
  assert.equal(r.frozen_room_1.alarm, false);
  assert.equal(r.frozen_room_2.limitsSwapped, false);
});

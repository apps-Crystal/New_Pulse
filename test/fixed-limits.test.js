const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsToSnapshot } = require('../lib/schema-detect');
const { applySetpoints } = require('../lib/setpoints');

const NOW = 1800000000000;
const long = { schema: 'public', table: 'readings', mode: 'long', roomCol: 'tag', tempCol: 'value', tsCol: 'ts' };

const { applyFixedLimits, fixedLimitsFor } = require('../lib/limits');
// The plant's bands are fixed (9 Sep 2026); they override the panel's limits and the operator file.
test('fixed limits: frozen -22..-18, chilled +2..+4, anterooms +2..+8, dock none; they win over everything', () => {
  assert.deepEqual(fixedLimitsFor('frozen_room_3', 'frozen'), { setLow: -22, setHigh: -18 });
  assert.deepEqual(fixedLimitsFor('blast_freezer_2', 'frozen'), { setLow: -22, setHigh: -18 });
  assert.deepEqual(fixedLimitsFor('chiller_room_5', 'chiller'), { setLow: 2, setHigh: 4 });
  assert.deepEqual(fixedLimitsFor('frozen_anteroom', 'frozen'), { setLow: 2, setHigh: 8 });
  assert.deepEqual(fixedLimitsFor('chiller_anteroom', 'chiller'), { setLow: 2, setHigh: 8 });
  assert.equal(fixedLimitsFor('dock_area', 'other'), null);
  const r = rowsToSnapshot(long, [
    { room: 'Frozen Room 1', temperature: -20.5, ts_ms: NOW },
    { room: 'Frozen Room 1 Set Low', temperature: -14, ts_ms: NOW },
    { room: 'Frozen Room 1 Set High', temperature: -25, ts_ms: NOW },
    { room: 'Chiller Room 5', temperature: -19.9, ts_ms: NOW },
    { room: 'Frozen Anteroom', temperature: 3.4, ts_ms: NOW },
  ], { now: NOW, staleMs: 600000 });
  applySetpoints(r, { chiller_room_5: { setLow: -25, setHigh: -15 } });
  applyFixedLimits(r);
  assert.deepEqual([r.frozen_room_1.setLow, r.frozen_room_1.setHigh, r.frozen_room_1.limitsSwapped, r.frozen_room_1.alarm], [-22, -18, false, false]);
  assert.deepEqual([r.chiller_room_5.setLow, r.chiller_room_5.setHigh, r.chiller_room_5.alarm], [2, 4, true]);   // a freezer-cold "chiller" is out of its chilled band
  assert.deepEqual([r.frozen_anteroom.setLow, r.frozen_anteroom.setHigh, r.frozen_anteroom.alarm], [2, 8, false]);
  assert.equal(r.dock_area.setLow, null);
});

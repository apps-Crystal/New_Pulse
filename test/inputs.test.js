const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyInputs } = require('../lib/inputs');

const NOW = 1800000000000;
// The plant's INPUT screen as the collector sends it (9 Sep 2026): panic buttons and the phase preventer
// are normally-closed (ON = healthy), doors are ON while open.
const live = (over = {}) => [
  ['Panic Button 1', 1], ['Panic Button 2', 1], ['Panic Button 3', 1], ['Panic Button 4', 1], ['Panic Button 5', 1],
  ['Phase Preventer', 1],
  ['Chiller Anteroom Door', 0], ['Chiller Room 1 Door 1', 0], ['Chiller Room 1 Door 2', 0], ['Chiller Room 2 Door', 0],
  ['Chiller Room 3 Door', 0], ['Chiller Room 4 Door', 0], ['Chiller Room 5 Door', 0], ['Chiller Room 6 Door', 0],
  ['Frozen Anteroom Door', 0], ['Frozen Room 1 Door', 0], ['Frozen Room 2 Door', 0], ['Frozen Room 3 Door', 0],
  ['Frozen Room 4 Door', 0], ['Frozen Room 5 Door', 0],
].map(([tag, value]) => ({ tag, value: over[tag] != null ? over[tag] : value, ts: new Date(NOW - 5000).toISOString() }));

test('inputs: doors land on their rooms, panic buttons and phase read normally-closed', () => {
  const io = classifyInputs(live(), NOW);
  assert.equal(Object.keys(io.doors).length, 13);   // 14 door contacts on 13 rooms (Chiller Room 1 has two)
  assert.equal(io.doors.chiller_room_1.length, 2);
  assert.deepEqual(io.doors.chiller_room_1.map((d) => d.label), ['Door 1', 'Door 2']);
  assert.equal(io.doors.frozen_anteroom[0].open, false);
  assert.equal(io.panic.length, 5);
  assert.ok(io.panic.every((p) => !p.pressed));
  assert.equal(io.phase.ok, true);
  assert.equal(io.anyDoorOpen, false);
  assert.equal(io.anyPanic, false);
  assert.deepEqual(io.other, []);
});

test('inputs: a door going ON is open, a panic button going OFF is pressed, a phase OFF is a fault', () => {
  const io = classifyInputs(live({ 'Chiller Room 2 Door': 1, 'Panic Button 3': 0, 'Phase Preventer': 0 }), NOW);
  assert.equal(io.doors.chiller_room_2[0].open, true);
  assert.equal(io.anyDoorOpen, true);
  assert.deepEqual(io.panic.filter((p) => p.pressed).map((p) => p.n), [3]);
  assert.equal(io.anyPanic, true);
  assert.equal(io.phase.ok, false);
});

test('inputs: unknown rooms and junk never throw', () => {
  const io = classifyInputs([{ tag: 'Ripening Room 9 Door', value: '1' }, { tag: 'Whatever', value: 1 }, { tag: 'Bad', value: 'x' }, null, { value: 1 }], NOW);
  assert.equal(Object.keys(io.doors).length, 1);
  assert.ok(Object.keys(io.doors)[0].startsWith('unknown:'));
  assert.deepEqual(io.other.map((o) => o.tag), ['Whatever']);
  assert.deepEqual(classifyInputs(null, NOW).panic, []);
});

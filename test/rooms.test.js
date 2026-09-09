const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRoomSettings, isOperational, isZoneId, shapeRoomSettings } = require('../lib/rooms');

test('rooms: settings switch a room off; off rooms never carry an alarm', () => {
  const rooms = { frozen_room_1: { label: 'Frozen Room 1', temperature: -16, alarm: true }, chiller_room_2: { label: 'Chiller Room 2', temperature: 3, alarm: false } };
  applyRoomSettings(rooms, { frozen_room_1: { operational: false } });
  assert.equal(rooms.frozen_room_1.operational, false);
  assert.equal(rooms.frozen_room_1.alarm, false);
  assert.equal(rooms.chiller_room_2.operational, true);
  assert.equal(isOperational(rooms.frozen_room_1), false);
  assert.equal(isOperational({}), true);
  const list = [{ id: 'dock_area', alarm: true }];
  applyRoomSettings(list, { dock_area: { operational: false } });
  assert.equal(list[0].alarm, false);
  assert.equal(applyRoomSettings(null, {}), null);
});

test('rooms: only the 16 zone ids are accepted; rows from the table become the settings map', () => {
  assert.equal(isZoneId('chiller_room_5'), true);
  assert.equal(isZoneId('kitchen'), false);
  assert.equal(isZoneId(5), false);
  const s = shapeRoomSettings([{ zone_id: 'frozen_room_2', operational: false, updated_ms: 1800000000000 }, { zone_id: 'x', operational: false }, null]);
  assert.deepEqual(Object.keys(s), ['frozen_room_2']);
  assert.equal(s.frozen_room_2.operational, false);
  assert.equal(s.frozen_room_2.updatedAt, new Date(1800000000000).toISOString());
});

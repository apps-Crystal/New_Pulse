const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES, resolveZone, normaliseRoomKey, inferType } = require('../lib/zones');
const { resolveZoneLoose } = require('../lib/schema-detect');

const id = (v) => (resolveZone(v) ? resolveZone(v).id : null);

test('16 canonical zones in display order', () => {
  assert.equal(ZONES.length, 16);
  assert.equal(ZONES[0].id, 'frozen_room_1');
  assert.equal(ZONES[6].id, 'chiller_room_1');
  assert.equal(ZONES[15].id, 'dock_area');
});

test('resolveZone handles names, slugs and codes', () => {
  assert.equal(id('Frozen Room 1'), 'frozen_room_1');
  assert.equal(id('frozen_room_1'), 'frozen_room_1');
  assert.equal(id('FR-1'), 'frozen_room_1');
  assert.equal(id('Chiller Anteroom'), 'chiller_anteroom');
  assert.equal(id('chiller_anteroom'), 'chiller_anteroom');
  assert.notEqual(id('chiller_anteroom'), 'chiller_room_1');
  assert.equal(id('Blast Freezer 2'), 'blast_freezer_2');
  assert.equal(id('Dock'), 'dock_area');
  assert.equal(id('garbage'), null);
  assert.equal(id(null), null);
  assert.equal(id(''), null);
});

test('resolveZone maps numeric ids 1..16 by display order', () => {
  assert.equal(id(7), 'chiller_room_1');
  assert.equal(id('16'), 'dock_area');
  assert.equal(id(1), 'frozen_room_1');
  assert.equal(id(0), null);
  assert.equal(id(17), null);
});

test('prefixed column names resolve to zones', () => {
  // zones.resolveZone handles long prefixed names via substring matching ...
  assert.equal(resolveZone('temp_frozen_room_1').id, 'frozen_room_1');
  assert.equal(resolveZone('temp_chiller_room_1').id, 'chiller_room_1');
  // ... and short codes need the loose resolver (aliases < 4 chars are not substring-matched by zones.js)
  assert.equal(resolveZoneLoose('temp_fr2').id, 'frozen_room_2');
  assert.equal(resolveZoneLoose('temp_frozen_room_1').id, 'frozen_room_1');
  assert.equal(resolveZoneLoose('chiller_anteroom_actual').id, 'chiller_anteroom');
  assert.equal(resolveZoneLoose('t_bf1').id, 'blast_freezer_1');
  assert.equal(resolveZoneLoose('garbage'), null);
  assert.equal(resolveZoneLoose('temperature'), null);
  assert.equal(resolveZoneLoose('created_at'), null);
  assert.equal(resolveZoneLoose('set_low'), null);
  assert.equal(resolveZoneLoose('value'), null);
});

test('normaliseRoomKey and inferType', () => {
  assert.equal(normaliseRoomKey('Frozen Room-1'), 'frozenroom1');
  assert.equal(inferType('Deep Freezer'), 'frozen');
  assert.equal(inferType('Cool Store'), 'chiller');
  assert.equal(inferType('Office'), 'other');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES } = require('../lib/zones');
const snap = require('../lib/live-snapshot');

const NOW = 1800000000000;

// This module runs in the browser for the Vercel deployment (Supabase Realtime) and in the Node hub for
// self-hosted ones. It must be pure: no globals, no I/O, no environment.

test('live-snapshot: accepts the collector batch shape and a bare array', () => {
  assert.deepEqual(snap.normalizeReadings({ at: 'x', readings: [{ tag: 'a', value: 1 }] }), [{ tag: 'a', value: 1 }]);
  assert.deepEqual(snap.normalizeReadings([{ tag: 'a', value: 1 }]), [{ tag: 'a', value: 1 }]);
  assert.deepEqual(snap.normalizeReadings(null), []);
  assert.deepEqual(snap.normalizeReadings({ nope: true }), []);
});

test('live-snapshot: builds the /api/plc room shape from broadcast readings, limits applied', () => {
  const state = snap.createLiveState();
  const n = snap.ingest(state, [
    { tag: 'Frozen Room 1', value: -18.5, ts: new Date(NOW - 1000).toISOString() },
    { tag: 'Chiller Room 2', value: '2.1', ts: NOW - 500 },
    { tag: 'Ripening Room 9', value: 14, ts: NOW },
    { tag: 'Frozen Room 3', value: 'abc', ts: NOW },
  ], NOW);
  assert.equal(n, 3);
  const { rooms, stats, rowCount } = snap.buildRooms(state, { now: NOW, staleMs: 600000, setpoints: { frozen_room_1: { setLow: -25, setHigh: -15 } } });
  assert.equal(rowCount, 3);
  assert.deepEqual(Object.keys(rooms).slice(0, 16), ZONES.map((z) => z.id));
  assert.equal(rooms.frozen_room_1.temperature, -18.5);
  assert.equal(rooms.frozen_room_1.setLow, -25);
  assert.equal(rooms.frozen_room_1.setHigh, -15);
  assert.equal(rooms.frozen_room_1.alarm, false);
  assert.equal(rooms.frozen_room_1.offline, false);
  assert.equal(rooms.chiller_room_2.temperature, 2.1);
  assert.equal(rooms.frozen_room_3.offline, true);
  assert.equal(Object.keys(rooms).length, 17);   // 16 zones + the unknown room, never dropped
  assert.equal(stats.resolvedZones, 2);
});

test('live-snapshot: state is per instance, not shared', () => {
  const a = snap.createLiveState();
  const b = snap.createLiveState();
  snap.ingest(a, [{ tag: 'Frozen Room 1', value: -20, ts: NOW }], NOW);
  assert.equal(snap.buildRooms(a, { now: NOW }).rowCount, 1);
  assert.equal(snap.buildRooms(b, { now: NOW }).rowCount, 0);
  assert.equal(snap.feedAgeMs(a, NOW + 5000), 5000);
  assert.equal(snap.feedAgeMs(b, NOW), null);
});

test('live-snapshot: newest wins, limit tags fold into the room, stale readings go offline', () => {
  const state = snap.createLiveState();
  snap.ingest(state, [{ tag: 'Frozen Room 2', value: -20, ts: NOW }], NOW);
  snap.ingest(state, [{ tag: 'Frozen Room 2', value: -5, ts: NOW - 60000 }], NOW + 10);   // older: ignored
  snap.ingest(state, [
    { tag: 'Frozen Room 2 Set Low', value: -22, ts: NOW },
    { tag: 'Frozen Room 2 Set High', value: -10, ts: NOW },
    { tag: 'Frozen Room 4', value: -19, ts: NOW - 600001 },
  ], NOW);
  const { rooms } = snap.buildRooms(state, { now: NOW, staleMs: 600000, setpoints: { frozen_room_2: { setLow: -30, setHigh: 0 } } });
  assert.equal(rooms.frozen_room_2.temperature, -20);
  assert.equal(rooms.frozen_room_2.setLow, -22);    // panel limits win over the operator file
  assert.equal(rooms.frozen_room_2.setHigh, -10);
  assert.equal(rooms.frozen_room_4.offline, true);
  assert.equal(Object.keys(rooms).length, 16);
});

test('live-snapshot: a seed from the database fills rooms the first broadcast does not carry, and a fresh broadcast wins', () => {
  const state = snap.createLiveState();
  // What the dashboard seeds from its last database snapshot (label, temperature, updatedAt).
  snap.ingest(state, [
    { tag: 'Frozen Room 1', value: -19.0, ts: NOW - 20000 },
    { tag: 'Chiller Room 3', value: 26.0, ts: NOW - 20000 },
  ], NOW);
  // The first broadcast: one panel screen only, with a newer Frozen Room 1.
  snap.ingest(state, [{ tag: 'Frozen Room 1', value: -19.8, ts: NOW }], NOW);
  const { rooms } = snap.buildRooms(state, { now: NOW, staleMs: 600000 });
  assert.equal(rooms.frozen_room_1.temperature, -19.8);   // broadcast overrides the seed
  assert.equal(rooms.chiller_room_3.temperature, 26.0);    // seeded room keeps its database value...
  assert.equal(rooms.chiller_room_3.updatedAt, NOW - 20000); // ...with the database's timestamp
  assert.equal(rooms.chiller_room_3.offline, false);
});

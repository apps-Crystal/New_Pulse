const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES } = require('../lib/zones');
const live = require('../lib/live');

const NOW = 1800000000000;

function fresh(env = {}) {
  live._resetForTests();
  delete process.env.PULSE_SETPOINTS;
  delete process.env.PULSE_LIVE_TOKEN;
  delete process.env.PULSE_LIVE_STALE_MS;
  process.env.PULSE_SETPOINTS_FILE = './definitely-missing-setpoints.json'; // never pick up a real file
  Object.assign(process.env, env);
}

test('live: nothing received yet -> no snapshot, not live', () => {
  fresh();
  assert.equal(live.getLatestSnapshot(NOW), null);
  assert.equal(live.isLive(NOW), false);
  assert.equal(live.getStatus(NOW).tags, 0);
});

test('live: collector tags resolve to the 16 zones through the same builder the database uses', () => {
  fresh({ PULSE_SETPOINTS: 'frozen_room_1=-25:-15' });
  const n = live.ingest([
    { tag: 'Frozen Room 1', value: -18.5, ts: new Date(NOW - 1000).toISOString() },
    { tag: 'Chiller Room 2', value: '2.1', ts: NOW - 500 },       // numeric string, epoch ms: both fine
    { tag: 'Dock Area', value: 0, ts: NOW },
    { tag: 'Ripening Room 9', value: 14, ts: NOW },              // unknown room: appended, never dropped
    { tag: 'Frozen Room 3', value: 'abc', ts: NOW },             // unparsable value: skipped
    { tag: '', value: 1, ts: NOW },                              // empty tag: skipped
  ], NOW);
  assert.equal(n, 4);

  const snap = live.buildSnapshot(NOW);
  assert.equal(snap.source, 'live');
  assert.deepEqual(Object.keys(snap.rooms).slice(0, 16), ZONES.map((z) => z.id));
  assert.equal(snap.rooms.frozen_room_1.temperature, -18.5);
  assert.equal(snap.rooms.frozen_room_1.updatedAt, NOW - 1000);
  assert.equal(snap.rooms.frozen_room_1.offline, false);
  assert.equal(snap.rooms.frozen_room_1.setLow, -25);   // operator set-points applied, like /api/plc
  assert.equal(snap.rooms.frozen_room_1.setHigh, -15);
  assert.equal(snap.rooms.frozen_room_1.alarm, false);
  assert.equal(snap.rooms.chiller_room_2.temperature, 2.1);
  assert.equal(snap.rooms.dock_area.temperature, 0);
  assert.equal(snap.rooms.frozen_room_3.temperature, null);
  assert.equal(snap.rooms.frozen_room_3.offline, true);
  const extra = Object.keys(snap.rooms).slice(16);
  assert.equal(extra.length, 1);
  assert.equal(snap.rooms[extra[0]].label, 'Ripening Room 9');
});

test('live: an out-of-order older reading never overwrites a newer one', () => {
  fresh();
  live.ingest([{ tag: 'Frozen Room 2', value: -20, ts: NOW }], NOW);
  live.ingest([{ tag: 'Frozen Room 2', value: -5, ts: NOW - 60000 }], NOW + 10);
  assert.equal(live.buildSnapshot(NOW + 10).rooms.frozen_room_2.temperature, -20);
});

test('live: a stale reading is offline, exactly as it would be from the database', () => {
  fresh({ PULSE_STALE_MS: '600000' });
  live.ingest([{ tag: 'Frozen Room 1', value: -20, ts: NOW - 600001 }], NOW);
  const r = live.buildSnapshot(NOW).rooms.frozen_room_1;
  assert.equal(r.temperature, -20);
  assert.equal(r.offline, true);
  delete process.env.PULSE_STALE_MS;
});

test('live: "<room> Set Low/High" tags become that room\'s limits and win over the operator file', () => {
  fresh({ PULSE_SETPOINTS: 'frozen_room_1=-25:-15' });
  const n = live.ingest([
    { tag: 'Frozen Room 1', value: -18.8, ts: NOW },
    { tag: 'Frozen Room 1 Set Low', value: -20, ts: NOW },
    { tag: 'Frozen Room 1 Set High', value: 0, ts: NOW },
  ], NOW);
  assert.equal(n, 3);
  const snap = live.buildSnapshot(NOW);
  assert.equal(snap.rooms.frozen_room_1.setLow, -20);   // from the panel, not -25 from the file
  assert.equal(snap.rooms.frozen_room_1.setHigh, 0);
  assert.equal(Object.keys(snap.rooms).length, 16);      // no "Frozen Room 1 Set Low" extra card
});

test('live: the feed counts as live only with a publisher attached and fresh data', () => {
  fresh({ PULSE_LIVE_STALE_MS: '90000' });
  live.ingest([{ tag: 'Frozen Room 1', value: -20, ts: NOW }], NOW);
  assert.equal(live.isLive(NOW), false);                  // data but no publisher socket
  live._setPublisherForTests({ readyState: 1 });
  assert.equal(live.isLive(NOW), true);
  assert.equal(live.buildSnapshot(NOW).connected, true);
  assert.equal(live.isLive(NOW + 90001), false);          // publisher still there, data gone quiet
  assert.equal(live.buildSnapshot(NOW + 90001).connected, false);
  live._setPublisherForTests(null);
});

test('live: publishers need the shared token; dashboards do not', () => {
  fresh();
  const cfg = { token: null };
  const url = (q) => new URL(`http://x/ws${q}`);
  assert.deepEqual(live.classifyConnection(url(''), cfg), { role: 'subscriber' });
  assert.deepEqual(live.classifyConnection(url('?role=subscriber'), cfg), { role: 'subscriber' });
  assert.equal(live.classifyConnection(url('?role=publisher&token=abc'), cfg).role, 'reject'); // no token configured

  const armed = { token: 's3cret-token' };
  assert.equal(live.classifyConnection(url('?role=publisher'), armed).role, 'reject');
  assert.equal(live.classifyConnection(url('?role=publisher&token=wrong'), armed).role, 'reject');
  assert.equal(live.classifyConnection(url('?role=publisher&token=s3cret-toke'), armed).role, 'reject'); // length mismatch
  assert.deepEqual(live.classifyConnection(url('?role=publisher&token=s3cret-token'), armed), { role: 'publisher' });
});

test('live: getConfig reads the env with safe defaults', () => {
  fresh();
  const cfg = live.getConfig();
  assert.equal(cfg.token, null);
  assert.equal(cfg.path, '/ws');
  assert.equal(cfg.liveStaleMs, 90000);
  assert.equal(cfg.staleMs, 600000);
});

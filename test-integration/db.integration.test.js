// Integration tests: run lib/db.js against a REAL PostgreSQL (embedded-postgres) with many
// candidate schemas, since the production Supabase layout is not known in advance.
//
//   npm run test:integration        (= node --test "test-integration/**/*.test.js")
//
// Requirements: devDependency `embedded-postgres`. On Windows the Postgres binaries need the
// Visual C++ 2015-2022 runtime; if it is not installed system-wide, put msvcp140.dll,
// vcruntime140.dll and vcruntime140_1.dll in a folder and set PULSE_VCRT_DIR to it (this file
// defaults to C:\Users\CRPL-21\.node\vcrt when that folder exists).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('pg');
const { ZONES } = require('../lib/zones');

const PORT = Number(process.env.PULSE_TEST_PG_PORT || 54331);
const PG_USER = 'postgres';
const PG_PASS = 'itest-secret-pw';
const DATA_DIR = path.join(__dirname, '.pgdata');
const STALE_MS = 10 * 60 * 1000;

let epg = null;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function adminUrl(db = 'postgres') {
  return `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PORT}/${db}?sslmode=disable`;
}

async function withClient(db, fn) {
  const c = new Client({ connectionString: adminUrl(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function createDb(name) {
  await withClient('postgres', (c) => c.query(`CREATE DATABASE "${name}"`));
}

// Load lib/db.js fresh so module-scoped config/cache/pool come from the current env.
function loadDb(env) {
  for (const k of Object.keys(process.env)) if (k.startsWith('PULSE_')) delete process.env[k];
  delete process.env.PGSSLMODE;
  process.env.PULSE_STALE_MS = String(STALE_MS);
  process.env.PULSE_CACHE_MS = '0';
  Object.assign(process.env, env);
  for (const k of Object.keys(require.cache)) {
    if (/[\\/]lib[\\/](db|schema-detect|zones)\.js$/.test(k)) delete require.cache[k];
  }
  return require('../lib/db');
}

async function snapshotFor(dbName, env = {}) {
  const db = loadDb({ DATABASE_URL: adminUrl(dbName), ...env });
  try {
    const snap = await db.getSnapshot();
    return snap;
  } finally {
    await db.closePool();
  }
}

// Reference values per zone. Frozen rooms around -18, chillers around 4, dock 12.
// chiller_room_2 is deliberately ABOVE its high limit (alarm); frozen_room_3 is within 2 C of
// its high limit (warning in the UI, but not an alarm); dock_area is used for "stale" cases.
const REF = {};
for (const z of ZONES) {
  const n = Number((z.id.match(/\d+/) || ['0'])[0]);
  if (z.type === 'frozen') REF[z.id] = { temp: -18 - n * 0.5, low: -25, high: -15 };
  else if (z.type === 'chiller') REF[z.id] = { temp: 2 + n * 0.5, low: 0, high: 8 };
  else REF[z.id] = { temp: 12.25, low: 5, high: 18 };
}
REF.chiller_room_2.temp = 9.5;   // alarm (> 8)
REF.frozen_room_3.temp = -16.0;  // warning band (within 2 of -15)

const LABEL = Object.fromEntries(ZONES.map((z) => [z.id, z.label]));
const CODE = {
  frozen_room_1: 'FR-1', frozen_room_2: 'FR-2', frozen_room_3: 'FR-3', frozen_room_4: 'FR-4', frozen_room_5: 'FR-5',
  frozen_anteroom: 'Frozen Anteroom', chiller_room_1: 'CR-1', chiller_room_2: 'CR-2', chiller_room_3: 'CR-3',
  chiller_room_4: 'CR-4', chiller_room_5: 'CR-5', chiller_room_6: 'CR-6', chiller_anteroom: 'Chiller Anteroom',
  blast_freezer_1: 'BF-1', blast_freezer_2: 'BF-2', dock_area: 'Dock',
};

function approx(a, b, eps = 1e-6) {
  return a != null && b != null && Math.abs(Number(a) - Number(b)) < eps;
}

function assertSixteen(snap) {
  assert.equal(snap.source, 'supabase');
  assert.ok(snap.rooms && typeof snap.rooms === 'object', 'rooms object');
  const ids = Object.keys(snap.rooms);
  assert.deepEqual(ids.slice(0, 16), ZONES.map((z) => z.id), 'first 16 rooms are the canonical zones in order');
  for (const z of ZONES) {
    const r = snap.rooms[z.id];
    assert.equal(r.label, z.label);
    assert.equal(r.type, z.type);
    for (const k of ['temperature', 'setLow', 'setHigh', 'alarm', 'offline', 'updatedAt']) assert.ok(k in r, `room has ${k}`);
  }
}

function assertMatchesRef(snap, { setpoints = true, freshWithinMs = 5 * 60 * 1000, skip = [] } = {}) {
  const now = Date.now();
  for (const z of ZONES) {
    if (skip.includes(z.id)) continue;
    const r = snap.rooms[z.id];
    const ref = REF[z.id];
    assert.ok(approx(r.temperature, ref.temp), `${z.id} temperature ${r.temperature} != ${ref.temp}`);
    assert.equal(r.offline, false, `${z.id} should be online`);
    if (setpoints) {
      assert.ok(approx(r.setLow, ref.low), `${z.id} setLow`);
      assert.ok(approx(r.setHigh, ref.high), `${z.id} setHigh`);
      const shouldAlarm = ref.temp < ref.low || ref.temp > ref.high;
      assert.equal(r.alarm, shouldAlarm, `${z.id} alarm flag`);
    } else {
      assert.equal(r.setLow, null);
      assert.equal(r.setHigh, null);
      assert.equal(r.alarm, false);
    }
    if (freshWithinMs != null) {
      assert.ok(typeof r.updatedAt === 'number', `${z.id} updatedAt is a number (got ${r.updatedAt})`);
      assert.ok(Math.abs(now - r.updatedAt) < freshWithinMs, `${z.id} updatedAt ${r.updatedAt} is not within ${freshWithinMs}ms of now ${now}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------------------------

before(async () => {
  const vcrt = process.env.PULSE_VCRT_DIR || 'C:\\Users\\CRPL-21\\.node\\vcrt';
  if (process.platform === 'win32' && fs.existsSync(vcrt)) process.env.PATH = `${vcrt};${process.env.PATH}`;
  const m = require('embedded-postgres');
  const EmbeddedPostgres = m.default || m;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  epg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: PG_USER, password: PG_PASS, port: PORT, persistent: false });
  await epg.initialise();
  await epg.start();
});

after(async () => {
  if (epg) {
    try { await epg.stop(); } catch {}
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------

test('F1 long: temperature_readings(room text, temperature numeric, set_low, set_high, recorded_at timestamptz) - latest per room, alarm, stale', async () => {
  await createDb('f1');
  await withClient('f1', async (c) => {
    await c.query(`CREATE TABLE temperature_readings (
      id serial PRIMARY KEY, room text NOT NULL, temperature numeric(6,2), set_low numeric(6,2), set_high numeric(6,2),
      recorded_at timestamptz NOT NULL DEFAULT now())`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      // older readings with different values must NOT win. dock_area's whole history is shifted back so its
      // NEWEST row is 12 minutes old: older than PULSE_STALE_MS (10 min) -> offline, but still inside the
      // 2 x PULSE_STALE_MS "recent" tier so F20 (same database) needs exactly one readings query.
      const shift = z.id === 'dock_area' ? 12 : 0;
      await c.query(`INSERT INTO temperature_readings(room, temperature, set_low, set_high, recorded_at) VALUES ($1,$2,$3,$4, now() - make_interval(mins => $5))`, [LABEL[z.id], ref.temp + 3, ref.low, ref.high, shift + 2]);
      await c.query(`INSERT INTO temperature_readings(room, temperature, set_low, set_high, recorded_at) VALUES ($1,$2,$3,$4, now() - make_interval(mins => $5))`, [LABEL[z.id], ref.temp - 3, ref.low, ref.high, shift + 1]);
      await c.query(`INSERT INTO temperature_readings(room, temperature, set_low, set_high, recorded_at) VALUES ($1,$2,$3,$4, now() - make_interval(mins => $5))`, [LABEL[z.id], ref.temp, ref.low, ref.high, shift]);
    }
  });
  const snap = await snapshotFor('f1');
  assert.equal(snap.ok, true, snap.error);
  assert.equal(snap.connected, true);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'long');
  assert.equal(snap.detected.table, 'temperature_readings');
  assert.equal(snap.detected.roomCol, 'room');
  assert.equal(snap.detected.tempCol, 'temperature');
  assert.equal(snap.detected.tsCol, 'recorded_at');
  assert.equal(snap.detected.setLowCol, 'set_low');
  assert.equal(snap.detected.setHighCol, 'set_high');
  assertMatchesRef(snap, { skip: ['dock_area'] });
  const dock = snap.rooms.dock_area;
  assert.ok(approx(dock.temperature, REF.dock_area.temp), 'stale reading still reported');
  assert.equal(dock.offline, true, 'reading older than PULSE_STALE_MS is offline');
  assert.equal(snap.rooms.chiller_room_2.alarm, true);
  assert.equal(snap.rooms.frozen_room_3.alarm, false, 'warning band is not an alarm');
  assert.equal(Object.keys(snap.rooms).length, 16, 'no extra rooms');
});

test('F2 long: sensor_logs(zone_name varchar, actual real, low_limit, high_limit, created_at timestamp WITHOUT tz stored as UTC)', async () => {
  await createDb('f2');
  await withClient('f2', async (c) => {
    await c.query(`CREATE TABLE sensor_logs (id bigserial PRIMARY KEY, zone_name varchar(64), actual real, low_limit real, high_limit real, created_at timestamp NOT NULL)`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      await c.query(`INSERT INTO sensor_logs(zone_name, actual, low_limit, high_limit, created_at) VALUES ($1,$2,$3,$4, (now() at time zone 'utc') - interval '3 minutes')`, [z.id, ref.temp + 1, ref.low, ref.high]);
      await c.query(`INSERT INTO sensor_logs(zone_name, actual, low_limit, high_limit, created_at) VALUES ($1,$2,$3,$4, (now() at time zone 'utc'))`, [z.id, ref.temp, ref.low, ref.high]);
    }
  });
  const snap = await snapshotFor('f2');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'long');
  assert.equal(snap.detected.table, 'sensor_logs');
  assert.equal(snap.detected.roomCol, 'zone_name');
  assert.equal(snap.detected.tempCol, 'actual');
  assert.equal(snap.detected.tsCol, 'created_at');
  assert.equal(snap.detected.setLowCol, 'low_limit');
  assert.equal(snap.detected.setHighCol, 'high_limit');
  // real is float4: allow float noise
  for (const z of ZONES) assert.ok(approx(snap.rooms[z.id].temperature, REF[z.id].temp, 1e-3), `${z.id} temp`);
  // timestamp-without-tz must be treated as UTC: if it were treated as local (IST, +5:30) every room would be hours off and OFFLINE
  assertMatchesRef(snap, { freshWithinMs: 5 * 60 * 1000 });
});

test('F3 per_room: rooms(id int, name text, temp double precision, min_temp, max_temp, updated_at) with short codes like FR-1 / CR-3 / Dock', async () => {
  await createDb('f3');
  await withClient('f3', async (c) => {
    await c.query(`CREATE TABLE rooms (id int PRIMARY KEY, name text NOT NULL, temp double precision, min_temp numeric, max_temp numeric, updated_at timestamptz DEFAULT now())`);
    // ids deliberately NOT 1..16 in zone order, so a numeric-id mapping would be wrong; the text name must win
    let i = 100;
    for (const z of [...ZONES].reverse()) {
      const ref = REF[z.id];
      await c.query(`INSERT INTO rooms(id, name, temp, min_temp, max_temp) VALUES ($1,$2,$3,$4,$5)`, [i++, CODE[z.id], ref.temp, ref.low, ref.high]);
    }
  });
  const snap = await snapshotFor('f3');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'per_room');
  assert.equal(snap.detected.table, 'rooms');
  assert.equal(snap.detected.roomCol, 'name');
  assert.equal(snap.detected.tempCol, 'temp');
  assert.equal(snap.detected.setLowCol, 'min_temp');
  assert.equal(snap.detected.setHighCol, 'max_temp');
  assertMatchesRef(snap);
  assert.equal(Object.keys(snap.rooms).length, 16, 'all codes resolved; no extra rooms');
});

test('F4 wide: plc_snapshots(ts timestamptz, <16 zone-id columns>) - newest row only', async () => {
  await createDb('f4');
  const cols = ZONES.map((z) => `"${z.id}" numeric(6,2)`).join(', ');
  await withClient('f4', async (c) => {
    await c.query(`CREATE TABLE plc_snapshots (id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), ${cols})`);
    const names = ZONES.map((z) => `"${z.id}"`).join(', ');
    const older = ZONES.map((z) => REF[z.id].temp + 5);
    const newest = ZONES.map((z) => REF[z.id].temp);
    const ph = (off) => ZONES.map((_, i) => `$${i + 1 + off}`).join(', ');
    await c.query(`INSERT INTO plc_snapshots(ts, ${names}) VALUES (now() - interval '5 minutes', ${ph(0)})`, older);
    await c.query(`INSERT INTO plc_snapshots(ts, ${names}) VALUES (now() - interval '10 minutes', ${ph(0)})`, older);
    await c.query(`INSERT INTO plc_snapshots(ts, ${names}) VALUES (now(), ${ph(0)})`, newest);
  });
  const snap = await snapshotFor('f4');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'wide');
  assert.equal(snap.detected.table, 'plc_snapshots');
  assert.equal(snap.detected.tsCol, 'ts');
  assert.equal(Object.keys(snap.detected.wideMap || {}).length, 16);
  assertMatchesRef(snap, { setpoints: false });
});

test('F5 distractors: users/profiles/alarm_events/settings/spatial_ref_sys must not be chosen over temperature_readings', async () => {
  await createDb('f5');
  await withClient('f5', async (c) => {
    await c.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz DEFAULT now())`);
    await c.query(`CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text, updated_at timestamptz)`);
    await c.query(`CREATE TABLE alarm_events (id bigserial PRIMARY KEY, room text, message text, temperature numeric, created_at timestamptz DEFAULT now())`);
    await c.query(`CREATE TABLE settings (key text PRIMARY KEY, value text)`);
    await c.query(`CREATE TABLE spatial_ref_sys (srid int PRIMARY KEY, auth_name varchar(256), auth_srid int, srtext varchar(2048), proj4text varchar(2048))`);
    await c.query(`CREATE TABLE temperature_readings (id serial PRIMARY KEY, room text, temperature numeric, set_low numeric, set_high numeric, recorded_at timestamptz DEFAULT now())`);
    await c.query(`INSERT INTO alarm_events(room, message, temperature) VALUES ('Frozen Room 1', 'TEMP HIGH', 99)`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      await c.query(`INSERT INTO temperature_readings(room, temperature, set_low, set_high) VALUES ($1,$2,$3,$4)`, [LABEL[z.id], ref.temp, ref.low, ref.high]);
    }
  });
  const snap = await snapshotFor('f5');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.table, 'temperature_readings');
  assertMatchesRef(snap);
});

test('F6 Supabase-typical: readings(id bigint, created_at timestamptz default now(), room_id int 1..16, value float8) - numeric room ids, no setpoints', async () => {
  await createDb('f6');
  await withClient('f6', async (c) => {
    await c.query(`CREATE TABLE readings (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), room_id int NOT NULL, value float8)`);
    for (let i = 0; i < ZONES.length; i++) {
      const z = ZONES[i];
      await c.query(`INSERT INTO readings(room_id, value, created_at) VALUES ($1,$2, now() - interval '1 minute')`, [i + 1, REF[z.id].temp + 2]);
      await c.query(`INSERT INTO readings(room_id, value) VALUES ($1,$2)`, [i + 1, REF[z.id].temp]);
    }
  });
  const snap = await snapshotFor('f6');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'long');
  assert.equal(snap.detected.table, 'readings');
  assert.equal(snap.detected.roomCol, 'room_id');
  assert.equal(snap.detected.tempCol, 'value');
  assert.equal(snap.detected.tsCol, 'created_at');
  assertMatchesRef(snap, { setpoints: false });
});

test('F7 text-typed columns: logs(room text, temperature text, time text) with units and garbage values - never throws', async () => {
  await createDb('f7');
  await withClient('f7', async (c) => {
    await c.query(`CREATE TABLE logs (room text, temperature text, "time" text)`);
    const iso = (d) => new Date(d).toISOString();
    const now = Date.now();
    for (const z of ZONES) {
      const ref = REF[z.id];
      const txt = z.id === 'chiller_room_1' ? ` ${ref.temp} \u00B0C` : String(ref.temp);
      await c.query(`INSERT INTO logs VALUES ($1,$2,$3)`, [LABEL[z.id], String(ref.temp + 4), iso(now - 120000)]);
      await c.query(`INSERT INTO logs VALUES ($1,$2,$3)`, [LABEL[z.id], txt, iso(now - 1000)]);
    }
    // garbage rows: must not throw and must not become the room's value
    await c.query(`INSERT INTO logs VALUES ('Frozen Room 1', 'N/A', $1)`, [iso(now - 3000)]);
    await c.query(`INSERT INTO logs VALUES ('Frozen Room 2', '-', $1)`, [iso(now - 3000)]);
    await c.query(`INSERT INTO logs VALUES ('Frozen Room 4', '.', 'not a date')`);
  });
  const snap = await snapshotFor('f7');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.table, 'logs');
  for (const z of ZONES) {
    const r = snap.rooms[z.id];
    assert.ok(approx(r.temperature, REF[z.id].temp, 1e-3), `${z.id} parsed from text: ${r.temperature}`);
  }
});

test('F8 view: readings_raw (long) + VIEW latest_room_temperatures - the "latest" view is preferred', async () => {
  await createDb('f8');
  await withClient('f8', async (c) => {
    await c.query(`CREATE TABLE readings_raw (id bigserial PRIMARY KEY, room text, temperature numeric, set_low numeric, set_high numeric, updated_at timestamptz DEFAULT now())`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      await c.query(`INSERT INTO readings_raw(room, temperature, set_low, set_high, updated_at) VALUES ($1,$2,$3,$4, now() - interval '4 minutes')`, [LABEL[z.id], ref.temp + 1, ref.low, ref.high]);
      await c.query(`INSERT INTO readings_raw(room, temperature, set_low, set_high) VALUES ($1,$2,$3,$4)`, [LABEL[z.id], ref.temp, ref.low, ref.high]);
    }
    await c.query(`CREATE VIEW latest_room_temperatures AS
      SELECT DISTINCT ON (room) room, temperature, set_low, set_high, updated_at FROM readings_raw ORDER BY room, updated_at DESC`);
  });
  const snap = await snapshotFor('f8');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.table, 'latest_room_temperatures');
  assert.equal(snap.detected.mode, 'per_room');
  assertMatchesRef(snap);
});

test('F9 wide with prefixes: temperatures(created_at, temp_frozen_room_1, temp_fr2, temp_cr1, ... temp_dock)', async () => {
  await createDb('f9');
  const wideNames = {
    frozen_room_1: 'temp_frozen_room_1', frozen_room_2: 'temp_fr2', frozen_room_3: 'temp_frozen_room_3', frozen_room_4: 'temp_fr4',
    frozen_room_5: 'temp_fr5', frozen_anteroom: 'temp_frozen_anteroom', chiller_room_1: 'temp_cr1', chiller_room_2: 'temp_cr2',
    chiller_room_3: 'temp_chiller_room_3', chiller_room_4: 'temp_cr4', chiller_room_5: 'temp_cr5', chiller_room_6: 'temp_cr6',
    chiller_anteroom: 'temp_chiller_anteroom', blast_freezer_1: 'temp_bf1', blast_freezer_2: 'temp_bf2', dock_area: 'temp_dock',
  };
  await withClient('f9', async (c) => {
    const cols = ZONES.map((z) => `${wideNames[z.id]} float8`).join(', ');
    await c.query(`CREATE TABLE temperatures (created_at timestamptz NOT NULL DEFAULT now(), ${cols})`);
    const names = ZONES.map((z) => wideNames[z.id]).join(', ');
    const ph = ZONES.map((_, i) => `$${i + 1}`).join(', ');
    await c.query(`INSERT INTO temperatures(created_at, ${names}) VALUES (now() - interval '1 minute', ${ph})`, ZONES.map((z) => REF[z.id].temp + 7));
    await c.query(`INSERT INTO temperatures(${names}) VALUES (${ph})`, ZONES.map((z) => REF[z.id].temp));
  });
  const snap = await snapshotFor('f9');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.mode, 'wide');
  assert.equal(snap.detected.table, 'temperatures');
  assertMatchesRef(snap, { setpoints: false });
});

test('F10 FK join: readings.room_id -> rooms(id serial NOT 1..16, name text) - names resolved through the foreign key', async () => {
  await createDb('f10');
  await withClient('f10', async (c) => {
    await c.query(`CREATE TABLE rooms (id serial PRIMARY KEY, name text NOT NULL, kind text)`);
    await c.query(`CREATE TABLE readings (id bigserial PRIMARY KEY, room_id int NOT NULL REFERENCES rooms(id), temperature numeric, created_at timestamptz NOT NULL DEFAULT now())`);
    await c.query(`ALTER SEQUENCE rooms_id_seq RESTART WITH 501`);
    const idOf = {};
    for (const z of [...ZONES].reverse()) {
      const r = await c.query(`INSERT INTO rooms(name, kind) VALUES ($1,$2) RETURNING id`, [LABEL[z.id], z.type]);
      idOf[z.id] = r.rows[0].id;
    }
    for (const z of ZONES) {
      await c.query(`INSERT INTO readings(room_id, temperature, created_at) VALUES ($1,$2, now() - interval '2 minutes')`, [idOf[z.id], REF[z.id].temp - 1]);
      await c.query(`INSERT INTO readings(room_id, temperature) VALUES ($1,$2)`, [idOf[z.id], REF[z.id].temp]);
    }
  });
  const snap = await snapshotFor('f10');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.table, 'readings');
  assertMatchesRef(snap, { setpoints: false });
  assert.equal(Object.keys(snap.rooms).length, 16, 'no unresolved numeric-id rooms appended');
});

test('F11 uuid FK: measurements.room_id uuid -> cold_rooms(id uuid, label text, set_low, set_high) - joined names AND setpoints from the parent', async () => {
  await createDb('f11');
  await withClient('f11', async (c) => {
    await c.query(`CREATE TABLE cold_rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL, set_low numeric, set_high numeric)`);
    await c.query(`CREATE TABLE measurements (id bigserial PRIMARY KEY, room_id uuid NOT NULL REFERENCES cold_rooms(id), temperature numeric, measured_at timestamptz NOT NULL DEFAULT now())`);
    const idOf = {};
    for (const z of ZONES) {
      const r = await c.query(`INSERT INTO cold_rooms(label, set_low, set_high) VALUES ($1,$2,$3) RETURNING id`, [LABEL[z.id], REF[z.id].low, REF[z.id].high]);
      idOf[z.id] = r.rows[0].id;
    }
    for (const z of ZONES) {
      await c.query(`INSERT INTO measurements(room_id, temperature, measured_at) VALUES ($1,$2, now() - interval '2 minutes')`, [idOf[z.id], REF[z.id].temp + 1]);
      await c.query(`INSERT INTO measurements(room_id, temperature) VALUES ($1,$2)`, [idOf[z.id], REF[z.id].temp]);
    }
  });
  const snap = await snapshotFor('f11');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.table, 'measurements');
  assertMatchesRef(snap);
});

test('F12 epoch: readings(room text, temp numeric, ts bigint seconds) and (ts_ms bigint milliseconds)', async () => {
  await createDb('f12');
  await withClient('f12', async (c) => {
    await c.query(`CREATE TABLE readings (room text, temp numeric, ts bigint)`);
    const nowS = Math.floor(Date.now() / 1000);
    for (const z of ZONES) {
      await c.query(`INSERT INTO readings VALUES ($1,$2,$3)`, [LABEL[z.id], REF[z.id].temp + 1, nowS - 120]);
      await c.query(`INSERT INTO readings VALUES ($1,$2,$3)`, [LABEL[z.id], REF[z.id].temp, nowS]);
    }
  });
  const snap = await snapshotFor('f12');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  assert.equal(snap.detected.tsCol, 'ts');
  assertMatchesRef(snap, { setpoints: false });

  await createDb('f12b');
  await withClient('f12b', async (c) => {
    await c.query(`CREATE TABLE readings (room text, temp numeric, timestamp_ms bigint)`);
    const nowMs = Date.now();
    for (const z of ZONES) {
      await c.query(`INSERT INTO readings VALUES ($1,$2,$3)`, [LABEL[z.id], REF[z.id].temp + 1, nowMs - 120000]);
      await c.query(`INSERT INTO readings VALUES ($1,$2,$3)`, [LABEL[z.id], REF[z.id].temp, nowMs]);
    }
  });
  const snap2 = await snapshotFor('f12b');
  assert.equal(snap2.ok, true, snap2.error);
  assertMatchesRef(snap2, { setpoints: false });
});

test('F13 empty candidate table: 16 zones OFFLINE, ok:true, connected:true', async () => {
  await createDb('f13');
  await withClient('f13', (c) => c.query(`CREATE TABLE temperature_readings (id serial, room text, temperature numeric, recorded_at timestamptz)`));
  const snap = await snapshotFor('f13');
  assert.equal(snap.ok, true, snap.error);
  assert.equal(snap.connected, true);
  assertSixteen(snap);
  for (const z of ZONES) {
    assert.equal(snap.rooms[z.id].offline, true);
    assert.equal(snap.rooms[z.id].temperature, null);
  }
});

test('F14 no candidate table at all: connected:true, ok:false with a helpful error, 16 zones OFFLINE', async () => {
  await createDb('f14');
  await withClient('f14', async (c) => {
    await c.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz DEFAULT now())`);
    await c.query(`CREATE TABLE settings (key text PRIMARY KEY, value text)`);
  });
  const snap = await snapshotFor('f14');
  assert.equal(snap.connected, true, 'DB itself is reachable');
  assert.equal(snap.ok, false);
  assert.match(String(snap.error), /PULSE_TABLE|no .*table/i);
  assertSixteen(snap);
  for (const z of ZONES) assert.equal(snap.rooms[z.id].offline, true);
});

test('F15 env overrides: PULSE_TABLE + column names on an oddly-named table beat auto-detection; partial overrides autodetect the rest', async () => {
  await createDb('f15');
  await withClient('f15', async (c) => {
    // an obviously-named decoy with WRONG numbers, and the real data in a table auto-detection would never pick
    await c.query(`CREATE TABLE temperature_readings (id serial, room text, temperature numeric, recorded_at timestamptz DEFAULT now())`);
    for (const z of ZONES) await c.query(`INSERT INTO temperature_readings(room, temperature) VALUES ($1, 99)`, [LABEL[z.id]]);
    await c.query(`CREATE TABLE "Zed Export 7" ("Chamber" text, "Val" numeric, "Lo" numeric, "Hi" numeric, "Stamp" timestamptz DEFAULT now())`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      await c.query(`INSERT INTO "Zed Export 7" VALUES ($1,$2,$3,$4)`, [LABEL[z.id], ref.temp, ref.low, ref.high]);
    }
  });
  const full = await snapshotFor('f15', {
    PULSE_TABLE: 'Zed Export 7', PULSE_MODE: 'per_room', PULSE_ROOM_COL: 'Chamber', PULSE_TEMP_COL: 'Val',
    PULSE_TS_COL: 'Stamp', PULSE_SET_LOW_COL: 'Lo', PULSE_SET_HIGH_COL: 'Hi',
  });
  assert.equal(full.ok, true, full.error);
  assert.equal(full.detected.via, 'env');
  assert.equal(full.detected.table, 'Zed Export 7');
  assertSixteen(full);
  assertMatchesRef(full);

  const partial = await snapshotFor('f15', { PULSE_TABLE: 'Zed Export 7' });
  assert.equal(partial.ok, true, partial.error);
  assert.equal(partial.detected.table, 'Zed Export 7');
  assert.equal(partial.detected.roomCol, 'Chamber');
  assert.equal(partial.detected.tempCol, 'Val');
  assertSixteen(partial);
  assertMatchesRef(partial);
});

test('F16 override naming a missing table: ok:false, error mentions the table, no throw, 16 zones OFFLINE', async () => {
  const snap = await snapshotFor('f1', { PULSE_TABLE: 'does_not_exist' });
  assert.equal(snap.ok, false);
  assert.match(String(snap.error), /does_not_exist/);
  assertSixteen(snap);
});

test('F17 unknown rooms are appended after the 16 zones, not dropped', async () => {
  await createDb('f17');
  await withClient('f17', async (c) => {
    await c.query(`CREATE TABLE temperature_readings (id serial, room text, temperature numeric, recorded_at timestamptz DEFAULT now())`);
    for (const z of ZONES) await c.query(`INSERT INTO temperature_readings(room, temperature) VALUES ($1,$2)`, [LABEL[z.id], REF[z.id].temp]);
    await c.query(`INSERT INTO temperature_readings(room, temperature) VALUES ('Ripening Room 9', 14.5)`);
  });
  const snap = await snapshotFor('f17');
  assert.equal(snap.ok, true, snap.error);
  assertSixteen(snap);
  const ids = Object.keys(snap.rooms);
  assert.equal(ids.length, 17);
  const extra = snap.rooms[ids[16]];
  assert.equal(extra.label, 'Ripening Room 9');
  assert.ok(approx(extra.temperature, 14.5));
  assert.equal(extra.offline, false);
});

test('F18 connection failure: ok:false, connected:false, error never contains the password', async () => {
  const db = loadDb({ DATABASE_URL: `postgresql://postgres:SuperSecretPw123@127.0.0.1:1/postgres?sslmode=disable` });
  try {
    const snap = await db.getSnapshot();
    assert.equal(snap.ok, false);
    assert.equal(snap.connected, false);
    assert.ok(snap.error, 'error message present');
    assert.doesNotMatch(String(snap.error), /SuperSecretPw123/);
    assert.doesNotMatch(JSON.stringify(db.getStatus()), /SuperSecretPw123/);
    assertSixteen(snap);
  } finally {
    await db.closePool();
  }
});

test('F19 missing DATABASE_URL: ok:false with a clear error, no throw', async () => {
  const db = loadDb({});
  delete process.env.DATABASE_URL;
  try {
    const snap = await db.getSnapshot();
    assert.equal(snap.ok, false);
    assert.equal(snap.connected, false);
    assert.match(String(snap.error), /DATABASE_URL/);
    assertSixteen(snap);
  } finally {
    await db.closePool();
  }
});

test('F20 caching + coalescing: concurrent callers share one query; cache honoured within PULSE_CACHE_MS', async () => {
  const db = loadDb({ DATABASE_URL: adminUrl('f1'), PULSE_CACHE_MS: '1500' });
  try {
    const before = db.getStatus().queryCount || 0;
    const [a, b, c] = await Promise.all([db.getSnapshot(), db.getSnapshot(), db.getSnapshot()]);
    assert.equal(a.ok, true, a.error);
    assert.equal(a.timestamp, b.timestamp);
    assert.equal(b.timestamp, c.timestamp);
    const d = await db.getSnapshot();
    assert.equal(d.timestamp, a.timestamp, 'served from cache');
    const after = db.getStatus().queryCount || 0;
    assert.equal(after - before, 1, `exactly one DB round-trip for 4 calls (got ${after - before})`);
  } finally {
    await db.closePool();
  }
});

test('F22 tiered window: a zone whose only reading is 30h old still appears (offline) via the 48h tier; fresh zones need only the recent tier', async () => {
  await createDb('f22');
  await withClient('f22', async (c) => {
    await c.query(`CREATE TABLE readings (id bigserial PRIMARY KEY, tag text NOT NULL, value double precision, ts timestamptz NOT NULL DEFAULT now())`);
    for (const z of ZONES) {
      const ref = REF[z.id];
      if (z.id === 'dock_area') {
        await c.query(`INSERT INTO readings(tag, value, ts) VALUES ($1,$2, now() - interval '31 hours')`, [LABEL[z.id], ref.temp + 1]);
        await c.query(`INSERT INTO readings(tag, value, ts) VALUES ($1,$2, now() - interval '30 hours')`, [LABEL[z.id], ref.temp]);
      } else {
        await c.query(`INSERT INTO readings(tag, value, ts) VALUES ($1,$2, now() - interval '25 hours')`, [LABEL[z.id], ref.temp + 5]);
        await c.query(`INSERT INTO readings(tag, value, ts) VALUES ($1,$2, now() - interval '3 seconds')`, [LABEL[z.id], ref.temp]);
      }
    }
  });
  const db = loadDb({ DATABASE_URL: adminUrl('f22') });
  try {
    const snap = await db.getSnapshot();
    assert.equal(snap.ok, true, snap.error);
    assertSixteen(snap);
    assert.equal(snap.detected.mode, 'long');
    assert.deepEqual([snap.detected.roomCol, snap.detected.tempCol, snap.detected.tsCol], ['tag', 'value', 'ts']);
    assertMatchesRef(snap, { setpoints: false, skip: ['dock_area'] });
    const dock = snap.rooms.dock_area;
    assert.ok(approx(dock.temperature, REF.dock_area.temp), `30h-old reading reported (got ${dock.temperature})`);
    assert.equal(dock.offline, true);
    assert.ok(Math.abs(Date.now() - 30 * 3600000 - dock.updatedAt) < 5 * 60 * 1000, 'updatedAt is the 30h-old timestamp');
    const st = db.getStatus();
    assert.deepEqual(st.lastTiers, ['recent', 'window'], 'recent slice was missing dock_area, so the 48h window ran; no unbounded query');
    assert.equal(st.queryCount, 2);

    // dock gets a fresh reading: back to the single recent-tier query
    await withClient('f22', (c) => c.query(`INSERT INTO readings(tag, value) VALUES ('Dock Area', $1)`, [REF.dock_area.temp]));
    const snap2 = await db.getSnapshot();
    assert.equal(snap2.rooms.dock_area.offline, false);
    assert.deepEqual(db.getStatus().lastTiers, ['recent']);
    assert.equal(db.getStatus().queryCount, 3);
  } finally {
    await db.closePool();
  }
});

test('F21 inspectSchema() lists tables and ranked candidates and never leaks the password', async () => {
  const db = loadDb({ DATABASE_URL: adminUrl('f5') });
  try {
    const info = await db.inspectSchema();
    assert.equal(info.schema, 'public');
    const names = info.tables.map((t) => t.name);
    for (const n of ['users', 'profiles', 'alarm_events', 'settings', 'temperature_readings']) assert.ok(names.includes(n), `lists ${n}`);
    assert.ok(info.chosen && info.chosen.table === 'temperature_readings');
    assert.doesNotMatch(JSON.stringify(info), new RegExp(PG_PASS));
  } finally {
    await db.closePool();
  }
});

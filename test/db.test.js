process.env.NEXT_PUBLIC_FIXED_LIMITS = 'false'; // these tests are about the panel's own limits
const test = require('node:test');
const assert = require('node:assert/strict');

test('db module: requiring does not connect and missing DATABASE_URL is a clean failure', async () => {
  delete process.env.DATABASE_URL;
  const db = require('../lib/db');
  db._resetForTests();
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, false);
  assert.equal(snap.connected, false);
  assert.equal(snap.error, 'DATABASE_URL not set');
  assert.equal(snap.source, 'supabase');
  assert.equal(Object.keys(snap.rooms).length, 16);
  assert.equal(snap.rooms.frozen_room_1.offline, true);
  const status = db.getStatus();
  assert.equal(status.connected, false);
  assert.equal(status.lastError, 'DATABASE_URL not set');
  assert.equal(status.cacheMs, 1500);
  assert.equal(status.staleMs, 600000);
  await db.closePool();
});

test('db module: passwords are redacted from messages', () => {
  const { redact } = require('../lib/db');
  assert.equal(redact('connect postgresql://postgres:s3cret@db.host:5432/postgres failed'), 'connect postgresql://***@db.host:5432/postgres failed');
  assert.equal(redact('plain message'), 'plain message');
});

// ---- fixes from review --------------------------------------------------------------
test('db module: sslmode in DATABASE_URL no longer overrides the ssl options handed to pg', () => {
  const { poolConfig, stripSslParams } = require('../lib/db');
  const { Client } = require('pg');
  const base = 'postgresql://postgres.abc:p%40ss[word]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  assert.equal(stripSslParams(base), base);
  assert.equal(stripSslParams(base + '?sslmode=require'), base);
  assert.equal(stripSslParams(base + '?sslmode=require&application_name=x&uselibpqcompat=true'), base + '?application_name=x');
  assert.equal(stripSslParams(base + '?SSLMode=verify-full&sslrootcert=/x'), base);
  const cfg = { databaseUrl: base + '?sslmode=require', sslCa: null };
  const pc = poolConfig(cfg);
  assert.equal(pc.connectionString, base);
  assert.deepEqual(pc.ssl, { rejectUnauthorized: false });
  const eff = new Client(pc).connectionParameters.ssl;
  assert.equal(eff.rejectUnauthorized, false);
  assert.equal(new Client(pc).connectionParameters.password, 'p@ss[word]');
  // sslmode=disable is still honoured (via sslOptions), and a CA file makes it verify
  assert.equal(poolConfig({ databaseUrl: base + '?sslmode=disable' }).ssl, false);
  const fs = require('fs');
  const path = require('path');
  const caPath = path.join(__dirname, 'tmp-ca.crt');
  fs.writeFileSync(caPath, 'FAKE CA');
  try {
    const withCa = poolConfig({ databaseUrl: base + '?sslmode=require', sslCa: caPath });
    assert.deepEqual(withCa.ssl, { ca: 'FAKE CA', rejectUnauthorized: true });
    assert.equal(new Client(withCa).connectionParameters.ssl.ca, 'FAKE CA');
  } finally {
    fs.unlinkSync(caPath);
  }
});

function fakePool(spec) {
  const calls = [];
  return {
    calls,
    async query(q) {
      const text = typeof q === 'string' ? q : q.text;
      calls.push({ text, values: (q && q.values) || [] });
      if (/information_schema\.tables/.test(text)) return { rows: spec.discovery || [] };
      if (/pg_class/.test(text)) return { rows: spec.matviews || [] };
      if (/FOREIGN KEY/.test(text)) return { rows: spec.fks || [] };
      if (/information_schema\.columns WHERE/.test(text)) return { rows: spec.refColumns || [] };
      if (/\/\* limits \*\//.test(text)) return typeof spec.limits === 'function' ? spec.limits(q) : { rows: spec.limits || [] };
      if (/\/\* inputs \*\//.test(text)) return { rows: spec.inputs || [] };
      if (/\/\* room_settings \*\//.test(text)) { if (/insert into/.test(text)) { spec.written = (spec.written || []).concat([q.values]); } return { rows: spec.roomSettings || [] }; }
      if (/\/\* alarms \*\//.test(text)) return { rows: spec.alarms || [] };
      return spec.onQuery(text);
    },
    async end() {},
  };
}
const disc = (table, cols, type = 'BASE TABLE') => cols.map(([column_name, data_type, udt_name], i) => ({
  table_name: table, table_type: type, column_name, data_type, udt_name: udt_name || null, ordinal_position: i + 1,
}));

function withEnv(fn) {
  return async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.PULSE_CACHE_MS = '0';
    delete process.env.PULSE_WINDOW_HOURS;
    const db = require('../lib/db');
    db._resetForTests();
    try {
      await fn(db);
    } finally {
      db._setPoolForTests(null);
      db._resetForTests();
      delete process.env.DATABASE_URL;
      delete process.env.PULSE_CACHE_MS;
    }
  };
}

const { ZONES } = require('../lib/zones');
const row = (room, temperature, ageMs = 0) => ({ room, temperature, set_low: null, set_high: null, ts_ms: Date.now() - ageMs, ts_raw: null });

test('db module: tiered window - recent slice first, 48h window only when a zone is missing, unbounded only when the window is empty (then held for a minute)', withEnv(async (db) => {
  let recentRows = [];
  let windowedRows = [];
  const pool = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: (text) => ({
      rows: /interval '20 minutes'/.test(text) ? recentRows
        : /interval '48 hours'/.test(text) ? windowedRows
          : [row('Frozen Room 1', -18.5, 3 * 86400000)],
    }),
  });
  db._setPoolForTests(pool);
  const main = () => pool.calls.filter((c) => /DISTINCT ON/.test(c.text) && !/\/\* (limits|inputs|alarms) \*\//.test(c.text));

  // (a) table empty in the last 48h: recent -> window -> unbounded (3 queries), 3-day-old reading shown as stale
  const snap1 = await db.getSnapshot();
  assert.equal(snap1.ok, true, snap1.error);
  assert.equal(snap1.detected.roomResolution, 'name');
  assert.equal(main().length, 3);
  assert.match(main()[0].text, /interval '20 minutes'/); // 2 x PULSE_STALE_MS (10 min) = 20 min
  assert.match(main()[1].text, /interval '48 hours'/);
  assert.ok(!/interval/.test(main()[2].text));
  assert.equal(snap1.rooms.frozen_room_1.temperature, -18.5);
  assert.equal(snap1.rooms.frozen_room_1.offline, true); // 3 days old: shown but stale
  assert.equal(snap1.stats.resolvedZones, 1);
  assert.equal(snap1.warning, null);
  assert.deepEqual(db.getStatus().lastTiers, ['recent', 'window', 'unbounded']);
  assert.equal(db.getStatus().queryCount, 3);
  assert.equal(db.getStatus().discoveryQueryCount, 2); // information_schema + matviews: NOT counted as snapshot queries
  // second poll within the hold: straight to unbounded
  pool.calls.length = 0;
  await db.getSnapshot();
  assert.equal(main().length, 1);
  assert.ok(!/interval/.test(main()[0].text));
  assert.deepEqual(db.getStatus().lastTiers, ['unbounded']);

  // (b) one zone only has a 30h-old reading: recent (15 zones) + window (dock), merged; NO unbounded query
  db._resetForTests();
  recentRows = ZONES.filter((z) => z.id !== 'dock_area').map((z) => row(z.label, -1));
  windowedRows = [...recentRows.map((r) => ({ ...r, temperature: 99, ts_ms: r.ts_ms - 60000 })), row('Dock Area', 12.5, 30 * 3600000)];
  pool.calls.length = 0;
  const snap2 = await db.getSnapshot();
  assert.equal(main().length, 2);
  assert.equal(snap2.rooms.dock_area.temperature, 12.5);
  assert.equal(snap2.rooms.dock_area.offline, true);
  assert.equal(snap2.rooms.frozen_room_1.temperature, -1); // newest per room wins on merge, not the older window row
  assert.equal(snap2.stats.resolvedZones, 16);
  assert.deepEqual(db.getStatus().lastTiers, ['recent', 'window']);

  // (c) a zone missing from the window too stays offline; the window had rows so still no unbounded query
  db._resetForTests();
  windowedRows = [];
  pool.calls.length = 0;
  const snap2b = await db.getSnapshot();
  assert.equal(main().length, 3, 'window empty -> unbounded'); // window returned 0 rows -> unbounded allowed
  windowedRows = [row('Chiller Room 1', 4, 40 * 3600000)];
  db._resetForTests();
  pool.calls.length = 0;
  const snap2c = await db.getSnapshot();
  assert.equal(main().length, 2, 'window non-empty -> never unbounded');
  assert.equal(snap2c.rooms.dock_area.temperature, null);
  assert.equal(snap2c.rooms.dock_area.offline, true);
  assert.equal(snap2b.ok && snap2c.ok, true);

  // (d) every zone in the recent slice: exactly one query per poll
  db._resetForTests();
  recentRows = ZONES.map((z) => row(z.label, -20));
  pool.calls.length = 0;
  const snap3 = await db.getSnapshot();
  assert.equal(snap3.rooms.frozen_room_1.temperature, -20);
  assert.equal(snap3.rooms.frozen_room_1.offline, false);
  assert.equal(main().length, 1);
  const status = db.getStatus();
  assert.equal(status.windowHours, 48);
  assert.equal(status.recentMs, 20 * 60 * 1000);
  assert.deepEqual(status.lastTiers, ['recent']);
  assert.equal(status.resolvedZones, 16);
  assert.equal(status.roomResolution, 'name');
}));

test('db module: PULSE_STALE_MS below 7.5 min keeps a 15 min recent window; PULSE_WINDOW_HOURS=0 goes straight to unbounded', withEnv(async (db) => {
  process.env.PULSE_STALE_MS = '60000';
  assert.equal(db.getStatus().recentMs, 15 * 60 * 1000);
  process.env.PULSE_WINDOW_HOURS = '0';
  const pool = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: () => ({ rows: [row('fr1', -20)] }),
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  const main = pool.calls.filter((c) => /DISTINCT ON/.test(c.text) && !/\/\* (limits|inputs|alarms) \*\//.test(c.text));
  assert.equal(main.length, 1);
  assert.ok(!/interval/.test(main[0].text));
  assert.deepEqual(db.getStatus().lastTiers, ['unbounded']);
  delete process.env.PULSE_STALE_MS;
  delete process.env.PULSE_WINDOW_HOURS;
}));

test('db module: no usable table / bad override is connected:true ok:false with a helpful error', withEnv(async (db) => {
  const pool = fakePool({
    discovery: disc('users', [['id', 'uuid'], ['email', 'text'], ['created_at', 'timestamp with time zone']]),
    onQuery: () => ({ rows: [] }),
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, false);
  assert.equal(snap.connected, true);
  assert.match(snap.error, /No usable temperature table/);
  assert.equal(db.getStatus().connected, true);
  assert.equal(db.getStatus().queryCount, 0);
  assert.ok(db.getStatus().discoveryQueryCount >= 1);

  db._resetForTests();
  process.env.PULSE_TABLE = 'does_not_exist';
  const snap2 = await db.getSnapshot();
  assert.equal(snap2.ok, false);
  assert.equal(snap2.connected, true);
  assert.match(snap2.error, /PULSE_TABLE="does_not_exist" was not found/);
  delete process.env.PULSE_TABLE;

  // a genuine connection error stays connected:false
  db._resetForTests();
  const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
  db._setPoolForTests({ calls: [], async query() { throw err; }, async end() {} });
  const snap3 = await db.getSnapshot();
  assert.equal(snap3.ok, false);
  assert.equal(snap3.connected, false);
}));

test('db module: integer FK room column is joined to the names table; matviews and enums are discovered', withEnv(async (db) => {
  const pool = fakePool({
    discovery: [
      ...disc('readings', [['id', 'bigint'], ['room_id', 'integer'], ['temperature', 'numeric'], ['created_at', 'timestamp with time zone']]),
      ...disc('rooms', [['id', 'integer'], ['name', 'text'], ['kind', 'USER-DEFINED', 'room_kind'], ['code', 'USER-DEFINED', 'citext'], ['set_low', 'numeric'], ['set_high', 'numeric']]),
    ],
    matviews: disc('alarm_summary', [['room', 'text'], ['count', 'bigint']], 'MATERIALIZED VIEW'),
    fks: [{ column_name: 'room_id', ref_schema: 'public', ref_table: 'rooms', ref_column: 'id' }],
    onQuery: (text) => {
      assert.match(text, /LEFT JOIN "public"\."rooms" AS "j" ON "j"\."id" = "t"\."room_id"/);
      assert.match(text, /"j"\."set_low"::float8 AS set_low, "j"\."set_high"::float8 AS set_high/);
      return {
        rows: [
          { room: 'Chiller Room 2', temperature: 4, set_low: 0, set_high: 3, ts_ms: Date.now(), ts_raw: null },
          { room: '17', temperature: 9, set_low: null, set_high: null, ts_ms: Date.now(), ts_raw: null },
        ],
      };
    },
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  assert.equal(snap.detected.roomResolution, 'join');
  assert.deepEqual(snap.detected.roomJoin, { schema: 'public', table: 'rooms', keyCol: 'id', nameCol: 'name', lowCol: 'set_low', highCol: 'set_high' });
  assert.equal(snap.rooms.chiller_room_2.temperature, 4);
  assert.equal(snap.rooms.chiller_room_2.offline, false);
  assert.equal(snap.rooms.chiller_room_2.setHigh, 3);
  assert.equal(snap.rooms.chiller_room_2.alarm, true); // 4 > parent set_high 3
  assert.equal(snap.rooms['17'].temperature, 9); // unmatched id falls back to its raw key (nothing dropped)
  const info = await db.inspectSchema();
  const names = info.tables.map((t) => t.name);
  assert.ok(names.includes('alarm_summary'));
  assert.equal(info.tables.find((t) => t.name === 'alarm_summary').kind, 'MATERIALIZED VIEW');
  const rooms = info.tables.find((t) => t.name === 'rooms');
  assert.equal(rooms.columns.find((c) => c.name === 'kind').type, 'user-defined');
  assert.equal(rooms.columns.find((c) => c.name === 'code').type, 'citext');
  assert.match(info.chosen.sql, /LEFT JOIN/);
}));

test('db module: unresolved rooms raise a warning; integer room column without FK is reported as ordinal', withEnv(async (db) => {
  const pool = fakePool({
    discovery: disc('sensor_data', [['sensor_id', 'text'], ['value', 'numeric'], ['ts', 'timestamp with time zone']]),
    onQuery: () => ({ rows: [{ room: 'S01', temperature: 1, ts_ms: Date.now() }, { room: 'S02', temperature: 2, ts_ms: Date.now() }] }),
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  assert.equal(snap.stats.resolvedZones, 0);
  assert.equal(snap.stats.unknownRooms, 2);
  assert.match(snap.warning, /No database room matched/);
  assert.match(db.getStatus().warning, /No database room matched/);
  assert.equal(Object.keys(snap.rooms).length, 18);

  db._resetForTests();
  const pool2 = fakePool({
    discovery: disc('temperature_history', [['id', 'bigint'], ['zone_id', 'integer'], ['temp', 'numeric'], ['ts', 'timestamp with time zone']]),
    onQuery: () => ({ rows: [{ room: '7', temperature: 2, ts_ms: Date.now() }] }),
  });
  db._setPoolForTests(pool2);
  const snap2 = await db.getSnapshot();
  assert.equal(snap2.ok, true, snap2.error);
  assert.equal(snap2.detected.roomResolution, 'ordinal');
  assert.equal(snap2.rooms.chiller_room_1.temperature, 2);
}));

test('db module: PULSE_SETPOINTS fills null DB limits and recomputes alarm; DB set-point columns win; offline rooms keep the limits', withEnv(async (db) => {
  process.env.PULSE_SETPOINTS = 'frozen=-25:-15, chiller_room_1=0:8, chiller_room_2=0:8, dock=5:18';
  try {
    const pool = fakePool({
      discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['set_low', 'numeric'], ['set_high', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
      onQuery: () => ({
        rows: [
          { ...row('Frozen Room 1', -10) },                                    // no DB limits: -25..-15 from env -> ALARM (too warm)
          { ...row('Frozen Room 2', -20) },                                    // no DB limits: -25..-15 from env -> ok
          { ...row('Chiller Room 1', 7), set_low: '2', set_high: '6' },        // DB limits 2..6 win over env 0..8 -> ALARM
          { ...row('Chiller Room 2', 7) },                                     // env 0..8 -> ok
          { ...row('Chiller Room 3', 30) },                                    // nothing configured -> no limits, never alarms
          { ...row('Blast Freezer 1', -30), set_low: null, set_high: '-18' }, // DB high only; low comes from the "frozen" default
          ...ZONES.filter((z) => !/^(frozen_room_[12]|chiller_room_[123]|blast_freezer_1)$/.test(z.id)).map((z) => row(z.label, 1)),
        ],
      }),
    });
    db._setPoolForTests(pool);
    const snap = await db.getSnapshot();
    assert.equal(snap.ok, true, snap.error);
    const r = snap.rooms;
    assert.deepEqual([r.frozen_room_1.setLow, r.frozen_room_1.setHigh, r.frozen_room_1.alarm], [-25, -15, true]);
    assert.deepEqual([r.frozen_room_2.setLow, r.frozen_room_2.setHigh, r.frozen_room_2.alarm], [-25, -15, false]);
    assert.deepEqual([r.chiller_room_1.setLow, r.chiller_room_1.setHigh, r.chiller_room_1.alarm], [2, 6, true]); // DB row kept its own limits
    assert.deepEqual([r.chiller_room_2.setLow, r.chiller_room_2.setHigh, r.chiller_room_2.alarm], [0, 8, false]);
    assert.deepEqual([r.chiller_room_3.setLow, r.chiller_room_3.setHigh, r.chiller_room_3.alarm], [null, null, false]);
    assert.deepEqual([r.blast_freezer_1.setLow, r.blast_freezer_1.setHigh, r.blast_freezer_1.alarm], [-25, -18, true]);
    assert.deepEqual([r.dock_area.setLow, r.dock_area.setHigh, r.dock_area.alarm], [5, 18, true]); // 1 C is below the dock low
    assert.equal(r.frozen_room_1.offline, false);
    assert.equal(snap.stats.resolvedZones, 16);
    const st = db.getStatus();
    assert.equal(st.setpointsSource, 'env');
    assert.equal(st.setpointsZones, 8 + 2 + 1); // frozen_room_1..5 + frozen_anteroom + blast_freezer_1..2 (type "frozen") + 2 chillers + dock
    assert.equal(st.setpointsPath, null);

    // DB unreachable: LOW/HIGH still shown from the configured set-points, alarm stays false (no temperature)
    db._resetForTests();
    db._setPoolForTests({ async query() { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }, async end() {} });
    const off = await db.getSnapshot();
    assert.equal(off.ok, false);
    assert.equal(off.connected, false);
    assert.deepEqual([off.rooms.frozen_room_1.setLow, off.rooms.frozen_room_1.setHigh, off.rooms.frozen_room_1.alarm, off.rooms.frozen_room_1.offline], [-25, -15, false, true]);

    // set-points are read once: clearing the env without a reset keeps them; a reset re-reads (none)
    delete process.env.PULSE_SETPOINTS;
    assert.equal(db.getStatus().setpointsSource, 'env');
    db._resetForTests();
    assert.equal(db.getStatus().setpointsSource, 'none');
    assert.equal(db.getStatus().setpointsZones, 0);
  } finally {
    delete process.env.PULSE_SETPOINTS;
  }
}));

// The collector writes a "<room> Set Low/High" row only when a limit changes, so the limits fall out of the
// tiered windows within minutes while still being the current limits. They are read as configuration:
// newest row per limit tag, any age, one index-friendly query, cached for a minute.
test('db module: panel limits are read without a time window, folded into the rooms, and cached a minute', withEnv(async (db) => {
  const pool = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: (text) => ({ rows: /interval '20 minutes'/.test(text) ? ZONES.map((z) => row(z.label, -1)) : [] }),
    limits: (q) => {
      assert.equal(q.values.length, 1);
      assert.equal(q.values[0].length, 32);
      assert.ok(q.values[0].includes('Frozen Room 1 Set Low'));
      assert.ok(q.values[0].includes('Dock Area Set High'));
      return { rows: [
        row('Frozen Room 1 Set Low', -25, 5 * 86400000), row('Frozen Room 1 Set High', -14, 5 * 86400000),
        row('Chiller Room 5 Set Low', 0, 3600000), row('Chiller Room 5 Set High', -15, 3600000),
      ] };
    },
  });
  db._setPoolForTests(pool);
  const limitCalls = () => pool.calls.filter((c) => /\/\* limits \*\//.test(c.text));
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  assert.equal(limitCalls().length, 1);
  assert.match(limitCalls()[0].text, /DISTINCT ON \("room"\)/);
  assert.match(limitCalls()[0].text, /"room" = ANY\(\$1::text\[\]\)/);
  assert.ok(!/interval/.test(limitCalls()[0].text), 'no time window on the limits');
  assert.equal(snap.rooms.frozen_room_1.setLow, -25);      // five days old and still the current limit
  assert.equal(snap.rooms.frozen_room_1.setHigh, -14);
  assert.equal(snap.rooms.frozen_room_1.temperature, -1);   // a limit row never becomes the temperature
  assert.equal(snap.rooms.frozen_room_1.offline, false);
  assert.equal(snap.rooms.chiller_room_5.limitsSwapped, true);
  assert.equal(snap.rooms.chiller_room_5.setLow, -15);
  assert.equal(snap.rooms.chiller_room_5.alarm, false);       // -1 sits inside -15..0
  assert.equal(snap.rooms.frozen_room_3.setLow, null);      // no limit rows for it: no limits
  assert.equal(db.getStatus().queryCount, 1, 'the limits query is not a snapshot query');
  // Cached: the next poll re-reads temperatures but not the limits.
  pool.calls.length = 0;
  await db.getSnapshot();
  assert.equal(limitCalls().length, 0);
  assert.equal(pool.calls.filter((c) => /DISTINCT ON/.test(c.text) && !/\/\* (limits|inputs|alarms) \*\//.test(c.text)).length, 1);
}));

// The collector's extra tables ride on the same snapshot: the newest state per input, and the panel's
// alarm log with active alarms first. A deployment without those tables gets empty lists, never an error.
test('db module: panel inputs and the panel alarm log are part of the snapshot; missing tables are not an error', withEnv(async (db) => {
  const pool = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: (text) => ({ rows: /interval '20 minutes'/.test(text) ? ZONES.map((z) => row(z.label, -1)) : [] }),
    inputs: [{ tag: 'Chiller Room 2 Door', value: 1, ts_ms: Date.now() - 4000 }, { tag: 'Panic Button 3', value: '0', ts_ms: Date.now() - 4000 }],
    alarms: [
      { id: '185577', at_ms: Date.now() - 60000, message: 'Chiller Room 1 Door 2 Open', state: '', reset_ms: null, active: true },
      { id: '185578', at_ms: Date.now() - 120000, message: 'Frozen Room 2 Door Open', state: 'Off', reset_ms: Date.now() - 118000, active: false },
    ],
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual(snap.inputs.map((i) => [i.tag, i.value]), [['Chiller Room 2 Door', 1], ['Panic Button 3', 0]]);
  assert.equal(snap.panelAlarms.active.length, 1);
  assert.equal(snap.panelAlarms.active[0].id, 185577);
  assert.equal(snap.panelAlarms.recent[0].resetAt != null, true);
  assert.ok(snap.panelAlarms.at);
  assert.equal(pool.calls.filter((c) => /\/\* inputs \*\//.test(c.text)).length, 1);
  const alarms = await db.getPanelAlarms(50);
  assert.equal(alarms.length, 2);

  // tables missing: the query throws, the snapshot still answers with empty lists
  db._resetForTests();
  const bare = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: (text) => { if (/\/\* (inputs|alarms) \*\//.test(text)) { const e = new Error('relation "public.panel_inputs" does not exist'); e.code = '42P01'; throw e; } return { rows: ZONES.map((z) => row(z.label, -1)) }; },
  });
  // the fake answers markers before onQuery, so route them to the throwing branch explicitly
  bare.query = ((orig) => async (q) => { const text = typeof q === 'string' ? q : q.text; if (/\/\* (inputs|alarms) \*\//.test(text)) { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; } return orig(q); })(bare.query.bind(bare));
  db._setPoolForTests(bare);
  const snap2 = await db.getSnapshot();
  assert.equal(snap2.ok, true, snap2.error);
  assert.deepEqual(snap2.inputs, []);
  assert.deepEqual(snap2.panelAlarms.active, []);
}));

// Per-room "in service" settings live in room_settings and ride on the snapshot; a room that is off keeps
// its readings but never carries an alarm.
test('db module: room settings are read with the snapshot and written through setRoomOperational', withEnv(async (db) => {
  const pool = fakePool({
    discovery: disc('temperature_readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['recorded_at', 'timestamp with time zone']]),
    onQuery: (text) => ({ rows: /interval '20 minutes'/.test(text) ? ZONES.map((z) => row(z.label, 25)) : [] }),   // every room at +25: out of every fixed band
    roomSettings: [{ zone_id: 'frozen_room_3', operational: false, updated_ms: Date.now() - 1000 }, { zone_id: 'nope', operational: false, updated_ms: 1 }],
  });
  db._setPoolForTests(pool);
  const snap = await db.getSnapshot();
  assert.equal(snap.ok, true, snap.error);
  assert.equal(snap.rooms.frozen_room_3.operational, false);
  assert.equal(snap.rooms.frozen_room_3.alarm, false);
  assert.equal(snap.rooms.frozen_room_4.operational, true);
  assert.equal(snap.rooms.frozen_room_4.alarm, process.env.NEXT_PUBLIC_FIXED_LIMITS === 'false' ? false : true);
  assert.deepEqual(Object.keys(snap.roomSettings), ['frozen_room_3']);          // unknown zone ids are dropped
  assert.ok(pool.calls.some((c) => /create table if not exists "public"\."room_settings"/.test(c.text)), 'the table is created on first use');
  await db.setRoomOperational('chiller_room_5', false);
  const ins = () => pool.calls.filter((c) => /insert into "public"\."room_settings"/.test(c.text));
  assert.deepEqual(ins()[ins().length - 1].values, ['chiller_room_5', false, null, null, false]);
  await db.setRoomSettings('chiller_room_5', { sensorFault: true, note: 'Sensor not working' });
  assert.deepEqual(ins()[ins().length - 1].values, ['chiller_room_5', null, true, 'Sensor not working', true]);
  await assert.rejects(() => db.setRoomOperational('kitchen', false), /unknown zone/);
}));

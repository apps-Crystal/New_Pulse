const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES } = require('../lib/zones');
const {
  classifyColumn, rankTables, buildQuery, quoteIdent, analyseTable, resolveZoneLoose, pickNameColumn, parseWideMap, PER_ROOM_LIMIT,
} = require('../lib/schema-detect');

// ---- fixtures -------------------------------------------------------------
const col = (name, type) => ({ name, type });
const tbl = (name, cols, kind = 'BASE TABLE') => ({ name, kind, columns: cols.map(([n, t]) => col(n, t)) });

const F1 = tbl('temperature_readings', [['id', 'integer'], ['room', 'text'], ['temperature', 'numeric'], ['set_low', 'numeric'], ['set_high', 'numeric'], ['recorded_at', 'timestamp with time zone']]);
const F2 = tbl('sensor_logs', [['id', 'bigint'], ['zone_name', 'character varying'], ['actual', 'real'], ['low_limit', 'real'], ['high_limit', 'real'], ['created_at', 'timestamp without time zone']]);
const F3 = tbl('rooms', [['id', 'integer'], ['name', 'text'], ['temp', 'double precision'], ['min_temp', 'numeric'], ['max_temp', 'numeric'], ['updated_at', 'timestamp with time zone']]);
const F4 = tbl('plc_snapshots', [['id', 'bigint'], ['ts', 'timestamp with time zone'], ...ZONES.map((z) => [z.id, 'numeric'])]);
const F5 = [
  tbl('users', [['id', 'bigint'], ['email', 'text'], ['created_at', 'timestamp with time zone']]),
  tbl('profiles', [['id', 'uuid'], ['full_name', 'text']]),
  tbl('alarm_events', [['id', 'bigint'], ['room', 'text'], ['message', 'text'], ['created_at', 'timestamp with time zone']]),
  tbl('settings', [['key', 'text'], ['value', 'text']]),
  tbl('spatial_ref_sys', [['srid', 'integer'], ['auth_name', 'character varying'], ['auth_srid', 'integer'], ['srtext', 'character varying'], ['proj4text', 'character varying']]),
];
const F6 = tbl('readings', [['id', 'bigint'], ['created_at', 'timestamp with time zone'], ['room_id', 'integer'], ['value', 'double precision']]);
const F7 = tbl('logs', [['room', 'text'], ['temperature', 'text'], ['time', 'text']]);
const F8 = tbl('latest_room_temperatures', [['room', 'text'], ['temperature', 'numeric'], ['set_low', 'numeric'], ['set_high', 'numeric'], ['updated_at', 'timestamp with time zone']], 'VIEW');
const F9 = tbl('temperatures', [
  ['created_at', 'timestamp with time zone'],
  ['temp_frozen_room_1', 'double precision'], ['temp_fr2', 'double precision'], ['temp_frozen_room_3', 'double precision'],
  ['temp_fr4', 'double precision'], ['temp_frozen_room_5', 'double precision'], ['temp_frozen_anteroom', 'double precision'],
  ['temp_chiller_room_1', 'double precision'], ['temp_cr2', 'double precision'], ['temp_chiller_3', 'double precision'],
  ['temp_dock_area', 'double precision'], ['temp_blast_freezer_1', 'double precision'], ['temp_bf2', 'double precision'],
]);

const best = (tables, opts) => rankTables(tables, opts)[0];
const withSchema = (c) => ({ schema: 'public', ...c });

function assertAllIdentsQuoted(text) {
  // every double-quoted identifier is non-empty and NUL-free (the quoting itself is the safety mechanism)
  const idents = text.match(/"(?:[^"]|"")*"/g) || [];
  for (const q of idents) {
    const inner = q.slice(1, -1);
    assert.ok(inner.length > 0 && !inner.includes('\0'), `bad identifier ${q}`);
  }
  // the FROM clause is fully quoted
  assert.match(text, /FROM "(?:[^"]|"")+"\."(?:[^"]|"")+"/);
}

// ---- classifyColumn ---------------------------------------------------------
test('classifyColumn basic roles', () => {
  assert.ok(classifyColumn(col('temperature', 'numeric')).has('temp'));
  assert.ok(classifyColumn(col('room', 'text')).has('room'));
  assert.ok(classifyColumn(col('recorded_at', 'timestamp with time zone')).has('ts'));
  assert.ok(classifyColumn(col('set_low', 'numeric')).has('setLow'));
  assert.ok(!classifyColumn(col('set_low', 'numeric')).has('temp'));
  assert.ok(classifyColumn(col('max_temp', 'numeric')).has('setHigh'));
  assert.ok(!classifyColumn(col('max_temp', 'numeric')).has('temp'));
  assert.ok(classifyColumn(col('id', 'bigint')).has('order'));
  assert.ok(classifyColumn(col('frozen_room_1', 'numeric')).has('zoneWide'));
  assert.ok(!classifyColumn(col('frozen_room_1', 'numeric')).has('room'));
  assert.ok(!classifyColumn(col('frozen_room_1', 'text')).has('zoneWide'));
  assert.ok(classifyColumn(col('temperature', 'text')).has('temp'));
  assert.ok(classifyColumn(col('time', 'text')).has('ts'));
  assert.ok(classifyColumn(col('room_id', 'integer')).has('room'));
  assert.ok(!classifyColumn(col('id', 'uuid')).has('room'));
  assert.ok(!classifyColumn(col('created_at', 'timestamp with time zone')).has('room'));
});

// ---- fixtures ---------------------------------------------------------------
test('F1 long, obvious', () => {
  const c = best([F1]);
  assert.equal(c.table, 'temperature_readings');
  assert.equal(c.mode, 'long');
  assert.equal(c.roomCol, 'room');
  assert.equal(c.tempCol, 'temperature');
  assert.equal(c.tsCol, 'recorded_at');
  assert.equal(c.setLowCol, 'set_low');
  assert.equal(c.setHighCol, 'set_high');
  assert.equal(c.orderCol, 'id');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /SELECT DISTINCT ON \("room"\)/);
  // index-friendly: NOT NULL filter + plain DESC (no NULLS LAST) so an index on (room, recorded_at) can serve it
  assert.match(q, /WHERE "temperature" IS NOT NULL AND "recorded_at" IS NOT NULL ORDER BY "room", "recorded_at" DESC, "id" DESC$/);
  assert.match(q, /EXTRACT\(EPOCH FROM "recorded_at"\)/);
  assert.ok(!/LIMIT/.test(q));
  assert.ok(!/NULLS LAST/.test(q));
  assertAllIdentsQuoted(q);
});

test('F2 long, other names', () => {
  const c = best([F2]);
  assert.equal(c.mode, 'long');
  assert.equal(c.roomCol, 'zone_name');
  assert.equal(c.tempCol, 'actual');
  assert.equal(c.tsCol, 'created_at');
  assert.equal(c.setLowCol, 'low_limit');
  assert.equal(c.setHighCol, 'high_limit');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /AT TIME ZONE 'UTC'/); // timestamp without tz treated as UTC by default
  const q2 = buildQuery(withSchema(c), { tz: 'Asia/Kolkata' }).text;
  assert.match(q2, /"created_at"::timestamp AT TIME ZONE 'Asia\/Kolkata'/);
  assertAllIdentsQuoted(q);
});

test('F3 per_room current table still gets the one-row-per-room DISTINCT ON query (it has ts/order columns)', () => {
  const c = best([F3]);
  assert.equal(c.mode, 'per_room');
  assert.equal(c.roomCol, 'name');
  assert.equal(c.tempCol, 'temp');
  assert.equal(c.tsCol, 'updated_at');
  assert.equal(c.setLowCol, 'min_temp');
  assert.equal(c.setHighCol, 'max_temp');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /SELECT DISTINCT ON \("name"\)/);
  assert.match(q, /ORDER BY "name", "updated_at" DESC NULLS LAST, "id" DESC$/); // null ts never wins on a per-room table
  assert.ok(!/WHERE/.test(q)); // per-room: nothing filtered out
  assert.match(q, /"name"::text AS room/);
  assertAllIdentsQuoted(q);
});

test('F4 wide, one row per ts', () => {
  const c = best([F4]);
  assert.equal(c.mode, 'wide');
  assert.equal(c.tsCol, 'ts');
  assert.equal(Object.keys(c.wideMap).length, 16);
  for (const z of ZONES) assert.equal(c.wideMap[z.id], z.id);
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /LIMIT 1$/);
  assert.match(q, /ORDER BY "ts" DESC NULLS LAST, "id" DESC/);
  assert.match(q, /"frozen_room_1"::float8 AS "frozen_room_1"/);
  assert.match(q, /"dock_area"::float8 AS "dock_area"/);
  assertAllIdentsQuoted(q);
});

test('F5 distractors are never viable and never beat a real candidate', () => {
  assert.equal(rankTables(F5).length, 0);
  const all = [...F5, F1];
  assert.equal(best(all).table, 'temperature_readings');
  const withOnlyF6 = [...F5, F6];
  assert.equal(best(withOnlyF6).table, 'readings');
  for (const t of F5) {
    const a = analyseTable(t);
    assert.equal(a.mode, null, `${t.name} should not be viable`);
  }
});

test('F6 Supabase-typical readings', () => {
  const c = best([F6]);
  assert.equal(c.mode, 'long');
  assert.equal(c.roomCol, 'room_id');
  assert.equal(c.tempCol, 'value');
  assert.equal(c.tsCol, 'created_at');
  assert.equal(c.setLowCol, null);
  assert.equal(c.setHighCol, null);
  assert.equal(c.orderCol, 'id');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /NULL::float8 AS set_low/);
  assert.match(q, /"room_id"::text AS room/);
  assertAllIdentsQuoted(q);
});

test('F7 text-typed values get safe casts; text timestamps are never cast in SQL', () => {
  const c = best([F7]);
  assert.equal(c.mode, 'long');
  assert.equal(c.roomCol, 'room');
  assert.equal(c.tempCol, 'temperature');
  assert.equal(c.tsCol, 'time');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /replace\(regexp_replace\("temperature", '\[\^0-9\.,\+-\]', '', 'g'\), ',', '\.'\)/); // decimal comma normalised, not stripped
  assert.match(q, /CASE WHEN replace\(regexp_replace\("temperature"/); // guarded cast
  assert.ok(!/::timestamptz/.test(q)); // no throwing cast anywhere
  assert.match(q, /NULL::bigint AS ts_ms, "time" AS ts_raw/); // parsed in JS instead
  assert.match(q, /WHERE "temperature" IS NOT NULL AND "temperature" <> ''/); // cheap predicate, regex stays in SELECT
  assert.match(q, /DISTINCT ON \("room"\)/);
  assert.match(q, /ORDER BY "room", "time" DESC$/);
  assertAllIdentsQuoted(q);
});

test('F8 view is a valid per_room candidate', () => {
  const c = best([F8]);
  assert.equal(c.mode, 'per_room');
  assert.equal(c.kind, 'VIEW');
  assert.equal(c.roomCol, 'room');
  assert.equal(c.tempCol, 'temperature');
  assert.equal(c.tsCol, 'updated_at');
  assert.equal(c.setLowCol, 'set_low');
  assert.equal(c.setHighCol, 'set_high');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /DISTINCT ON \("room"\)/); // idempotent on a true per-room view, bounded if it is not
  assert.ok(!/WHERE/.test(q));
  assertAllIdentsQuoted(q);
});

test('F9 wide with prefixes resolves via loose zone matching', () => {
  const c = best([F9]);
  assert.equal(c.mode, 'wide');
  assert.equal(c.tsCol, 'created_at');
  assert.equal(c.wideMap.temp_frozen_room_1, 'frozen_room_1');
  assert.equal(c.wideMap.temp_fr2, 'frozen_room_2');
  assert.equal(c.wideMap.temp_cr2, 'chiller_room_2');
  assert.equal(c.wideMap.temp_chiller_3, 'chiller_room_3');
  assert.equal(c.wideMap.temp_bf2, 'blast_freezer_2');
  assert.equal(c.wideMap.temp_dock_area, 'dock_area');
  assert.equal(Object.keys(c.wideMap).length, 12);
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /"temp_fr2"::float8 AS "frozen_room_2"/);
  assert.match(q, /LIMIT 1$/);
  assertAllIdentsQuoted(q);
});

// ---- preference rules -----------------------------------------------------------
test('long readings beat a per_room table unless the per_room one is a latest/current view', () => {
  assert.equal(best([F3, F1]).table, 'temperature_readings');
  assert.equal(best([F1, F3]).table, 'temperature_readings');
  assert.equal(best([F1, F8]).table, 'latest_room_temperatures');
  assert.equal(best([F8, F1]).table, 'latest_room_temperatures');
  // a non-"latest" view still loses to ground-truth history
  const plainView = { ...F8, name: 'room_temperature_view' };
  assert.equal(best([plainView, F1]).table, 'temperature_readings');
});

test('ranking is deterministic on ties (by table name)', () => {
  const a = { ...F1, name: 'b_readings' };
  const b = { ...F1, name: 'a_readings' };
  assert.equal(best([a, b]).table, 'a_readings');
  assert.equal(best([b, a]).table, 'a_readings');
});

test('every fixture gets its columns ranked with reasons', () => {
  for (const t of [F1, F2, F3, F4, F6, F7, F8, F9]) {
    const c = best([t]);
    assert.ok(c.score >= 40, `${t.name} score ${c.score}`);
    assert.ok(Array.isArray(c.reasons) && c.reasons.length > 0);
  }
});

// ---- overrides ------------------------------------------------------------------
test('overrides: PULSE_TABLE restricts to that table and missing columns are auto-detected from it', () => {
  const c = best([F1, F3, F8], { overrides: { table: 'rooms' } });
  assert.equal(c.table, 'rooms');
  assert.equal(c.roomCol, 'name');
  assert.equal(c.tempCol, 'temp');
  const c2 = best([F1, F3], { overrides: { table: 'rooms', tempCol: 'max_temp', mode: 'long' } });
  assert.equal(c2.tempCol, 'max_temp');
  assert.equal(c2.mode, 'long');
  assert.equal(c2.setHighCol, null); // max_temp consumed as temp
});

test('overrides: unknown table still yields a candidate driven by explicit columns', () => {
  const c = best([F1], { overrides: { table: 'hidden_table', mode: 'long', roomCol: 'r', tempCol: 't', tsCol: 'at' } });
  assert.equal(c.table, 'hidden_table');
  assert.equal(c.mode, 'long');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /FROM "public"\."hidden_table"/);
  assert.match(q, /regexp_replace\("t"::text/); // unknown type -> safe text cast
  assert.match(q, /"at"::text AS ts_raw/); // unknown ts type -> raw text, parsed in JS
  assert.match(q, /ORDER BY "r", "at"::text DESC$/);
  assertAllIdentsQuoted(q);
});

test('overrides: PULSE_WIDE_MAP forces a wide mapping (e.g. thermocouple tags TC1..TC16)', () => {
  const plc = tbl('plc_data', [['id', 'bigint'], ['ts', 'timestamp with time zone'], ...Array.from({ length: 16 }, (_, i) => [`TC${i + 1}`, 'real'])]);
  assert.deepEqual(parseWideMap('TC1=frozen_room_1, TC2:fr2;TC3 = Chiller Room 1'), { TC1: 'frozen_room_1', TC2: 'frozen_room_2', TC3: 'chiller_room_1' });
  assert.deepEqual(parseWideMap('bogus=nowhere'), {});
  const spec = ZONES.map((z, i) => `TC${i + 1}=${z.id}`).join(',');
  const c = best([plc], { overrides: { wideMap: spec } });
  assert.equal(c.mode, 'wide');
  assert.equal(Object.keys(c.wideMap).length, 16);
  assert.equal(c.wideMap.TC7, 'chiller_room_1');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /"TC16"::float8 AS "dock_area"/);
  assert.match(q, /LIMIT 1$/);
});

// ---- quoteIdent -------------------------------------------------------------------
test('quoteIdent accepts every legal Postgres identifier and neutralises injection by doubling quotes', () => {
  assert.equal(quoteIdent('room'), '"room"');
  assert.equal(quoteIdent('Room Name'), '"Room Name"');
  assert.equal(quoteIdent('FR-1'), '"FR-1"');
  assert.equal(quoteIdent('Temperature (°C)'), '"Temperature (°C)"');
  assert.equal(quoteIdent('2024_readings'), '"2024_readings"');
  assert.equal(quoteIdent('temp.actual'), '"temp.actual"');
  assert.equal(quoteIdent('x"; drop table y--'), '"x""; drop table y--"'); // one identifier, quote doubled
  assert.throws(() => quoteIdent(''), /Unsafe SQL identifier/);
  assert.throws(() => quoteIdent('a\0b'), /Unsafe SQL identifier/);
  assert.throws(() => quoteIdent('x'.repeat(64)), /Unsafe SQL identifier/);
  const q = buildQuery({ schema: 'public', table: 'x"; drop table y--', mode: 'per_room', roomCol: 'r', tempCol: 't' }).text;
  assert.match(q, /FROM "public"\."x""; drop table y--" LIMIT/);
  assert.ok(!/"\."x"; /.test(q));
});

test('auto-detected tables with punctuation / non-ASCII / leading-digit column names are queryable', () => {
  const hmi = tbl('hmi_temps', [['FR-1', 'real'], ['FR-2', 'real'], ['FR-3', 'real'], ['FR-4', 'real'], ['FR-5', 'real'], ['CR-1', 'real'], ['CR-2', 'real'], ['logged_at', 'timestamp with time zone']]);
  const c = best([hmi]);
  assert.equal(c.mode, 'wide');
  assert.equal(c.wideMap['FR-1'], 'frozen_room_1');
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /"FR-1"::float8 AS "frozen_room_1"/);
  assertAllIdentsQuoted(q);

  const csv = tbl('2024_import', [['Room Name', 'text'], ['Temperature (°C)', 'numeric'], ['Logged At', 'timestamp without time zone']]);
  const c2 = best([csv]);
  assert.equal(c2.mode, 'long');
  assert.equal(c2.tempCol, 'Temperature (°C)');
  const q2 = buildQuery(withSchema(c2)).text;
  assert.match(q2, /FROM "public"\."2024_import"/);
  assert.match(q2, /"Temperature \(°C\)"::float8 AS temperature/);
  assertAllIdentsQuoted(q2);
});

test('buildQuery never interpolates unquoted identifiers', () => {
  const outputAliases = /\b(room|temperature|set_low|set_high|ts_ms|ts_raw)\b/g;
  for (const t of [F1, F2, F3, F4, F6, F7, F8, F9]) {
    const c = best([t]);
    const q = buildQuery(withSchema(c)).text;
    // strip quoted identifiers, string literals and our fixed output aliases; no column name should remain bare
    const stripped = q.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '').replace(outputAliases, '');
    for (const cc of t.columns) {
      assert.ok(!new RegExp('\\b' + cc.name + '\\b').test(stripped), `${t.name}.${cc.name} appears unquoted in: ${q}`);
    }
  }
});

// ---- SQL safety: bounded queries --------------------------------------------------
test('long mode: windowHours adds an index-friendly time window and reports windowed=true', () => {
  const c = withSchema(best([F1]));
  const w = buildQuery(c, { windowHours: 48 });
  assert.equal(w.windowed, true);
  assert.match(w.text, /AND "recorded_at" >= now\(\) - interval '48 hours' ORDER BY/);
  const u = buildQuery(c, { windowHours: 0 });
  assert.equal(u.windowed, false);
  assert.ok(!/interval/.test(u.text));
  // garbage window values never reach the SQL
  for (const bad of [NaN, 'abc', -5, Infinity, null]) {
    const r = buildQuery(c, { windowHours: bad });
    assert.equal(r.windowed, false, `windowHours=${bad}`);
    assert.ok(!/NaN|Infinity|interval/.test(r.text));
  }
  assert.match(buildQuery(c, { windowHours: 1.7 }).text, /interval '1 hours'/);
  assert.match(buildQuery(c, { windowHours: 999999 }).text, /interval '8760 hours'/);
  // naive timestamp: window relative to the DB clock in the configured zone
  const c2 = withSchema(best([F2]));
  assert.match(buildQuery(c2, { windowHours: 24, tz: 'Asia/Kolkata' }).text, /"created_at" >= \(now\(\) AT TIME ZONE 'Asia\/Kolkata'\) - interval '24 hours'/);
  assert.match(buildQuery(c2, { windowHours: 24, tz: "x'; drop" }).text, /AT TIME ZONE 'UTC'/); // invalid tz falls back
  // numeric epoch (seconds or millis) is windowed too
  const epoch = tbl('readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['epoch', 'bigint']]);
  const c3 = withSchema(best([epoch]));
  assert.equal(c3.tsCol, 'epoch');
  const q3 = buildQuery(c3, { windowHours: 2 });
  assert.equal(q3.windowed, true);
  assert.match(q3.text, /\(\("epoch" < 1e11 AND "epoch" >= EXTRACT\(EPOCH FROM now\(\)\) - 7200\) OR "epoch" >= \(EXTRACT\(EPOCH FROM now\(\)\) - 7200\) \* 1000\)/);
  // text timestamps cannot be windowed safely
  assert.equal(buildQuery(withSchema(best([F7])), { windowHours: 48 }).windowed, false);
});

test('history tables whose NAME says per_room still get DISTINCT ON, never an unbounded scan', () => {
  for (const name of ['room_temperature', 'room_temperatures', 'zone_temps', 'cold_room_status', 'current_temps']) {
    const t = tbl(name, [['id', 'bigint'], ['room', 'text'], ['temperature', 'double precision'], ['recorded_at', 'timestamp with time zone']]);
    const c = best([t]);
    assert.equal(c.mode, 'per_room', name); // label kept (ranking unchanged)...
    const q = buildQuery(withSchema(c)).text;
    assert.match(q, /SELECT DISTINCT ON \("room"\)/, name); // ...but the SQL is one row per room
    assert.match(q, /ORDER BY "room", "recorded_at" DESC NULLS LAST, "id" DESC$/, name);
  }
});

test('per_room table with nothing to order by gets a hard LIMIT', () => {
  const t = tbl('rooms', [['room', 'text'], ['temperature', 'numeric']]);
  const c = best([t]);
  assert.equal(c.mode, 'per_room');
  const q = buildQuery(withSchema(c)).text;
  assert.ok(!/DISTINCT ON/.test(q));
  assert.match(q, new RegExp(`LIMIT ${PER_ROOM_LIMIT}$`));
});

test('wide mode always LIMIT 1', () => {
  const q = buildQuery(withSchema(best([F4]))).text;
  assert.match(q, /LIMIT 1$/);
});

// ---- detection findings -------------------------------------------------------------
test('serial id is never the room column on a history-shaped table (uuid / enum room column)', () => {
  const uuidRoom = tbl('readings', [['id', 'bigint'], ['room_id', 'uuid'], ['temperature', 'numeric'], ['created_at', 'timestamp with time zone']]);
  const c = best([uuidRoom]);
  assert.equal(c.roomCol, 'room_id'); // uuid qualifies as a (join-able) room key
  assert.notEqual(c.roomCol, 'id');
  const enumRoom = tbl('readings', [['id', 'bigint'], ['room', 'user-defined'], ['temperature', 'numeric'], ['created_at', 'timestamp with time zone']]);
  assert.equal(best([enumRoom]).roomCol, 'room');
  // no room column at all + history shape -> not viable, with a reason (never "every row is a room")
  const noRoom = tbl('readings', [['id', 'bigint'], ['temperature', 'numeric'], ['created_at', 'timestamp with time zone']]);
  const a = analyseTable(noRoom);
  assert.equal(a.mode, null);
  assert.match(a.reasons.join(' '), /only the id column/);
  // bare id IS acceptable as an ordinal key on a per-room table with no ts/order
  const perRoomId = tbl('rooms', [['id', 'integer'], ['temperature', 'numeric']]);
  assert.equal(best([perRoomId]).roomCol, 'id');
  assert.equal(buildQuery(withSchema(best([perRoomId]))).text.includes('LIMIT'), true);
});

test('citext / enum column types are recognised', () => {
  assert.ok(classifyColumn(col('room', 'citext')).has('room'));
  assert.ok(classifyColumn(col('room', 'USER-DEFINED')).has('room'));
  assert.ok(classifyColumn(col('room_id', 'uuid')).has('room'));
  assert.ok(!classifyColumn(col('temperature', 'uuid')).has('temp'));
});

test('humidity / airflow columns never become temperature setpoints or temperatures', () => {
  const t = tbl('readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['humidity', 'numeric'], ['humidity_min', 'numeric'], ['humidity_max', 'numeric'], ['airflow', 'numeric'], ['window', 'integer'], ['minutes', 'integer'], ['created_at', 'timestamp with time zone']]);
  const c = best([t]);
  assert.equal(c.tempCol, 'temperature');
  assert.equal(c.setLowCol, null);
  assert.equal(c.setHighCol, null);
  for (const n of ['humidity_min', 'airflow', 'window', 'minutes', 'flow_rate', 'rh_min']) assert.ok(!classifyColumn(col(n, 'numeric')).has('setLow'), n);
  for (const n of ['humidity_max', 'airflow', 'window']) assert.ok(!classifyColumn(col(n, 'numeric')).has('setHigh'), n);
  assert.ok(!classifyColumn(col('humidity_value', 'numeric')).has('temp'));
  // real setpoints still work in all common spellings
  for (const n of ['set_low', 'setlow', 'low_limit', 'min_temp', 'temp_min', 'lowLimit', 'sp_low', 'alarm_low', 'lower_limit', 'temp_lo']) assert.ok(classifyColumn(col(n, 'numeric')).has('setLow'), n);
  for (const n of ['set_high', 'sethigh', 'high_limit', 'max_temp', 'temp_max', 'highLimit', 'sp_high', 'upper_limit', 'temp_hi']) assert.ok(classifyColumn(col(n, 'numeric')).has('setHigh'), n);
});

test('integer room column is penalised so a sibling table with room names wins; text room boosted', () => {
  const zones = tbl('zones', [['id', 'integer'], ['name', 'text'], ['temperature', 'numeric']]);
  const hist = tbl('temperature_history', [['id', 'bigint'], ['zone_id', 'integer'], ['temp', 'numeric'], ['ts', 'timestamp with time zone']]);
  assert.equal(best([zones, hist]).table, 'zones');
  assert.equal(best([hist, zones]).table, 'zones');
  assert.equal(best([hist]).table, 'temperature_history'); // still viable on its own
  assert.match(best([hist]).reasons.join(' '), /ordinal/);
});

test('FK join: name column picked from the referenced table and used in the query', () => {
  const { pickSetpointColumns } = require('../lib/schema-detect');
  assert.equal(pickNameColumn([col('id', 'integer'), col('name', 'text'), col('description', 'text')]), 'name');
  const sp = pickSetpointColumns([col('id', 'uuid'), col('label', 'text'), col('set_low', 'numeric'), col('set_high', 'numeric'), col('humidity_max', 'numeric')]);
  assert.equal(sp.lowCol, 'set_low');
  assert.equal(sp.highCol, 'set_high');
  assert.equal(sp.colTypes.set_low, 'numeric');
  assert.deepEqual(pickSetpointColumns([col('id', 'integer'), col('name', 'text')]).lowCol, null);
  // parent setpoints are selected through the join alias when the readings table has none
  const cj = withSchema({ ...best([F6]), roomJoin: { schema: 'public', table: 'cold_rooms', keyCol: 'id', nameCol: 'label', lowCol: 'set_low', highCol: 'set_high', colTypes: { set_low: 'numeric', set_high: 'text' } } });
  const qj = buildQuery(cj).text;
  assert.match(qj, /"j"\."set_low"::float8 AS set_low/);
  assert.match(qj, /regexp_replace\("j"\."set_high", .* AS set_high/);
  // ...but never override the readings table's own setpoints
  const own = withSchema({ ...best([F1]), roomJoin: { schema: 'public', table: 'rooms', keyCol: 'id', nameCol: 'name', lowCol: 'lo', highCol: 'hi', colTypes: {} } });
  assert.match(buildQuery(own).text, /"t"\."set_low"::float8 AS set_low, "t"\."set_high"::float8 AS set_high/);
  assert.equal(pickNameColumn([col('id', 'uuid'), col('code', 'text'), col('label', 'character varying')]), 'label');
  assert.equal(pickNameColumn([col('id', 'integer'), col('capacity', 'numeric')]), null);
  const c = withSchema({ ...best([F6]), roomJoin: { schema: 'public', table: 'rooms', keyCol: 'id', nameCol: 'name' } });
  const q = buildQuery(c, { windowHours: 24 }).text;
  assert.match(q, /FROM "public"\."readings" AS "t" LEFT JOIN "public"\."rooms" AS "j" ON "j"\."id" = "t"\."room_id"/);
  assert.match(q, /SELECT DISTINCT ON \("t"\."room_id"\) COALESCE\("j"\."name"::text, "t"\."room_id"::text\) AS room/);
  assert.match(q, /"t"\."value"::float8 AS temperature/);
  assert.match(q, /WHERE "t"\."value" IS NOT NULL AND "t"\."created_at" IS NOT NULL AND "t"\."created_at" >= now\(\)/);
  assert.match(q, /ORDER BY "t"\."room_id", "t"\."created_at" DESC, "t"\."id" DESC$/);
});

test('thermocouple tags TC1..TC16 are not remapped onto chiller rooms; t_ prefix still works', () => {
  assert.equal(resolveZoneLoose('TC1'), null);
  assert.equal(resolveZoneLoose('TF1'), null);
  assert.equal(resolveZoneLoose('t_bf1').id, 'blast_freezer_1');
  assert.equal(resolveZoneLoose('T-FR1').id, 'frozen_room_1');
  assert.equal(resolveZoneLoose('temp_c1').id, 'chiller_room_1');
  const plc = tbl('plc_data', [['id', 'bigint'], ['ts', 'timestamp with time zone'], ...Array.from({ length: 16 }, (_, i) => [`TC${i + 1}`, 'real'])]);
  assert.equal(analyseTable(plc).mode, null); // not silently half-mapped; PULSE_WIDE_MAP is the way in
});

test('wide mode picks the live temperature column per zone and keeps per-zone setpoints', () => {
  const zones6 = ['frozen_room_1', 'frozen_room_2', 'frozen_room_3', 'chiller_room_1', 'chiller_room_2', 'chiller_room_3'];
  const cols = [['ts', 'timestamp with time zone']];
  for (const z of zones6) cols.push([`${z}_low`, 'real'], [`${z}_high`, 'real'], [`${z}_status`, 'integer'], [`${z}_temp`, 'real']);
  cols.push(['humidity_frozen_room_1', 'real']);
  const c = best([tbl('plc', cols)]);
  assert.equal(c.mode, 'wide');
  for (const z of zones6) assert.equal(c.wideMap[`${z}_temp`], z);
  assert.equal(Object.keys(c.wideMap).length, 6);
  assert.deepEqual(c.wideSetpoints.frozen_room_1, { low: 'frozen_room_1_low', high: 'frozen_room_1_high' });
  const q = buildQuery(withSchema(c)).text;
  assert.match(q, /"frozen_room_1_temp"::float8 AS "frozen_room_1"/);
  assert.match(q, /"frozen_room_1_low"::float8 AS "frozen_room_1__low"/);
  assert.match(q, /"frozen_room_1_high"::float8 AS "frozen_room_1__high"/);
  assert.ok(!/"frozen_room_1_status"/.test(q));
  // status-only sibling (no _temp) is still preferred over a setpoint column
  const c2 = best([tbl('plc2', [['ts', 'timestamp with time zone'], ...zones6.flatMap((z) => [[`${z}_low`, 'real'], [`${z}_pv`, 'real']])])]);
  for (const z of zones6) assert.equal(c2.wideMap[`${z}_pv`], z);
  // unmapped numeric columns are reported
  const c3 = best([tbl('plc3', [['ts', 'timestamp with time zone'], ...zones6.map((z) => [z, 'real']), ['TC9', 'real'], ['TC10', 'real']])]);
  assert.deepEqual(c3.wideUnmapped, ['TC9', 'TC10']);
  assert.match(c3.reasons.join(' '), /map to no zone: TC9, TC10/);
});

test('target / desired / setpoint columns are not the live temperature; numeric measured_temp is not a timestamp', () => {
  const a = best([tbl('rooms', [['id', 'integer'], ['name', 'text'], ['zone_temp', 'numeric'], ['target_temp', 'numeric']])]);
  assert.equal(a.tempCol, 'zone_temp');
  const b = best([tbl('rooms', [['id', 'integer'], ['name', 'text'], ['measured_temp', 'numeric'], ['desired_temp', 'numeric']])]);
  assert.equal(b.tempCol, 'measured_temp');
  assert.equal(b.tsCol, null);
  assert.ok(!classifyColumn(col('measured_temp', 'numeric')).has('ts'));
  assert.ok(classifyColumn(col('reading_time', 'numeric')).has('ts'));
  assert.ok(classifyColumn(col('measured_at', 'text')).has('ts'));
  for (const n of ['target_temp', 'desired_temp', 'setpoint', 'set_temp', 'temp_sp', 'sp_temp']) assert.ok(!classifyColumn(col(n, 'numeric')).has('temp'), n);
  // a table with ONLY a setpoint-ish column is not viable rather than wrong
  assert.equal(analyseTable(tbl('rooms', [['name', 'text'], ['target_temp', 'numeric']])).mode, null);
});

test('sensor_name beats sensor_id on ties', () => {
  const c = best([tbl('readings', [['sensor_id', 'text'], ['sensor_name', 'text'], ['temperature', 'numeric'], ['created_at', 'timestamp with time zone']])]);
  assert.equal(c.roomCol, 'sensor_name');
  // canonical room_id is not penalised into losing to a random *_name column
  const c2 = best([tbl('readings', [['room_id', 'text'], ['operator_name', 'text'], ['temperature', 'numeric']])]);
  assert.equal(c2.roomCol, 'room_id');
});

test('materialized views are analysed like views', () => {
  const mv = { ...F8, name: 'latest_temps_mv', kind: 'MATERIALIZED VIEW' };
  const c = best([mv, F1]);
  assert.equal(c.table, 'latest_temps_mv');
  assert.equal(c.mode, 'per_room');
  assert.match(c.reasons.join(' '), /latest\/current view/);
});

// ---- tiered window / forced-table fallbacks / text garbage guard ------------------------
const { missingZones } = require('../lib/schema-detect');

test('windowHours below one hour renders a minute interval (tier-1 recent window)', () => {
  const c = withSchema(best([F1]));
  assert.match(buildQuery(c, { windowHours: 20 / 60 }).text, /"recorded_at" >= now\(\) - interval '20 minutes' ORDER BY/);
  assert.match(buildQuery(c, { windowHours: 0.25 }).text, /interval '15 minutes'/);
  assert.match(buildQuery(c, { windowHours: 0.0001 }).text, /interval '1 minutes'/); // never below a minute
  assert.match(buildQuery(c, { windowHours: 2 }).text, /interval '2 hours'/);
  const epoch = withSchema(best([tbl('readings', [['id', 'bigint'], ['room', 'text'], ['temperature', 'numeric'], ['epoch', 'bigint']])]));
  assert.match(buildQuery(epoch, { windowHours: 0.5 }).text, /EXTRACT\(EPOCH FROM now\(\)\) - 1800\)/);
});

test('text temperature columns: non-numeric values are excluded in WHERE so garbage never wins DISTINCT ON', () => {
  const c = withSchema(best([F7]));
  const q = buildQuery(c).text;
  assert.match(q, /WHERE "temperature" IS NOT NULL AND "temperature" <> '' AND \(CASE WHEN replace\(regexp_replace\("temperature"/);
  assert.match(q, /END\) IS NOT NULL ORDER BY "room"/);
  // numeric temperatures keep the cheap predicate only
  assert.match(buildQuery(withSchema(best([F1]))).text, /WHERE "temperature" IS NOT NULL AND "recorded_at" IS NOT NULL ORDER BY/);
});

test('PULSE_TABLE alone on a table with hint-free column names: numeric "Val" becomes the temperature, text "Chamber" the room', () => {
  const zed = tbl('Zed Export 7', [['Chamber', 'text'], ['Val', 'numeric'], ['Lo', 'numeric'], ['Hi', 'numeric'], ['Stamp', 'timestamp with time zone']]);
  assert.equal(rankTables([zed]).length, 0, 'never auto-picked without the override');
  const c = best([zed], { overrides: { table: 'Zed Export 7' } });
  assert.ok(c, 'viable once the operator names the table');
  assert.equal(c.roomCol, 'Chamber');
  assert.equal(c.tempCol, 'Val');
  assert.equal(c.tsCol, 'Stamp');
  assert.equal(c.setLowCol, 'Lo');
  assert.equal(c.setHighCol, 'Hi');
  assert.ok(c.reasons.some((r) => /PULSE_TABLE: no column named like a temperature; using numeric column Val/.test(r)));
  // the fallback never grabs ids, humidity or integer counters
  const odd = tbl('x', [['id', 'bigint'], ['Chamber', 'text'], ['humidity', 'numeric'], ['door_count', 'integer'], ['Stamp', 'timestamp with time zone']]);
  assert.equal(best([odd], { overrides: { table: 'x' } }), undefined);
});

test('missingZones lists the canonical zones no row resolves to', () => {
  assert.equal(missingZones([]).length, 16);
  const rows = ZONES.filter((z) => z.id !== 'dock_area').map((z) => ({ room: z.label }));
  assert.deepEqual(missingZones(rows), ['dock_area']);
  assert.deepEqual(missingZones([...rows, { room: 'Dock' }, { room: 'Ripening Room 9' }]), []);
  assert.deepEqual(missingZones(null).length, 16);
});

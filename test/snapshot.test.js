const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES } = require('../lib/zones');
const { rowsToSnapshot, snapshotStats, parseTsRaw, naiveToEpochMs } = require('../lib/schema-detect');

const NOW = 1800000000000;
const STALE = 600000;
const long = { schema: 'public', table: 't', mode: 'long', roomCol: 'room', tempCol: 'temperature', tsCol: 'recorded_at' };
const perRoom = { ...long, mode: 'per_room' };

test('all 16 zones are always present, in order, offline when no data', () => {
  const rooms = rowsToSnapshot(long, [], { now: NOW, staleMs: STALE });
  assert.deepEqual(Object.keys(rooms), ZONES.map((z) => z.id));
  for (const z of ZONES) {
    assert.equal(rooms[z.id].label, z.label);
    assert.equal(rooms[z.id].type, z.type);
    assert.equal(rooms[z.id].temperature, null);
    assert.equal(rooms[z.id].offline, true);
    assert.equal(rooms[z.id].alarm, false);
    assert.equal(rooms[z.id].updatedAt, null);
  }
});

test('numeric strings from pg are parsed; NaN becomes null', () => {
  const rooms = rowsToSnapshot(long, [
    { room: 'Frozen Room 1', temperature: '-18.50', set_low: '-22', set_high: '-15', ts_ms: String(NOW - 1000) },
    { room: 'Chiller Room 2', temperature: 'abc', set_low: null, set_high: null, ts_ms: NOW },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.temperature, -18.5);
  assert.equal(rooms.frozen_room_1.setLow, -22);
  assert.equal(rooms.frozen_room_1.setHigh, -15);
  assert.equal(rooms.frozen_room_1.updatedAt, NOW - 1000);
  assert.equal(rooms.frozen_room_1.offline, false);
  assert.equal(rooms.frozen_room_1.alarm, false);
  assert.equal(rooms.chiller_room_2.temperature, null);
  assert.equal(rooms.chiller_room_2.offline, true);
});

test('stale readings are offline', () => {
  const rooms = rowsToSnapshot(long, [
    { room: 'frozen_room_2', temperature: -20, ts_ms: NOW - STALE - 1 },
    { room: 'frozen_room_3', temperature: -20, ts_ms: NOW - STALE + 1 },
    { room: 'frozen_room_4', temperature: -20, ts_ms: null },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_2.offline, true);
  assert.equal(rooms.frozen_room_2.temperature, -20); // value retained, only flagged
  assert.equal(rooms.frozen_room_3.offline, false);
  assert.equal(rooms.frozen_room_4.offline, false); // no timestamp -> cannot be stale
});

test('alarm computed from setpoints', () => {
  const rooms = rowsToSnapshot(perRoom, [
    { room: 'chiller_room_1', temperature: 6.5, set_low: 0, set_high: 5, ts_ms: NOW },
    { room: 'chiller_room_2', temperature: -1, set_low: 0, set_high: 5, ts_ms: NOW },
    { room: 'chiller_room_3', temperature: 3, set_low: 0, set_high: 5, ts_ms: NOW },
    { room: 'chiller_room_4', temperature: 3, set_low: null, set_high: null, ts_ms: NOW },
    { room: 'chiller_room_5', temperature: 9, set_low: null, set_high: 5, ts_ms: NOW },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.chiller_room_1.alarm, true);
  assert.equal(rooms.chiller_room_2.alarm, true);
  assert.equal(rooms.chiller_room_3.alarm, false);
  assert.equal(rooms.chiller_room_4.alarm, false);
  assert.equal(rooms.chiller_room_5.alarm, true);
});

test('numeric room ids map by display order', () => {
  const rooms = rowsToSnapshot(long, [
    { room: '7', temperature: 2, ts_ms: NOW },
    { room: 16, temperature: 12, ts_ms: NOW },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.chiller_room_1.temperature, 2);
  assert.equal(rooms.dock_area.temperature, 12);
});

test('unknown rooms are appended after the 16 zones, nothing dropped', () => {
  const rooms = rowsToSnapshot(long, [
    { room: 'Ripening Room 9', temperature: 14, ts_ms: NOW },
    { room: 'Deep Freezer X', temperature: -30, ts_ms: NOW },
  ], { now: NOW, staleMs: STALE });
  const keys = Object.keys(rooms);
  assert.equal(keys.length, 18);
  assert.equal(keys[16], 'ripeningroom9');
  assert.equal(keys[17], 'deepfreezerx');
  assert.equal(rooms.ripeningroom9.label, 'Ripening Room 9');
  assert.equal(rooms.ripeningroom9.temperature, 14);
  assert.equal(rooms.ripeningroom9.offline, false);
  assert.equal(rooms.deepfreezerx.type, 'frozen');
});

test('per_room duplicates keep the newest timestamp', () => {
  const rooms = rowsToSnapshot(perRoom, [
    { room: 'frozen_room_1', temperature: -10, ts_ms: NOW - 5000 },
    { room: 'frozen_room_1', temperature: -12, ts_ms: NOW - 1000 },
    { room: 'frozen_room_1', temperature: -11, ts_ms: NOW - 3000 },
    { room: 'frozen_room_2', temperature: 1, ts_ms: null },
    { room: 'frozen_room_2', temperature: 2, ts_ms: null },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.temperature, -12);
  assert.equal(rooms.frozen_room_1.updatedAt, NOW - 1000);
  assert.equal(rooms.frozen_room_2.temperature, 2); // no ts: last seen wins
});

test('wide mode fans one row out to 16 rooms', () => {
  const wideMap = {};
  for (const z of ZONES) wideMap[z.id] = z.id;
  const detected = { schema: 'public', table: 'plc_snapshots', mode: 'wide', tsCol: 'ts', wideMap };
  const row = { ts_ms: String(NOW - 2000) };
  ZONES.forEach((z, i) => { row[z.id] = String(-20 + i); });
  row.dock_area = null;
  const rooms = rowsToSnapshot(detected, [row], { now: NOW, staleMs: STALE });
  assert.equal(Object.keys(rooms).length, 16);
  assert.equal(rooms.frozen_room_1.temperature, -20);
  assert.equal(rooms.chiller_room_1.temperature, -14);
  assert.equal(rooms.frozen_room_1.updatedAt, NOW - 2000);
  assert.equal(rooms.frozen_room_1.offline, false);
  assert.equal(rooms.dock_area.temperature, null);
  assert.equal(rooms.dock_area.offline, true);
});

test('wide mode with a stale row marks every zone offline', () => {
  const wideMap = { temp_fr1: 'frozen_room_1', temp_cr1: 'chiller_room_1' };
  const detected = { schema: 'public', table: 't', mode: 'wide', tsCol: 'ts', wideMap };
  const rooms = rowsToSnapshot(detected, [{ ts_ms: NOW - STALE - 10, frozen_room_1: -20, chiller_room_1: 3 }], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.temperature, -20);
  assert.equal(rooms.frozen_room_1.offline, true);
  assert.equal(rooms.chiller_room_1.offline, true);
});

test('wide mode with no rows leaves everything offline', () => {
  const detected = { schema: 'public', table: 't', mode: 'wide', tsCol: 'ts', wideMap: { frozen_room_1: 'frozen_room_1' } };
  const rooms = rowsToSnapshot(detected, [], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.offline, true);
});

// ---- fixes from review --------------------------------------------------------------
test('readings stamped in the future are stale too (naive local-time logger read as UTC)', () => {
  const rooms = rowsToSnapshot(long, [
    { room: 'frozen_room_1', temperature: -20, ts_ms: NOW + 3.5 * 3600000 }, // +5.5h skew, 2h old
    { room: 'frozen_room_2', temperature: -20, ts_ms: NOW + 30000 }, // 30s ahead: fine
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.offline, true);
  assert.equal(rooms.frozen_room_2.offline, false);
  const st = snapshotStats(rooms, { now: NOW });
  assert.equal(st.futureSkewMs, 3.5 * 3600000);
  assert.match(st.warning, /future/);
  assert.match(st.warning, /PULSE_TS_TZ/);
});

test('text / unknown timestamps are parsed in JS from ts_raw and never throw', () => {
  assert.equal(parseTsRaw('2026-09-06T10:00:00Z'), Date.UTC(2026, 8, 6, 10));
  assert.equal(parseTsRaw('2026-09-06 10:00:00+05:30'), Date.UTC(2026, 8, 6, 4, 30));
  assert.equal(parseTsRaw('2026-09-06 10:00:00'), Date.UTC(2026, 8, 6, 10)); // naive = UTC by default
  assert.equal(parseTsRaw('2026-09-06 10:00:00', 'Asia/Kolkata'), Date.UTC(2026, 8, 6, 4, 30));
  assert.equal(parseTsRaw('2026-09-06 10:00:00.250', 'UTC'), Date.UTC(2026, 8, 6, 10, 0, 0, 250));
  assert.equal(parseTsRaw('2026-09-06'), Date.UTC(2026, 8, 6));
  assert.equal(parseTsRaw('1800000000'), 1800000000000); // epoch seconds
  assert.equal(parseTsRaw('1800000000000'), 1800000000000); // epoch millis
  assert.equal(parseTsRaw('1800000000000000'), 1800000000000); // epoch micros
  for (const bad of ['0000-00-00 00:00:00', '2026-02-30 10:00:00', '2026-09-06 25:00:00', 'N/A', '', null, 'yesterday', '-5']) {
    assert.equal(parseTsRaw(bad), null, String(bad));
  }
  assert.equal(naiveToEpochMs('2026-02-30 10:00:00', 'UTC'), null);
  const rooms = rowsToSnapshot(long, [
    { room: 'frozen_room_1', temperature: -20, ts_ms: null, ts_raw: new Date(NOW - 1000).toISOString() },
    { room: 'frozen_room_2', temperature: -20, ts_ms: null, ts_raw: '2026-02-30 10:00:00' },
    { room: 'frozen_room_3', temperature: -20, ts_ms: String(NOW), ts_raw: 'ignored when ts_ms present' },
  ], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.updatedAt, NOW - 1000);
  assert.equal(rooms.frozen_room_1.offline, false);
  assert.equal(rooms.frozen_room_2.updatedAt, null); // bad row: value shown, no timestamp, never a crash
  assert.equal(rooms.frozen_room_2.temperature, -20);
  assert.equal(rooms.frozen_room_3.updatedAt, NOW);
});

test('wide mode reads per-zone setpoints and raises alarms from them', () => {
  const detected = {
    schema: 'public', table: 't', mode: 'wide', tsCol: 'ts',
    wideMap: { fr1_temp: 'frozen_room_1', cr1_temp: 'chiller_room_1' },
    wideSetpoints: { frozen_room_1: { low: 'fr1_low', high: 'fr1_high' } },
  };
  const rooms = rowsToSnapshot(detected, [{ ts_ms: NOW, frozen_room_1: -12, frozen_room_1__low: -25, frozen_room_1__high: -15, chiller_room_1: 3 }], { now: NOW, staleMs: STALE });
  assert.equal(rooms.frozen_room_1.setLow, -25);
  assert.equal(rooms.frozen_room_1.setHigh, -15);
  assert.equal(rooms.frozen_room_1.alarm, true);
  assert.equal(rooms.chiller_room_1.setLow, null);
  assert.equal(rooms.chiller_room_1.alarm, false);
});

test('snapshotStats flags zero resolved zones and counts unknown rooms', () => {
  const rooms = rowsToSnapshot(long, [
    { room: 'S01', temperature: 1, ts_ms: NOW },
    { room: 'S02', temperature: 2, ts_ms: NOW },
  ], { now: NOW, staleMs: STALE });
  const st = snapshotStats(rooms, { now: NOW, rowCount: 2 });
  assert.equal(st.resolvedZones, 0);
  assert.equal(st.unknownRooms, 2);
  assert.match(st.warning, /No database room matched any of the 16 zones \(2 unknown room\(s\): s01, s02\)/);
  const ok = snapshotStats(rowsToSnapshot(long, [{ room: 'fr1', temperature: -20, ts_ms: NOW }], { now: NOW, staleMs: STALE }), { now: NOW, rowCount: 1 });
  assert.equal(ok.resolvedZones, 1);
  assert.equal(ok.unknownRooms, 0);
  assert.equal(ok.warning, null);
  const empty = snapshotStats(rowsToSnapshot(long, [], { now: NOW, staleMs: STALE }), { now: NOW, rowCount: 0 });
  assert.match(empty.warning, /no rows/);
});

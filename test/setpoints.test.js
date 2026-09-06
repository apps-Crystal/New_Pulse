const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ZONES } = require('../lib/zones');
const { parseSetpoints, loadSetpointsFromEnv, applySetpoints, normaliseEntry } = require('../lib/setpoints');

const FROZEN_IDS = ZONES.filter((z) => z.type === 'frozen').map((z) => z.id);
const CHILLER_IDS = ZONES.filter((z) => z.type === 'chiller').map((z) => z.id);

// ---------- parseSetpoints: input forms ----------

test('parseSetpoints: object keyed by zone id with {low, high}', () => {
  const { setpoints, warnings } = parseSetpoints({ frozen_room_1: { low: -25, high: -15 } });
  assert.deepEqual(setpoints, { frozen_room_1: { setLow: -25, setHigh: -15 } });
  assert.deepEqual(warnings, []);
});

test('parseSetpoints: value shapes {setLow,setHigh}, {min,max}, [low,high], "low:high"', () => {
  const { setpoints } = parseSetpoints({
    frozen_room_1: { setLow: -25, setHigh: -15 },
    frozen_room_2: { min: -24, max: -16 },
    frozen_room_3: [-23, -17],
    frozen_room_4: '-22:-18',
    frozen_room_5: '-21..-19',
  });
  assert.deepEqual(setpoints.frozen_room_1, { setLow: -25, setHigh: -15 });
  assert.deepEqual(setpoints.frozen_room_2, { setLow: -24, setHigh: -16 });
  assert.deepEqual(setpoints.frozen_room_3, { setLow: -23, setHigh: -17 });
  assert.deepEqual(setpoints.frozen_room_4, { setLow: -22, setHigh: -18 });
  assert.deepEqual(setpoints.frozen_room_5, { setLow: -21, setHigh: -19 });
});

test('parseSetpoints: numeric strings and one-sided limits', () => {
  const { setpoints, warnings } = parseSetpoints({
    chiller_room_1: { low: '0', high: '8' },
    chiller_room_2: { high: 8 },
    chiller_room_3: [null, 6],
    chiller_room_4: ':7',
    chiller_room_5: '1:',
  });
  assert.deepEqual(setpoints.chiller_room_1, { setLow: 0, setHigh: 8 });
  assert.deepEqual(setpoints.chiller_room_2, { setLow: null, setHigh: 8 });
  assert.deepEqual(setpoints.chiller_room_3, { setLow: null, setHigh: 6 });
  assert.deepEqual(setpoints.chiller_room_4, { setLow: null, setHigh: 7 });
  assert.deepEqual(setpoints.chiller_room_5, { setLow: 1, setHigh: null });
  assert.deepEqual(warnings, []);
});

test('parseSetpoints: alias and label keys resolve through lib/zones', () => {
  const { setpoints, warnings } = parseSetpoints({
    'Frozen Room 1': [-25, -15],
    fr2: [-25, -15],
    'chiller-anteroom': [0, 10],
    'Blast Freezer 2': [-35, -20],
    Dock: [5, 18],
    7: [0, 8], // numeric index -> chiller_room_1
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(Object.keys(setpoints).sort(), ['blast_freezer_2', 'chiller_anteroom', 'chiller_room_1', 'dock_area', 'frozen_room_1', 'frozen_room_2']);
  assert.deepEqual(setpoints.chiller_anteroom, { setLow: 0, setHigh: 10 });
  assert.deepEqual(setpoints.chiller_room_1, { setLow: 0, setHigh: 8 });
});

test('parseSetpoints: JSON string input', () => {
  const { setpoints, warnings } = parseSetpoints('{"frozen_room_1": {"low": -25, "high": -15}, "dock_area": [5, 18]}');
  assert.deepEqual(setpoints, { frozen_room_1: { setLow: -25, setHigh: -15 }, dock_area: { setLow: 5, setHigh: 18 } });
  assert.deepEqual(warnings, []);
});

test('parseSetpoints: compact string with ":" and ".." separators, empty sides, ";" and spaces', () => {
  const { setpoints, warnings } = parseSetpoints('frozen_room_1=-25:-15, chiller_room_1=0..8; dock=5:18,chiller_room_2=:6,chiller_room_3=1:');
  assert.deepEqual(warnings, []);
  assert.deepEqual(setpoints.frozen_room_1, { setLow: -25, setHigh: -15 });
  assert.deepEqual(setpoints.chiller_room_1, { setLow: 0, setHigh: 8 });
  assert.deepEqual(setpoints.dock_area, { setLow: 5, setHigh: 18 });
  assert.deepEqual(setpoints.chiller_room_2, { setLow: null, setHigh: 6 });
  assert.deepEqual(setpoints.chiller_room_3, { setLow: 1, setHigh: null });
});

test('parseSetpoints: "_comment" keys and empty entries are ignored silently', () => {
  const { setpoints, warnings } = parseSetpoints({
    _comment: 'units are degrees C',
    frozen_room_1: { low: null, high: null },
    frozen_room_2: {},
    frozen_room_3: null,
    frozen_room_4: { _note: 'tbd' },
  });
  assert.deepEqual(setpoints, {});
  assert.deepEqual(warnings, []);
});

// ---------- type defaults ----------

test('parseSetpoints: type-wide defaults expand to every zone of that type', () => {
  const { setpoints, warnings } = parseSetpoints({ frozen: [-25, -15], chiller: '0:8' });
  assert.deepEqual(warnings, []);
  for (const id of FROZEN_IDS) assert.deepEqual(setpoints[id], { setLow: -25, setHigh: -15 }, id);
  for (const id of CHILLER_IDS) assert.deepEqual(setpoints[id], { setLow: 0, setHigh: 8 }, id);
  assert.equal(setpoints.dock_area, undefined);
});

test('parseSetpoints: "*" / "default" apply to all zones; explicit zone > type > global', () => {
  const { setpoints } = parseSetpoints({
    '*': { low: -40, high: 25 },
    frozen: { high: -15 },
    'Frozen Room 1': { low: -30 },
    chiller_room_2: [2, 6],
  });
  assert.deepEqual(setpoints.dock_area, { setLow: -40, setHigh: 25 });
  assert.deepEqual(setpoints.frozen_room_2, { setLow: -40, setHigh: -15 });
  assert.deepEqual(setpoints.frozen_room_1, { setLow: -30, setHigh: -15 });
  assert.deepEqual(setpoints.chiller_room_1, { setLow: -40, setHigh: 25 });
  assert.deepEqual(setpoints.chiller_room_2, { setLow: 2, setHigh: 6 });
  assert.equal(Object.keys(setpoints).length, 16);

  const alt = parseSetpoints('default=-40:25').setpoints;
  assert.equal(Object.keys(alt).length, 16);
});

test('parseSetpoints: explicit entries win over type defaults regardless of key order', () => {
  const a = parseSetpoints({ frozen_room_1: [-30, -20], frozen: [-25, -15] }).setpoints;
  const b = parseSetpoints({ frozen: [-25, -15], frozen_room_1: [-30, -20] }).setpoints;
  assert.deepEqual(a.frozen_room_1, { setLow: -30, setHigh: -20 });
  assert.deepEqual(b.frozen_room_1, { setLow: -30, setHigh: -20 });
  assert.deepEqual(a.frozen_room_2, { setLow: -25, setHigh: -15 });
});

// ---------- malformed input and warnings ----------

test('parseSetpoints: unknown zones are skipped and reported', () => {
  const { setpoints, warnings } = parseSetpoints({ garbage_room: [1, 2], frozen_room_1: [-25, -15] });
  assert.deepEqual(Object.keys(setpoints), ['frozen_room_1']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown zone "garbage_room"/);
});

test('parseSetpoints: malformed JSON yields {} plus a warning, never throws', () => {
  const { setpoints, warnings } = parseSetpoints('{"frozen_room_1": [-25, -15');
  assert.deepEqual(setpoints, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /invalid JSON/);
});

test('parseSetpoints: bad compact items, non-numeric and inverted limits are reported', () => {
  const { setpoints, warnings } = parseSetpoints('frozen_room_1=-25:-15,nonsense,chiller_room_1=abc:8,chiller_room_2=10:2');
  assert.deepEqual(Object.keys(setpoints), ['frozen_room_1']);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /cannot parse "nonsense"/);
  assert.match(warnings[1], /non-numeric limit for "chiller_room_1"/);
  assert.match(warnings[2], /low 10 is above high 2 for "chiller_room_2"/);
});

test('parseSetpoints: unrecognised value shapes and non-object roots', () => {
  const r1 = parseSetpoints({ frozen_room_1: { foo: 1 } });
  assert.deepEqual(r1.setpoints, {});
  assert.match(r1.warnings[0], /unrecognised value for "frozen_room_1"/);
  const r2 = parseSetpoints('[1, 2]');
  assert.deepEqual(r2.setpoints, {});
  assert.match(r2.warnings[0], /expected an object/);
  assert.deepEqual(parseSetpoints(null), { setpoints: {}, warnings: [] });
  assert.deepEqual(parseSetpoints('   '), { setpoints: {}, warnings: [] });
  assert.deepEqual(parseSetpoints(42).setpoints, {});
});

test('normaliseEntry helper', () => {
  assert.deepEqual(normaliseEntry([-1, 1]), { setLow: -1, setHigh: 1 });
  assert.deepEqual(normaliseEntry({ lo: 1, hi: 2 }), { setLow: 1, setHigh: 2 });
  assert.equal(normaliseEntry('nope'), null);
  assert.equal(normaliseEntry(true), null);
});

// ---------- loader ----------

test('loadSetpointsFromEnv: PULSE_SETPOINTS wins over the file', () => {
  const readFile = () => { throw new Error('should not be read'); };
  const r = loadSetpointsFromEnv({ PULSE_SETPOINTS: 'frozen_room_1=-25:-15', PULSE_SETPOINTS_FILE: './x.json' }, { readFile });
  assert.equal(r.source, 'env');
  assert.deepEqual(r.setpoints, { frozen_room_1: { setLow: -25, setHigh: -15 } });
  assert.deepEqual(r.warnings, []);
});

test('loadSetpointsFromEnv: PULSE_SETPOINTS may be JSON', () => {
  const r = loadSetpointsFromEnv({ PULSE_SETPOINTS: '{"chiller": [0, 8]}' }, { readFile: () => null });
  assert.equal(r.source, 'env');
  assert.deepEqual(r.setpoints.chiller_room_6, { setLow: 0, setHigh: 8 });
});

test('loadSetpointsFromEnv: reads ./setpoints.json from cwd by default', () => {
  const seen = [];
  const readFile = (p) => { seen.push(p); return JSON.stringify({ _comment: 'x', dock_area: { low: 5, high: 18 } }); };
  const r = loadSetpointsFromEnv({}, { readFile, cwd: 'C:\\plant\\pulse' });
  assert.equal(r.source, 'file');
  assert.equal(seen.length, 1);
  assert.equal(seen[0], path.resolve('C:\\plant\\pulse', './setpoints.json'));
  assert.equal(r.path, seen[0]);
  assert.deepEqual(r.setpoints, { dock_area: { setLow: 5, setHigh: 18 } });
  assert.deepEqual(r.warnings, []);
});

test('loadSetpointsFromEnv: PULSE_SETPOINTS_FILE overrides the path (relative and absolute)', () => {
  const seen = [];
  const readFile = (p) => { seen.push(p); return '{}'; };
  loadSetpointsFromEnv({ PULSE_SETPOINTS_FILE: 'config/limits.json' }, { readFile, cwd: 'C:\\plant' });
  loadSetpointsFromEnv({ PULSE_SETPOINTS_FILE: 'C:\\elsewhere\\limits.json' }, { readFile, cwd: 'C:\\plant' });
  assert.equal(seen[0], path.resolve('C:\\plant', 'config/limits.json'));
  assert.equal(seen[1], 'C:\\elsewhere\\limits.json');
});

test('loadSetpointsFromEnv: missing default file is silent (source none); missing explicit file warns', () => {
  const enoent = () => { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; };
  const a = loadSetpointsFromEnv({}, { readFile: enoent });
  assert.equal(a.source, 'none');
  assert.deepEqual(a.setpoints, {});
  assert.deepEqual(a.warnings, []);

  const b = loadSetpointsFromEnv({}, { readFile: () => null });
  assert.equal(b.source, 'none');
  assert.deepEqual(b.warnings, []);

  const c = loadSetpointsFromEnv({ PULSE_SETPOINTS_FILE: './missing.json' }, { readFile: enoent });
  assert.equal(c.source, 'none');
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /PULSE_SETPOINTS_FILE=\.\/missing\.json not found/);
});

test('loadSetpointsFromEnv: unreadable or malformed file never throws', () => {
  const eacces = () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; };
  const a = loadSetpointsFromEnv({}, { readFile: eacces });
  assert.equal(a.source, 'none');
  assert.match(a.warnings[0], /cannot read .*setpoints\.json \(permission denied\)/);

  const b = loadSetpointsFromEnv({}, { readFile: () => '{ not json' });
  assert.equal(b.source, 'file');
  assert.deepEqual(b.setpoints, {});
  assert.match(b.warnings[0], /invalid JSON/);

  const c = loadSetpointsFromEnv({ PULSE_SETPOINTS: '{ not json' }, { readFile: () => '{}' });
  assert.equal(c.source, 'env');
  assert.deepEqual(c.setpoints, {});
  assert.match(c.warnings[0], /invalid JSON/);
});

test('loadSetpointsFromEnv: real fs reader against a temp cwd', () => {
  const fs = require('fs');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-sp-'));
  try {
    const none = loadSetpointsFromEnv({}, { cwd: dir });
    assert.equal(none.source, 'none');
    fs.writeFileSync(path.join(dir, 'setpoints.json'), '{"frozen": [-25, -15]}');
    const some = loadSetpointsFromEnv({}, { cwd: dir });
    assert.equal(some.source, 'file');
    assert.deepEqual(some.setpoints.frozen_room_1, { setLow: -25, setHigh: -15 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- applySetpoints ----------

function room(over) {
  return { label: 'x', type: 'frozen', temperature: null, setLow: null, setHigh: null, alarm: false, offline: false, updatedAt: 1, ...over };
}

test('applySetpoints: fills null limits by zone id and recomputes alarm', () => {
  const rooms = {
    frozen_room_1: room({ temperature: -10 }),
    frozen_room_2: room({ temperature: -20 }),
    frozen_room_3: room({ temperature: -30 }),
  };
  const sp = parseSetpoints({ frozen_room_1: [-25, -15], frozen_room_2: [-25, -15], frozen_room_3: [-25, -15] }).setpoints;
  const out = applySetpoints(rooms, sp);
  assert.equal(out, rooms);
  assert.deepEqual([rooms.frozen_room_1.setLow, rooms.frozen_room_1.setHigh], [-25, -15]);
  assert.equal(rooms.frozen_room_1.alarm, true);  // above high
  assert.equal(rooms.frozen_room_2.alarm, false);
  assert.equal(rooms.frozen_room_3.alarm, true);  // below low
});

test('applySetpoints: DB-provided limits always win over configured ones', () => {
  const rooms = {
    frozen_room_1: room({ temperature: -18, setLow: -20, setHigh: -16 }),
    frozen_room_2: room({ temperature: -3, setLow: -30, setHigh: null }),
  };
  const sp = parseSetpoints({ frozen: [-10, -5] }).setpoints;
  applySetpoints(rooms, sp);
  assert.deepEqual([rooms.frozen_room_1.setLow, rooms.frozen_room_1.setHigh], [-20, -16]);
  assert.equal(rooms.frozen_room_1.alarm, false);
  // only the missing side is filled
  assert.deepEqual([rooms.frozen_room_2.setLow, rooms.frozen_room_2.setHigh], [-30, -5]);
  assert.equal(rooms.frozen_room_2.alarm, true); // -3 > -5
});

test('applySetpoints: rooms without an entry stay null and never alarm; null temperature never alarms', () => {
  const rooms = {
    dock_area: room({ type: 'other', temperature: 40 }),
    frozen_room_1: room({ temperature: null, offline: true }),
  };
  applySetpoints(rooms, parseSetpoints({ frozen_room_1: [-25, -15] }).setpoints);
  assert.deepEqual([rooms.dock_area.setLow, rooms.dock_area.setHigh, rooms.dock_area.alarm], [null, null, false]);
  assert.deepEqual([rooms.frozen_room_1.setLow, rooms.frozen_room_1.setHigh, rooms.frozen_room_1.alarm], [-25, -15, false]);
});

test('applySetpoints: clears a stale alarm flag when the limits no longer justify it', () => {
  const rooms = { chiller_room_1: room({ type: 'chiller', temperature: 4, alarm: true }) };
  applySetpoints(rooms, {});
  assert.equal(rooms.chiller_room_1.alarm, false);
});

test('applySetpoints: accepts raw type / "*" keys in a hand-built map and an array of rooms', () => {
  const rooms = {
    chiller_room_1: room({ type: 'chiller', temperature: 9 }),
    dock_area: room({ type: 'other', temperature: 30 }),
    unknown_extra: room({ type: 'other', temperature: 12 }),
  };
  applySetpoints(rooms, { chiller: { setLow: 0, setHigh: 8 }, '*': { setLow: null, setHigh: 25 } });
  assert.equal(rooms.chiller_room_1.alarm, true);
  assert.equal(rooms.dock_area.alarm, true);
  assert.equal(rooms.unknown_extra.alarm, false);
  assert.equal(rooms.unknown_extra.setHigh, 25);

  const arr = [{ id: 'frozen_room_1', ...room({ temperature: -5 }) }];
  applySetpoints(arr, { frozen_room_1: { setLow: -25, setHigh: -15 } });
  assert.equal(arr[0].alarm, true);
  assert.equal(applySetpoints(null, {}), null);
});

test('applySetpoints: warning band is left to the UI (only alarm is computed)', () => {
  // -16 is within 2 C of the high limit -15: not an alarm; lib/format.js zoneStatus() turns it into WARN.
  const rooms = { frozen_room_1: room({ temperature: -16 }) };
  applySetpoints(rooms, { frozen_room_1: { setLow: -25, setHigh: -15 } });
  assert.equal(rooms.frozen_room_1.alarm, false);
});

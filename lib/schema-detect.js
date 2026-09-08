// Pure schema-detection helpers for the Pulse data layer.
// No database access here: everything is unit-testable with plain fixtures.
// CommonJS on purpose (shared by Next.js route handlers and plain `node scripts/*.js`).

const { ZONES, normaliseRoomKey, resolveZone, inferType } = require('./zones');
const { normaliseLimits } = require('./limits');

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

const NUMERIC_TYPES = /^(numeric|decimal|real|double precision|integer|smallint|bigint|float4|float8|int2|int4|int8|int|serial|bigserial|smallserial|money)\b/i;
const INTEGER_TYPES = /^(integer|smallint|bigint|int2|int4|int8|int|serial|bigserial|smallserial)\b/i;
const TIMESTAMP_TYPES = /^(timestamp|timestamptz|date)\b/i;
const TEXT_TYPES = /^(text|character varying|varchar|character|char|citext|bpchar|name)\b/i;
// Types that can identify a room (cast ::text) but can never be a measurement: uuid, enums, citext-as-udt, arrays.
const OPAQUE_TYPES = /^(uuid|user-defined|enum|array)\b/i;

function normType(type) {
  return String(type == null ? '' : type).trim().toLowerCase();
}
function isNumericType(type) { return NUMERIC_TYPES.test(normType(type)); }
function isIntegerType(type) { return INTEGER_TYPES.test(normType(type)); }
function isTimestampType(type) { return TIMESTAMP_TYPES.test(normType(type)); }
function isTextType(type) { return TEXT_TYPES.test(normType(type)); }
function isOpaqueType(type) { return OPAQUE_TYPES.test(normType(type)); }
function isUnknownType(type) { return normType(type) === '' || normType(type) === 'unknown'; }

// ---------------------------------------------------------------------------
// Name patterns (from the data contract)
// ---------------------------------------------------------------------------

const RE_TEMP = /temp|actual|reading|value|celsius|deg|°/i;
const RE_ROOM = /room|zone|area|location|sensor|device|chamber|channel|tag|point|name|label|id$/i;
// Any ts-ish word is fine on text / timestamp columns...
const RE_TS = /time|date|_at$|^ts$|stamp|created|updated|recorded|logged|measured|epoch/i;
// ...but a NUMERIC column is only a timestamp when the name says so strongly (measured_temp is a temperature).
const RE_TS_STRONG = /time|date|_at$|^ts$|stamp|epoch/i;
const RE_ID_LIKE = /^(id|seq|sequence|serial|row_?id|rowid)$/i;
// Measurements of something other than temperature: never a temperature and never a temperature setpoint.
const RE_NOT_TEMP = /humid|(^|[^a-z])rh([^a-z]|$)|flow|press|volt|amp|batt|minute|door|fan|compressor|defrost|power|energy|kwh|level|speed|rpm|percent|pct|status|state|mode|flag|count|fault/i;
// A "temperature" column that is really a target, not a live reading.
const RE_SETPOINTISH = /target|desired|setpoint|set_?point|set_?temp|goal|nominal|(^|[^a-z])sp([^a-z]|$)/i;

const RE_TABLE_GOOD = /temp|read|sensor|log|pulse|cold|room|zone|plc|hmi/i;
const RE_TABLE_BAD = /alarm|event|user|profile|setting|config|migration|spatial_ref/i;
const RE_TABLE_PER_ROOM = /room|zone|current|latest|status/i;
const RE_TABLE_HISTORY = /reading|log|history|record|event|sample|measure|series/i;
const RE_VIEW_LATEST = /latest|current/i;

// A room's alarm limits logged as their own rows ("Frozen Room 1 Set Low"): limits, not temperatures.
const RE_LIMIT_TAG = /^(.*?)\s+set\s*(low|high)$/i;

const WIDE_MIN_ZONES = 6;
const PER_ROOM_LIMIT = 500;

// Split a column name into lowercase tokens: "humidityMin" / "set_low" / "Temp (C)" -> [...].
function tokens(name) {
  return String(name == null ? '' : name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Setpoint tokens are bounded: "low"/"min" as a whole token (or glued to set/limit/temp),
// so "airflow", "window", "minutes", "flow_rate" never qualify.
const LOW_TOKEN = /^(set)?(low|lo|lower|min|minimum|floor)$/;
const LOW_COMPOUND = /^(set)?(low|min)(limit|temp|point|value|threshold|sp|c)$/;
const HIGH_TOKEN = /^(set)?(high|hi|higher|upper|max|maximum|ceil|ceiling)$/;
const HIGH_COMPOUND = /^(set)?(high|max)(limit|temp|point|value|threshold|sp|c)$/;

function looksSetLow(name) {
  if (RE_NOT_TEMP.test(name)) return false;
  return tokens(name).some((t) => LOW_TOKEN.test(t) || LOW_COMPOUND.test(t));
}
function looksSetHigh(name) {
  if (RE_NOT_TEMP.test(name)) return false;
  return tokens(name).some((t) => HIGH_TOKEN.test(t) || HIGH_COMPOUND.test(t));
}

// ---------------------------------------------------------------------------
// Zone resolution with a little more tolerance than zones.resolveZone:
// strips common measurement prefixes/suffixes so that "temp_fr2" -> frozen_room_2.
// (No single-letter strips: "TC1" is a thermocouple tag, not "c1" = chiller room 1.)
// ---------------------------------------------------------------------------

const STRIP_PREFIX = /^(temperature|temp|actual|reading|value|current|sensor|pv)(?=[a-z0-9])/;
const STRIP_SUFFIX = /(temperature|temp|celsius|degc|deg|actual|reading|value|current|sensor|setpoint|pv|low|high|min|max)$/;

const EXACT_INDEX = new Map();
for (const z of ZONES) {
  for (const a of [z.id, z.label, ...z.aliases]) EXACT_INDEX.set(normaliseRoomKey(a), z);
}

function resolveZoneLoose(raw) {
  const direct = resolveZone(raw);
  if (direct) return direct;
  if (raw == null) return null;
  // A lone "t"/"T" followed by a separator is a temperature prefix ("t_bf1", "T-FR1"); "TC1" is a tag, not "c1".
  const bare = String(raw).replace(/^t(?=[^a-z0-9]+[a-z0-9])[^a-z0-9]+/i, '');
  if (bare !== String(raw) && EXACT_INDEX.has(normaliseRoomKey(bare))) return EXACT_INDEX.get(normaliseRoomKey(bare));
  let key = normaliseRoomKey(raw);
  if (!key) return null;
  // Peel prefixes, then suffixes, checking for an exact alias after each step.
  for (let i = 0; i < 4; i++) {
    const next = key.replace(STRIP_PREFIX, '');
    if (next === key) break;
    key = next;
    if (EXACT_INDEX.has(key)) return EXACT_INDEX.get(key);
  }
  for (let i = 0; i < 4; i++) {
    const next = key.replace(STRIP_SUFFIX, '');
    if (next === key || next.length < 2) break;
    key = next;
    if (EXACT_INDEX.has(key)) return EXACT_INDEX.get(key);
  }
  // Numeric remainder (e.g. "room_7" -> "7") maps by display order.
  if (/^\d{1,2}$/.test(key)) return resolveZone(Number(key));
  return null;
}

// ---------------------------------------------------------------------------
// classifyColumn({ name, type }) -> Set of roles
// roles: temp | room | ts | setLow | setHigh | order | zoneWide
// ---------------------------------------------------------------------------

function classifyColumn(col) {
  const name = String((col && col.name) || '');
  const type = normType(col && col.type);
  const roles = new Set();
  if (!name) return roles;

  const numeric = isNumericType(type);
  const integer = isIntegerType(type);
  const text = isTextType(type);
  const timestamp = isTimestampType(type);
  const opaque = isOpaqueType(type);
  const unknown = isUnknownType(type);
  const idLike = RE_ID_LIKE.test(name);

  const zone = numeric || unknown ? resolveZoneLoose(name) : null;
  if (zone && !idLike) roles.add('zoneWide');

  const isSetLow = looksSetLow(name) && (numeric || text || unknown);
  const isSetHigh = looksSetHigh(name) && (numeric || text || unknown);
  if (isSetLow) roles.add('setLow');
  if (isSetHigh) roles.add('setHigh');

  // temp: numeric or text-typed, name looks like a live measurement, and is not a setpoint / target / id / zone column.
  if (RE_TEMP.test(name) && (numeric || text || unknown) && !isSetLow && !isSetHigh && !idLike && !/_id$/i.test(name)
    && !zone && !RE_NOT_TEMP.test(name) && !RE_SETPOINTISH.test(name)) {
    roles.add('temp');
  }

  // ts: timestamp type always; a ts-ish name on text/unknown columns; only a strongly ts-ish name on numeric columns.
  if (timestamp || (!zone && !idLike && ((RE_TS.test(name) && (text || unknown)) || (RE_TS_STRONG.test(name) && numeric)))) {
    roles.add('ts');
  }

  // room: text preferred; integer, uuid/enum (opaque) and unknown allowed. Never a zone-named column or a timestamp.
  if (RE_ROOM.test(name) && (text || integer || unknown || opaque) && !timestamp && !zone && !roles.has('ts')) {
    if (!(/^id$/i.test(name) && !integer && !unknown)) roles.add('room');
  }

  // order: id-like integer/serial column.
  if (idLike && (integer || unknown)) roles.add('order');

  return roles;
}

// ---------------------------------------------------------------------------
// Preference scoring within a table
// ---------------------------------------------------------------------------

function tempPreference(c) {
  const n = c.name.toLowerCase();
  let s = 0;
  if (/^temp(erature)?(_?(c|celsius|deg_?c|value|actual|pv))?$/.test(n)) s += 100;
  else if (/temp/.test(n)) s += 80;
  else if (/actual|reading|celsius|deg|°/.test(n)) s += 60;
  else if (/value/.test(n)) s += 40;
  if (/actual|measured|current|pv|reading|live/.test(n)) s += 15;
  if (isTextType(c.type)) s -= 20;
  if (isUnknownType(c.type)) s -= 10;
  if (isIntegerType(c.type)) s -= 5;
  return s;
}

function roomPreference(c) {
  const n = c.name.toLowerCase();
  let s = 0;
  if (isTextType(c.type)) s += 50;
  if (/^(room|zone)(_?(name|id|no|num|number|code|key))?$/.test(n)) s += 30;
  else if (/room|zone|chamber|area/.test(n)) s += 20;
  else if (/sensor|device|channel|tag|point|location/.test(n)) s += 15;
  else if (/name|label/.test(n)) s += 10;
  else if (/_id$/.test(n)) s += 5;
  else if (/^id$/.test(n)) s += 1;
  // Human-readable names beat opaque keys on ties (sensor_name > sensor_id).
  if (/name|label|title/.test(n)) s += 10;
  if (/(^|_)(id|uuid|key)$/.test(n) && !/^(room|zone)_?id$/.test(n)) s -= 10;
  return s;
}

function tsPreference(c) {
  const n = c.name.toLowerCase();
  let s = 0;
  if (isTimestampType(c.type)) s += 50;
  else if (isNumericType(c.type)) s += 5;
  if (/recorded|measured|logged|sampled|reading_?time|read_?at/.test(n)) s += 30;
  else if (/time|^ts$|stamp/.test(n)) s += 20;
  else if (/updated|modified/.test(n)) s += 12;
  else if (/created|inserted|_at$|date/.test(n)) s += 10;
  return s;
}

function setPreference(c) {
  const n = c.name.toLowerCase();
  let s = 0;
  if (/set_?(low|high|min|max)|limit|setpoint|sp_/.test(n)) s += 30;
  if (/temp/.test(n)) s += 10;
  if (isNumericType(c.type)) s += 20;
  return s;
}

// Which of several zone-named numeric columns for the same zone is the live temperature?
function widePreference(c, roles) {
  const n = c.name.toLowerCase();
  let s = 0;
  if (roles.includes('setLow') || roles.includes('setHigh')) s -= 100;
  if (RE_NOT_TEMP.test(n) || RE_SETPOINTISH.test(n)) s -= 60;
  if (isIntegerType(c.type)) s -= 30;
  if (isTextType(c.type)) s -= 20;
  if (isUnknownType(c.type)) s -= 10;
  if (/temp|pv|actual|value|reading|celsius|deg|measured|current/.test(n)) s += 20;
  return s;
}

function pickBest(cands, pref) {
  if (!cands.length) return null;
  const sorted = cands.slice().sort((a, b) => pref(b) - pref(a) || a.name.localeCompare(b.name));
  return sorted[0];
}

// Pick the human-readable name column of a referenced (FK) table, e.g. rooms.name.
function pickNameColumn(columns) {
  const cols = (columns || []).map((c) => ({ name: String(c.name), type: normType(c.type) }));
  const textCols = cols.filter((c) => isTextType(c.type) && !RE_ID_LIKE.test(c.name));
  if (!textCols.length) return null;
  const pref = (c) => {
    const n = c.name.toLowerCase();
    let s = 0;
    if (/name|label|title/.test(n)) s += 30;
    if (/room|zone|display/.test(n)) s += 10;
    if (/code|slug|key|tag/.test(n)) s += 5;
    if (/desc|note|comment|uuid|_id$/.test(n)) s -= 20;
    return s;
  };
  return pickBest(textCols, pref).name;
}

// Setpoint columns of a referenced (FK) names table, e.g. rooms.set_low / rooms.set_high.
function pickSetpointColumns(columns) {
  const cols = (columns || []).map((c) => ({ name: String(c.name), type: normType(c.type) }));
  const roleOf = new Map(cols.map((c) => [c.name, classifyColumn(c)]));
  const lows = cols.filter((c) => roleOf.get(c.name).has('setLow') && !roleOf.get(c.name).has('setHigh'));
  const highs = cols.filter((c) => roleOf.get(c.name).has('setHigh') && !roleOf.get(c.name).has('setLow'));
  const low = pickBest(lows, setPreference);
  const high = pickBest(highs, setPreference);
  const colTypes = {};
  for (const c of cols) colTypes[c.name] = c.type;
  return { lowCol: low ? low.name : null, highCol: high ? high.name : null, colTypes };
}

// Parse PULSE_WIDE_MAP ("col=zone,col=zone" or "col:zone;col:zone") into { column -> zoneId }.
function parseWideMap(spec) {
  const out = {};
  if (!spec) return out;
  if (typeof spec === 'object') {
    for (const [k, v] of Object.entries(spec)) {
      const z = resolveZone(v);
      if (k && z) out[k] = z.id;
    }
    return out;
  }
  for (const part of String(spec).split(/[,;\n]/)) {
    const m = /^\s*([^=:]+?)\s*[=:]\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    const z = resolveZone(m[2]);
    if (z) out[m[1]] = z.id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// analyseTable(table, overrides) -> full analysis for one table
// table = { name, kind, columns: [{ name, type }] }
// ---------------------------------------------------------------------------

function analyseTable(table, overrides) {
  const ov = overrides || {};
  const name = String(table.name || '');
  const kind = String(table.kind || 'BASE TABLE').toUpperCase();
  const isView = /VIEW/.test(kind);
  const columns = (table.columns || []).map((c) => ({ name: String(c.name), type: normType(c.type) }));
  const colTypes = {};
  const roles = {};
  for (const c of columns) {
    colTypes[c.name] = c.type;
    roles[c.name] = Array.from(classifyColumn(c));
  }
  const has = (c, r) => roles[c.name] && roles[c.name].includes(r);
  const byName = (n) => (n ? columns.find((c) => c.name === n) || columns.find((c) => c.name.toLowerCase() === String(n).toLowerCase()) : null);
  const reasons = [];

  // --- wide candidates: per zone, choose the column that looks most like the live temperature
  const wideMap = {};
  const wideSetpoints = {};
  const forcedWide = parseWideMap(ov.wideMap);
  if (Object.keys(forcedWide).length) {
    for (const [colName, zoneId] of Object.entries(forcedWide)) {
      const c = byName(colName);
      wideMap[c ? c.name : colName] = zoneId;
      if (!c) { colTypes[colName] = 'unknown'; reasons.push(`PULSE_WIDE_MAP column ${colName} not found in table (treated as unknown type)`); }
    }
  } else {
    const perZone = new Map();
    for (const c of columns) {
      if (!has(c, 'zoneWide')) continue;
      const z = resolveZoneLoose(c.name);
      if (!z) continue;
      if (!perZone.has(z.id)) perZone.set(z.id, []);
      perZone.get(z.id).push(c);
    }
    for (const [zoneId, cands] of perZone) {
      const temps = cands.filter((c) => !has(c, 'setLow') && !has(c, 'setHigh'));
      const lows = cands.filter((c) => has(c, 'setLow') && !has(c, 'setHigh'));
      const highs = cands.filter((c) => has(c, 'setHigh') && !has(c, 'setLow'));
      const bestTemp = pickBest(temps.length ? temps : cands, (c) => widePreference(c, roles[c.name]));
      if (!bestTemp) continue;
      wideMap[bestTemp.name] = zoneId;
      if (lows.length || highs.length) {
        wideSetpoints[zoneId] = {
          low: lows.length ? pickBest(lows, setPreference).name : null,
          high: highs.length ? pickBest(highs, setPreference).name : null,
        };
      }
    }
  }
  const wideCount = Object.keys(wideMap).length;

  // --- long / per_room column picks (respecting overrides)
  const forced = (key) => {
    const v = ov[key];
    if (!v) return null;
    return byName(v) || { name: String(v), type: 'unknown', synthetic: true };
  };

  const used = new Set();
  const take = (col) => { if (col) used.add(col.name); return col || null; };

  // The operator named this table (PULSE_TABLE) but not every column: names like "Val" / "Chamber"
  // carry no hint, so fall back to "the only plain numeric column" / "a plain text column".
  const tableForced = Boolean(ov.table) && String(ov.table).toLowerCase() === name.toLowerCase();
  const plainCols = (pred) => columns.filter((c) => pred(c) && !RE_ID_LIKE.test(c.name) && !/_id$/i.test(c.name)
    && !has(c, 'ts') && !has(c, 'setLow') && !has(c, 'setHigh') && !has(c, 'zoneWide') && !RE_NOT_TEMP.test(c.name) && !RE_SETPOINTISH.test(c.name));
  let tempCol = forced('tempCol') || pickBest(columns.filter((c) => has(c, 'temp')), tempPreference);
  if (!tempCol && tableForced) {
    const plainNumeric = plainCols((c) => isNumericType(c.type) && !isIntegerType(c.type) && !has(c, 'room'));
    if (plainNumeric.length) { tempCol = pickBest(plainNumeric, tempPreference); reasons.push(`PULSE_TABLE: no column named like a temperature; using numeric column ${tempCol.name}`); }
  }
  tempCol = take(tempCol);
  const isWide = ov.mode ? ov.mode === 'wide' : wideCount >= WIDE_MIN_ZONES;
  const roomCands = columns.filter((c) => has(c, 'room') && !used.has(c.name));
  const nonIdRooms = roomCands.filter((c) => !/^id$/i.test(c.name));
  const tsCands = columns.filter((c) => has(c, 'ts') && !used.has(c.name));
  const orderCands = columns.filter((c) => has(c, 'order'));
  let roomCol = null;
  let idRejected = false;
  if (!isWide) {
    roomCol = forced('roomCol') || pickBest(nonIdRooms, roomPreference);
    if (!roomCol && tableForced) {
      const plainText = plainCols((c) => isTextType(c.type) && !used.has(c.name) && !has(c, 'temp'));
      if (plainText.length) { roomCol = pickBest(plainText, roomPreference); reasons.push(`PULSE_TABLE: no column named like a room; using text column ${roomCol.name}`); }
    }
    if (!roomCol) {
      // A bare serial `id` may only stand in as the room key for a per-room table (no timestamp /
      // other ordering column): on a history table every row would become a "room".
      const idCand = roomCands.find((c) => /^id$/i.test(c.name));
      const historyShaped = tsCands.length > 0 || orderCands.some((c) => idCand && c.name !== idCand.name);
      if (idCand && !historyShaped) roomCol = idCand;
      else if (idCand) idRejected = true;
    }
    roomCol = take(roomCol);
  }
  const tsCol = take(forced('tsCol') || pickBest(columns.filter((c) => has(c, 'ts') && !used.has(c.name)), tsPreference));
  const setLowCol = take(forced('setLowCol') || pickBest(columns.filter((c) => has(c, 'setLow') && !has(c, 'setHigh') && !used.has(c.name)), setPreference));
  const setHighCol = take(forced('setHighCol') || pickBest(columns.filter((c) => has(c, 'setHigh') && !has(c, 'setLow') && !used.has(c.name)), setPreference));
  const orderCol = columns.find((c) => has(c, 'order') && !used.has(c.name)) || null;

  // numeric columns in a wide table that map to no zone (reported, never silently forgotten)
  const wideUnmapped = columns
    .filter((c) => (isNumericType(c.type) || isUnknownType(c.type)) && !wideMap[c.name] && !RE_ID_LIKE.test(c.name)
      && !(tsCol && c.name === tsCol.name) && !has(c, 'ts') && !RE_NOT_TEMP.test(c.name)
      && !Object.values(wideSetpoints).some((s) => s.low === c.name || s.high === c.name))
    .map((c) => c.name);

  // --- mode
  let mode = null;
  if (ov.mode) {
    mode = ov.mode;
  } else if (wideCount >= WIDE_MIN_ZONES) {
    mode = 'wide';
  } else if (roomCol && tempCol) {
    const noTsOrOrder = !tsCol && !orderCol;
    const nameSaysPerRoom = RE_TABLE_PER_ROOM.test(name) && !RE_TABLE_HISTORY.test(name);
    // Label only: buildQuery uses the one-row-per-room DISTINCT ON form whenever a ts/order column exists.
    if (noTsOrOrder || isView || nameSaysPerRoom) mode = 'per_room';
    else mode = 'long';
  }
  if (mode === 'wide' && wideCount === 0) mode = null;
  if ((mode === 'long' || mode === 'per_room') && !(roomCol && tempCol)) mode = null;

  // --- score
  let score = 0;
  if (mode) {
    score += 40; reasons.push(`viable ${mode} (+40)`);
    if (RE_TABLE_GOOD.test(name)) { score += 15; reasons.push('table name looks like temperature data (+15)'); }
    if (RE_TABLE_BAD.test(name)) { score -= 30; reasons.push('table name looks like a distractor (-30)'); }
    if (mode === 'wide') {
      score += 2 * wideCount; reasons.push(`wide: ${wideCount} zone columns (+${2 * wideCount})`);
      if (tsCol) { score += 10; reasons.push('has timestamp (+10)'); }
      if (wideUnmapped.length) reasons.push(`wide: ${wideUnmapped.length} numeric column(s) map to no zone: ${wideUnmapped.join(', ')}`);
    } else {
      if (tsCol) { score += 10; reasons.push(`has timestamp ${tsCol.name} (+10)`); }
      if (setLowCol || setHighCol) { score += 8; reasons.push('has setpoints (+8)'); }
      if (roomCol && isTextType(roomCol.type)) { score += 15; reasons.push('text room column (+15)'); }
      else if (roomCol && isIntegerType(roomCol.type)) { score -= 10; reasons.push('integer room column: rooms mapped by ordinal unless a FK to a names table exists (-10)'); }
      else if (roomCol && isOpaqueType(roomCol.type)) { reasons.push('uuid/enum room column: needs a FK to a names table or an enum with room names'); }
      if (mode === 'long') { score += 6; reasons.push('long history is ground truth (+6)'); }
      if (mode === 'per_room' && isView && RE_VIEW_LATEST.test(name)) { score += 12; reasons.push('latest/current view (+12)'); }
    }
  } else {
    if (RE_TABLE_BAD.test(name)) score -= 30;
    reasons.push('not viable: ' + (!tempCol ? 'no temperature column'
      : idRejected ? 'only the id column could serve as room key on a history-shaped table (room column has an unusable type?)'
        : !roomCol ? 'no room column' : 'unknown'));
  }

  return {
    table: name,
    kind,
    mode,
    roomCol: mode === 'wide' ? null : (roomCol ? roomCol.name : null),
    tempCol: mode === 'wide' ? null : (tempCol ? tempCol.name : null),
    tsCol: tsCol ? tsCol.name : null,
    setLowCol: mode === 'wide' ? null : (setLowCol ? setLowCol.name : null),
    setHighCol: mode === 'wide' ? null : (setHighCol ? setHighCol.name : null),
    orderCol: orderCol ? orderCol.name : null,
    wideMap: mode === 'wide' ? wideMap : {},
    wideSetpoints: mode === 'wide' ? wideSetpoints : {},
    wideUnmapped: mode === 'wide' ? wideUnmapped : [],
    colTypes,
    roles,
    score,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// rankTables(tables, { overrides }) -> sorted viable candidates
// ---------------------------------------------------------------------------

function rankTables(tables, opts) {
  const overrides = (opts && opts.overrides) || {};
  let list = Array.isArray(tables) ? tables.slice() : [];
  if (overrides.table) {
    const want = String(overrides.table);
    let hit = list.filter((t) => t.name === want);
    if (!hit.length) hit = list.filter((t) => String(t.name).toLowerCase() === want.toLowerCase());
    if (!hit.length) {
      // Table not visible in information_schema (permissions?) - trust the operator's overrides.
      hit = [{ name: want, kind: 'BASE TABLE', columns: [] }];
    }
    list = hit;
  }
  const analysed = list.map((t) => analyseTable(t, overrides));
  const viable = analysed.filter((a) => a.mode);
  viable.sort((a, b) => b.score - a.score || a.table.localeCompare(b.table));
  return viable;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

// Any identifier is safe once double-quoted with embedded quotes doubled (that is how Postgres
// itself defines quoted identifiers). Only reject what Postgres rejects: empty, NUL, > 63 bytes.
function quoteIdent(name) {
  const s = String(name == null ? '' : name);
  if (!s || s.includes('\0') || Buffer.byteLength(s, 'utf8') > 63) throw new Error(`Unsafe SQL identifier: ${JSON.stringify(s)}`);
  return '"' + s.replace(/"/g, '""') + '"';
}

const RE_TZ = /^[A-Za-z0-9_+\-/]{1,64}$/;
function safeTz(tz) {
  const s = String(tz == null ? '' : tz).trim();
  return RE_TZ.test(s) ? s : 'UTC';
}
// Window length in hours; fractional values (the short tier-1 window) are kept to the minute.
function safeHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return Math.min(8760, Math.floor(n));
  return Math.max(1, Math.round(n * 60)) / 60;
}
function intervalLiteral(hours) {
  return Number.isInteger(hours) ? `interval '${hours} hours'` : `interval '${Math.round(hours * 60)} minutes'`;
}

const TEXT_NUM_GUARD = "'^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)$'";

// "-18.5", " -18,5 °C ", "12.0C" -> float; "N/A", "1,234.5", "1.2.3", "" -> NULL. Never throws.
function textToFloat(expr) {
  const cleaned = `replace(regexp_replace(${expr}, '[^0-9.,+-]', '', 'g'), ',', '.')`;
  return `(CASE WHEN ${cleaned} ~ ${TEXT_NUM_GUARD} THEN ${cleaned}::float8 END)`;
}

function tempExprQ(q, type) {
  if (isNumericType(type)) return `${q}::float8`;
  if (isTextType(type)) return textToFloat(q);
  // unknown / exotic type: go through text safely
  return textToFloat(`${q}::text`);
}
function tempExpr(col, type) { return tempExprQ(quoteIdent(col), type); }

// "this column holds something": cheap, index-friendly predicate (the regex CASE stays in SELECT only).
function notNullExprQ(q, type) {
  if (isTextType(type)) return `${q} IS NOT NULL AND ${q} <> ''`;
  return `${q} IS NOT NULL`;
}

// Epoch milliseconds for native types. Text/unknown timestamps are NOT parsed in SQL (Postgres has no
// non-throwing cast and one bad row would fail every poll): they come back as ts_raw and are parsed in JS.
function tsMsExprQ(q, type, tz) {
  if (!q) return 'NULL::bigint';
  const t = normType(type);
  if (/^timestamptz\b|^timestamp with time zone\b/.test(t)) {
    return `(EXTRACT(EPOCH FROM ${q}) * 1000)::bigint`;
  }
  if (/^timestamp\b|^date\b/.test(t)) {
    return `(EXTRACT(EPOCH FROM (${q}::timestamp AT TIME ZONE '${safeTz(tz)}')) * 1000)::bigint`;
  }
  if (isNumericType(t)) {
    return `(CASE WHEN ${q} > 1e14 THEN ${q} / 1000 WHEN ${q} > 1e11 THEN ${q} ELSE ${q} * 1000 END)::bigint`;
  }
  return 'NULL::bigint';
}
function tsMsExpr(col, type, tz) { return tsMsExprQ(col ? quoteIdent(col) : null, type, tz); }

function tsIsNative(type) {
  const t = normType(type);
  return isTimestampType(t) || isNumericType(t);
}

// Expression to ORDER BY for "newest first". Raw column for native types (index-friendly);
// the raw text for text/unknown (correct for ISO-8601 and fixed-width epoch strings, never throws).
function tsOrderExprQ(q, type) {
  if (!q) return null;
  if (tsIsNative(type)) return q;
  if (isTextType(type)) return q;
  return `${q}::text`;
}

// WHERE fragment restricting to the last `hours` hours, for native ts types only. null = no window.
function windowClauseQ(q, type, hours, tz) {
  const h = safeHours(hours);
  if (!q || !h) return null;
  const t = normType(type);
  if (/^timestamptz\b|^timestamp with time zone\b/.test(t)) return `${q} >= now() - ${intervalLiteral(h)}`;
  if (/^timestamp\b|^date\b/.test(t)) return `${q} >= (now() AT TIME ZONE '${safeTz(tz)}') - ${intervalLiteral(h)}`;
  if (isNumericType(t)) {
    // seconds or milliseconds epoch; both ranges are index-friendly
    const secs = Math.round(h * 3600);
    return `((${q} < 1e11 AND ${q} >= EXTRACT(EPOCH FROM now()) - ${secs}) OR ${q} >= (EXTRACT(EPOCH FROM now()) - ${secs}) * 1000)`;
  }
  return null;
}

function typeOf(detected, col) {
  return (detected.colTypes && detected.colTypes[col]) || 'unknown';
}

// buildQuery(detected, { windowHours, tz }) -> { text, values, windowed }
function buildQuery(detected, opts) {
  if (!detected || !detected.table) throw new Error('buildQuery: no table');
  const o = opts || {};
  const tz = safeTz(o.tz);
  const schema = detected.schema || 'public';
  const join = detected.roomJoin && detected.roomJoin.table && detected.roomJoin.keyCol && detected.roomJoin.nameCol ? detected.roomJoin : null;
  const T = join ? '"t".' : '';
  const ref = (col) => T + quoteIdent(col);
  let from = `${quoteIdent(schema)}.${quoteIdent(detected.table)}`;
  if (join) {
    from += ` AS "t" LEFT JOIN ${quoteIdent(join.schema || schema)}.${quoteIdent(join.table)} AS "j" ON "j".${quoteIdent(join.keyCol)} = ${ref(detected.roomCol)}`;
  }
  const tsType = detected.tsCol ? typeOf(detected, detected.tsCol) : null;
  const tsQ = detected.tsCol ? ref(detected.tsCol) : null;
  const tsMs = tsMsExprQ(tsQ, tsType, tz);
  const tsRaw = tsQ && !tsIsNative(tsType) ? (isTextType(tsType) ? tsQ : `${tsQ}::text`) : 'NULL::text';
  const tsOrder = tsOrderExprQ(tsQ, tsType);
  const orderParts = (nullsLast) => {
    const parts = [];
    if (tsOrder) parts.push(`${tsOrder} DESC${nullsLast ? ' NULLS LAST' : ''}`);
    if (detected.orderCol) parts.push(`${ref(detected.orderCol)} DESC`);
    return parts;
  };

  if (detected.mode === 'wide') {
    const cols = Object.entries(detected.wideMap || {});
    if (!cols.length) throw new Error('buildQuery: wide mode without wideMap');
    const sel = [`${tsMs} AS ts_ms`, `${tsRaw} AS ts_raw`];
    for (const [col, zoneId] of cols) {
      sel.push(`${tempExprQ(ref(col), typeOf(detected, col))} AS ${quoteIdent(zoneId)}`);
      const sp = detected.wideSetpoints && detected.wideSetpoints[zoneId];
      if (sp && sp.low) sel.push(`${tempExprQ(ref(sp.low), typeOf(detected, sp.low))} AS ${quoteIdent(zoneId + '__low')}`);
      if (sp && sp.high) sel.push(`${tempExprQ(ref(sp.high), typeOf(detected, sp.high))} AS ${quoteIdent(zoneId + '__high')}`);
    }
    let text = `SELECT ${sel.join(', ')} FROM ${from}`;
    const op = orderParts(true);
    if (op.length) text += ` ORDER BY ${op.join(', ')}`;
    text += ' LIMIT 1';
    return { text, values: [], windowed: false };
  }

  if (!detected.roomCol || !detected.tempCol) throw new Error('buildQuery: room/temp column missing');
  const roomQ = ref(detected.roomCol);
  const roomExpr = join ? `COALESCE("j".${quoteIdent(join.nameCol)}::text, ${roomQ}::text)` : `${roomQ}::text`;
  const tempType = typeOf(detected, detected.tempCol);
  const tempQ = ref(detected.tempCol);
  const temp = tempExprQ(tempQ, tempType);
  // setpoints: from the readings table, else from the joined names table (rooms.set_low), else NULL
  const jType = (c) => (join && join.colTypes && join.colTypes[c]) || 'unknown';
  const low = detected.setLowCol ? tempExprQ(ref(detected.setLowCol), typeOf(detected, detected.setLowCol))
    : join && join.lowCol ? tempExprQ(`"j".${quoteIdent(join.lowCol)}`, jType(join.lowCol)) : 'NULL::float8';
  const high = detected.setHighCol ? tempExprQ(ref(detected.setHighCol), typeOf(detected, detected.setHighCol))
    : join && join.highCol ? tempExprQ(`"j".${quoteIdent(join.highCol)}`, jType(join.highCol)) : 'NULL::float8';
  const select = `${roomExpr} AS room, ${temp} AS temperature, ${low} AS set_low, ${high} AS set_high, ${tsMs} AS ts_ms, ${tsRaw} AS ts_raw`;
  const hasOrder = Boolean(tsOrder || detected.orderCol);

  if (detected.mode !== 'long' && detected.mode !== 'per_room') throw new Error(`buildQuery: unknown mode ${detected.mode}`);

  if (!hasOrder) {
    // A true per-room table with nothing to order by: still never unbounded.
    return { text: `SELECT ${select} FROM ${from} LIMIT ${PER_ROOM_LIMIT}`, values: [], windowed: false };
  }

  // One row per room, newest first. Same shape for long history and per-room tables (idempotent on the latter).
  const where = [];
  let windowed = false;
  if (detected.mode === 'long') {
    where.push(notNullExprQ(tempQ, tempType));
    // text / unknown temperatures: a non-numeric value ('N/A', '-', '.') must never be a room's newest row
    if (!isNumericType(tempType)) where.push(`${temp} IS NOT NULL`);
    if (tsQ && tsIsNative(tsType)) where.push(`${tsQ} IS NOT NULL`);
    const w = windowClauseQ(tsQ, tsType, o.windowHours, tz);
    if (w) { where.push(w); windowed = true; }
  }
  // long: ts is filtered NOT NULL so plain DESC (index-friendly); per_room: keep NULLS LAST so a null ts never wins.
  const op = orderParts(detected.mode !== 'long');
  let text = `SELECT DISTINCT ON (${roomQ}) ${select} FROM ${from}`;
  if (where.length) text += ` WHERE ${where.join(' AND ')}`;
  text += ` ORDER BY ${roomQ}, ${op.join(', ')}`;
  return { text, values: [], windowed };
}

// ---------------------------------------------------------------------------
// Timestamp parsing for text / unknown ts columns (ts_raw). Never throws; NaN -> null.
// ---------------------------------------------------------------------------

function tzOffsetMs(tz, epochMs) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(epochMs))) p[part.type] = part.value;
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    return asUtc - Math.floor(epochMs / 1000) * 1000;
  } catch (e) {
    return 0;
  }
}

// Interpret a naive "YYYY-MM-DD HH:MM:SS" wall-clock string in `tz` (IANA name; default UTC).
function naiveToEpochMs(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/.exec(str);
  if (!m) return null;
  const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0), ms);
  if (!Number.isFinite(guess)) return null;
  // Reject impossible dates that Date.UTC would silently roll over (2026-02-30, 25:00).
  const d = new Date(guess);
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]) || d.getUTCHours() !== Number(m[4] || 0)) return null;
  const zone = safeTz(tz);
  if (zone === 'UTC') return guess;
  let epoch = guess - tzOffsetMs(zone, guess);
  epoch = guess - tzOffsetMs(zone, epoch); // second pass settles DST boundaries
  return epoch;
}

function parseTsRaw(raw, tz) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    let n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n > 1e14) n = n / 1000;
    else if (n <= 1e11) n = n * 1000;
    return Math.round(n);
  }
  // ISO-ish "YYYY-MM-DD[ HH:MM[:SS[.fff]]][Z|+HH[:MM]]": validate the fields ourselves (Date.parse rolls
  // 2026-02-30 over to March 2) and apply an explicit offset; no suffix means wall-clock time in `tz`.
  const iso = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(s);
  if (iso) {
    if (!iso[2]) return naiveToEpochMs(iso[1], tz);
    const base = naiveToEpochMs(iso[1], 'UTC');
    if (base == null) return null;
    if (/^z$/i.test(iso[2])) return base;
    const om = /^([+-])(\d{2}):?(\d{2})?$/.exec(iso[2]);
    const offset = (Number(om[2]) * 60 + Number(om[3] || 0)) * 60000 * (om[1] === '-' ? -1 : 1);
    return base - offset;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return null; // date-shaped but malformed: never guess
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// rowsToSnapshot(detected, rows, { now, staleMs, tz }) -> rooms
// ---------------------------------------------------------------------------

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'bigint') return Number(v);
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function emptyRoom(zone) {
  return {
    label: zone.label,
    type: zone.type,
    temperature: null,
    setLow: null,
    setHigh: null,
    limitsInvalid: false,
    alarm: false,
    offline: true,
    updatedAt: null,
  };
}

function finaliseRoom(room, now, staleMs) {
  const t = room.temperature;
  normaliseLimits(room);
  // A reading far in the FUTURE is as untrustworthy as one far in the past (clock skew / wrong tz):
  // it must not keep a dead sensor looking live.
  const stale = room.updatedAt != null && Number.isFinite(staleMs) && Math.abs(now - room.updatedAt) > staleMs;
  room.offline = t == null || stale;
  let alarm = false;
  if (t != null && !room.limitsInvalid) {
    if (room.setLow != null && t < room.setLow) alarm = true;
    if (room.setHigh != null && t > room.setHigh) alarm = true;
  }
  room.alarm = alarm;
  return room;
}

function rowTs(row, tz) {
  const ms = toNum(row.ts_ms);
  if (ms != null) return ms;
  return parseTsRaw(row.ts_raw, tz);
}

function rowsToSnapshot(detected, rows, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const staleMs = o.staleMs == null ? 600000 : Number(o.staleMs);
  const tz = o.tz;
  const mode = detected && detected.mode;

  const rooms = {};
  for (const z of ZONES) rooms[z.id] = emptyRoom(z);
  const unknownOrder = [];
  const unknown = {};
  const folded = {}; // zoneId -> { setLow, setHigh } from "<room> Set Low/High" rows

  const assign = (target, reading) => {
    // keep the newest timestamp; if no timestamps, last seen wins
    if (target.updatedAt != null && reading.updatedAt != null && reading.updatedAt < target.updatedAt) return;
    target.temperature = reading.temperature;
    target.setLow = reading.setLow;
    target.setHigh = reading.setHigh;
    target.updatedAt = reading.updatedAt;
  };

  const list = Array.isArray(rows) ? rows : [];
  if (mode === 'wide') {
    const row = list[0];
    if (row) {
      const ts = rowTs(row, tz);
      for (const zoneId of Object.values(detected.wideMap || {})) {
        if (!rooms[zoneId]) continue;
        assign(rooms[zoneId], {
          temperature: toNum(row[zoneId]),
          setLow: toNum(row[zoneId + '__low']),
          setHigh: toNum(row[zoneId + '__high']),
          updatedAt: ts,
        });
      }
    }
  } else {
    for (const row of list) {
      if (!row) continue;
      const raw = row.room;
      // The collector can log a room's SET LOW / SET HIGH as rows of their own. They are limits, not
      // temperatures: fold them into the room. Without this the loose zone match reads
      // "Frozen Room 1 Set High" as Frozen Room 1 and a limit can be shown as the temperature.
      const lim = RE_LIMIT_TAG.exec(String(raw == null ? '' : raw));
      if (lim) {
        const base = resolveZoneLoose(lim[1]);
        const v = toNum(row.temperature);
        if (base && v != null) {
          const slot = folded[base.id] || (folded[base.id] = { setLow: null, setHigh: null });
          if (lim[2].toLowerCase() === 'low') slot.setLow = v; else slot.setHigh = v;
          continue;
        }
      }
      const reading = {
        temperature: toNum(row.temperature),
        setLow: toNum(row.set_low),
        setHigh: toNum(row.set_high),
        updatedAt: rowTs(row, tz),
      };
      const zone = resolveZoneLoose(raw);
      if (zone) {
        assign(rooms[zone.id], reading);
      } else {
        const id = normaliseRoomKey(raw) || 'unknown';
        if (!unknown[id]) {
          unknown[id] = {
            label: raw == null || String(raw).trim() === '' ? 'Unknown' : String(raw),
            type: inferType(raw),
            temperature: null, setLow: null, setHigh: null, limitsInvalid: false, alarm: false, offline: true, updatedAt: null,
          };
          unknownOrder.push(id);
        }
        assign(unknown[id], reading);
      }
    }
  }

  // Folded limit rows are database values: they fill what the row itself did not carry, and being set
  // here they win over the operator file (applySetpoints only fills nulls).
  for (const id of Object.keys(folded)) {
    const room = rooms[id];
    if (!room) continue;
    if (room.setLow == null && folded[id].setLow != null) room.setLow = folded[id].setLow;
    if (room.setHigh == null && folded[id].setHigh != null) room.setHigh = folded[id].setHigh;
  }
  for (const id of Object.keys(rooms)) finaliseRoom(rooms[id], now, staleMs);
  for (const id of unknownOrder) {
    finaliseRoom(unknown[id], now, staleMs);
    rooms[rooms[id] ? `${id}_db` : id] = unknown[id];
  }
  return rooms;
}

// buildLimitsQuery(detected, { tz, tags }) -> { text, values } | null
// The collector logs each room's SET LOW / SET HIGH as rows of their own and writes them only when a limit
// changes, so they are configuration, not recent history: the newest row per limit tag is wanted however old
// it is, outside the tiered time windows. Long tables with a text room column and no set-point columns only.
// Index-friendly: `tag = ANY(...)` then the (tag, ts DESC) order the readings index already provides.
function buildLimitsQuery(detected, opts) {
  if (!detected || !detected.table || detected.mode !== 'long') return null;
  if (!detected.roomCol || !detected.tempCol) return null;
  if (detected.setLowCol || detected.setHighCol) return null;
  if (detected.roomJoin && detected.roomJoin.table) return null;
  const roomType = typeOf(detected, detected.roomCol);
  if (!(isTextType(roomType) || isUnknownType(roomType))) return null;
  const o = opts || {};
  const tz = safeTz(o.tz);
  const tags = Array.isArray(o.tags) && o.tags.length ? o.tags : limitTags();
  const schema = detected.schema || 'public';
  const from = `${quoteIdent(schema)}.${quoteIdent(detected.table)}`;
  const roomQ = quoteIdent(detected.roomCol);
  const temp = tempExprQ(quoteIdent(detected.tempCol), typeOf(detected, detected.tempCol));
  const tsType = detected.tsCol ? typeOf(detected, detected.tsCol) : null;
  const tsQ = detected.tsCol ? quoteIdent(detected.tsCol) : null;
  const tsMs = tsMsExprQ(tsQ, tsType, tz);
  const tsRaw = tsQ && !tsIsNative(tsType) ? (isTextType(tsType) ? tsQ : `${tsQ}::text`) : 'NULL::text';
  const tsOrder = tsOrderExprQ(tsQ, tsType);
  const order = [roomQ];
  if (tsOrder) order.push(`${tsOrder} DESC NULLS LAST`);
  if (detected.orderCol) order.push(`${quoteIdent(detected.orderCol)} DESC`);
  const select = `${roomQ}::text AS room, ${temp} AS temperature, NULL::float8 AS set_low, NULL::float8 AS set_high, ${tsMs} AS ts_ms, ${tsRaw} AS ts_raw`;
  const text = `/* limits */ SELECT DISTINCT ON (${roomQ}) ${select} FROM ${from} WHERE ${roomQ} = ANY($1::text[]) ORDER BY ${order.join(', ')}`;
  return { text, values: [tags] };
}

// The 32 limit tags the collector writes for the 16 zones ("Frozen Room 1 Set Low", ...).
function limitTags() {
  const out = [];
  for (const z of ZONES) out.push(`${z.label} Set Low`, `${z.label} Set High`);
  return out;
}

// missingZones(rows) -> ids of the canonical zones no long/per_room row resolves to (drives the tiered window).
function missingZones(rows) {
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const z = row && resolveZoneLoose(row.room);
    if (z) seen.add(z.id);
  }
  return ZONES.filter((z) => !seen.has(z.id)).map((z) => z.id);
}

// snapshotStats(rooms, { now, rowCount }) -> { resolvedZones, unknownRooms, futureSkewMs, warning }
const SKEW_WARN_MS = 5 * 60 * 1000;
function snapshotStats(rooms, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const zoneIds = new Set(ZONES.map((z) => z.id));
  let resolvedZones = 0;
  let futureSkewMs = 0;
  const unknownIds = [];
  for (const [id, r] of Object.entries(rooms || {})) {
    if (zoneIds.has(id)) { if (r.temperature != null) resolvedZones += 1; } else unknownIds.push(id);
    if (r.updatedAt != null && r.updatedAt - now > futureSkewMs) futureSkewMs = r.updatedAt - now;
  }
  const warnings = [];
  if (resolvedZones === 0 && unknownIds.length) {
    warnings.push(`No database room matched any of the 16 zones (${unknownIds.length} unknown room(s): ${unknownIds.slice(0, 6).join(', ')}${unknownIds.length > 6 ? ', ...' : ''}). Check the room naming or set PULSE_ROOM_COL / PULSE_WIDE_MAP.`);
  } else if (resolvedZones === 0 && o.rowCount === 0) {
    warnings.push('Query returned no rows.');
  }
  if (futureSkewMs > SKEW_WARN_MS) {
    warnings.push(`Readings are stamped up to ${Math.round(futureSkewMs / 60000)} min in the future: the DB timestamps are probably local wall-clock time. Set PULSE_TS_TZ (e.g. Asia/Kolkata).`);
  }
  return { resolvedZones, unknownRooms: unknownIds.length, futureSkewMs, warning: warnings.length ? warnings.join(' ') : null };
}

module.exports = {
  classifyColumn,
  analyseTable,
  rankTables,
  buildQuery,
  rowsToSnapshot,
  missingZones,
  snapshotStats,
  quoteIdent,
  resolveZoneLoose,
  pickNameColumn,
  pickSetpointColumns,
  parseWideMap,
  parseTsRaw,
  naiveToEpochMs,
  isNumericType,
  isIntegerType,
  isTimestampType,
  isTextType,
  isOpaqueType,
  tempExpr,
  tsMsExpr,
  PER_ROOM_LIMIT,
  buildLimitsQuery,
  limitTags,
};

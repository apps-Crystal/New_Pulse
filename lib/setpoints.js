// Operator-defined set-points (alarm limits) for the 16 zones.
//
// The plant database (public.readings: tag, value, ts) stores temperatures only; it has no low/high
// columns. Without limits the dashboard can never raise an alarm, so limits may be supplied by the
// operator through PULSE_SETPOINTS (env) or setpoints.json (file). Database columns, when a table has
// them, always win over these values.
//
// CommonJS on purpose (used by Next.js route handlers, lib/db.js and plain node scripts).
// Pure: no I/O except loadSetpointsFromEnv(), which reads exactly one file through an injectable reader.
//
// Exported API
//   parseSetpoints(input)                       -> { setpoints, warnings }
//   loadSetpointsFromEnv(env, { readFile, cwd }) -> { setpoints, source, path, warnings }
//   applySetpoints(rooms, setpoints)            -> rooms (mutated in place and returned)
//   normaliseEntry(value)                       -> { setLow, setHigh } | null      (helper, exported for tests)
//
// `setpoints` is always an object keyed by canonical zone id: { frozen_room_1: { setLow: -25, setHigh: -15 }, ... }.
// Type-wide defaults ("frozen", "chiller", "other") and the global default ("*" / "default" / "all") are
// expanded into every matching zone at parse time; an explicit zone entry overrides a type default, which
// overrides the global default. Unknown keys never throw: they are skipped and reported in `warnings`.

const { ZONES, resolveZone } = require('./zones');
const { normaliseLimits } = require('./limits');

const TYPE_KEYS = new Set(['frozen', 'chiller', 'other']);
const GLOBAL_KEYS = new Set(['*', 'default', 'defaults', 'all']);
const DEFAULT_FILE = './setpoints.json';

// ---------- value parsing ----------

// "-25" -> -25, 3 -> 3, "" / null / undefined -> null, anything else -> NaN (caller reports it).
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s === '-' || s.toLowerCase() === 'null') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  if (typeof v === 'boolean') return NaN;
  return NaN;
}

// Split a compact "low:high" / "low..high" range. Either side may be empty ("-25:" or ":8").
function splitRange(str) {
  const s = String(str).trim();
  if (s.includes('..')) {
    const i = s.indexOf('..');
    return [s.slice(0, i), s.slice(i + 2)];
  }
  const i = s.indexOf(':');
  if (i >= 0) return [s.slice(0, i), s.slice(i + 1)];
  return null;
}

// Normalise one entry value into { setLow, setHigh } (numbers or null).
// Accepts { low, high } / { setLow, setHigh } / { min, max } / [low, high] / "low:high" / "low..high".
// Returns null when the shape is not recognised; NaN inside the result signals a bad number.
function normaliseEntry(value) {
  if (value == null) return { setLow: null, setHigh: null };
  if (Array.isArray(value)) {
    if (value.length > 2) return null;
    return { setLow: toNumber(value[0]), setHigh: toNumber(value[1]) };
  }
  if (typeof value === 'string') {
    const parts = splitRange(value);
    if (!parts) return null;
    return { setLow: toNumber(parts[0]), setHigh: toNumber(parts[1]) };
  }
  if (typeof value === 'object') {
    const has = (k) => Object.prototype.hasOwnProperty.call(value, k);
    let lowKey = null;
    let highKey = null;
    for (const [l, h] of [['setLow', 'setHigh'], ['low', 'high'], ['min', 'max'], ['lo', 'hi'], ['set_low', 'set_high']]) {
      if (has(l) || has(h)) { lowKey = l; highKey = h; break; }
    }
    if (!lowKey) {
      // {} or a "_comment"-only object: an empty entry, not an error.
      const realKeys = Object.keys(value).filter((k) => !k.startsWith('_'));
      return realKeys.length === 0 ? { setLow: null, setHigh: null } : null;
    }
    return { setLow: toNumber(value[lowKey]), setHigh: toNumber(value[highKey]) };
  }
  return null;
}

// ---------- key classification ----------

// Returns { kind: 'global' } | { kind: 'type', type } | { kind: 'zone', id } | null.
function classifyKey(rawKey) {
  const key = String(rawKey == null ? '' : rawKey).trim();
  if (!key) return null;
  const lower = key.toLowerCase().replace(/[^a-z0-9*]/g, '');
  if (GLOBAL_KEYS.has(lower) || GLOBAL_KEYS.has(key)) return { kind: 'global' };
  if (TYPE_KEYS.has(lower)) return { kind: 'type', type: lower };
  const zone = resolveZone(key);
  if (zone) return { kind: 'zone', id: zone.id };
  return null;
}

// ---------- compact string ----------

// "frozen_room_1=-25:-15, chiller_room_1=0:8; dock=5..18"  -> plain object, ready for parseObject.
function parseCompact(str, warnings) {
  const out = {};
  const items = String(str).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq < 0) {
      warnings.push(`setpoints: cannot parse "${item}" (expected zone=low:high)`);
      continue;
    }
    const key = item.slice(0, eq).trim();
    const range = item.slice(eq + 1).trim();
    if (!splitRange(range)) {
      warnings.push(`setpoints: cannot parse "${item}" (expected zone=low:high)`);
      continue;
    }
    out[key] = range;
  }
  return out;
}

// ---------- object -> zone map ----------

function parseObject(obj, warnings) {
  const globalDefault = { setLow: null, setHigh: null };
  const typeDefaults = {};
  const explicit = {};

  for (const rawKey of Object.keys(obj)) {
    if (rawKey.startsWith('_')) continue; // "_comment" and friends
    const cls = classifyKey(rawKey);
    if (!cls) {
      warnings.push(`setpoints: unknown zone "${rawKey}" ignored`);
      continue;
    }
    const entry = normaliseEntry(obj[rawKey]);
    if (!entry) {
      warnings.push(`setpoints: unrecognised value for "${rawKey}" ignored (use {low, high}, [low, high] or "low:high")`);
      continue;
    }
    if (Number.isNaN(entry.setLow) || Number.isNaN(entry.setHigh)) {
      warnings.push(`setpoints: non-numeric limit for "${rawKey}" ignored`);
      continue;
    }
    if (entry.setLow != null && entry.setHigh != null && entry.setLow > entry.setHigh) {
      warnings.push(`setpoints: low ${entry.setLow} is above high ${entry.setHigh} for "${rawKey}"; entry ignored`);
      continue;
    }
    if (cls.kind === 'global') Object.assign(globalDefault, entry);
    else if (cls.kind === 'type') typeDefaults[cls.type] = Object.assign(typeDefaults[cls.type] || {}, entry);
    else explicit[cls.id] = Object.assign(explicit[cls.id] || {}, entry);
  }

  const hasGlobal = globalDefault.setLow != null || globalDefault.setHigh != null;
  const setpoints = {};
  for (const z of ZONES) {
    const merged = { setLow: null, setHigh: null };
    const layers = [hasGlobal ? globalDefault : null, typeDefaults[z.type] || null, explicit[z.id] || null];
    let touched = false;
    for (const layer of layers) {
      if (!layer) continue;
      touched = true;
      if (layer.setLow != null) merged.setLow = layer.setLow;
      if (layer.setHigh != null) merged.setHigh = layer.setHigh;
    }
    if (touched && (merged.setLow != null || merged.setHigh != null)) setpoints[z.id] = merged;
  }
  return setpoints;
}

// ---------- public: parse ----------

// parseSetpoints(input) -> { setpoints, warnings }
//   input: object keyed by zone id / alias / label / type / "*", a JSON string of that object, or a
//   compact string "zone=low:high,zone=low..high". Never throws.
function parseSetpoints(input) {
  const warnings = [];
  if (input == null) return { setpoints: {}, warnings };

  let obj = input;
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return { setpoints: {}, warnings };
    if (s[0] === '{' || s[0] === '[') {
      try {
        obj = JSON.parse(s);
      } catch (err) {
        warnings.push(`setpoints: invalid JSON (${err.message})`);
        return { setpoints: {}, warnings };
      }
    } else {
      obj = parseCompact(s, warnings);
    }
  }

  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    warnings.push('setpoints: expected an object keyed by zone');
    return { setpoints: {}, warnings };
  }
  return { setpoints: parseObject(obj, warnings), warnings };
}

// ---------- public: loader ----------

// loadSetpointsFromEnv(env = process.env, { readFile, cwd } = {})
//   -> { setpoints, source: 'env' | 'file' | 'none', path, warnings }
//   PULSE_SETPOINTS (compact or JSON) wins; else PULSE_SETPOINTS_FILE (default ./setpoints.json,
//   relative to cwd) if it exists; else none. Never throws.
//   readFile(absPath) -> string | null; may throw (ENOENT is treated as "no file").
function loadSetpointsFromEnv(env = process.env, opts = {}) {
  const warnings = [];
  const inline = env && typeof env.PULSE_SETPOINTS === 'string' ? env.PULSE_SETPOINTS.trim() : '';
  if (inline) {
    const r = parseSetpoints(inline);
    return { setpoints: r.setpoints, source: 'env', path: null, warnings: warnings.concat(r.warnings) };
  }

  const explicitFile = env && typeof env.PULSE_SETPOINTS_FILE === 'string' ? env.PULSE_SETPOINTS_FILE.trim() : '';
  const relPath = explicitFile || DEFAULT_FILE;
  const path = require('path');
  const cwd = opts.cwd || process.cwd();
  const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(cwd, relPath);
  const readFile = opts.readFile || ((p) => require('fs').readFileSync(p, 'utf8'));

  let text = null;
  try {
    text = readFile(absPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      text = null;
    } else {
      warnings.push(`setpoints: cannot read ${absPath} (${(err && err.message) || err})`);
      return { setpoints: {}, source: 'none', path: absPath, warnings };
    }
  }
  if (text == null) {
    if (explicitFile) warnings.push(`setpoints: PULSE_SETPOINTS_FILE=${explicitFile} not found (${absPath})`);
    return { setpoints: {}, source: 'none', path: absPath, warnings };
  }
  if (typeof text !== 'string') text = String(text);
  if (!text.trim()) return { setpoints: {}, source: 'none', path: absPath, warnings };

  const r = parseSetpoints(text);
  return { setpoints: r.setpoints, source: 'file', path: absPath, warnings: warnings.concat(r.warnings) };
}

// ---------- public: apply ----------

function alarmFor(room) {
  const t = room.temperature;
  if (t == null || room.limitsInvalid) return false;
  if (room.setLow != null && t < room.setLow) return true;
  if (room.setHigh != null && t > room.setHigh) return true;
  return false;
}

// applySetpoints(rooms, setpoints) -> rooms
//   rooms: the snapshot's `rooms` object ({ zoneId: room }) or an array of rooms carrying an `id`.
//   For each room whose setLow / setHigh is null, fills it from setpoints[zoneId], else from a type default
//   (setpoints.frozen / chiller / other) or a global default (setpoints['*']) when such keys are present.
//   Limits already on the room (from database columns) are never overwritten.
//   Recomputes room.alarm for every room so the flag is consistent with the limits shown. Mutates and returns rooms.
function applySetpoints(rooms, setpoints) {
  if (!rooms) return rooms;
  const sp = setpoints && typeof setpoints === 'object' ? setpoints : {};
  const entries = Array.isArray(rooms)
    ? rooms.map((r) => [r && r.id, r])
    : Object.keys(rooms).map((id) => [id, rooms[id]]);

  for (const [id, room] of entries) {
    if (!room || typeof room !== 'object') continue;
    const entry = (id && sp[id]) || (room.type && sp[room.type]) || sp['*'] || sp.default || null;
    if (entry) {
      let filled = false;
      if (room.setLow == null && entry.setLow != null && Number.isFinite(entry.setLow)) { room.setLow = entry.setLow; filled = true; }
      if (room.setHigh == null && entry.setHigh != null && Number.isFinite(entry.setHigh)) { room.setHigh = entry.setHigh; filled = true; }
      // A band seeded from a database snapshot arrives already corrected; keep the mark that says so.
      if (filled && entry.limitsSwapped) room.limitsSwapped = true;
    }
    // Filled limits follow the same band rules as limits read with the row (equal = none, inverted = flagged).
    normaliseLimits(room);
    room.alarm = alarmFor(room);
  }
  return rooms;
}

module.exports = { parseSetpoints, loadSetpointsFromEnv, applySetpoints, normaliseEntry, DEFAULT_FILE };

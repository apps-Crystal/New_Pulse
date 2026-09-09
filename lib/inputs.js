// The panel's INPUT screen as the collector sends it: [{ tag, value, ts }] with value 1 = ON (green on the
// panel) and 0 = OFF (grey). Wiring as found on this plant: a door contact is ON while the door is open;
// the panic buttons and the phase preventer are normally-closed circuits, so ON is the healthy state and
// OFF means pressed / phase fault. Both readings are overridable at build time.
//
// Pure and isomorphic: used by the browser (live path), the route handlers (database path) and the tests.

const { ZONES, resolveZone } = require('./zones');

const DOOR_OPEN_VALUE = envInt('NEXT_PUBLIC_DOOR_OPEN_VALUE', 1);
const PANIC_PRESSED_VALUE = envInt('NEXT_PUBLIC_PANIC_PRESSED_VALUE', 0);
const PHASE_OK_VALUE = envInt('NEXT_PUBLIC_PHASE_OK_VALUE', 1);

function envInt(name, fallback) {
  const raw = typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) ? n : fallback;
}

const RE_DOOR = /^(.*?)\s+door(?:\s*(\d+))?$/i;
const RE_PANIC = /^panic\s*button\s*(\d+)$/i;
const RE_PHASE = /^phase\s*preventer$/i;

function toMs(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : fallback;
}

function toState(v) {
  if (v === 1 || v === '1' || v === true) return 1;
  if (v === 0 || v === '0' || v === false) return 0;
  const n = Number(v);
  return n === 1 ? 1 : n === 0 ? 0 : null;
}

// Loose zone match for the room part of a door tag ("Chiller Room 1", "Frozen Anteroom").
function zoneFor(name) {
  const direct = resolveZone(name);
  if (direct) return direct;
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ZONES.find((z) => z.id.replace(/_/g, '') === key || z.label.toLowerCase().replace(/[^a-z0-9]/g, '') === key) || null;
}

/**
 * classifyInputs(inputs, now) -> { doors: { zoneId: [{ tag, label, open, value, ts }] }, panic: [...],
 *   phase: { ok, value, ts } | null, other: [{ tag, value, ts }], anyDoorOpen, anyPanic }
 */
function classifyInputs(inputs, now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const doors = {};
  const panic = [];
  const other = [];
  let phase = null;
  for (const raw of Array.isArray(inputs) ? inputs : []) {
    if (!raw || typeof raw.tag !== 'string') continue;
    const tag = raw.tag.trim();
    const value = toState(raw.value);
    if (value == null) continue;
    const ts = toMs(raw.ts, t);
    let m;
    if ((m = RE_PANIC.exec(tag))) {
      panic.push({ n: Number(m[1]), tag, pressed: value === PANIC_PRESSED_VALUE, value, ts });
    } else if (RE_PHASE.test(tag)) {
      phase = { tag, ok: value === PHASE_OK_VALUE, value, ts };
    } else if ((m = RE_DOOR.exec(tag))) {
      const zone = zoneFor(m[1]);
      const label = m[2] ? `Door ${Number(m[2])}` : 'Door';
      const entry = { tag, label, open: value === DOOR_OPEN_VALUE, value, ts, room: m[1].trim() };
      const key = zone ? zone.id : `unknown:${m[1].trim().toLowerCase()}`;
      (doors[key] || (doors[key] = [])).push(entry);
    } else {
      other.push({ tag, value, ts });
    }
  }
  panic.sort((a, b) => a.n - b.n);
  for (const k of Object.keys(doors)) doors[k].sort((a, b) => a.label.localeCompare(b.label));
  return {
    doors,
    panic,
    phase,
    other,
    anyDoorOpen: Object.values(doors).some((list) => list.some((d) => d.open)),
    anyPanic: panic.some((p) => p.pressed),
  };
}

module.exports = { classifyInputs, DOOR_OPEN_VALUE, PANIC_PRESSED_VALUE, PHASE_OK_VALUE };

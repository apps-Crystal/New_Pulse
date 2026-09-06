// Canonical list of the 16 Crystal cold-storage zones, in display order.
// `aliases` are normalised forms (lowercase, non-alphanumerics stripped) that a database
// room identifier may take. Matching is done via resolveZone().
// CommonJS on purpose: used by Next.js route handlers AND plain `node scripts/*.js`.

const ZONES = [
  { id: 'frozen_room_1',    label: 'Frozen Room 1',    type: 'frozen',  aliases: ['frozenroom1', 'frozen1', 'fr1', 'freezer1', 'freezerroom1', 'fz1', 'f1'] },
  { id: 'frozen_room_2',    label: 'Frozen Room 2',    type: 'frozen',  aliases: ['frozenroom2', 'frozen2', 'fr2', 'freezer2', 'freezerroom2', 'fz2', 'f2'] },
  { id: 'frozen_room_3',    label: 'Frozen Room 3',    type: 'frozen',  aliases: ['frozenroom3', 'frozen3', 'fr3', 'freezer3', 'freezerroom3', 'fz3', 'f3'] },
  { id: 'frozen_room_4',    label: 'Frozen Room 4',    type: 'frozen',  aliases: ['frozenroom4', 'frozen4', 'fr4', 'freezer4', 'freezerroom4', 'fz4', 'f4'] },
  { id: 'frozen_room_5',    label: 'Frozen Room 5',    type: 'frozen',  aliases: ['frozenroom5', 'frozen5', 'fr5', 'freezer5', 'freezerroom5', 'fz5', 'f5'] },
  { id: 'frozen_anteroom',  label: 'Frozen Anteroom',  type: 'frozen',  aliases: ['frozenanteroom', 'frozenante', 'frozenanti', 'frozenantiroom', 'fanteroom', 'anteroomfrozen', 'freezeranteroom', 'frozenlobby'] },
  { id: 'chiller_room_1',   label: 'Chiller Room 1',   type: 'chiller', aliases: ['chillerroom1', 'chiller1', 'cr1', 'chill1', 'chillroom1', 'ch1', 'c1'] },
  { id: 'chiller_room_2',   label: 'Chiller Room 2',   type: 'chiller', aliases: ['chillerroom2', 'chiller2', 'cr2', 'chill2', 'chillroom2', 'ch2', 'c2'] },
  { id: 'chiller_room_3',   label: 'Chiller Room 3',   type: 'chiller', aliases: ['chillerroom3', 'chiller3', 'cr3', 'chill3', 'chillroom3', 'ch3', 'c3'] },
  { id: 'chiller_room_4',   label: 'Chiller Room 4',   type: 'chiller', aliases: ['chillerroom4', 'chiller4', 'cr4', 'chill4', 'chillroom4', 'ch4', 'c4'] },
  { id: 'chiller_room_5',   label: 'Chiller Room 5',   type: 'chiller', aliases: ['chillerroom5', 'chiller5', 'cr5', 'chill5', 'chillroom5', 'ch5', 'c5'] },
  { id: 'chiller_room_6',   label: 'Chiller Room 6',   type: 'chiller', aliases: ['chillerroom6', 'chiller6', 'cr6', 'chill6', 'chillroom6', 'ch6', 'c6'] },
  { id: 'chiller_anteroom', label: 'Chiller Anteroom', type: 'chiller', aliases: ['chilleranteroom', 'chillerante', 'chilleranti', 'chillerantiroom', 'canteroom', 'anteroomchiller', 'chillanteroom', 'chillerlobby'] },
  { id: 'blast_freezer_1',  label: 'Blast Freezer 1',  type: 'frozen',  aliases: ['blastfreezer1', 'blast1', 'bf1', 'blastfreezerroom1', 'blaster1'] },
  { id: 'blast_freezer_2',  label: 'Blast Freezer 2',  type: 'frozen',  aliases: ['blastfreezer2', 'blast2', 'bf2', 'blastfreezerroom2', 'blaster2'] },
  { id: 'dock_area',        label: 'Dock Area',        type: 'other',   aliases: ['dockarea', 'dock', 'loadingdock', 'dockroom', 'loadingbay', 'dockzone'] },
];

// Lowercase, strip everything that isn't a letter or digit. "Frozen Room-1" -> "frozenroom1".
function normaliseRoomKey(value) {
  if (value == null) return '';
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Lookup: normalised alias -> zone. Includes id, label, and explicit aliases.
const ALIAS_INDEX = new Map();
for (const z of ZONES) {
  for (const a of [z.id, z.label, ...z.aliases]) {
    ALIAS_INDEX.set(normaliseRoomKey(a), z);
  }
}

// Resolve a raw DB room identifier to a canonical zone, or null if unknown.
// Numeric 1..16 map to the zones in display order (TEMP-1 rows then TEMP-2 rows).
function resolveZone(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' || /^\s*\d+\s*$/.test(String(raw))) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= ZONES.length) return ZONES[n - 1];
    return null;
  }
  const key = normaliseRoomKey(raw);
  if (!key) return null;
  if (ALIAS_INDEX.has(key)) return ALIAS_INDEX.get(key);
  // Tolerate prefixes/suffixes such as "temp_frozen_room_1", "frozen_room_1_actual", "Frozen Room 1 (degC)".
  // Longest alias wins so "chiller_anteroom" beats "chiller_room_1"-style partials.
  let best = null;
  for (const [alias, zone] of ALIAS_INDEX) {
    if (alias.length < 4) continue; // too short to trust as a substring match
    if (key.includes(alias) && (!best || alias.length > best.alias.length)) best = { alias, zone };
  }
  return best ? best.zone : null;
}

// Guess a type for an unknown room name so its card still gets a sensible colour.
function inferType(raw) {
  const k = normaliseRoomKey(raw);
  if (/frozen|freez|blast|fz/.test(k)) return 'frozen';
  if (/chill|cool|cr\d/.test(k)) return 'chiller';
  return 'other';
}

module.exports = { ZONES, normaliseRoomKey, resolveZone, inferType };

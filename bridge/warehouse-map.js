// Warehouse map for the Crystal cold-storage HMI at 192.168.0.51 (WECON LAN monitor).
// 16 zones spread across two temperature screens. Each numeric value on a screen is mapped
// to (zone, column) by its on-screen position: nearest column x + nearest room row top.
//
// Columns (x anchors, from the header labels): ACTUAL≈261, SET LOW≈456, SET HIGH≈655.
// Screen 1 = TEMP-1 (nav button y≈180), Screen 2 = TEMP-2 (nav button y≈255).

const COLUMNS = [
  { key: 'actual', x: 261 },
  { key: 'setLow', x: 456 },
  { key: 'setHigh', x: 655 },
];

// type drives card colour + fallback classification: frozen (sky), chiller (emerald), other.
const ZONES = [
  // ---- Screen 1 / TEMP-1 ----
  { id: 'frozen_room_1',   label: 'Frozen Room 1',   type: 'frozen',  screen: 'temp1', row: 171 },
  { id: 'frozen_room_2',   label: 'Frozen Room 2',   type: 'frozen',  screen: 'temp1', row: 221 },
  { id: 'frozen_room_3',   label: 'Frozen Room 3',   type: 'frozen',  screen: 'temp1', row: 271 },
  { id: 'frozen_room_4',   label: 'Frozen Room 4',   type: 'frozen',  screen: 'temp1', row: 324 },
  { id: 'frozen_room_5',   label: 'Frozen Room 5',   type: 'frozen',  screen: 'temp1', row: 373 },
  { id: 'frozen_anteroom', label: 'Frozen Anteroom', type: 'frozen',  screen: 'temp1', row: 425 },
  { id: 'chiller_room_1',  label: 'Chiller Room 1',  type: 'chiller', screen: 'temp1', row: 475 },
  { id: 'chiller_room_2',  label: 'Chiller Room 2',  type: 'chiller', screen: 'temp1', row: 526 },
  // ---- Screen 2 / TEMP-2 ----
  { id: 'chiller_room_3',   label: 'Chiller Room 3',   type: 'chiller', screen: 'temp2', row: 169 },
  { id: 'chiller_room_4',   label: 'Chiller Room 4',   type: 'chiller', screen: 'temp2', row: 223 },
  { id: 'chiller_room_5',   label: 'Chiller Room 5',   type: 'chiller', screen: 'temp2', row: 273 },
  { id: 'chiller_room_6',   label: 'Chiller Room 6',   type: 'chiller', screen: 'temp2', row: 319 },
  { id: 'chiller_anteroom', label: 'Chiller Anteroom', type: 'chiller', screen: 'temp2', row: 372 },
  { id: 'blast_freezer_1',  label: 'Blast Freezer 1',  type: 'frozen',  screen: 'temp2', row: 424 },
  { id: 'blast_freezer_2',  label: 'Blast Freezer 2',  type: 'frozen',  screen: 'temp2', row: 481 },
  { id: 'dock_area',        label: 'Dock Area',        type: 'other',   screen: 'temp2', row: 525 },
];

// Nav button click targets (HMI logical coords). x≈930 hits the right-side sidebar.
const NAV = {
  main:      { x: 930, y: 105 },
  temp1:     { x: 930, y: 180 },
  temp2:     { x: 930, y: 255 },
  input:     { x: 930, y: 330 },
  output:    { x: 930, y: 400 },
  alarm:     { x: 930, y: 480 },
  alarmHist: { x: 930, y: 550 },
};

// Tolerances for mapping a numeric part to a column / row.
const COLUMN_TOLERANCE = 130; // px around a column x
const ROW_TOLERANCE = 45;     // px around a room row top

function nearestColumn(left) {
  let best = null, bestD = Infinity;
  for (const c of COLUMNS) {
    const d = Math.abs(left - c.x);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= COLUMN_TOLERANCE ? best.key : null;
}

function nearestZone(screen, top) {
  let best = null, bestD = Infinity;
  for (const z of ZONES) {
    if (z.screen !== screen) continue;
    const d = Math.abs(top - z.row);
    if (d < bestD) { bestD = d; best = z; }
  }
  return bestD <= ROW_TOLERANCE ? best.id : null;
}

module.exports = { ZONES, COLUMNS, NAV, nearestColumn, nearestZone };

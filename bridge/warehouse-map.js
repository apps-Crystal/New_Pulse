// Warehouse map for the Crystal cold-storage HMI at 192.168.0.51 (WECON LAN monitor).
// 16 zones across two temperature screens. The HMI overlays live values as HTML elements;
// the headless engine reads them from the DOM and maps each to (zone, column) by its
// on-screen CENTRE position (viewport locked to 1024x768). Coordinates below are the
// measured pixel positions of the value cells.

// Value columns by pixel x-centre.
const COLUMNS = [
  { key: 'actual', x: 325 },
  { key: 'setLow', x: 525 },
  { key: 'setHigh', x: 724 },
];

// The 8 table rows (pixel y-centre), top to bottom — identical layout on both temp screens.
const ROW_Y = [231, 296, 362, 427, 492, 557, 623, 688];

// type drives card colour: frozen (sky), chiller (emerald), other.
const ZONES = [
  // ---- Screen 1 / TEMP-1 (rows 0..7) ----
  { id: 'frozen_room_1',   label: 'Frozen Room 1',   type: 'frozen',  screen: 'temp1', row: ROW_Y[0] },
  { id: 'frozen_room_2',   label: 'Frozen Room 2',   type: 'frozen',  screen: 'temp1', row: ROW_Y[1] },
  { id: 'frozen_room_3',   label: 'Frozen Room 3',   type: 'frozen',  screen: 'temp1', row: ROW_Y[2] },
  { id: 'frozen_room_4',   label: 'Frozen Room 4',   type: 'frozen',  screen: 'temp1', row: ROW_Y[3] },
  { id: 'frozen_room_5',   label: 'Frozen Room 5',   type: 'frozen',  screen: 'temp1', row: ROW_Y[4] },
  { id: 'frozen_anteroom', label: 'Frozen Anteroom', type: 'frozen',  screen: 'temp1', row: ROW_Y[5] },
  { id: 'chiller_room_1',  label: 'Chiller Room 1',  type: 'chiller', screen: 'temp1', row: ROW_Y[6] },
  { id: 'chiller_room_2',  label: 'Chiller Room 2',  type: 'chiller', screen: 'temp1', row: ROW_Y[7] },
  // ---- Screen 2 / TEMP-2 (rows 0..7) ----
  { id: 'chiller_room_3',   label: 'Chiller Room 3',   type: 'chiller', screen: 'temp2', row: ROW_Y[0] },
  { id: 'chiller_room_4',   label: 'Chiller Room 4',   type: 'chiller', screen: 'temp2', row: ROW_Y[1] },
  { id: 'chiller_room_5',   label: 'Chiller Room 5',   type: 'chiller', screen: 'temp2', row: ROW_Y[2] },
  { id: 'chiller_room_6',   label: 'Chiller Room 6',   type: 'chiller', screen: 'temp2', row: ROW_Y[3] },
  { id: 'chiller_anteroom', label: 'Chiller Anteroom', type: 'chiller', screen: 'temp2', row: ROW_Y[4] },
  { id: 'blast_freezer_1',  label: 'Blast Freezer 1',  type: 'frozen',  screen: 'temp2', row: ROW_Y[5] },
  { id: 'blast_freezer_2',  label: 'Blast Freezer 2',  type: 'frozen',  screen: 'temp2', row: ROW_Y[6] },
  { id: 'dock_area',        label: 'Dock Area',        type: 'other',   screen: 'temp2', row: ROW_Y[7] },
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

const COLUMN_TOLERANCE = 90; // px around a column x
const ROW_TOLERANCE = 28;    // px around a row y-centre

function nearestColumn(x) {
  let best = null, bestD = Infinity;
  for (const c of COLUMNS) { const d = Math.abs(x - c.x); if (d < bestD) { bestD = d; best = c; } }
  return bestD <= COLUMN_TOLERANCE ? best.key : null;
}

function nearestZone(screen, y) {
  let best = null, bestD = Infinity;
  for (const z of ZONES) { if (z.screen !== screen) continue; const d = Math.abs(y - z.row); if (d < bestD) { bestD = d; best = z; } }
  return bestD <= ROW_TOLERANCE ? best.id : null;
}

module.exports = { ZONES, COLUMNS, ROW_Y, NAV, nearestColumn, nearestZone };

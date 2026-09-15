// Shapes for the archived daily reports (tables written by the collector's report agent). Pure and
// isomorphic: the database side lives in lib/db.js, the PDF in lib/report-pdf.js.
const { ZONES } = require('./zones');

const ORDER = new Map(ZONES.map((z, i) => [z.id, i]));

/** Display order: the 16 zones as on the dashboard, anything else (unlisted tags) after them. */
function sortReports(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ia = ORDER.has(a.zone_id) ? ORDER.get(a.zone_id) : 100;
    const ib = ORDER.has(b.zone_id) ? ORDER.get(b.zone_id) : 100;
    return ia - ib || String(a.label).localeCompare(String(b.label));
  });
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/** A daily_reports row -> what the Reports page shows per zone. */
function shapeReportSummary(r) {
  return {
    id: r.zone_id,
    label: r.label,
    type: r.type,
    day: r.day,
    limitLow: num(r.limit_low),
    limitHigh: num(r.limit_high),
    readings: Number(r.readings) || 0,
    slotsWithData: Number(r.slots_with_data) || 0,
    slots: Number(r.slots) || 0,
    lowest: num(r.lowest),
    lowestAt: iso(r.lowest_at),
    highest: num(r.highest),
    highestAt: iso(r.highest_at),
    average: num(r.average),
    stdDev: num(r.std_dev),
    mkt: num(r.mkt),
    lowerStatus: r.lower_status || 'n/a',
    upperStatus: r.upper_status || 'n/a',
    lowerMinutes: num(r.lower_minutes) || 0,
    upperMinutes: num(r.upper_minutes) || 0,
    lowerOccurrences: Number(r.lower_occurrences) || 0,
    upperOccurrences: Number(r.upper_occurrences) || 0,
    gapMinutes: Number(r.gap_minutes) || 0,
    doorEvents: Number(r.door_events) || 0,
    operational: r.operational == null ? null : r.operational !== false,
    sensorFault: r.sensor_fault === true,
    note: r.note || null,
    generatedAt: iso(r.generated_at),
  };
}

module.exports = { sortReports, shapeReportSummary };

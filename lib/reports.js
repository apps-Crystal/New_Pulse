// Archived daily reports, built on the fly from the 5-minute rows (daily_samples) the collector's report
// agent keeps: zone identity and fixed alarm band from lib/zones + lib/limits, statistics from
// lib/report-stats. Pure and isomorphic; the database side lives in lib/db.js, the PDF in lib/report-pdf.js.
const { ZONES } = require('./zones');
const { fixedLimitsFor } = require('./limits');
const { dayStats } = require('./report-stats');

const ORDER = new Map(ZONES.map((z, i) => [z.id, i]));

function typeLabel(zone) {
  if (/_anteroom$/.test(zone.id)) return 'Anteroom';
  if (/^blast_freezer/.test(zone.id)) return 'Blast freezer';
  if (zone.type === 'frozen') return 'Frozen room';
  if (zone.type === 'chiller') return 'Chilled room';
  return zone.id.startsWith('unlisted_') ? 'Unlisted' : 'Other area';
}

/** Zone identity and band for a daily_samples zone_id; ids outside the 16 zones are "unlisted". */
function zoneInfo(zoneId) {
  const z = ZONES.find((x) => x.id === zoneId);
  if (z) {
    const f = fixedLimitsFor(z.id, z.type);
    const zone = { id: z.id, label: z.label, type: z.type, limits: f ? { low: f.setLow, high: f.setHigh } : null };
    zone.typeLabel = typeLabel(zone);
    return zone;
  }
  const raw = String(zoneId).replace(/^unlisted_/, '');
  const label = raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || String(zoneId);
  const zone = { id: String(zoneId), label, type: 'other', limits: null };
  zone.typeLabel = typeLabel(zone);
  return zone;
}

/** Display order: the 16 zones as on the dashboard, anything else after them. */
function sortZoneIds(ids) {
  return [...ids].sort((a, b) => {
    const ia = ORDER.has(a) ? ORDER.get(a) : 100;
    const ib = ORDER.has(b) ? ORDER.get(b) : 100;
    return ia - ib || String(a).localeCompare(String(b));
  });
}

/**
 * samplesByZone: Map zone_id -> daily_samples rows. Returns one report per zone, in display order:
 * { day, zone, samples (sorted by slot), stats }.
 */
function buildZoneReports(day, samplesByZone, { intervalMin = 5 } = {}) {
  const ids = sortZoneIds([...(samplesByZone ? samplesByZone.keys() : [])]);
  return ids.map((id) => {
    const zone = zoneInfo(id);
    const samples = [...samplesByZone.get(id)].sort((a, b) => Number(a.slot) - Number(b.slot));
    return { day, zone, samples, stats: dayStats(samples, zone.limits, { intervalMin }) };
  });
}

/** A zone report -> what the Reports page shows per zone. */
function shapeReportSummary(zr) {
  const s = zr.stats;
  return {
    id: zr.zone.id,
    label: zr.zone.label,
    type: zr.zone.type,
    day: zr.day,
    limitLow: zr.zone.limits ? zr.zone.limits.low : null,
    limitHigh: zr.zone.limits ? zr.zone.limits.high : null,
    readings: s.readings,
    slotsWithData: s.slotsWithData,
    slots: s.slots,
    lowest: s.lowest,
    lowestAt: s.lowestAt,
    highest: s.highest,
    highestAt: s.highestAt,
    average: s.average,
    stdDev: s.stdDev,
    mkt: s.mkt,
    lowerStatus: s.lower.status,
    upperStatus: s.upper.status,
    lowerMinutes: s.lower.minutes,
    upperMinutes: s.upper.minutes,
    lowerOccurrences: s.lower.occurrences,
    upperOccurrences: s.upper.occurrences,
    gapMinutes: s.gapMinutes,
    doorEvents: s.doorEvents,
  };
}

module.exports = { zoneInfo, sortZoneIds, buildZoneReports, shapeReportSummary, typeLabel };

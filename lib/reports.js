// Archived daily reports, built on the fly from what the collector's report agent keeps of a past day:
// the 5-minute rows (daily_samples) and the per-input door / panic / phase summaries (daily_doors).
// Zone identity and fixed alarm band from lib/zones + lib/limits, statistics from lib/report-stats.
// Pure and isomorphic; the database side lives in lib/db.js, the PDF in lib/report-pdf.js.
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

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** "Chiller Room 1 Door 2" -> "Door 2"; "Frozen Anteroom Door" -> "Door"; a panic button keeps its name. */
function doorName(tag) {
  const m = /\b(Door(?:\s+\d+)?)$/i.exec(String(tag || ''));
  return m ? m[1] : String(tag || '');
}

/** A daily_doors row -> the shape the page and the PDF use. */
function shapeDoor(r) {
  const events = Array.isArray(r.long_events) ? r.long_events : [];
  return {
    tag: r.tag,
    name: doorName(r.tag),
    kind: r.kind || 'door',
    zoneId: r.zone_id || null,
    thresholdSec: num(r.threshold_sec),
    opens: num(r.opens),
    openMinutes: num(r.open_minutes),
    okOpens: num(r.ok_opens),
    okMinutes: num(r.ok_minutes),
    longOpens: num(r.long_opens),
    longMinutes: num(r.long_minutes),
    longestSec: num(r.longest_sec),
    openAtStart: r.open_at_start === true,
    openAtEnd: r.open_at_end === true,
    longEvents: events.map((e) => ({ at: e.at || null, minutes: num(e.minutes), until: e.until || null, ongoing: e.ongoing === true })),
  };
}

/**
 * samplesByZone: Map zone_id -> daily_samples rows; doors: daily_doors rows of the day (optional).
 * Returns one report per zone, in display order: { day, zone, samples (sorted by slot), stats, doors }.
 */
function buildZoneReports(day, samplesByZone, { intervalMin = 5, doors = [] } = {}) {
  const ids = sortZoneIds([...(samplesByZone ? samplesByZone.keys() : [])]);
  const shaped = (doors || []).map(shapeDoor);
  return ids.map((id) => {
    const zone = zoneInfo(id);
    const samples = [...samplesByZone.get(id)].sort((a, b) => Number(a.slot) - Number(b.slot));
    const zoneDoors = shaped.filter((d) => d.kind === 'door' && d.zoneId === id).sort((a, b) => a.tag.localeCompare(b.tag));
    return { day, zone, samples, stats: dayStats(samples, zone.limits, { intervalMin }), doors: zoneDoors };
  });
}

/** The day's non-door inputs (panic buttons, phase preventer) and the long door openings across all zones. */
function buildInputsSummary(doors = [], zoneReports = []) {
  const shaped = (doors || []).map(shapeDoor);
  const labelOf = new Map(zoneReports.map((zr) => [zr.zone.id, zr.zone.label]));
  const longOpenings = [];
  for (const d of shaped) {
    if (d.kind !== 'door') continue;
    for (const e of d.longEvents) longOpenings.push({ zoneId: d.zoneId, zone: labelOf.get(d.zoneId) || zoneInfo(d.zoneId || '').label, door: d.name, at: e.at, until: e.until, minutes: e.minutes, ongoing: e.ongoing });
  }
  longOpenings.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return {
    panic: shaped.filter((d) => d.kind === 'panic'),
    phase: shaped.filter((d) => d.kind === 'phase'),
    other: shaped.filter((d) => !['door', 'panic', 'phase'].includes(d.kind)),
    longOpenings,
  };
}

/** A zone report -> what the Reports page shows per zone. */
function shapeReportSummary(zr) {
  const s = zr.stats;
  const doors = zr.doors || [];
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
    doors,
    doorOpens: doors.reduce((n, d) => n + d.opens, 0),
    doorOpenMinutes: Math.round(doors.reduce((n, d) => n + d.openMinutes, 0) * 10) / 10,
    doorLongOpens: doors.reduce((n, d) => n + d.longOpens, 0),
    doorLongMinutes: Math.round(doors.reduce((n, d) => n + d.longMinutes, 0) * 10) / 10,
  };
}

module.exports = { zoneInfo, sortZoneIds, buildZoneReports, buildInputsSummary, shapeReportSummary, shapeDoor, doorName, typeLabel };

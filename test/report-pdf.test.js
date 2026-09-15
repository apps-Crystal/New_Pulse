const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { renderDayPdf, reportFileName, fmtElapsed, fmtDT, fmtLongDay, clean } = require('../lib/report-pdf');
const { LOGO_PNG_BASE64 } = require('../lib/report-logo');

const DAY = '2026-09-14';
const DAY_START = Date.UTC(2026, 8, 13, 18, 30, 0); // 00:00 IST

function reportRow(over = {}) {
  return {
    day: DAY, zone_id: 'chiller_room_2', tag: 'Chiller Room 2', label: 'Chiller Room 2', type: 'chiller', tz_offset_min: 330, interval_min: 5,
    limit_low: 2, limit_high: 4, readings: 1319, last_reading_id: 226925, first_reading: new Date(DAY_START + 15771), last_reading: new Date(DAY_START + 1439 * 60000),
    elapsed_min: 1440, nominal_gap_sec: 68, slots: 288, slots_with_data: 286,
    lowest: -1.1, lowest_at: new Date(DAY_START + 200 * 60000), highest: 2.5, highest_at: new Date(DAY_START + 700 * 60000), average: 0.76, std_dev: 0.78, mkt: 0.79,
    lower_status: 'fail', lower_triggered: new Date(DAY_START + 15771), lower_minutes: 1233.1, lower_occurrences: 3, lower_deg_minutes: 1350.49,
    upper_status: 'ok', upper_triggered: null, upper_minutes: 0, upper_occurrences: 0, upper_deg_minutes: 0,
    not_in_alert_min: 188.5, gap_minutes: 18, gaps: [{ from: new Date(DAY_START + 900 * 60000).toISOString(), to: new Date(DAY_START + 918 * 60000).toISOString(), minutes: 18 }],
    door_events: 536, operational: false, sensor_fault: false, note: null, raw_deleted_at: new Date(), generated_at: new Date(),
    ...over,
  };
}
function samplesFor(zoneId, { withEvents = true } = {}) {
  const out = [];
  for (let k = 0; k < 288; k += 1) {
    const gap = k === 181 || k === 182;
    out.push({ zone_id: zoneId, slot: k * 5, ts: new Date(DAY_START + k * 5 * 60000), avg_temp: gap ? null : 0.5 + Math.sin(k / 20), min_temp: gap ? null : 0.3 + Math.sin(k / 20), max_temp: gap ? null : 0.9 + Math.sin(k / 20), readings: gap ? 0 : 5, events: withEvents && k % 40 === 8 ? '00:42 Door opened; 00:42 Door closed (open 7 s)' : null });
  }
  return out;
}

test('report-pdf: one zone renders a summary page, three table pages and a statistics page, with the logo', async () => {
  const bytes = await renderDayPdf({ day: DAY, reports: [reportRow()], samplesByZone: new Map([['chiller_room_2', samplesFor('chiller_room_2')]]), logoPng: Buffer.from(LOGO_PNG_BASE64, 'base64'), generatedAt: new Date(Date.UTC(2026, 8, 15, 7, 0, 0)) });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 5);
  assert.equal(doc.getTitle(), 'Crystal Group - Daily Temperature Report - Chiller Room 2 - 14-09-2026');
  assert.equal(doc.getAuthor(), 'Crystal Group');
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(Math.round(width), 595);
  assert.equal(Math.round(height), 842);
  assert.ok(bytes.length > 20000 && bytes.length < 600000, `size ${bytes.length}`);
});

test('report-pdf: all zones get a cover page first; unusual text and empty days do not break the render', async () => {
  const a = reportRow();
  const b = reportRow({ zone_id: 'dock_area', tag: 'Dock Area', label: 'Dock Area', type: 'other', limit_low: null, limit_high: null, lower_status: 'n/a', upper_status: 'n/a', note: 'Sensor not working – dock area is operational Δ', sensor_fault: true });
  const empty = reportRow({ zone_id: 'frozen_room_5', tag: 'Frozen Room 5', label: 'Frozen Room 5', type: 'frozen', readings: 0, slots_with_data: 0, lowest: null, lowest_at: null, highest: null, highest_at: null, average: null, std_dev: null, mkt: null, first_reading: null, last_reading: null, elapsed_min: 0, gap_minutes: 1440, gaps: [], lower_status: 'ok', upper_status: 'ok', lower_triggered: null, lower_minutes: 0, lower_occurrences: 0, lower_deg_minutes: 0, not_in_alert_min: 0, door_events: 0 });
  const samples = new Map([['chiller_room_2', samplesFor('chiller_room_2')], ['dock_area', samplesFor('dock_area', { withEvents: false })]]);
  const bytes = await renderDayPdf({ day: DAY, reports: [a, b, empty], samplesByZone: samples, logoPng: null });
  const doc = await PDFDocument.load(bytes);
  // cover + (5 + 5) + (summary + 1 table page for no samples + stats)
  assert.equal(doc.getPageCount(), 1 + 5 + 5 + 3);
  assert.equal(doc.getTitle(), 'Crystal Group - Daily Temperature Report - All zones - 14-09-2026');
});

test('report-pdf: helpers format like a LogTag report', () => {
  assert.equal(fmtElapsed(1565), '1 Day 2 Hours 5 Minutes');
  assert.equal(fmtElapsed(15), '15 Minutes');
  assert.equal(fmtElapsed(0), '0 Minutes');
  assert.equal(fmtDT('2026-06-19T05:31:03.000Z', 330), '19-06-2026 11:01:03');
  assert.equal(fmtDT(null, 330), '(none)');
  assert.equal(fmtLongDay('2026-09-14'), 'Monday, 14 September 2026');
  assert.equal(clean('Δ 83.144 kJ/mol · −18 °C'), '? 83.144 kJ/mol · ?18 °C');
  assert.equal(reportFileName('2026-09-14', [{ label: 'Chiller Room 2' }]), 'Crystal Group - Daily Temperature Report - Chiller Room 2 - 14-09-2026.pdf');
  assert.equal(reportFileName('2026-09-14', [{}, {}]), 'Crystal Group - Daily Temperature Report - All zones - 14-09-2026.pdf');
});

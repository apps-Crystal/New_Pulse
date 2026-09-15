const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { renderDayPdf, reportFileName, fmtElapsed, fmtDT, fmtLongDay, clean } = require('../lib/report-pdf');
const { buildZoneReports } = require('../lib/reports');
const { LOGO_PNG_BASE64 } = require('../lib/report-logo');

const DAY = '2026-09-14';
const DAY_START = Date.UTC(2026, 8, 13, 18, 30, 0); // 00:00 IST

function samplesFor(zoneId, { withEvents = true, empty = false } = {}) {
  const out = [];
  for (let k = 0; k < 288; k += 1) {
    const gap = empty || k === 181 || k === 182;
    const v = 0.5 + Math.sin(k / 20);
    out.push({ zone_id: zoneId, slot: k * 5, ts: new Date(DAY_START + k * 5 * 60000), avg_temp: gap ? null : Math.round(v * 100) / 100, min_temp: gap ? null : v - 0.2, max_temp: gap ? null : v + 0.4, readings: gap ? 0 : 5, events: withEvents && k % 40 === 8 ? '00:42 Door opened; 00:42 Door closed (open 7 s)' : null });
  }
  return out;
}

test('report-pdf: one zone renders a summary page, three table pages and a statistics page, with the logo', async () => {
  const reports = buildZoneReports(DAY, new Map([['chiller_room_2', samplesFor('chiller_room_2')]]));
  assert.equal(reports[0].zone.label, 'Chiller Room 2');
  assert.equal(reports[0].stats.lower.status, 'fail'); // the sine dips below +2
  const bytes = await renderDayPdf({ day: DAY, reports, logoPng: Buffer.from(LOGO_PNG_BASE64, 'base64'), generatedAt: new Date(Date.UTC(2026, 8, 15, 7, 0, 0)) });
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

test('report-pdf: all zones get a cover page first; an unlisted zone, a zone without a band and an empty day render too', async () => {
  const samples = new Map([
    ['dock_area', samplesFor('dock_area', { withEvents: false })],
    ['chiller_room_2', samplesFor('chiller_room_2')],
    ['frozen_room_5', samplesFor('frozen_room_5', { empty: true })],
    ['unlisted_machineroom', samplesFor('unlisted_machineroom')],
  ]);
  const reports = buildZoneReports(DAY, samples);
  assert.deepEqual(reports.map((r) => r.zone.id), ['frozen_room_5', 'chiller_room_2', 'dock_area', 'unlisted_machineroom'], 'dashboard order (frozen rooms first), unlisted last');
  assert.equal(reports[0].stats.average, null, 'the empty day');
  assert.equal(reports[2].zone.limits, null, 'the dock has no band');
  assert.equal(reports[3].zone.label, 'Machineroom');
  const bytes = await renderDayPdf({ day: DAY, reports, logoPng: null });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1 + 4 * 5);
  assert.equal(doc.getTitle(), 'Crystal Group - Daily Temperature Report - All zones - 14-09-2026');
});

test('report-pdf: helpers format like a LogTag report', () => {
  assert.equal(fmtElapsed(1565), '1 Day 2 Hours 5 Minutes');
  assert.equal(fmtElapsed(15), '15 Minutes');
  assert.equal(fmtElapsed(0), '0 Minutes');
  assert.equal(fmtDT('2026-06-19T05:31:03.000Z', 330), '19-06-2026 11:01:03');
  assert.equal(fmtDT(null, 330), '(none)');
  assert.equal(fmtLongDay('2026-09-14'), 'Monday, 14 September 2026');
  assert.equal(clean('Δ 83.144 kJ/mol — −18 °C • ok'), '? 83.144 kJ/mol — ?18 °C • ok');
  assert.equal(reportFileName('2026-09-14', [{ zone: { label: 'Chiller Room 2' } }]), 'Crystal Group - Daily Temperature Report - Chiller Room 2 - 14-09-2026.pdf');
  assert.equal(reportFileName('2026-09-14', [{}, {}]), 'Crystal Group - Daily Temperature Report - All zones - 14-09-2026.pdf');
});

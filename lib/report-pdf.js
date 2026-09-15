// Daily temperature report as a PDF, in the layout of a LogTag recorder report, branded for Crystal
// Group: one section per zone (summary page with the chart, the 5-minute readings table, a statistics
// page) and, when several zones are printed together, a cover page with the overview.
//
// Input is what lib/reports.js builds from the archived 5-minute rows: { day, zone, samples, stats }.
// Pure pdf-lib (no font files, no filesystem), so it renders the same on this laptop and inside a
// Vercel function. CommonJS on purpose: used by the API route and by plain `node` tests.
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const CW = A4.w - 2 * M;
const FOOT_TOP = 806;
const MS_MIN = 60000;
const COMPANY = 'Crystal Group';
const DEFAULT_SITE = 'Cold Storage · Dankuni Site';
const DEFAULT_OFFSET_MIN = 330; // the plant's clock: UTC +05:30

const C = {
  ink: rgb(0.07, 0.09, 0.14),
  muted: rgb(0.40, 0.44, 0.52),
  line: rgb(0.66, 0.70, 0.76),
  box: rgb(0.36, 0.40, 0.48),
  stripe: rgb(0.945, 0.953, 0.980),
  brand: rgb(0.06, 0.21, 0.47),
  ok: rgb(0.10, 0.52, 0.27),
  okBg: rgb(0.85, 0.96, 0.88),
  fail: rgb(0.78, 0.15, 0.15),
  failBg: rgb(0.99, 0.87, 0.87),
  na: rgb(0.45, 0.48, 0.55),
  naBg: rgb(0.92, 0.93, 0.95),
  green: rgb(0.86, 0.96, 0.86),
  pink: rgb(0.98, 0.87, 0.87),
  plot: rgb(0.09, 0.40, 0.64),
  grid: rgb(0.82, 0.85, 0.90),
  white: rgb(1, 1, 1),
  headerBg: rgb(0.96, 0.97, 0.99),
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

// --- formatting ------------------------------------------------------------------------------------

function localParts(ms, offsetMin) {
  const d = new Date(ms + offsetMin * MS_MIN);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}
function toMs(v) { if (v == null) return null; const ms = v instanceof Date ? v.getTime() : new Date(v).getTime(); return Number.isFinite(ms) ? ms : null; }
function fmtDT(v, off) { const ms = toMs(v); if (ms == null) return '(none)'; const p = localParts(ms, off); return `${pad2(p.d)}-${pad2(p.mo)}-${p.y} ${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`; }
function fmtHM(v, off) { const ms = toMs(v); if (ms == null) return ''; const p = localParts(ms, off); return `${pad2(p.h)}:${pad2(p.mi)}`; }
function fmtDayKey(dayKey) { const [y, m, d] = String(dayKey).split('-').map(Number); return `${pad2(d)}-${pad2(m)}-${y}`; }
function fmtLongDay(dayKey) { const [y, m, d] = String(dayKey).split('-').map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${DOW[dow]}, ${d} ${MONTHS[m - 1]} ${y}`; }
function fmtOffset(off) { const a = Math.abs(off); return `UTC ${off < 0 ? '-' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`; }
function fmtElapsed(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60); const m = mins % 60;
  const parts = [];
  if (d) parts.push(`${d} Day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${h} Hour${h === 1 ? '' : 's'}`);
  if (m || !parts.length) parts.push(`${m} Minute${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}
function num(x, dp = 1) { return x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(dp); }
function deg(x, dp = 1) { return x == null || !Number.isFinite(Number(x)) ? '—' : `${Number(x).toFixed(dp)} °C`; }
/**
 * Standard fonts speak WinAnsi only; anything else would throw inside pdf-lib. WinAnsi does carry
 * the typographic punctuation we use (dashes, bullet, ellipsis, curly quotes), so those stay.
 */
function clean(s) { return String(s == null ? '' : s).replace(/[^\x20-\x7e\xa0-\xff–—‘’“”•…€™]/g, '?'); }
function bandText(zone) { return zone.limits ? `${deg(zone.limits.low)} to ${deg(zone.limits.high)}` : 'No alarm band'; }
/**
 * Door events for a narrow table cell: "12:03 Door opened; 12:07 Door closed (open 3 min 12 s)" becomes
 * "12:03 open; 12:07 shut 3m12s" (a second door keeps its number: "D2 open").
 */
function compactEvents(text) {
  if (!text) return '';
  return String(text).split(';').map((e) => {
    const m = /^\s*(\d\d:\d\d)\s+(?:Door(?:\s+(\d+))?|(\S+))\s+(opened|closed)(?:\s+\(open\s+([^)]+)\))?\s*$/.exec(e);
    if (!m) return e.trim();
    const [, hm, doorNo, other, what, dur] = m;
    const who = doorNo ? `D${doorNo} ` : other ? `${other} ` : '';
    const d = dur ? ` ${dur.replace(/\s*h\b/, 'h').replace(/\s*min\b/, 'm').replace(/\s*s\b/, 's').replace(/\s+/g, '')}` : '';
    return `${hm} ${who}${what === 'opened' ? 'open' : 'shut'}${d}`;
  }).join('; ');
}

// --- drawing helpers (top-based coordinates) --------------------------------------------------------

class Sheet {
  constructor(doc, fonts, page) { this.doc = doc; this.fonts = fonts; this.page = page; }
  y(top) { return A4.h - top; }
  width(str, size = 8.5, font = 'reg') { return this.fonts[font].widthOfTextAtSize(clean(str), size); }
  fit(str, size, font, maxW) {
    let s = clean(str);
    if (this.width(s, size, font) <= maxW) return s;
    while (s.length > 1 && this.width(`${s}…`, size, font) > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }
  text(str, x, top, { size = 8.5, font = 'reg', color = C.ink, align = 'left', width = 0, maxWidth = 0 } = {}) {
    let s = clean(str);
    if (maxWidth) s = this.fit(s, size, font, maxWidth);
    const w = this.width(s, size, font);
    let xx = x;
    if (align === 'right') xx = x + width - w;
    else if (align === 'center') xx = x + (width - w) / 2;
    this.page.drawText(s, { x: xx, y: this.y(top) - size * 0.8, size, font: this.fonts[font], color });
    return w;
  }
  rect(x, top, w, h, { fill = null, stroke = null, width = 0.8 } = {}) {
    const o = { x, y: this.y(top) - h, width: w, height: h };
    if (fill) o.color = fill;
    if (stroke) { o.borderColor = stroke; o.borderWidth = width; }
    if (!fill && !stroke) return;
    this.page.drawRectangle(o);
  }
  line(x1, t1, x2, t2, { color = C.line, width = 0.6, dash = null } = {}) {
    const o = { start: { x: x1, y: this.y(t1) }, end: { x: x2, y: this.y(t2) }, thickness: width, color };
    if (dash) o.dashArray = dash;
    this.page.drawLine(o);
  }
  image(img, x, top, w, h) { this.page.drawImage(img, { x, y: this.y(top) - h, width: w, height: h }); }
}

function title(sh, x, top, text) { sh.text(text, x, top, { size: 10.5, font: 'bold', color: C.brand }); return top + 14; }

/**
 * A LogTag-style key/value box: alternating stripes, right-aligned labels, values beside them.
 * rows: [[label, value], ...] for one column or [[l1, v1, l2, v2], ...] for two.
 */
function kvBox(sh, x, top, w, rows, { cols = 1, labelW = 116, rowH = 11.6, size = 7.9 } = {}) {
  const h = rows.length * rowH + 6;
  const colW = w / cols;
  rows.forEach((r, i) => {
    const ry = top + 3 + i * rowH;
    if (i % 2 === 0) sh.rect(x + 1, ry, w - 2, rowH, { fill: C.stripe });
    for (let c = 0; c < cols; c += 1) {
      const label = r[2 * c];
      const value = r[2 * c + 1];
      if (label == null) continue;
      const cx = x + c * colW;
      sh.text(`${label} :`, cx + 4, ry + (rowH - size) / 2, { size, width: labelW, align: 'right', color: C.ink });
      sh.text(value == null ? '' : value, cx + labelW + 10, ry + (rowH - size) / 2, { size, maxWidth: colW - labelW - 14 });
    }
  });
  sh.rect(x, top, w, h, { stroke: C.box, width: 0.8 });
  return top + h;
}

function badge(sh, x, top, status, { w = 46, h = 13 } = {}) {
  const s = String(status || 'n/a');
  const fill = s === 'fail' ? C.failBg : s === 'ok' ? C.okBg : C.naBg;
  const ink = s === 'fail' ? C.fail : s === 'ok' ? C.ok : C.na;
  sh.rect(x, top, w, h, { fill, stroke: ink, width: 0.6 });
  sh.text(s === 'fail' ? 'FAIL' : s === 'ok' ? 'OK' : 'N/A', x, top + 2.4, { size: 8, font: 'bold', color: ink, align: 'center', width: w });
}

/** Page header: logo (or wordmark), report title, and the zone / day on the right. */
function header(sh, ctx, heading, sub) {
  sh.rect(0, 0, A4.w, 74, { fill: C.headerBg });
  if (ctx.logo) {
    // The official mark carries the "Cold Chain Solution Company" tagline itself.
    const h = 36;
    const w = h * (ctx.logo.width / ctx.logo.height);
    sh.image(ctx.logo, M, 18, w, h);
  } else {
    sh.text(COMPANY, M, 22, { size: 20, font: 'bold' });
    sh.text('Cold Chain Solution Company', M, 48, { size: 7.5, color: C.muted });
  }
  sh.text('Daily Temperature Report', M, 20, { size: 14, font: 'bold', color: C.brand, align: 'right', width: CW });
  sh.text(heading, M, 39, { size: 10.5, font: 'bold', align: 'right', width: CW });
  sh.text(sub, M, 53, { size: 8.5, color: C.muted, align: 'right', width: CW });
  sh.line(M, 74, A4.w - M, 74, { color: C.brand, width: 1.2 });
}

function footer(sh, i, n, ctx) {
  sh.line(M, FOOT_TOP, A4.w - M, FOOT_TOP, { color: C.line, width: 0.5 });
  sh.text(`${COMPANY} · ${ctx.site} · Generated by Crystal Pulse on ${fmtDT(ctx.generatedAt, ctx.offsetMin)} · All date-time values are in ${fmtOffset(ctx.offsetMin)}`, M, FOOT_TOP + 4, { size: 7, color: C.muted, maxWidth: CW - 70 });
  sh.text(`Page ${i} of ${n}`, M, FOOT_TOP + 4, { size: 7, color: C.muted, align: 'right', width: CW });
}

// --- chart ---------------------------------------------------------------------------------------

function niceStep(raw) { for (const s of [0.5, 1, 2, 5, 10, 20, 50]) if (s >= raw) return s; return 100; }

function drawChart(sh, x, top, w, h, zone, samples) {
  const padL = 38; const padR = 38; const padT = 10; const padB = 20;
  const px = x + padL; const py = top + padT; const pw = w - padL - padR; const ph = h - padT - padB;
  const vals = samples.filter((s) => s.avg_temp != null).map((s) => Number(s.avg_temp));
  const band = zone.limits;
  let lo = Math.min(...vals, band ? band.low : Infinity);
  let hi = Math.max(...vals, band ? band.high : -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = -25; hi = 25; }
  const span0 = Math.max(hi - lo, 6);
  const step = niceStep(span0 / 6);
  lo = Math.floor((lo - span0 * 0.12) / step) * step;
  hi = Math.ceil((hi + span0 * 0.12) / step) * step;
  const yOf = (v) => py + ph - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ph;
  const xOf = (min) => px + (min / 1440) * pw;
  if (band) {
    const yHigh = yOf(band.high); const yLow = yOf(band.low);
    sh.rect(px, py, pw, Math.max(0, yHigh - py), { fill: C.pink });
    sh.rect(px, yHigh, pw, Math.max(0, yLow - yHigh), { fill: C.green });
    sh.rect(px, yLow, pw, Math.max(0, py + ph - yLow), { fill: C.pink });
  } else {
    sh.rect(px, py, pw, ph, { fill: C.stripe });
  }
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = yOf(v);
    sh.line(px, yy, px + pw, yy, { color: C.grid, width: 0.4, dash: [2, 2] });
    sh.text(v.toFixed(1), x, yy - 4, { size: 6.5, color: C.brand, align: 'right', width: padL - 4 });
    sh.text(v.toFixed(1), px + pw + 4, yy - 4, { size: 6.5, color: C.brand });
  }
  for (let m = 0; m <= 1440; m += 120) {
    const xx = xOf(m);
    sh.line(xx, py, xx, py + ph, { color: C.grid, width: 0.4, dash: [2, 2] });
    sh.text(`${pad2(Math.floor(m / 60))}:00`, xx - 14, py + ph + 4, { size: 6.5, color: C.brand, align: 'center', width: 28 });
  }
  sh.rect(px, py, pw, ph, { stroke: C.brand, width: 0.8 });
  let prev = null;
  for (const s of samples) {
    if (s.avg_temp == null) { prev = null; continue; }
    const pt = { x: xOf(Number(s.slot)), y: yOf(Number(s.avg_temp)) };
    if (prev) sh.line(prev.x, prev.y, pt.x, pt.y, { color: C.plot, width: 1 });
    prev = pt;
  }
  sh.text('Temp °C', x, top - 1, { size: 6.5, color: C.muted });
  sh.text('Temp °C', px + pw + 4, top - 1, { size: 6.5, color: C.muted });
  sh.line(px + pw / 2 - 34, py + ph + 15, px + pw / 2 - 18, py + ph + 15, { color: C.plot, width: 1 });
  sh.text('Temperature (°C, 5-minute average)', px + pw / 2 - 14, py + ph + 11.5, { size: 6.5, color: C.muted });
}

// --- pages -----------------------------------------------------------------------------------------

function summaryPage(ctx, zr) {
  const sh = new Sheet(ctx.doc, ctx.fonts, ctx.doc.addPage([A4.w, A4.h]));
  const { zone, stats: s, samples } = zr;
  const off = ctx.offsetMin;
  const interval = s.intervalMin || 5;
  header(sh, ctx, zone.label, `${fmtLongDay(zr.day)} · ${ctx.site}`);
  const RH = 11.6;
  let y = 84;
  title(sh, M, y, 'Alarm Status');
  title(sh, M + 172, y, 'Zone Information');
  y += 13;
  const ah = 3 * RH + 6;
  sh.rect(M + 1, y + 3, 160 - 2, RH, { fill: C.stripe });
  sh.rect(M + 1, y + 3 + 2 * RH, 160 - 2, RH, { fill: C.stripe });
  sh.text('Lower :', M + 4, y + 4.8, { size: 7.9, width: 50, align: 'right' });
  badge(sh, M + 64, y + 3 + 0.3, s.lower.status, { h: 11 });
  sh.text('Upper :', M + 4, y + 4.8 + RH, { size: 7.9, width: 50, align: 'right' });
  badge(sh, M + 64, y + 3 + RH + 0.3, s.upper.status, { h: 11 });
  sh.text(!zone.limits ? 'no band configured' : `${s.lower.occurrences} low / ${s.upper.occurrences} high excursion(s)`, M + 4, y + 4.8 + 2 * RH, { size: 7.2, color: C.muted, maxWidth: 152 });
  sh.rect(M, y, 160, ah, { stroke: C.box });
  kvBox(sh, M + 172, y, CW - 172, [
    ['Zone', `${zone.label}  (${zone.typeLabel || zone.type})`],
    ['Alarm band', bandText(zone)],
    ['Source', 'PLC probe via the WECON panel · Crystal Pulse collector'],
  ], { labelW: 64 });
  y += ah + 8;

  y = title(sh, M, y, 'Recording Configuration') - 1;
  y = kvBox(sh, M, y, CW, [
    ['Logging', 'Panel read about once a minute', 'Temperature alarms', bandText(zone)],
    ['Table samples', `Every ${interval} minutes (${s.slots || 288} per day), averaged`, 'Alarm rule', `${interval}-minute average outside the band`],
    ['Day', `${fmtLongDay(zr.day)} (${fmtOffset(off)})`, 'Statistics', 'Computed from the 5-minute rows'],
  ], { cols: 2, labelW: 84 }) + 8;

  y = title(sh, M, y, 'Recorded Data') - 1;
  y = kvBox(sh, M, y, CW, [
    ['First reading', fmtDT(s.first, off), 'Lowest', `${deg(s.lowest)}   @ ${fmtDT(s.lowestAt, off)}`],
    ['Last reading', fmtDT(s.last, off), 'Highest', `${deg(s.highest)}   @ ${fmtDT(s.highestAt, off)}`],
    ['Elapsed time', fmtElapsed(s.elapsedMin), 'Average reading', deg(s.average)],
    ['Raw readings', `${s.readings}`, 'Standard deviation', `${num(s.stdDev)} °C (S)`],
    ['Samples with data', `${s.slotsWithData} of ${s.slots}${s.gapMinutes ? `  (${s.gapMinutes} min without data)` : ''}`, 'MKT (dH 83.144)', deg(s.mkt)],
  ], { cols: 2, labelW: 84 }) + 8;

  const half = (CW - 12) / 2;
  const yA = title(sh, M, y, 'Lower Alarm') - 1;
  title(sh, M + half + 12, y, 'Upper Alarm');
  const blockRows = (b, word) => [
    ['Status', b.status === 'n/a' ? `No ${word === 'below' ? 'lower' : 'upper'} limit` : b.status === 'fail' ? 'FAIL' : 'OK'],
    ['Triggered', b.triggered ? fmtDT(b.triggered, off) : '(none)'],
    [`Time ${word}`, b.minutes ? fmtElapsed(b.minutes) : '(none)'],
    ['Occurrences', `${b.occurrences || 0}`],
    [`°C - Minutes ${word}`, num(b.degMinutes, 2)],
  ];
  kvBox(sh, M, yA, half, blockRows(s.lower, 'below'), { labelW: 92 });
  y = kvBox(sh, M + half + 12, yA, half, blockRows(s.upper, 'above'), { labelW: 92 }) + 6;

  const notes = [];
  const gaps = Array.isArray(s.gaps) ? s.gaps : [];
  for (const g of gaps.slice(0, 3)) notes.push(`No data ${fmtHM(g.from, off)} - ${fmtHM(g.to, off)} (${g.minutes} min): collector offline or panel unreachable.`);
  if (gaps.length > 3) notes.push(`... and ${gaps.length - 3} more gap(s), ${s.gapMinutes} minutes in total.`);
  if (s.doorEvents) notes.push(`${s.doorEvents} door event(s) recorded; they are listed against their 5-minute slot in the readings table.`);
  notes.push(`Time not in alert: ${fmtElapsed(s.notInAlertMin)}. Lowest and highest are the extreme raw readings inside a slot; alarms are judged on the slot average.`);
  for (const n of notes) { sh.text(`• ${n}`, M + 2, y, { size: 7.3, color: C.muted, maxWidth: CW - 4 }); y += 9.2; }
  y += 3;

  y = title(sh, M, y, 'Temperature over the day') - 2;
  const chartH = FOOT_TOP - 8 - y;
  drawChart(sh, M, y + 2, CW, chartH, zone, samples);
}

/** The recorder's "Summary" statistics as a two-column box; returns its bottom, or the height needed when dry. */
function summaryBox(sh, ctx, zr, top, { dry = false } = {}) {
  const { zone, stats: s } = zr;
  const off = ctx.offsetMin;
  const items = [
    ['Company', COMPANY],
    ['Site', ctx.site],
    ['Zone', `${zone.label} (${zone.typeLabel || zone.type})`],
    ['Day', fmtLongDay(zr.day)],
    ['Time zone', fmtOffset(off)],
    ['Reading interval', `~1 min; archived every ${s.intervalMin || 5} min`],
    ['Number of raw readings', `${s.readings}`],
    ['Samples with data', `${s.slotsWithData} of ${s.slots}`],
    ['Non alert range', bandText(zone)],
    ['First reading', fmtDT(s.first, off)],
    ['Last reading', fmtDT(s.last, off)],
    ['Elapsed time', fmtElapsed(s.elapsedMin)],
    ['Readings range', `${deg(s.lowest)} to ${deg(s.highest)}`],
    ['Lowest reading', `${deg(s.lowest)} @ ${fmtDT(s.lowestAt, off)}`],
    ['Highest reading', `${deg(s.highest)} @ ${fmtDT(s.highestAt, off)}`],
    ['Average reading', deg(s.average)],
    ['Standard deviation (S)', `${num(s.stdDev)} °C`],
    ['Time below lower alert', s.lower.status === 'n/a' ? 'No lower limit' : s.lower.minutes ? fmtElapsed(s.lower.minutes) : 'None'],
    ['Time above upper alert', s.upper.status === 'n/a' ? 'No upper limit' : s.upper.minutes ? fmtElapsed(s.upper.minutes) : 'None'],
    ['Time not in alert', fmtElapsed(s.notInAlertMin)],
    ['°C-Min below lower alert', num(s.lower.degMinutes, 1)],
    ['°C-Min above upper alert', num(s.upper.degMinutes, 1)],
    ['Mean kinetic temperature', deg(s.mkt)],
    ['Minutes without data', `${s.gapMinutes || 0}`],
    ['Door events', `${s.doorEvents || 0}`],
    ['Generated', `Crystal Pulse, ${fmtDT(ctx.generatedAt, off)}`],
  ];
  const half = Math.ceil(items.length / 2);
  const rows = [];
  for (let i = 0; i < half; i += 1) rows.push([...items[i], ...(items[i + half] || [null, null])]);
  const rowH = 11;
  const height = 13 + rows.length * rowH + 6;
  if (dry) return height;
  const y = title(sh, M, top, 'Summary') - 1;
  kvBox(sh, M, y, CW, rows, { cols: 2, labelW: 108, rowH, size: 7.6 });
  return top + height;
}

/**
 * The readings table: three blocks a page, 72 rows each (216 a page, so a 288-slot day takes two pages).
 * On the last page the remaining rows are spread evenly over the blocks and the Summary statistics box
 * goes underneath, so no page is left mostly empty.
 */
function tablePages(ctx, zr) {
  const { zone, samples, stats: s } = zr;
  const off = ctx.offsetMin;
  const interval = s.intervalMin || 5;
  const BLOCKS = 3;
  const ROWS = 72;
  const perPage = ROWS * BLOCKS;
  const rowH = 9.6;
  const gapX = 8;
  const blockW = (CW - gapX * (BLOCKS - 1)) / BLOCKS;
  const cols = [['Idx', 15, 'right'], ['Time', 22, 'left'], ['Avg', 25, 'right'], ['Min', 23, 'right'], ['Max', 23, 'right'], ['Events', blockW - 15 - 22 - 25 - 23 - 23, 'left']];
  const band = zone.limits;
  const pages = Math.max(1, Math.ceil(samples.length / perPage));
  for (let p = 0; p < pages; p += 1) {
    const sh = new Sheet(ctx.doc, ctx.fonts, ctx.doc.addPage([A4.w, A4.h]));
    header(sh, ctx, zone.label, `${fmtLongDay(zr.day)} · readings ${p + 1} of ${pages}`);
    let y = 84;
    sh.text(`Readings — ${interval}-minute averages (°C) with the lowest and highest reading inside each slot; door events against their slot; averages outside the band in red`, M, y, { size: 7.4, color: C.muted, maxWidth: CW });
    y += 12;
    const pageRows = samples.slice(p * perPage, (p + 1) * perPage);
    const perBlock = pageRows.length < perPage ? Math.ceil(pageRows.length / BLOCKS) : ROWS;
    let bottom = y;
    for (let b = 0; b < BLOCKS; b += 1) {
      const x0 = M + b * (blockW + gapX);
      const start = p * perPage + b * perBlock;
      const rows = samples.slice(start, Math.min(start + perBlock, (p + 1) * perPage));
      if (rows.length === 0) continue;
      sh.rect(x0, y, blockW, rowH, { fill: C.stripe, stroke: C.box, width: 0.6 });
      let cx = x0;
      for (const [name, w, align] of cols) { sh.text(name, cx + 2, y + 1.9, { size: 6.3, font: 'bold', align, width: w - 4 }); cx += w; }
      let ry = y + rowH;
      rows.forEach((r, i) => {
        if (i % 2 === 1) sh.rect(x0, ry, blockW, rowH, { fill: C.stripe });
        const avg = r.avg_temp == null ? null : Number(r.avg_temp);
        const out = band && avg != null && (avg < band.low || avg > band.high);
        const vals = [
          String(start + i + 1),
          fmtHM(r.ts, off),
          avg == null ? '—' : avg.toFixed(1),
          r.min_temp == null ? '—' : Number(r.min_temp).toFixed(1),
          r.max_temp == null ? '—' : Number(r.max_temp).toFixed(1),
          r.events ? compactEvents(r.events) : (!r.readings ? 'no data' : ''),
        ];
        cx = x0;
        cols.forEach(([, w, align], ci) => {
          const color = ci === 2 && out ? C.fail : ci === 5 ? C.muted : C.ink;
          sh.text(vals[ci], cx + 2, ry + 1.9, { size: 6.2, align, width: w - 4, maxWidth: w - 4, color, font: ci === 2 && out ? 'bold' : 'reg' });
          cx += w;
        });
        ry += rowH;
      });
      sh.rect(x0, y, blockW, rowH + rows.length * rowH, { stroke: C.box, width: 0.6 });
      cx = x0;
      for (const [, w] of cols.slice(0, -1)) { cx += w; sh.line(cx, y, cx, y + rowH + rows.length * rowH, { color: C.line, width: 0.3 }); }
      bottom = Math.max(bottom, y + rowH + rows.length * rowH);
    }
    if (p === pages - 1) {
      const need = summaryBox(sh, ctx, zr, 0, { dry: true });
      if (FOOT_TOP - 8 - (bottom + 10) >= need) {
        summaryBox(sh, ctx, zr, bottom + 10);
      } else {
        const sh2 = new Sheet(ctx.doc, ctx.fonts, ctx.doc.addPage([A4.w, A4.h]));
        header(sh2, ctx, zone.label, `${fmtLongDay(zr.day)} · summary`);
        summaryBox(sh2, ctx, zr, 88);
      }
    }
  }
}

function coverPage(ctx, reports) {
  const sh = new Sheet(ctx.doc, ctx.fonts, ctx.doc.addPage([A4.w, A4.h]));
  header(sh, ctx, 'All zones', `${fmtLongDay(ctx.day)} · ${ctx.site}`);
  let y = title(sh, M, 88, `Overview — ${reports.length} zone(s)`);
  const cols = [['Zone', 92, 'left'], ['Band', 74, 'left'], ['Lowest', 40, 'right'], ['Highest', 42, 'right'], ['Average', 42, 'right'], ['SD', 30, 'right'], ['MKT', 36, 'right'], ['Lower', 40, 'center'], ['Upper', 40, 'center'], ['Readings', 44, 'right'], ['No data', 43, 'right']];
  const rowH = 15;
  sh.rect(M, y, CW, rowH, { fill: C.stripe, stroke: C.box, width: 0.6 });
  let cx = M;
  for (const [name, w, align] of cols) { sh.text(name, cx + 3, y + 3.6, { size: 7.6, font: 'bold', align, width: w - 6 }); cx += w; }
  let ry = y + rowH;
  reports.forEach((zr, i) => {
    const { zone, stats: s } = zr;
    if (i % 2 === 1) sh.rect(M, ry, CW, rowH, { fill: C.stripe });
    const vals = [zone.label, zone.limits ? `${num(zone.limits.low)} to ${num(zone.limits.high)} °C` : '—', num(s.lowest), num(s.highest), num(s.average), num(s.stdDev), num(s.mkt), null, null, String(s.readings), s.gapMinutes ? `${s.gapMinutes} min` : '—'];
    cx = M;
    cols.forEach(([, w, align], ci) => {
      if (ci === 7) badge(sh, cx + (w - 34) / 2, ry + 1.5, s.lower.status, { w: 34, h: 12 });
      else if (ci === 8) badge(sh, cx + (w - 34) / 2, ry + 1.5, s.upper.status, { w: 34, h: 12 });
      else sh.text(vals[ci], cx + 3, ry + 3.6, { size: 7.6, align, width: w - 6, maxWidth: w - 6, font: ci === 0 ? 'bold' : 'reg' });
      cx += w;
    });
    ry += rowH;
  });
  sh.rect(M, y, CW, rowH + reports.length * rowH, { stroke: C.box, width: 0.6 });
  y = ry + 14;
  const fails = reports.filter((zr) => zr.stats.lower.status === 'fail' || zr.stats.upper.status === 'fail');
  const lines = [
    'The archive keeps each day as 5-minute rows: the average of the readings in each slot, the lowest and highest reading inside it, and door events. Every statistic here is computed from those rows.',
    'Alarm bands are the plant\'s fixed limits: frozen rooms and blast freezers -22 to -18 °C, chilled rooms +2 to +4 °C, anterooms +2 to +8 °C; the dock has no band.',
    'A zone is in alarm when a 5-minute average is below its lower or above its upper limit. FAIL means at least one 5-minute average was outside the band that day.',
    fails.length ? `Zones with an excursion: ${fails.map((zr) => zr.zone.label).join(', ')}.` : 'No zone had an excursion outside its band on this day.',
    'Each zone follows on its own pages: summary and chart, the 5-minute readings table, and a statistics page.',
  ];
  for (const l of lines) {
    const words = clean(l).split(' ');
    let line = '';
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (sh.width(t, 8.4) > CW - 4) { sh.text(line, M + 2, y, { size: 8.4 }); y += 11.5; line = wd; } else line = t;
    }
    if (line) { sh.text(line, M + 2, y, { size: 8.4 }); y += 11.5; }
    y += 3;
  }
}

/**
 * Render the PDF. reports: zone reports from lib/reports.js ({ day, zone, samples, stats }), in display
 * order; logoPng: PNG bytes or null. Returns a Uint8Array.
 */
async function renderDayPdf({ day, reports, logoPng = null, generatedAt = new Date(), site = DEFAULT_SITE, offsetMin = DEFAULT_OFFSET_MIN }) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error('no reports to render');
  const doc = await PDFDocument.create();
  doc.setTitle(`${COMPANY} - Daily Temperature Report - ${reports.length === 1 ? reports[0].zone.label : 'All zones'} - ${fmtDayKey(day)}`);
  doc.setAuthor(COMPANY);
  doc.setSubject(`Cold storage temperature record for ${fmtLongDay(day)}`);
  doc.setCreator('Crystal Pulse');
  doc.setProducer('Crystal Pulse');
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const logo = logoPng ? await doc.embedPng(logoPng) : null;
  const ctx = { doc, fonts, logo, generatedAt, site, day, offsetMin };
  if (reports.length > 1) coverPage(ctx, reports);
  for (const zr of reports) {
    summaryPage(ctx, zr);
    tablePages(ctx, zr); // the Summary statistics box rides on the last readings page
  }
  const pages = doc.getPages();
  pages.forEach((page, i) => footer(new Sheet(doc, fonts, page), i + 1, pages.length, ctx));
  return doc.save();
}

function reportFileName(day, reports) {
  const who = reports.length === 1 ? reports[0].zone.label : 'All zones';
  return `${COMPANY} - Daily Temperature Report - ${who} - ${fmtDayKey(day)}.pdf`.replace(/[^\w .()+-]/g, '');
}

module.exports = { renderDayPdf, reportFileName, fmtElapsed, fmtDT, fmtLongDay, clean, compactEvents, COMPANY, DEFAULT_SITE, DEFAULT_OFFSET_MIN };

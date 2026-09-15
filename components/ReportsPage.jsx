'use client';
// Daily reports: pick an archived day and a zone (or all zones) and download the Crystal Group PDF.
// The day's per-zone summary is shown on the page so the numbers can be checked before downloading.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, DoorOpen, Download, FileText } from 'lucide-react';
import { ZONES } from '../lib/zones';

const IST = 'Asia/Kolkata';

function fmtDayLong(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fmtAt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: IST });
}
function fmtT(v) { return v == null ? '—' : `${Number(v).toFixed(1)}°C`; }
function fmtMin(mins) {
  const m = Math.round(Number(mins) || 0);
  if (!m) return '—';
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
const OK = { color: '#34d399', background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)' };
const FAIL = { color: '#f87171', background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' };
const NA = { color: '#94a3b8', background: 'rgba(148,163,184,0.10)', borderColor: 'rgba(148,163,184,0.3)' };
function Status({ s }) {
  const style = s === 'fail' ? FAIL : s === 'ok' ? OK : NA;
  return <span className={PILL} style={style}>{s === 'fail' ? 'Fail' : s === 'ok' ? 'OK' : 'n/a'}</span>;
}

export default function ReportsPage() {
  const [days, setDays] = useState(null);      // [{ day, zones }] newest first
  const [day, setDay] = useState('');
  const [zone, setZone] = useState('all');
  const [summary, setSummary] = useState(null);  // { day, zones: [...] }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);         // href of the PDF being fetched
  const [downloadError, setDownloadError] = useState(null);

  // Fetch the PDF ourselves and hand the browser a file: a failed request then shows its message here
  // instead of replacing the page with a JSON error (which is what a plain link would do).
  async function download(href, fallbackName) {
    if (busy) return;
    setBusy(href);
    setDownloadError(null);
    try {
      const res = await fetch(href, { cache: 'no-store' });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.includes('application/pdf')) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = m ? m[1] : fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setDownloadError(`Could not download: ${e.message}. If this keeps happening, reload the page (Ctrl+F5) — a newer version of the dashboard may be waiting.`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/reports', { cache: 'no-store' });
        const body = await res.json();
        if (!alive) return;
        if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setDays(body.days);
        if (body.days.length && !day) setDay(body.days[0].day);
      } catch (e) {
        if (alive) { setDays([]); setError(e.message); }
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!day) { setSummary(null); return undefined; }
    let alive = true;
    setSummary(null);
    (async () => {
      try {
        const res = await fetch(`/api/reports?day=${encodeURIComponent(day)}`, { cache: 'no-store' });
        const body = await res.json();
        if (!alive) return;
        if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setSummary(body);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => { alive = false; };
  }, [day]);

  const available = useMemo(() => new Set((days || []).map((d) => d.day)), [days]);
  const minDay = days && days.length ? days[days.length - 1].day : '';
  const maxDay = days && days.length ? days[0].day : '';
  const hasDay = available.has(day);
  const zonesForDay = summary && summary.day === day ? summary.zones : [];
  const zoneOptions = zonesForDay.length ? zonesForDay.map((z) => ({ id: z.id, label: z.label })) : ZONES.map((z) => ({ id: z.id, label: z.label }));
  const pdfHref = hasDay ? `/api/reports/pdf?day=${encodeURIComponent(day)}&zone=${encodeURIComponent(zone)}` : null;
  const fails = zonesForDay.filter((z) => z.lowerStatus === 'fail' || z.upperStatus === 'fail').length;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="shrink-0">
        <div className="mx-auto flex min-h-[70px] w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
              <img src="/crystal-logo.jpeg" alt="Crystal" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold leading-tight text-white sm:text-[22px]">Crystal Pulse</div>
              <div className="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Daily Reports · Dankuni Site</div>
            </div>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition-colors hover:bg-white/10">
            <ArrowLeft size={14} /> Live dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 pb-10 pt-2 sm:px-6">
        <section className="card p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="report-day" className="text-[11px] uppercase tracking-wide text-slate-400">Date</label>
              <input
                id="report-day"
                type="date"
                value={day}
                min={minDay || undefined}
                max={maxDay || undefined}
                onChange={(e) => setDay(e.target.value)}
                className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-sky-400/60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="report-zone" className="text-[11px] uppercase tracking-wide text-slate-400">Zone</label>
              <select
                id="report-zone"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                className="h-10 min-w-[220px] rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-sky-400/60"
              >
                <option value="all" className="bg-[#0b0f1e]">All zones (one PDF)</option>
                {zoneOptions.map((z) => <option key={z.id} value={z.id} className="bg-[#0b0f1e]">{z.label}</option>)}
              </select>
            </div>
            <button
              type="button"
              disabled={!pdfHref || Boolean(busy)}
              onClick={() => pdfHref && download(pdfHref, `Crystal Group - Daily Temperature Report - ${zone === 'all' ? 'All zones' : zone} - ${day}.pdf`)}
              className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${pdfHref ? 'bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-60' : 'cursor-not-allowed bg-white/10 text-slate-500'}`}
            >
              <Download size={16} /> {busy === pdfHref ? 'Preparing…' : 'Download PDF'}
            </button>
            <div className="ml-auto text-right text-[12px] text-slate-400">
              {days === null && 'Loading archived days…'}
              {days && days.length === 0 && 'No archived days yet. The report agent archives each day just after midnight.'}
              {days && days.length > 0 && (
                <>
                  <div>{days.length} archived day{days.length === 1 ? '' : 's'} · {minDay === maxDay ? fmtDayLong(maxDay) : `${fmtDayLong(minDay)} to ${fmtDayLong(maxDay)}`}</div>
                  {day && !hasDay && <div className="text-amber-300">No archived report for {fmtDayLong(day)}.</div>}
                </>
              )}
            </div>
          </div>
          {error && <div className="mt-3 text-[12px] text-red-300">{error}. If this keeps happening, reload the page (Ctrl+F5).</div>}
          {downloadError && <div className="mt-3 text-[12px] text-amber-300">{downloadError}</div>}
        </section>

        {hasDay && (
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileText size={16} className="text-sky-300" /> {fmtDayLong(day)}
              </div>
              <div className="text-[12px] text-slate-400">
                {summary ? `${zonesForDay.length} zone(s) · ${fails ? `${fails} with an excursion` : 'no excursions'}` : 'Loading…'}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[12.5px]">
                <thead className="text-[10.5px] uppercase tracking-wide text-slate-400">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                    <th>Zone</th><th>Band</th><th className="!text-right">Lowest</th><th className="!text-right">Highest</th><th className="!text-right">Average</th><th className="!text-right">SD</th><th className="!text-right">MKT</th><th>Lower</th><th>Upper</th><th className="!text-right">In alarm</th><th className="!text-right">Readings</th><th className="!text-right">No data</th><th className="!text-right" title="Door openings that day, and the time the doors were open in total">Door opens</th><th className="!text-right" title="Openings of 10 minutes or more">Long opens</th><th></th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {zonesForDay.map((z) => (
                    <tr key={z.id} className="border-t border-white/[0.05] [&>td]:px-3 [&>td]:py-2">
                      <td className="font-medium text-white">
                        {z.label}
                        {z.operational === false && <span className="ml-2 text-[10px] uppercase text-slate-500">off</span>}
                        {z.sensorFault && <span className="ml-2 text-[10px] uppercase text-amber-400/80">sensor</span>}
                      </td>
                      <td className="text-slate-400">{z.limitLow == null ? '—' : `${z.limitLow} to ${z.limitHigh}°C`}</td>
                      <td className="text-right tabular"><span>{fmtT(z.lowest)}</span> <span className="text-[10px] text-slate-500">{fmtAt(z.lowestAt)}</span></td>
                      <td className="text-right tabular"><span>{fmtT(z.highest)}</span> <span className="text-[10px] text-slate-500">{fmtAt(z.highestAt)}</span></td>
                      <td className="text-right tabular">{fmtT(z.average)}</td>
                      <td className="text-right tabular">{z.stdDev == null ? '—' : z.stdDev.toFixed(1)}</td>
                      <td className="text-right tabular">{fmtT(z.mkt)}</td>
                      <td><Status s={z.lowerStatus} /></td>
                      <td><Status s={z.upperStatus} /></td>
                      <td className="text-right tabular">{fmtMin(z.lowerMinutes + z.upperMinutes)}</td>
                      <td className="text-right tabular">{z.readings}</td>
                      <td className="text-right tabular">{z.gapMinutes ? `${z.gapMinutes} min` : '—'}</td>
                      <td className="text-right tabular">{z.doors && z.doors.length ? <><span>{z.doorOpens}</span> <span className="text-[10px] text-slate-500">{fmtMin(z.doorOpenMinutes)}</span></> : '—'}</td>
                      <td className={`text-right tabular ${z.doorLongOpens ? 'font-semibold text-red-300' : ''}`}>{z.doors && z.doors.length ? (z.doorLongOpens ? <><span>{z.doorLongOpens}</span> <span className="text-[10px] text-red-300/70">{fmtMin(z.doorLongMinutes)}</span></> : '0') : '—'}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => download(`/api/reports/pdf?day=${encodeURIComponent(day)}&zone=${encodeURIComponent(z.id)}`, `Crystal Group - Daily Temperature Report - ${z.label} - ${day}.pdf`)}
                          title={`Download the ${z.label} report`}
                          className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 disabled:opacity-50"
                        >
                          <Download size={13} /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                  {summary && zonesForDay.length === 0 && (
                    <tr><td colSpan={15} className="px-3 py-6 text-center text-slate-400">No zones archived for this day.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {hasDay && summary && summary.inputs && (
          <section className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <DoorOpen size={16} className="text-amber-300" /> Doors, panic buttons and phase preventer
            </div>
            {summary.inputs.longOpenings.length === 0 ? (
              <div className="text-[12.5px] text-slate-300">No door was open for 10 minutes or more on this day.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[12.5px]">
                  <thead className="text-[10.5px] uppercase tracking-wide text-slate-400">
                    <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-left"><th>Zone</th><th>Door</th><th>Open from</th><th>Until</th><th className="!text-right">Open for</th></tr>
                  </thead>
                  <tbody className="text-slate-200">
                    {summary.inputs.longOpenings.map((e, i) => (
                      <tr key={i} className="border-t border-white/[0.05] [&>td]:px-3 [&>td]:py-1.5">
                        <td className="font-medium text-white">{e.zone}</td><td>{e.door}</td><td className="tabular">{fmtAt(e.at)}</td><td className="tabular">{e.until ? fmtAt(e.until) : 'midnight'}{e.ongoing ? ' (still open)' : ''}</td>
                        <td className="text-right tabular font-semibold text-red-300">{fmtMin(e.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-slate-300">
              {(() => {
                const presses = summary.inputs.panic.reduce((n, d) => n + d.opens, 0);
                const faults = summary.inputs.phase.reduce((n, d) => n + d.opens, 0);
                return (
                  <>
                    <span className={presses ? 'text-red-300' : ''}>Panic buttons: {presses ? `${presses} press(es) — ${summary.inputs.panic.filter((d) => d.opens).map((d) => `${d.tag} ${d.opens}× (${fmtMin(d.openMinutes)})`).join(', ')}` : 'none pressed'}</span>
                    <span className={faults ? 'text-red-300' : ''}>Phase preventer: {faults ? `${faults} fault(s), ${fmtMin(summary.inputs.phase.reduce((n, d) => n + d.openMinutes, 0))}` : 'no fault'}</span>
                    <span className="text-slate-500">A door opening of 10 minutes or more counts as long; every panic press or phase fault is listed.</span>
                  </>
                );
              })()}
            </div>
          </section>
        )}

        <p className="text-[11.5px] leading-relaxed text-slate-500">
          Each report follows the LogTag recorder layout: a summary page with the alarm status, recorded data, lower and upper alarm blocks and the day's
          temperature chart, then the 5-minute readings table (average, lowest and highest reading in each slot, door events), then a statistics page.
          The archive keeps each past day as 5-minute rows only; every statistic is computed from those rows, the way a LogTag recorder computes its
          summary from its own 5-minute readings. Times are India Standard Time.
        </p>
      </main>
    </div>
  );
}

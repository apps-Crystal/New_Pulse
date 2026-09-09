'use client';
import { useEffect, useState } from 'react';
import EventsTable from './EventsTable';

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:px-6';

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return sameDay ? `${hh}:${mm}:${ss}` : `${dd} ${hh}:${mm}:${ss}`;
}

function kindOf(message) {
  if (/door/i.test(message)) return 'door';
  if (/panic/i.test(message)) return 'panic';
  if (/temp/i.test(message)) return 'temp';
  return 'other';
}

const KIND_STYLE = {
  door: { color: '#fcd34d', background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.35)' },
  panic: { color: '#fca5a5', background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.45)' },
  temp: { color: '#93c5fd', background: 'rgba(59,130,246,0.10)', borderColor: 'rgba(59,130,246,0.35)' },
  other: { color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' },
};

// The panel's own alarm log (CURRENT ALARM + ALARM HISTORY, read by the collector), newest first, with
// active alarms on top. `panelAlarms` is what the snapshot carries (the panel's latest page); "Load more"
// pulls the database's longer history.
function PanelAlarmTable({ panelAlarms }) {
  const [more, setMore] = useState(null);   // rows from /api/alarms
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const live = [];
  const seen = new Set();
  for (const a of (panelAlarms && panelAlarms.active) || []) { if (!seen.has(a.id)) { seen.add(a.id); live.push({ ...a, active: true }); } }
  for (const a of (panelAlarms && panelAlarms.recent) || []) { if (!seen.has(a.id)) { seen.add(a.id); live.push({ ...a, active: false }); } }
  for (const a of more || []) { if (!seen.has(a.id)) { seen.add(a.id); live.push(a); } }
  live.sort((p, q) => (q.active ? 1 : 0) - (p.active ? 1 : 0) || (Date.parse(q.at) || 0) - (Date.parse(p.at) || 0));

  const loadMore = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/alarms?limit=300', { cache: 'no-store' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMore(j.alarms || []);
    } catch (e) { setError(e.message || String(e)); } finally { setLoading(false); }
  };

  return (
    <div>
      <div className="scrollbar-thin overflow-x-auto overflow-y-auto" style={{ maxHeight: '400px' }}>
        <table className="relative w-full">
          <thead className="sticky top-0 z-10 bg-[#101527]">
            <tr>
              <th className={TH}>Raised</th>
              <th className={TH}>Alarm (as the panel logs it)</th>
              <th className={TH}>Status</th>
              <th className={TH}>Panel id</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {live.length === 0 ? (
              <tr><td colSpan="4" className="px-4 py-8 text-center"><span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">No alarms from the panel yet</span></td></tr>
            ) : live.map((a) => (
              <tr key={a.id} className="hover:bg-white/[0.03]">
                <td className="tabular whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-400 sm:px-6">{fmtWhen(a.at)}</td>
                <td className="px-4 py-3 sm:px-6">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
                    {a.active && <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.7)' }} />}
                    <span className="inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={KIND_STYLE[kindOf(a.message)]}>{kindOf(a.message)}</span>
                    {a.message}
                  </span>
                </td>
                <td className="px-4 py-3 sm:px-6">
                  <span
                    className="inline-block whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
                    style={a.active
                      ? { color: '#f87171', background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' }
                      : { color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }}
                  >
                    {a.active ? 'Active' : a.resetAt ? `Reset ${fmtWhen(a.resetAt)}` : (a.state || 'cleared')}
                  </span>
                </td>
                <td className="tabular whitespace-nowrap px-4 py-3 font-mono text-[12px] text-slate-500 sm:px-6">#{a.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-2 sm:px-6">
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? 'Loading…' : more ? 'Reload history' : 'Load older history'}
        </button>
        {more && <span className="text-[11px] text-slate-500">{more.length} from the database</span>}
        {error && <span className="text-[11px] text-[#f87171]">{error}</span>}
        <span className="ml-auto text-[11px] text-slate-500">{panelAlarms && panelAlarms.at ? `panel read ${fmtWhen(panelAlarms.at)}` : ''}</span>
      </div>
    </div>
  );
}

// Two logs in one card: what this dashboard saw happen, and what the panel itself has logged.
export default function LogTabs({ events, panelAlarms }) {
  const [tab, setTab] = useState('panel');
  useEffect(() => { try { const t = window.localStorage.getItem('pulse.logTab'); if (t === 'events' || t === 'panel') setTab(t); } catch {} }, []);
  const pick = (t) => { setTab(t); try { window.localStorage.setItem('pulse.logTab', t); } catch {} };
  const activeCount = ((panelAlarms && panelAlarms.active) || []).length;
  const TAB = (id, label, count) => (
    <button
      type="button"
      onClick={() => pick(id)}
      aria-pressed={tab === id}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] transition-colors ${tab === id ? 'border-white/20 bg-white/10 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}
    >
      {label}{count != null ? ` · ${count}` : ''}
    </button>
  );
  if (tab === 'events') {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 sm:px-6">
          {TAB('panel', 'Panel alarm history', activeCount ? `${activeCount} active` : null)}
          {TAB('events', "Today's events", events.length)}
        </div>
        <EventsTable events={events} embedded />
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 sm:px-6">
        {TAB('panel', 'Panel alarm history', activeCount ? `${activeCount} active` : null)}
        {TAB('events', "Today's events", events.length)}
      </div>
      <PanelAlarmTable panelAlarms={panelAlarms} />
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { fmtClock } from '../lib/format';

const PILL =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide leading-none';

export default function Header({ connected, alarmsMuted, onToggleAlarms }) {
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    setClock(fmtClock());
    const id = setInterval(() => setClock(fmtClock()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="shrink-0">
      <div className="mx-auto flex min-h-[70px] w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        {/* Left: logo tile + title */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
            <img src="/crystal-logo.jpeg" alt="Crystal" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xl font-semibold leading-tight text-white sm:text-[22px]">Crystal Pulse</div>
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400">Cold Storage · All Sites</div>
          </div>
        </div>

        {/* Right: DB pill, alarms toggle, clock */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div
            className={PILL}
            style={
              connected
                ? { color: '#34d399', background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)' }
                : { color: '#f87171', background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' }
            }
            title={connected ? 'Database connected' : 'Database unreachable'}
            aria-label={connected ? 'DB online' : 'DB offline'}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={
                connected
                  ? { background: '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.9)' }
                  : { background: '#f87171', boxShadow: '0 0 8px rgba(248,113,113,0.9)' }
              }
            />
            {connected ? 'Live · DB online' : 'DB offline'}
          </div>

          <button
            type="button"
            onClick={onToggleAlarms}
            aria-label="Toggle alarms"
            aria-pressed={!alarmsMuted}
            title={alarmsMuted ? 'Alarms muted - click to enable' : 'Alarms on - click to mute'}
            className={`${PILL} transition-colors ${
              alarmsMuted ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10' : 'hover:bg-red-500/25'
            }`}
            style={
              alarmsMuted
                ? undefined
                : { color: '#f87171', background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' }
            }
          >
            {alarmsMuted ? 'Alarms muted' : 'Alarms armed'}
          </button>

          <div className="tabular font-mono text-lg font-medium leading-none text-white sm:text-[26px]" suppressHydrationWarning>
            {clock}
          </div>
        </div>
      </div>
    </header>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { Bell, BellOff, Volume2 } from 'lucide-react';
import { fmtClock } from '../lib/format';

const PILL =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide leading-none';

const GREEN = { color: '#34d399', background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)' };
const GREEN_DOT = { background: '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.9)' };
const RED = { color: '#f87171', background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' };
const RED_DOT = { background: '#f87171', boxShadow: '0 0 8px rgba(248,113,113,0.9)' };
const GREY = { color: '#94a3b8', background: 'rgba(148,163,184,0.10)', borderColor: 'rgba(148,163,184,0.3)' };
const GREY_DOT = { background: '#94a3b8' };

// Where the numbers on screen are coming from right now.
//   null  - nothing has answered yet (first paint / server render): not a fault, just connecting
//   live  - pushed by the plant collector (Supabase Realtime or the self-hosted hub)
//   db    - polled from the Supabase database (the fallback)
function feedPill(connected, source) {
  if (source === null) return { style: GREY, dot: GREY_DOT, text: 'Connecting', title: 'Waiting for the first reading' };
  if (!connected) {
    return source === 'live'
      ? { style: RED, dot: RED_DOT, text: 'Feed stalled', title: 'Collector connected but not sending' }
      : { style: RED, dot: RED_DOT, text: 'DB offline', title: 'Database unreachable' };
  }
  if (source === 'live') return { style: GREEN, dot: GREEN_DOT, text: 'Live · socket', title: 'Readings pushed live by the plant collector' };
  return { style: GREEN, dot: GREEN_DOT, text: 'Live · DB', title: 'Polling the database (live feed not connected)' };
}

export default function Header({ connected, source, alarmsEnabled, onEnableAlarms, onDisableAlarms, onTestSound, testing }) {
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    setClock(fmtClock());
    const id = setInterval(() => setClock(fmtClock()), 1000);
    return () => clearInterval(id);
  }, []);

  const pill = feedPill(connected, source);

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

        {/* Right: feed pill, alarms toggle, clock */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className={PILL} style={pill.style} title={pill.title} aria-label={pill.text}>
            <span className="h-2 w-2 rounded-full" style={pill.dot} />
            {pill.text}
          </div>

          {/* The master alarm switch: sound and pop-ups on / off. Colours and counts stay either way. */}
          <button
            type="button"
            role="switch"
            aria-checked={alarmsEnabled}
            aria-label={alarmsEnabled ? 'Alarms on' : 'Alarms off'}
            title={alarmsEnabled ? 'Alarm sound and pop-ups are on - click to switch off' : 'Alarm sound and pop-ups are off - click to switch on'}
            onClick={() => (alarmsEnabled ? onDisableAlarms() : onEnableAlarms())}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors"
            style={alarmsEnabled
              ? { background: 'rgba(239,68,68,0.35)', borderColor: 'rgba(239,68,68,0.7)' }
              : { background: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.4)' }}
          >
            <span
              className="absolute flex h-5 w-5 items-center justify-center rounded-full transition-all"
              style={{ left: alarmsEnabled ? 22 : 2, background: alarmsEnabled ? '#f87171' : '#94a3b8' }}
            >
              {alarmsEnabled ? <Bell size={12} color="#2a0707" /> : <BellOff size={12} color="#0b0f1e" />}
            </span>
          </button>

          {alarmsEnabled && (
            <button
              type="button"
              onClick={onTestSound}
              aria-label="Test alarm sound"
              title="Play the siren for four seconds to check this screen's sound"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10"
              style={testing ? { color: '#fecaca', background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.5)' } : undefined}
            >
              <Volume2 size={14} />
            </button>
          )}

          <div className="tabular font-mono text-lg font-medium leading-none text-white sm:text-[26px]" suppressHydrationWarning>
            {clock}
          </div>
        </div>
      </div>
    </header>
  );
}

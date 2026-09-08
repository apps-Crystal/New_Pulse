'use client';
import { useEffect, useState } from 'react';
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
  const [confirming, setConfirming] = useState(false); // "Start alarms?" question open

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

          <div className="relative">
            <button
              type="button"
              onClick={() => (alarmsEnabled ? onDisableAlarms() : setConfirming((c) => !c))}
              aria-label={alarmsEnabled ? 'Alarms on' : 'Alarms off'}
              aria-pressed={alarmsEnabled}
              aria-expanded={!alarmsEnabled ? confirming : undefined}
              title={alarmsEnabled ? 'Alarms on - click to switch them off' : 'Alarms off - click to start them'}
              className={`${PILL} transition-colors ${
                alarmsEnabled ? 'hover:bg-red-500/25' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
              style={
                alarmsEnabled
                  ? { color: '#f87171', background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full"
                style={alarmsEnabled ? { background: '#f87171', boxShadow: '0 0 8px rgba(248,113,113,0.9)' } : { background: '#64748b' }}
              />
              {alarmsEnabled ? 'Alarms on' : 'Alarms off'}
            </button>

            {confirming && !alarmsEnabled && (
              <>
                <button type="button" aria-label="Not now" className="fixed inset-0 z-[9990] cursor-default" onClick={() => setConfirming(false)} />
                <div
                  role="dialog"
                  aria-label="Start alarms?"
                  className="absolute right-0 top-[calc(100%+8px)] z-[9991] w-72 rounded-xl border p-4 text-left shadow-2xl"
                  style={{ background: 'rgba(17,23,48,0.98)', borderColor: 'rgba(239,68,68,0.45)' }}
                >
                  <div className="text-[15px] font-semibold leading-tight text-white">Start alarms on this screen?</div>
                  <div className="mt-2 text-[12px] leading-snug text-slate-300">
                    Rooms outside their panel limits will turn red, near-limit rooms yellow, and the siren will sound here.
                    Limits stay visible either way. Remembered for this browser.
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setConfirming(false); onEnableAlarms(); }}
                      className={`${PILL} flex-1 justify-center hover:bg-red-500/30`}
                      style={{ color: '#fecaca', background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.6)' }}
                    >
                      Yes, start alarms
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className={`${PILL} flex-1 justify-center border-white/10 bg-white/5 text-slate-300 hover:bg-white/10`}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {alarmsEnabled && (
            <button
              type="button"
              onClick={onTestSound}
              aria-label="Test alarm sound"
              title="Play the siren for four seconds to check this screen's sound"
              className={`${PILL} border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10`}
              style={testing ? { color: '#fecaca', background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)' } : undefined}
            >
              {testing ? 'Sounding…' : 'Test sound'}
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

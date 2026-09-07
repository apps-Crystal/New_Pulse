'use client';
import { useEffect, useState } from 'react';
import { Bell, BellOff, Database, DatabaseZap } from 'lucide-react';
import { fmtClock } from '../lib/format';
import NavbarPulse from './NavbarPulse';

// Shared pill shell (source header style). Label text is hidden below `sm`; icons always show.
const PILL = 'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all duration-300 sm:px-3';
const PILL_TEXT = 'hidden text-[9px] font-bold uppercase tracking-wide sm:inline';

export default function Header({ connected, alarmsMuted, onToggleAlarms }) {
  const [dark, setDark] = useState(false);
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setClock(fmtClock());
    const id = setInterval(() => setClock(fmtClock()), 1000);
    return () => clearInterval(id);
  }, []);

  function toggleDarkMode() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.theme = next ? 'dark' : 'light'; } catch {}
  }

  return (
    <header className="sticky top-0 z-50 shrink-0 border-b border-slate-200 bg-white shadow-sm transition-colors duration-300 dark:border-[#3A4178] dark:bg-[#252B59]">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 sm:gap-x-4">
          {/* Left: logo group + mini ECG */}
          <div className="flex shrink-0 items-center gap-4">
            <div className="group relative flex h-14 w-44 items-center justify-start overflow-hidden sm:w-80 lg:h-11">
              <img
                src="/pulse-logo.png"
                alt="Crystal Pulse"
                className="absolute left-0 top-[60%] h-36 w-auto max-w-none -translate-y-1/2 object-contain drop-shadow-sm transition-all duration-300 invert hover:scale-105 sm:h-56 lg:h-44 dark:invert-0"
              />

              {/* LIVE indicator - sports broadcast style */}
              <div className="absolute left-3 top-3 z-10 sm:left-4 lg:top-2">
                <div className="flex animate-pulse items-center gap-1 rounded bg-red-600 px-2 py-0.5 shadow-lg">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[9px] font-black uppercase tracking-wider text-white">LIVE</span>
                </div>
              </div>
            </div>

            <div className="hidden lg:block" title={connected ? 'Data feed alive' : 'Data feed down'}>
              <NavbarPulse active={connected} color="#10b981" />
            </div>
          </div>

          {/* Right: DB pill, alarms toggle, theme toggle, system time (clock hidden below sm) */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              className={`${PILL} ${
                connected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'animate-pulse border-red-600 bg-red-500 text-white'
              }`}
              title={connected ? 'Database connected' : 'Database unreachable'}
              aria-label={connected ? 'DB online' : 'DB offline'}
            >
              {connected ? <Database size={14} /> : <DatabaseZap size={14} />}
              <span className={PILL_TEXT}>DB: {connected ? 'ONLINE' : 'OFFLINE'}</span>
            </div>

            <button
              type="button"
              onClick={onToggleAlarms}
              aria-label="Toggle alarms"
              aria-pressed={!alarmsMuted}
              title={alarmsMuted ? 'Alarms muted - click to enable' : 'Alarms on - click to mute'}
              className={`${PILL} ${
                alarmsMuted
                  ? 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800'
                  : 'border-red-600 bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              {alarmsMuted ? <BellOff size={14} /> : <Bell size={14} />}
              <span className={PILL_TEXT}>ALARMS {alarmsMuted ? 'OFF' : 'ON'}</span>
            </button>

            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="Toggle Dark Mode"
              className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-amber-500 dark:border-slate-600 dark:bg-slate-700 dark:text-yellow-400 dark:hover:bg-slate-600"
            >
              {dark ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
              )}
            </button>

            <div className="hidden rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right transition-colors duration-300 sm:block lg:py-1 dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[8px] font-bold uppercase tracking-widest text-slate-400">System Time</div>
              <div className="tabular font-mono text-sm font-bold tracking-tight text-slate-700 transition-colors duration-300 dark:text-slate-200" suppressHydrationWarning>
                {clock}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

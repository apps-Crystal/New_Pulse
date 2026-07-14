'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun, Snowflake, Wifi, WifiOff, Bell, BellOff } from 'lucide-react';
import { fmtClock } from '../lib/format';

export default function Header({ connected, alarmsMuted, onToggleAlarms }) {
  const [dark, setDark] = useState(false);
  const [clock, setClock] = useState('--:--:--');

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    const id = setInterval(() => setClock(fmtClock()), 1000);
    setClock(fmtClock());
    return () => clearInterval(id);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.theme = next ? 'dark' : 'light'; } catch {}
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 dark:border-[#3A4178] bg-white dark:bg-brand-blue">
      <div className="mx-auto max-w-[1280px] px-6 h-16 flex items-center justify-between">
        {/* Left: brand + LIVE */}
        <div className="relative flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="grid place-items-center h-10 w-10 rounded-xl bg-brand-blue dark:bg-white/10">
              <Snowflake className="h-6 w-6 text-white" />
            </div>
            <div className="leading-tight">
              <div className="font-mono font-extrabold text-lg tracking-tight text-brand-blue dark:text-white">
                PULSE
              </div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-300">
                Crystal Cold Storage
              </div>
            </div>
          </div>
          <span className="animate-live inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            <span className="font-mono text-[9px] font-bold tracking-widest text-white">LIVE</span>
          </span>
        </div>

        {/* Right: connection + clock + theme */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
              connected
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 animate-alarm'
            }`}
          >
            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {connected ? 'HMI ONLINE' : 'HMI OFFLINE'}
          </div>

          <button
            onClick={onToggleAlarms}
            aria-label="Toggle alarms"
            title={alarmsMuted ? 'Alarms muted — click to enable' : 'Alarms on — click to mute'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
              alarmsMuted
                ? 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400'
                : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
            }`}
          >
            {alarmsMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {alarmsMuted ? 'ALARMS OFF' : 'ALARMS ON'}
          </button>

          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="grid place-items-center h-9 w-9 rounded-md border border-slate-200 dark:border-[#3A4178] text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="text-right">
            <div className="text-[8px] uppercase tracking-widest text-slate-400 dark:text-slate-400">
              System Time
            </div>
            <div className="tabular font-bold text-sm text-slate-700 dark:text-white">{clock}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

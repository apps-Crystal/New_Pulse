'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, Thermometer } from 'lucide-react';
import { fmtTemp, fmtElapsed } from '../lib/format';

function gridCols(n) {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-2';
  if (n <= 4) return 'grid-cols-2';
  if (n <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

export default function AlarmModal({ alarms }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!alarms.length) return null;
  const single = alarms.length === 1;

  return (
    <div
      className="scanlines fixed inset-0 z-[9999] flex flex-col p-6"
      style={{ background: 'linear-gradient(135deg, #B91C1C, #DC2626, #991B1B)' }}
    >
      <div className="animate-border pointer-events-none absolute inset-3 rounded-2xl border-8 border-white" />

      {/* Top strip */}
      <div className="flex items-center justify-center gap-4 py-3 text-white">
        <AlertTriangle className="h-8 w-8 animate-alarm" />
        <span className="font-mono text-xl font-black uppercase tracking-[0.2em]">
          ⚠ Temperature Alert — Do Not Ignore ⚠
        </span>
        <AlertTriangle className="h-8 w-8 animate-alarm" />
      </div>
      <div className="mb-4 flex items-center justify-center gap-2 text-white/90">
        <span className="h-2.5 w-2.5 animate-alarm rounded-full bg-white" />
        <span className="font-mono text-sm font-bold">
          {alarms.length} Active Alarm{alarms.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Alarm grid */}
      <div className={`grid flex-1 gap-4 overflow-auto ${gridCols(alarms.length)}`}>
        {alarms.map((a) => {
          const outHigh = a.setHigh != null && a.temperature > a.setHigh;
          return (
            <div
              key={a.id}
              className="flex flex-col justify-between rounded-xl border-2 border-white/20 bg-black/40 p-5 backdrop-blur"
            >
              <div className="flex items-start justify-between">
                <div className="grid h-16 w-16 animate-alarm place-items-center rounded-xl bg-white/10">
                  <Thermometer className="h-10 w-10 text-white" />
                </div>
                <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                  Critical
                </span>
              </div>

              <div className="mt-4">
                <div className={`font-mono font-black tracking-wide text-white ${single ? 'text-5xl' : 'text-3xl'}`}>
                  {a.label}
                </div>
                <div className={`mt-2 border-l-4 border-white/60 pl-3 text-white ${single ? 'text-3xl' : 'text-xl'}`}>
                  {outHigh ? 'Temperature above set high' : 'Temperature below set low'}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-white/90">
                  <span className={single ? 'text-4xl font-black' : 'text-2xl font-black'}>
                    {fmtTemp(a.temperature)}
                  </span>
                  <span className="self-end text-sm">
                    range {a.setLow?.toFixed(1)}° … {a.setHigh?.toFixed(1)}°
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="flex items-center gap-1.5 text-xs font-bold text-white/80">
                  <span className="h-2 w-2 animate-alarm rounded-full bg-white" /> LIVE
                </span>
                <span className="rounded-full bg-white px-3 py-1 font-mono text-sm font-bold text-red-700">
                  {fmtElapsed(Date.now() - a.since)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-3 text-center text-xs text-white/70">
        This screen will clear automatically when all temperatures return to range.
      </div>
    </div>
  );
}

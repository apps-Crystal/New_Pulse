'use client';
import { Thermometer } from 'lucide-react';
import { fmtTemp, WARN_MARGIN } from '../lib/format';

/**
 * Right-side floating warning stack for near-limit temperatures (source WarningSystem, yellow severity).
 * No timer: warning start times are not tracked.
 */
export default function WarningToasts({ warnings }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[99999] flex w-80 flex-col gap-3">
      {warnings.map((w, i) => {
        const nearHigh = w.setHigh != null && w.temperature != null && w.temperature >= w.setHigh - WARN_MARGIN;

        return (
          <div
            key={w.id || i}
            className="animate-slide-in-right pointer-events-auto flex items-start gap-3 rounded-lg border-l-[6px] border-yellow-700 bg-yellow-500/90 p-3 text-black shadow-xl backdrop-blur-md transition-all duration-300 hover:scale-105"
          >
            <div className="mt-0.5 rounded-md bg-black/10 p-1.5">
              <Thermometer size={20} className="text-black" strokeWidth={2.5} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center justify-between">
                <h4 className="truncate pr-2 text-xs font-black uppercase tracking-wider">{w.label}</h4>
                <span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest opacity-80">
                  WARNING
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-black" />
                <span className="font-mono text-xs font-bold uppercase">
                  {nearHigh ? 'Approaching set high' : 'Approaching set low'}
                </span>
                <span className="tabular ml-auto font-mono text-sm font-black">{fmtTemp(w.temperature)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

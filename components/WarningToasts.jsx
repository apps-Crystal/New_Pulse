'use client';
import { Thermometer } from 'lucide-react';
import { fmtTemp } from '../lib/format';

export default function WarningToasts({ warnings }) {
  if (!warnings.length) return null;
  return (
    <div className="fixed right-4 top-20 z-[99999] flex w-80 flex-col gap-3">
      {warnings.map((w) => {
        const nearHigh = w.setHigh != null && w.temperature >= w.setHigh - 2;
        return (
          <div
            key={w.id}
            className="animate-toast flex items-center gap-3 rounded-xl border-l-[6px] border-yellow-500 bg-yellow-500/95 p-3 text-white shadow-lg"
          >
            <Thermometer className="h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{w.label}</div>
              <div className="text-xs opacity-90">
                {nearHigh ? 'Approaching set high' : 'Approaching set low'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-alarm rounded-full bg-white" />
              <span className="font-mono text-sm font-bold tabular">{fmtTemp(w.temperature)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

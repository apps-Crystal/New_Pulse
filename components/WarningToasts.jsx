'use client';
import { WARN_MARGIN } from '../lib/format';

/**
 * Right-side floating warning stack for near-limit temperatures.
 * No timer: warning start times are not tracked.
 */
export default function WarningToasts({ warnings }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-[7.5rem] z-[9998] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 md:top-20">
      {warnings.map((w, i) => {
        const nearHigh = w.setHigh != null && w.temperature != null && w.temperature >= w.setHigh - WARN_MARGIN;
        const t = w.temperature;

        return (
          <div
            key={w.id || i}
            className="animate-slide-in-right pointer-events-auto flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3"
            style={{ background: 'rgba(17,23,48,0.96)', borderColor: 'rgba(234,179,8,0.6)' }}
          >
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium leading-tight text-white">{w.label}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#facc15]">
                <span className="h-2 w-2 rounded-full" style={{ background: '#eab308', boxShadow: '0 0 8px rgba(234,179,8,0.6)' }} />
                {w.limitsInvalid ? 'Limits invalid on panel' : nearHigh ? 'Near high' : 'Near low'}
              </div>
            </div>
            <div className="flex shrink-0 items-baseline gap-1">
              <span className="tabular font-mono text-2xl font-bold leading-none text-[#facc15]">
                {t == null || Number.isNaN(t) ? '—' : t.toFixed(1)}
              </span>
              <span className="text-[12px] text-slate-400">°C</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

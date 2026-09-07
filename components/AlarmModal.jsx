'use client';
import { useEffect, useState } from 'react';

/**
 * FULL-SCREEN alert takeover - covers 100% of the viewport.
 * No close button, no clickable elements. Disappears only when every alarm clears.
 * Below `md` the alarm grid collapses to a single column and the takeover scrolls vertically.
 */
function AlertTimer({ startTime, className = '' }) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startTime) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatTime = (totalSeconds) => {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  };

  return (
    <span
      className={`tabular inline-block whitespace-nowrap rounded-full border px-3 py-1 font-mono font-semibold leading-none text-white ${className}`}
      style={{ background: 'rgba(239,68,68,0.18)', borderColor: 'rgba(239,68,68,0.5)' }}
    >
      {formatTime(elapsed)}
    </span>
  );
}

function fmtSide(v) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(1);
}

// Dynamic sizing configuration based on alarm count (phone sizes first, desktop sizes from `md` up).
function getLayoutConfig(count) {
  // Single alarm: maximum size, centred
  if (count === 1) {
    return {
      container: 'flex justify-center items-center w-full max-w-4xl md:h-full',
      card: 'w-full md:max-h-[60vh] flex flex-col justify-center p-6 gap-5 md:p-12 md:gap-8',
      title: 'text-3xl md:text-5xl',
      msg: 'text-base md:text-2xl',
      temp: 'text-6xl md:text-8xl',
      unit: 'text-xl md:text-3xl',
      range: 'text-sm md:text-lg',
      timer: 'text-lg md:text-2xl',
    };
  }
  // Two alarms: split screen, large
  if (count === 2) {
    return {
      container: 'grid content-center grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 w-full max-w-[90vw] items-center',
      card: 'md:aspect-[16/10] flex flex-col justify-between p-5 gap-4 md:p-8 md:gap-6',
      title: 'text-2xl md:text-3xl',
      msg: 'text-sm md:text-lg',
      temp: 'text-5xl md:text-7xl',
      unit: 'text-lg md:text-2xl',
      range: 'text-sm md:text-base',
      timer: 'text-base md:text-xl',
    };
  }
  // 3-4 alarms: 2x2 grid
  if (count <= 4) {
    return {
      container: 'grid content-center grid-cols-1 md:grid-cols-2 md:auto-rows-fr gap-4 md:gap-5 w-full max-w-[90vw] md:h-full md:max-h-[70vh]',
      card: 'flex flex-col justify-between p-5 gap-3 md:p-6 md:gap-4',
      title: 'text-xl md:text-2xl',
      msg: 'text-sm md:text-base',
      temp: 'text-4xl md:text-6xl',
      unit: 'text-base md:text-xl',
      range: 'text-sm',
      timer: 'text-sm md:text-lg',
    };
  }
  // 5-6 alarms: 3x2 grid
  if (count <= 6) {
    return {
      container: 'grid content-center grid-cols-1 sm:grid-cols-2 md:grid-cols-3 md:auto-rows-fr gap-4 w-full max-w-[95vw] md:h-full md:max-h-[75vh]',
      card: 'flex flex-col justify-between p-5 gap-3',
      title: 'text-xl md:text-2xl',
      msg: 'text-sm',
      temp: 'text-4xl md:text-5xl',
      unit: 'text-base md:text-lg',
      range: 'text-sm',
      timer: 'text-sm md:text-base',
    };
  }
  // 7+ alarms: compact grid
  return {
    container: 'grid content-center grid-cols-1 sm:grid-cols-2 md:grid-cols-4 md:auto-rows-fr gap-3 w-full max-w-[98vw] md:h-full md:max-h-[85vh]',
    card: 'flex flex-col justify-between p-4 gap-2',
    title: 'text-lg md:text-xl',
    msg: 'text-xs md:text-sm',
    temp: 'text-4xl md:text-5xl',
    unit: 'text-base',
    range: 'text-xs',
    timer: 'text-xs md:text-sm',
  };
}

export default function AlarmModal({ alarms }) {
  if (!alarms || alarms.length === 0) return null;

  const layout = getLayoutConfig(alarms.length);

  return (
    <div
      className="fixed inset-0 z-[9999] select-none overflow-y-auto overflow-x-hidden"
      style={{
        pointerEvents: 'all',
        cursor: 'default',
        background: 'linear-gradient(180deg, rgba(127,29,29,0.96) 0%, rgba(69,10,10,0.98) 60%, #2a0707 100%)',
      }}
    >
      {/* Pulsing frame around the entire screen */}
      <div className="pointer-events-none fixed inset-0 animate-pulse border-[6px]" style={{ borderColor: 'rgba(239,68,68,0.55)' }} />

      {/* Content - fills the entire screen (scrolls on phones) */}
      <div className="pointer-events-none relative z-10 flex min-h-full w-full flex-col items-center justify-between px-4 py-6 md:px-8 md:py-8">
        {/* Header section */}
        <div className="flex w-full flex-col items-center gap-3 md:gap-4">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-[#fca5a5]"
            style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(239,68,68,0.45)' }}
          >
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.9)' }} />
            Alert active · Do not ignore
          </div>

          <div
            className="inline-flex items-center gap-3 rounded-full border px-5 py-2 md:px-7 md:py-2.5"
            style={{ background: 'rgba(11,15,30,0.7)', borderColor: 'rgba(239,68,68,0.55)' }}
          >
            <span className="tabular font-mono text-2xl font-bold leading-none text-white md:text-3xl">{alarms.length}</span>
            <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-200 md:text-sm">
              Active {alarms.length === 1 ? 'alarm' : 'alarms'}
            </span>
          </div>
        </div>

        {/* Dynamic alarm container */}
        <div className={`my-4 flex w-full flex-1 flex-col items-center justify-center ${layout.container}`}>
          {alarms.map((a, i) => {
            const outHigh = a.setHigh != null && a.temperature != null && a.temperature > a.setHigh;
            const message = outHigh ? 'TEMP TOO HIGH' : 'TEMP TOO LOW';
            const t = a.temperature;

            return (
              <div
                key={a.id || i}
                className={`relative w-full min-w-0 overflow-hidden rounded-[14px] border ${layout.card}`}
                style={{ background: 'rgba(11,15,30,0.82)', borderColor: 'rgba(239,68,68,0.6)' }}
              >
                {/* Title row: name + dot */}
                <div className="flex w-full items-start justify-between gap-3">
                  <div className={`${layout.title} min-w-0 break-words font-semibold leading-tight text-white`}>
                    {a.label || 'Unknown'}
                  </div>
                  <span
                    className="mt-1 h-3 w-3 shrink-0 animate-pulse rounded-full"
                    style={{ background: '#ef4444', boxShadow: '0 0 10px rgba(239,68,68,0.9)' }}
                  />
                </div>

                {/* Main content */}
                <div className="flex w-full min-w-0 flex-1 flex-col justify-center gap-2">
                  <div className={`${layout.msg} font-bold uppercase tracking-[0.18em] text-[#f87171]`}>{message}</div>
                  <div className="flex items-baseline gap-1">
                    <span className={`${layout.temp} tabular whitespace-nowrap font-mono font-bold leading-none text-[#f87171]`}>
                      {t == null || Number.isNaN(t) ? '—' : t.toFixed(1)}
                    </span>
                    <span className={`${layout.unit} font-medium text-slate-400`}>°C</span>
                  </div>
                  <div className={`${layout.range} tabular font-mono text-slate-400`}>
                    Range {fmtSide(a.setLow)} — {fmtSide(a.setHigh)}
                  </div>
                </div>

                {/* Footer: LIVE + timer */}
                <div className="mt-auto flex w-full items-center justify-between border-t border-white/[0.07] pt-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.9)' }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Live</span>
                  </div>

                  {a.since && <AlertTimer startTime={a.since} className={layout.timer} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom message */}
        <div
          className="flex items-center justify-center rounded-full border px-5 py-2 text-center md:px-8"
          style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.1)' }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
            This screen will clear automatically when all temperatures return to range
          </span>
        </div>
      </div>
    </div>
  );
}

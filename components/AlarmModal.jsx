'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, Thermometer } from 'lucide-react';
import { fmtTemp } from '../lib/format';

/**
 * FULL-SCREEN alert takeover - covers 100% of the viewport.
 * No close button, no clickable elements. Disappears only when every alarm clears.
 * Below `md` the alarm grid collapses to a single column and the takeover scrolls vertically.
 */
function AlertTimer({ startTime }) {
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
    <span className="rounded-lg border-2 border-white/20 bg-red-600 px-3 py-1 font-mono text-2xl font-black tracking-widest text-white shadow-lg">
      {formatTime(elapsed)}
    </span>
  );
}

function fmtSetpoint(v) {
  return v == null || Number.isNaN(v) ? '—' : `${v.toFixed(1)}°`;
}

// Dynamic sizing configuration based on alarm count (source layout config, made responsive:
// phone sizes first, the source's desktop sizes from `md` up).
function getLayoutConfig(count) {
  // Single alarm: maximum size, centred
  if (count === 1) {
    return {
      container: 'flex justify-center items-center w-full max-w-5xl md:h-full',
      card: 'w-full md:max-h-[60vh] flex flex-col justify-center p-6 gap-5 md:p-12 md:gap-8',
      icon: 56,
      iconMd: 80,
      title: 'text-4xl md:text-6xl',
      badge: 'px-3 py-1 text-base md:px-6 md:py-2 md:text-2xl',
      msg: 'text-2xl pl-4 border-l-4 py-1 md:text-5xl md:pl-8 md:border-l-[6px] md:py-2',
      temp: 'text-5xl md:text-7xl',
      range: 'text-base md:text-2xl',
      timer: 'scale-125 md:scale-[2.0]',
      live: 'scale-125 gap-2 md:scale-150 md:gap-3',
    };
  }
  // Two alarms: split screen, large
  if (count === 2) {
    return {
      container: 'grid content-center grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 w-full max-w-[90vw] items-center',
      card: 'md:aspect-[16/10] flex flex-col justify-between p-5 gap-4 md:p-8 md:gap-6',
      icon: 44,
      iconMd: 64,
      title: 'text-3xl md:text-4xl',
      badge: 'px-3 py-1 text-sm md:px-4 md:text-lg',
      msg: 'text-xl pl-4 border-l-4 md:text-3xl md:pl-6 md:border-l-[5px]',
      temp: 'text-4xl md:text-5xl',
      range: 'text-sm md:text-lg',
      timer: 'scale-110 md:scale-150',
      live: 'scale-110 gap-2 md:scale-125',
    };
  }
  // 3-4 alarms: 2x2 grid
  if (count <= 4) {
    return {
      container: 'grid content-center grid-cols-1 md:grid-cols-2 md:auto-rows-fr gap-4 md:gap-6 w-full max-w-[90vw] md:h-full md:max-h-[70vh]',
      card: 'flex flex-col justify-between p-5 gap-3 md:p-6 md:gap-4',
      icon: 40,
      iconMd: 48,
      title: 'text-2xl md:text-3xl',
      badge: 'px-3 py-1 text-sm',
      msg: 'text-xl md:text-2xl pl-4 border-l-4',
      temp: 'text-3xl md:text-4xl',
      range: 'text-sm',
      timer: 'scale-100 md:scale-125',
      live: 'scale-100 gap-2 md:scale-110',
    };
  }
  // 5-6 alarms: 3x2 grid
  if (count <= 6) {
    return {
      container: 'grid content-center grid-cols-1 sm:grid-cols-2 md:grid-cols-3 md:auto-rows-fr gap-4 w-full max-w-[95vw] md:h-full md:max-h-[75vh]',
      card: 'flex flex-col justify-between p-5 gap-3',
      icon: 36,
      iconMd: 40,
      title: 'text-2xl md:text-4xl',
      badge: 'px-3 py-1 text-sm',
      msg: 'text-xl md:text-3xl pl-3 border-l-4',
      temp: 'text-3xl md:text-4xl',
      range: 'text-sm',
      timer: 'scale-100 md:scale-110',
      live: 'scale-100 gap-1',
    };
  }
  // 7+ alarms: compact grid
  return {
    container: 'grid content-center grid-cols-1 sm:grid-cols-2 md:grid-cols-4 md:auto-rows-fr gap-3 w-full max-w-[98vw] md:h-full md:max-h-[85vh]',
    card: 'flex flex-col justify-between p-4 gap-2',
    icon: 32,
    iconMd: 36,
    title: 'text-2xl md:text-3xl',
    badge: 'px-2 py-0.5 text-xs',
    msg: 'text-lg md:text-2xl pl-3 border-l-4',
    temp: 'text-3xl',
    range: 'text-xs',
    timer: 'scale-100',
    live: 'scale-90 gap-1',
  };
}

export default function AlarmModal({ alarms }) {
  if (!alarms || alarms.length === 0) return null;

  const layout = getLayoutConfig(alarms.length);

  return (
    <div
      className="fixed inset-0 z-[9999] select-none overflow-y-auto overflow-x-hidden bg-gradient-to-b from-red-700 via-red-600 to-red-800"
      style={{ pointerEvents: 'all', cursor: 'default' }}
    >
      {/* Scan lines */}
      <div
        className="pointer-events-none fixed inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />

      {/* Pulsing border around the entire screen */}
      <div className="pointer-events-none fixed inset-0 animate-pulse border-[8px] border-white/30" />

      {/* Content - fills the entire screen (scrolls on phones) */}
      <div className="pointer-events-none relative z-10 flex min-h-full w-full flex-col items-center justify-between px-4 py-6 md:px-8 md:py-8">
        {/* Header section */}
        <div className="flex w-full flex-col items-center gap-4 md:gap-6">
          <div className="flex items-center justify-center gap-3 rounded-full border border-white/10 bg-black/30 px-5 py-2 text-center backdrop-blur-md md:gap-4 md:px-12">
            <AlertTriangle size={18} className="hidden animate-pulse text-white sm:block" strokeWidth={3} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white md:text-xs md:tracking-[0.4em]">
              ⚠ ALERT ACTIVE — DO NOT IGNORE ⚠
            </span>
            <AlertTriangle size={18} className="hidden animate-pulse text-white sm:block" strokeWidth={3} />
          </div>

          <div className="inline-flex items-center gap-3 rounded-full border-2 border-white/30 bg-black/40 px-5 py-2 shadow-xl backdrop-blur-md md:px-8 md:py-3">
            <div className="h-3 w-3 animate-pulse rounded-full bg-white" />
            <span className="whitespace-nowrap text-sm font-black uppercase tracking-[0.2em] text-white md:text-lg md:tracking-[0.3em]">
              {alarms.length} Active {alarms.length === 1 ? 'Alert' : 'Alerts'}
            </span>
            <div className="h-3 w-3 animate-pulse rounded-full bg-white" />
          </div>
        </div>

        {/* Dynamic alarm container */}
        <div className={`my-4 flex w-full flex-1 flex-col items-center justify-center ${layout.container}`}>
          {alarms.map((a, i) => {
            const outHigh = a.setHigh != null && a.temperature != null && a.temperature > a.setHigh;
            const message = outHigh ? 'TEMP TOO HIGH' : 'TEMP TOO LOW';

            return (
              <div
                key={a.id || i}
                className={`relative w-full min-w-0 overflow-hidden rounded-3xl border-2 border-white/20 bg-black/40 shadow-2xl backdrop-blur-md ${layout.card}`}
              >
                <div className="flex w-full items-start justify-between gap-3">
                  {/* Icon (phone size below md, source size from md up) */}
                  <div className="flex flex-shrink-0 animate-pulse items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-3">
                    <Thermometer size={layout.icon} className="text-white drop-shadow-lg md:hidden" strokeWidth={2} />
                    <Thermometer size={layout.iconMd} className="hidden text-white drop-shadow-lg md:block" strokeWidth={2} />
                  </div>

                  {/* Severity badge */}
                  <span
                    className={`${layout.badge} animate-pulse whitespace-nowrap rounded-lg border border-red-400/50 bg-red-600/90 font-black uppercase tracking-[0.2em] text-white shadow-lg`}
                  >
                    CRITICAL
                  </span>
                </div>

                {/* Main content */}
                <div className="flex w-full min-w-0 flex-1 flex-col justify-center">
                  <div className={`${layout.title} mb-3 break-words font-black uppercase leading-none tracking-tight text-white drop-shadow-lg`}>
                    {a.label || 'Unknown'}
                  </div>
                  <div className={`${layout.msg} border-white/30 font-bold uppercase tracking-widest text-white/90`}>
                    {message}
                  </div>
                  <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <span className={`${layout.temp} tabular font-mono font-black leading-none text-white drop-shadow-lg`}>
                      {fmtTemp(a.temperature)}
                    </span>
                    <span className={`${layout.range} font-mono font-bold uppercase tracking-widest text-white/70`}>
                      range {fmtSetpoint(a.setLow)} … {fmtSetpoint(a.setHigh)}
                    </span>
                  </div>
                </div>

                {/* Footer: LIVE + timer */}
                <div className="mt-auto flex w-full items-center justify-between border-t border-white/10 pt-4">
                  <div className={`flex items-center ${layout.live}`}>
                    <div className="h-3 w-3 animate-pulse rounded-full bg-white shadow-lg shadow-white/50" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60">LIVE</span>
                  </div>

                  {a.since && (
                    <div className={`origin-right ${layout.timer}`}>
                      <AlertTimer startTime={a.since} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom message */}
        <div className="flex items-center justify-center rounded-full border border-white/10 bg-black/30 px-5 py-2 text-center backdrop-blur-md md:px-8">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
            This screen will clear automatically when all temperatures return to range
          </span>
        </div>
      </div>
    </div>
  );
}

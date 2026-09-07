'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, Thermometer } from 'lucide-react';
import { fmtTemp } from '../lib/format';

/**
 * FULL-SCREEN alert takeover - covers 100% of the viewport.
 * No close button, no clickable elements. Disappears only when every alarm clears.
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

// Dynamic sizing configuration based on alarm count (source layout config + temperature sizes)
function getLayoutConfig(count) {
  // Single alarm: maximum size, centred
  if (count === 1) {
    return {
      container: 'flex justify-center items-center w-full max-w-5xl h-full',
      card: 'w-full max-h-[60vh] flex flex-col justify-center p-12 gap-8',
      icon: 80,
      title: 'text-6xl',
      badge: 'px-6 py-2 text-2xl',
      msg: 'text-5xl pl-8 border-l-[6px] py-2',
      temp: 'text-7xl',
      range: 'text-2xl',
      timer: 'scale-[2.0]',
      live: 'scale-150 gap-3',
    };
  }
  // Two alarms: split screen, large
  if (count === 2) {
    return {
      container: 'grid grid-cols-2 gap-10 w-full max-w-[90vw] items-center',
      card: 'aspect-[16/10] flex flex-col justify-between p-8 gap-6',
      icon: 64,
      title: 'text-4xl',
      badge: 'px-4 py-1 text-lg',
      msg: 'text-3xl pl-6 border-l-[5px]',
      temp: 'text-5xl',
      range: 'text-lg',
      timer: 'scale-150',
      live: 'scale-125 gap-2',
    };
  }
  // 3-4 alarms: 2x2 grid
  if (count <= 4) {
    return {
      container: 'grid grid-cols-2 auto-rows-fr gap-6 w-full max-w-[90vw] h-full max-h-[70vh]',
      card: 'flex flex-col justify-between p-6 gap-4',
      icon: 48,
      title: 'text-3xl',
      badge: 'px-3 py-1 text-sm',
      msg: 'text-2xl pl-4 border-l-4',
      temp: 'text-4xl',
      range: 'text-sm',
      timer: 'scale-125',
      live: 'scale-110 gap-2',
    };
  }
  // 5-6 alarms: 3x2 grid
  if (count <= 6) {
    return {
      container: 'grid grid-cols-3 auto-rows-fr gap-4 w-full max-w-[95vw] h-full max-h-[75vh]',
      card: 'flex flex-col justify-between p-5 gap-3',
      icon: 40,
      title: 'text-4xl',
      badge: 'px-3 py-1 text-sm',
      msg: 'text-3xl pl-3 border-l-4',
      temp: 'text-4xl',
      range: 'text-sm',
      timer: 'scale-110',
      live: 'scale-100 gap-1',
    };
  }
  // 7+ alarms: compact grid
  return {
    container: 'grid grid-cols-4 auto-rows-fr gap-3 w-full max-w-[98vw] h-full max-h-[85vh]',
    card: 'flex flex-col justify-between p-4 gap-2',
    icon: 36,
    title: 'text-3xl',
    badge: 'px-2 py-0.5 text-xs',
    msg: 'text-2xl pl-3 border-l-4',
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
    <div className="fixed inset-0 z-[9999] select-none overflow-hidden" style={{ pointerEvents: 'all', cursor: 'default' }}>
      {/* Full-screen red background */}
      <div className="absolute inset-0 bg-gradient-to-b from-red-700 via-red-600 to-red-800" />

      {/* Scan lines */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
        }}
      />

      {/* Pulsing border around the entire screen */}
      <div className="absolute inset-0 animate-pulse border-[8px] border-white/30" />

      {/* Content - fills the entire screen */}
      <div className="pointer-events-none relative z-10 flex h-full w-full flex-col items-center justify-between px-8 py-8">
        {/* Header section */}
        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex items-center justify-center gap-4 rounded-full border border-white/10 bg-black/30 px-12 py-2 backdrop-blur-md">
            <AlertTriangle size={18} className="animate-pulse text-white" strokeWidth={3} />
            <span className="text-xs font-black uppercase tracking-[0.4em] text-white">
              ⚠ ALERT ACTIVE — DO NOT IGNORE ⚠
            </span>
            <AlertTriangle size={18} className="animate-pulse text-white" strokeWidth={3} />
          </div>

          <div className="inline-flex items-center gap-3 rounded-full border-2 border-white/30 bg-black/40 px-8 py-3 shadow-xl backdrop-blur-md">
            <div className="h-3 w-3 animate-pulse rounded-full bg-white" />
            <span className="text-lg font-black uppercase tracking-[0.3em] text-white">
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
                className={`relative overflow-hidden rounded-3xl border-2 border-white/20 bg-black/40 shadow-2xl backdrop-blur-md ${layout.card}`}
              >
                <div className="flex w-full items-start justify-between">
                  {/* Icon */}
                  <div className="flex flex-shrink-0 animate-pulse items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-3">
                    <Thermometer size={layout.icon} className="text-white drop-shadow-lg" strokeWidth={2} />
                  </div>

                  {/* Severity badge */}
                  <span
                    className={`${layout.badge} animate-pulse rounded-lg border border-red-400/50 bg-red-600/90 font-black uppercase tracking-[0.2em] text-white shadow-lg`}
                  >
                    CRITICAL
                  </span>
                </div>

                {/* Main content */}
                <div className="flex w-full flex-1 flex-col justify-center">
                  <div className={`${layout.title} mb-3 font-black uppercase leading-none tracking-tight text-white drop-shadow-lg`}>
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
        <div className="flex items-center justify-center rounded-full border border-white/10 bg-black/30 px-8 py-2 backdrop-blur-md">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
            This screen will clear automatically when all temperatures return to range
          </span>
        </div>
      </div>
    </div>
  );
}

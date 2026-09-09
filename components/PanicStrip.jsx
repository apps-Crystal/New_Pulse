'use client';
import { Siren, Zap } from 'lucide-react';

// The plant's five panic buttons and the phase preventer, straight from the panel's INPUT screen.
// A pressed button is the most urgent thing on the page: it is shown red here whether or not alarms are
// switched on for this screen; the siren and the takeover follow the alarm switch like everything else.
export default function PanicStrip({ panic, phase, updatedAt }) {
  if ((!panic || panic.length === 0) && !phase) return null;
  const pressed = (panic || []).filter((p) => p.pressed);
  return (
    <div
      className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5"
      style={pressed.length ? { borderColor: 'rgba(239,68,68,0.6)', background: 'rgba(239,68,68,0.10)' } : undefined}
    >
      <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
        <Siren size={14} className={pressed.length ? 'text-[#f87171]' : 'text-slate-400'} />
        Panic buttons
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {(panic || []).map((p) => (
          <span
            key={p.tag}
            title={`${p.tag}: ${p.pressed ? 'PRESSED' : 'not pressed'}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${p.pressed ? 'animate-pulse' : ''}`}
            style={
              p.pressed
                ? { color: '#fecaca', background: 'rgba(239,68,68,0.28)', borderColor: 'rgba(239,68,68,0.7)' }
                : { color: '#86efac', background: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.35)' }
            }
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.pressed ? '#ef4444' : '#34d399' }} />
            {p.n} {p.pressed ? 'Pressed' : 'OK'}
          </span>
        ))}
      </div>
      {phase && (
        <span
          title={`Phase preventer: ${phase.ok ? 'phases healthy' : 'PHASE FAULT'}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
          style={
            phase.ok
              ? { color: '#86efac', background: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.35)' }
              : { color: '#fecaca', background: 'rgba(239,68,68,0.28)', borderColor: 'rgba(239,68,68,0.7)' }
          }
        >
          <Zap size={12} />
          Phase {phase.ok ? 'OK' : 'Fault'}
        </span>
      )}
      {pressed.length > 0 && (
        <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-[#fca5a5] sm:w-auto">
          {pressed.map((p) => p.tag).join(', ')} pressed — someone may need help
        </span>
      )}
    </div>
  );
}

'use client';
import { zoneStatus, WARN_MARGIN } from '../lib/format';

function fmtSide(v) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(1);
}

const DOT = {
  ok: { background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.75)' },
  warning: { background: '#eab308', boxShadow: '0 0 8px rgba(234,179,8,0.6)' },
  alarm: { background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.7)' },
  offline: { background: '#64748b' },
};

const TINT = {
  warning: { borderColor: 'rgba(234,179,8,0.55)', background: 'rgba(234,179,8,0.06)' },
  alarm: { borderColor: 'rgba(239,68,68,0.55)', background: 'rgba(239,68,68,0.08)' },
  offline: { background: 'rgba(0,0,0,0.18)' },
};

export default function RoomCard({ room, alarmsEnabled = true }) {
  // Alarms off: the card keeps its limits line but never colours; only "no signal" still shows.
  const status = alarmsEnabled ? zoneStatus(room) : zoneStatus(room) === 'offline' ? 'offline' : 'ok';
  const t = room.temperature;
  const outHigh = room.setHigh != null && t != null && t > room.setHigh;
  const nearHigh = room.setHigh != null && t != null && t >= room.setHigh - WARN_MARGIN;

  let label = null;
  let labelClass = '';
  if (status === 'alarm') {
    label = outHigh ? 'TEMP TOO HIGH' : 'TEMP TOO LOW';
    labelClass = 'text-[#f87171]';
  } else if (status === 'warning') {
    label = room.limitsInvalid ? 'LIMITS INVALID' : nearHigh ? 'NEAR HIGH' : 'NEAR LOW';
    labelClass = 'text-[#facc15]';
  } else if (status === 'offline') {
    label = 'NO SIGNAL';
    labelClass = 'text-slate-500';
  }

  const tempClass =
    status === 'alarm' ? 'text-[#f87171]' : status === 'warning' ? 'text-[#facc15]' : 'text-white';
  const range = status === 'offline' ? '— — —' : `${fmtSide(room.setLow)} — ${fmtSide(room.setHigh)}`;

  return (
    <div
      className={`card flex min-w-0 flex-col justify-between gap-2 p-4 lg:h-full lg:min-h-0 lg:py-3 ${
        status === 'offline' ? 'text-slate-500' : ''
      }`}
      style={TINT[status]}
    >
      {/* Top: name + status dot */}
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate text-[15px] font-medium leading-tight ${status === 'offline' ? 'text-slate-500' : 'text-white'}`}>
          {room.label}
        </span>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={DOT[status]} />
      </div>

      {/* Middle: temperature */}
      <div className="flex min-h-0 items-baseline gap-1">
        {status === 'offline' || t == null ? (
          <span className="tabular font-mono text-[clamp(2rem,4.2vh,3rem)] font-bold leading-none text-slate-500">—</span>
        ) : (
          <>
            <span className={`tabular whitespace-nowrap font-mono text-[clamp(2rem,4.2vh,3rem)] font-bold leading-none ${tempClass}`}>
              {t.toFixed(1)}
            </span>
            <span className="text-[13px] font-medium text-slate-400">°C</span>
          </>
        )}
      </div>

      {/* Bottom: setpoint range + status label */}
      <div className="flex items-center justify-between gap-2">
        <span className="tabular whitespace-nowrap font-mono text-[11px] text-slate-500">{range}</span>
        {label && <span className={`whitespace-nowrap text-[11px] font-bold uppercase tracking-wide ${labelClass}`}>{label}</span>}
      </div>
    </div>
  );
}

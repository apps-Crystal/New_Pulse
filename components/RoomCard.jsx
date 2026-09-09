'use client';
import { DoorOpen, DoorClosed } from 'lucide-react';
import { zoneStatus, WARN_MARGIN } from '../lib/format';

function fmtOpenFor(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

// The room's door contacts from the panel's INPUT screen; a room can have two (Chiller Room 1). An open
// door shows how long it has been open; once it is an alarm the pill turns red with the card.
function DoorPills({ doors, alarm }) {
  if (!doors || doors.length === 0) return null;
  const now = Date.now();
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {doors.map((d) => (
        <span
          key={d.tag}
          title={`${d.tag}: ${d.open ? `OPEN for ${fmtOpenFor(now - d.since)}` : 'closed'}`}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${d.open ? 'animate-pulse' : ''}`}
          style={d.open
            ? (alarm
              ? { color: '#fecaca', background: 'rgba(239,68,68,0.22)', borderColor: 'rgba(239,68,68,0.6)' }
              : { color: '#fcd34d', background: 'rgba(245,158,11,0.16)', borderColor: 'rgba(245,158,11,0.55)' })
            : { color: '#64748b', background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          {d.open ? <DoorOpen size={11} /> : <DoorClosed size={11} />}
          {doors.length > 1 ? `${d.label.replace('Door ', 'D')} ` : ''}{d.open ? `Open ${fmtOpenFor(now - d.since)}` : 'Closed'}
        </span>
      ))}
    </div>
  );
}

function fmtSide(v) {
  return v == null || Number.isNaN(v) ? '—' : v.toFixed(1);
}

const DOT = {
  off: { background: '#475569' },
  fault: { background: '#94a3b8' },
  ok: { background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.75)' },
  warning: { background: '#eab308', boxShadow: '0 0 8px rgba(234,179,8,0.6)' },
  alarm: { background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.7)' },
  offline: { background: '#64748b' },
};

const TINT = {
  off: { opacity: 0.55, borderStyle: 'dashed' },
  fault: { borderColor: 'rgba(148,163,184,0.45)', background: 'rgba(148,163,184,0.07)' },
  warning: { borderColor: 'rgba(234,179,8,0.55)', background: 'rgba(234,179,8,0.06)' },
  alarm: { borderColor: 'rgba(239,68,68,0.55)', background: 'rgba(239,68,68,0.08)' },
  offline: { background: 'rgba(0,0,0,0.18)' },
};

export default function RoomCard({ room, alarmsEnabled = true, doors = null, doorAlarm = false, onToggleOperational = null }) {
  // Colours never depend on the alarm switch. A door alarm colours the card red like a temperature
  // alarm; a room out of service is dimmed; a room whose sensor is broken is grey with its note.
  const operational = room.operational !== false;
  const fault = operational && room.sensorFault === true;
  const tempStatus = !operational ? 'off' : fault ? 'fault' : zoneStatus(room);
  const status = operational && doorAlarm && tempStatus !== 'alarm' ? 'alarm' : tempStatus;
  const t = room.temperature;
  const outHigh = room.setHigh != null && t != null && t > room.setHigh;
  const nearHigh = room.setHigh != null && t != null && t >= room.setHigh - WARN_MARGIN;

  let label = null;
  let labelClass = '';
  if (status === 'alarm') {
    label = tempStatus === 'alarm' ? (outHigh ? 'TEMP TOO HIGH' : 'TEMP TOO LOW') : 'DOOR OPEN';
    labelClass = 'text-[#f87171]';
  } else if (status === 'warning') {
    label = room.limitsInvalid ? 'LIMITS INVALID' : nearHigh ? 'NEAR HIGH' : 'NEAR LOW';
    labelClass = 'text-[#facc15]';
  } else if (status === 'offline') {
    label = 'NO SIGNAL';
    labelClass = 'text-slate-500';
  } else if (status === 'off') {
    label = 'OUT OF SERVICE';
    labelClass = 'text-slate-500';
  } else if (status === 'fault') {
    label = 'SENSOR NOT WORKING';
    labelClass = 'text-slate-400';
  }

  const tempClass =
    tempStatus === 'alarm' ? 'text-[#f87171]' : tempStatus === 'warning' ? 'text-[#facc15]' : tempStatus === 'fault' ? 'text-slate-500 line-through decoration-slate-600' : 'text-white';
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

      {/* Middle: temperature, with the door state beside it */}
      <div className="flex min-h-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
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
        <DoorPills doors={doors} alarm={operational && doorAlarm} />
      </div>
      {room.note && <div className="truncate text-[11px] italic text-slate-400" title={room.note}>{room.note}</div>}

      {/* Bottom: setpoint range + status label */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="tabular whitespace-nowrap font-mono text-[11px] text-slate-500"
          title={room.limitsSwapped ? 'The panel has these two the other way round; shown corrected' : undefined}
        >
          {range}{room.limitsSwapped ? ' \u21c4' : ''}
        </span>
        <span className="flex items-center gap-2">
          {label && <span className={`whitespace-nowrap text-[11px] font-bold uppercase tracking-wide ${labelClass}`}>{label}</span>}
          {onToggleOperational && (
            <button
              type="button"
              role="switch"
              aria-checked={operational}
              aria-label={`${room.label}: ${operational ? 'in service' : 'out of service'}`}
              title={operational ? 'In service — click to mark out of service (no alarms from this room)' : 'Out of service — click to put back in service'}
              onClick={() => onToggleOperational(room.id, !operational)}
              className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors"
              style={operational
                ? { background: 'rgba(52,211,153,0.35)', borderColor: 'rgba(52,211,153,0.6)' }
                : { background: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.4)' }}
            >
              <span
                className="absolute h-3 w-3 rounded-full transition-all"
                style={{ left: operational ? 14 : 1, background: operational ? '#34d399' : '#94a3b8' }}
              />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

'use client';
import { Thermometer, AlertTriangle, Snowflake, Wind } from 'lucide-react';
import { fmtTemp, zoneStatus, statusLabel } from '../lib/format';

function cardColor(status, type) {
  switch (status) {
    case 'alarm':
      return 'bg-red-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'offline':
      return 'bg-slate-600 grayscale';
    default:
      if (type === 'frozen') return 'bg-sky-600';
      if (type === 'chiller') return 'bg-emerald-500';
      return 'bg-slate-500';
  }
}

function fmtSetpoint(v) {
  return v == null || Number.isNaN(v) ? '—' : `${v.toFixed(1)}°`;
}

// Setpoint tile: icon tile + label + value (re-purposed source SensorIcon)
function SetpointTile({ icon: Icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative rounded-md bg-white/20 p-1.5 backdrop-blur-sm lg:p-1">
        <Icon size={20} className="text-white drop-shadow-sm lg:h-4 lg:w-4" strokeWidth={2.5} />
      </div>
      <span className="scale-90 text-[9px] font-bold uppercase tracking-wider text-white/90">{label}</span>
      <span className="tabular font-mono text-xs font-bold text-white drop-shadow-sm">{value}</span>
    </div>
  );
}

export default function RoomCard({ room }) {
  const status = zoneStatus(room);
  const t = room.temperature;
  const outHigh = room.setHigh != null && t != null && t > room.setHigh;
  const outLow = room.setLow != null && t != null && t < room.setLow;
  const nearHigh = room.setHigh != null && t != null && !outHigh && !outLow && t >= room.setHigh - 2;

  let banner = null;
  if (status === 'alarm') banner = outHigh ? 'TEMP TOO HIGH' : outLow ? 'TEMP TOO LOW' : 'OUT OF RANGE';
  else if (status === 'warning') banner = nearHigh ? 'NEAR SET HIGH' : 'NEAR SET LOW';
  else if (status === 'offline') banner = 'Sensor Inactive';

  const TypeIcon = room.type === 'frozen' ? Snowflake : Wind;

  return (
    <div
      className={`flex transform flex-col justify-between overflow-hidden rounded-lg text-white shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg lg:h-full lg:min-h-0 ${cardColor(status, room.type)}`}
    >
      <div>
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-white/10 bg-black/10 px-3 py-2 lg:px-2.5 lg:py-1">
          <span className="truncate pr-2 text-xs font-bold uppercase tracking-widest text-white drop-shadow-md">
            {room.label}
          </span>
          <div
            className={`shrink-0 rounded border border-white/20 px-2 py-1 backdrop-blur-md lg:py-0.5 ${
              status === 'offline' ? 'bg-black/40' : 'bg-white/20'
            }`}
          >
            <span className="text-[9px] font-bold uppercase tracking-wide text-white">{statusLabel(status)}</span>
          </div>
        </div>

        {/* Alert banner */}
        {banner && (
          <div className={`flex items-center gap-2 bg-black/20 px-3 py-1 lg:px-2.5 lg:py-0.5 ${status === 'offline' ? '' : 'animate-pulse'}`}>
            <AlertTriangle size={12} className="text-white" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-white">{banner}</span>
          </div>
        )}
      </div>

      {/* LOW setpoint | temperature centrepiece | HIGH setpoint */}
      <div className="grid min-h-0 flex-grow grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/10 bg-black/10 px-3 py-3 lg:px-2.5 lg:py-1.5">
        <SetpointTile icon={TypeIcon} label="Low" value={fmtSetpoint(room.setLow)} />

        <div className="flex flex-col items-center gap-1 lg:gap-0.5">
          <div className="relative rounded-md bg-white/20 p-2 backdrop-blur-sm lg:p-1.5">
            <Thermometer size={20} className="text-white drop-shadow-sm lg:h-4 lg:w-4" strokeWidth={2.5} />
          </div>
          <span
            className={`tabular whitespace-nowrap font-mono text-2xl font-black leading-tight tracking-tight drop-shadow-md lg:text-[clamp(1.25rem,3vh,2.75rem)] lg:leading-none ${
              status === 'offline' ? 'text-white/50' : 'text-white'
            }`}
          >
            {fmtTemp(t)}
          </span>
        </div>

        <SetpointTile icon={TypeIcon} label="High" value={fmtSetpoint(room.setHigh)} />
      </div>
    </div>
  );
}

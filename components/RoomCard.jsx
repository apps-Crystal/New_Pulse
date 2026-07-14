'use client';
import { Thermometer, AlertTriangle, Snowflake, Wind, WifiOff } from 'lucide-react';
import { fmtTemp, zoneStatus, statusLabel } from '../lib/format';

const BG = {
  okChiller: 'bg-emerald-500',
  okFrozen: 'bg-sky-600',
  okOther: 'bg-slate-500',
  warning: 'bg-yellow-500',
  alarm: 'bg-red-500',
  offline: 'bg-slate-600 grayscale',
};

export default function RoomCard({ room }) {
  const status = zoneStatus(room);
  let bg;
  if (status === 'alarm') bg = BG.alarm;
  else if (status === 'warning') bg = BG.warning;
  else if (status === 'offline') bg = BG.offline;
  else bg = room.type === 'frozen' ? BG.okFrozen : room.type === 'chiller' ? BG.okChiller : BG.okOther;

  const t = room.temperature;
  const outHigh = room.setHigh != null && t != null && t > room.setHigh;
  const outLow = room.setLow != null && t != null && t < room.setLow;
  const tempClass = status === 'offline' ? 'text-white/40' : (outHigh || outLow) ? 'text-amber-200' : 'text-white';

  return (
    <div
      className={`group relative overflow-hidden rounded-xl ${bg} text-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg`}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between bg-black/10 px-3 py-2">
        <span className="font-mono text-[12px] font-bold uppercase tracking-wider">{room.label}</span>
        <span className="rounded-md bg-white/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">
          {statusLabel(status)}
        </span>
      </div>

      {/* Alarm banner */}
      {status === 'alarm' && (
        <div className="flex items-center gap-1.5 bg-black/20 px-3 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 animate-alarm" />
          <span className="text-[10px] font-bold uppercase tracking-wide">
            {outHigh ? 'TEMP TOO HIGH' : outLow ? 'TEMP TOO LOW' : 'OUT OF RANGE'}
          </span>
        </div>
      )}

      {/* Temperature centerpiece */}
      <div className="flex items-center justify-center gap-2 bg-black/[0.15] py-4">
        {status === 'offline' ? <WifiOff className="h-6 w-6 opacity-60" /> : <Thermometer className="h-7 w-7" />}
        <span className={`font-mono text-4xl font-black tabular ${tempClass}`}>{fmtTemp(t)}</span>
      </div>

      {/* Setpoint range */}
      <div className="flex items-center justify-between bg-black/10 px-3 py-2 text-[10px] font-semibold">
        <span className="flex items-center gap-1 opacity-90">
          {room.type === 'frozen' ? <Snowflake className="h-3 w-3" /> : <Wind className="h-3 w-3" />}
          LOW {room.setLow != null ? `${room.setLow.toFixed(1)}°` : '—'}
        </span>
        <span className="opacity-90">HIGH {room.setHigh != null ? `${room.setHigh.toFixed(1)}°` : '—'}</span>
      </div>
    </div>
  );
}

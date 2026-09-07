'use client';
import { Activity, CheckCircle, AlertTriangle, Thermometer } from 'lucide-react';

// SCADA-style bold metric card (source design)
function MetricCard({ icon: Icon, label, value, colorClass, shadowClass }) {
  return (
    <div
      className={`relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/20 p-4 text-white shadow-lg ${colorClass} ${shadowClass}`}
    >
      {/* Background icon watermark */}
      <div className="absolute right-0 top-0 -translate-y-1/4 translate-x-1/4 transform p-2 opacity-10">
        <Icon size={60} strokeWidth={3} />
      </div>

      {/* Icon tile */}
      <div className="relative z-10 rounded-lg bg-white/10 p-2 backdrop-blur-sm">
        <Icon size={32} strokeWidth={2.5} />
      </div>

      {/* Text */}
      <div className="relative z-10 flex-1">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider opacity-90">{label}</div>
        <div className="tabular text-2xl font-black tracking-tight">{value}</div>
      </div>
    </div>
  );
}

const ORANGE = 'bg-gradient-to-br from-pulse-orange to-pulse-orange-dark';
const ORANGE_SHADOW = 'shadow-pulse-orange/20';

export default function MetricCards({ total, normal, alarm, warning }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={Activity}
        label="Total Zones"
        value={`${total}/${total}`}
        colorClass="bg-gradient-to-br from-pulse-blue to-pulse-blue-dark"
        shadowClass="shadow-pulse-blue/20"
      />
      <MetricCard
        icon={CheckCircle}
        label="Zones Normal"
        value={String(normal)}
        colorClass={ORANGE}
        shadowClass={ORANGE_SHADOW}
      />
      <MetricCard
        icon={Thermometer}
        label="Warnings"
        value={String(warning)}
        colorClass={warning > 0 ? 'bg-gradient-to-br from-amber-400 to-amber-500' : ORANGE}
        shadowClass={warning > 0 ? 'shadow-amber-500/20' : ORANGE_SHADOW}
      />
      <MetricCard
        icon={AlertTriangle}
        label="Temp Alarms"
        value={String(alarm)}
        colorClass={alarm > 0 ? 'bg-gradient-to-br from-red-500 to-red-600' : ORANGE}
        shadowClass={alarm > 0 ? 'shadow-red-500/20' : ORANGE_SHADOW}
      />
    </div>
  );
}

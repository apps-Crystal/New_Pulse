'use client';
import { Activity, CheckCircle, AlertTriangle, Thermometer } from 'lucide-react';

// SCADA-style bold metric card (source design). At lg+ it collapses to a single compact row
// (small icon tile, label and value side by side) so the kiosk view fits on one screen.
function MetricCard({ icon: Icon, label, value, colorClass, shadowClass }) {
  return (
    <div
      className={`relative flex items-center gap-3 overflow-hidden rounded-xl border border-white/20 p-4 text-white shadow-lg lg:gap-2.5 lg:rounded-lg lg:px-3 lg:py-2 ${colorClass} ${shadowClass}`}
    >
      {/* Background icon watermark */}
      <div className="absolute right-0 top-0 -translate-y-1/4 translate-x-1/4 transform p-2 opacity-10">
        <Icon size={60} strokeWidth={3} className="lg:h-10 lg:w-10" />
      </div>

      {/* Icon tile */}
      <div className="relative z-10 rounded-lg bg-white/10 p-2 backdrop-blur-sm lg:rounded-md lg:p-1.5">
        <Icon size={32} strokeWidth={2.5} className="lg:h-5 lg:w-5" />
      </div>

      {/* Text: stacked below lg, side by side at lg+ */}
      <div className="relative z-10 flex-1 lg:flex lg:min-w-0 lg:items-baseline lg:justify-between lg:gap-2">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider opacity-90 lg:mb-0 lg:truncate lg:text-[11px]">{label}</div>
        <div className="tabular text-2xl font-black tracking-tight lg:text-xl lg:leading-none">{value}</div>
      </div>
    </div>
  );
}

const ORANGE = 'bg-gradient-to-br from-pulse-orange to-pulse-orange-dark';
const ORANGE_SHADOW = 'shadow-pulse-orange/20';

export default function MetricCards({ total, normal, alarm, warning }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3">
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

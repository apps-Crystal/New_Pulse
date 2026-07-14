'use client';
import { Activity, CheckCircle, AlertTriangle, Thermometer } from 'lucide-react';

function Card({ icon: Icon, label, value, gradient, accent }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 text-white shadow-lg"
      style={{ background: gradient, boxShadow: `0 8px 24px -8px ${accent}` }}
    >
      <Icon className="absolute -right-2 -top-2 h-16 w-16 opacity-10" />
      <div className="mb-3 grid h-8 w-8 place-items-center rounded-lg bg-white/10">
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">{label}</div>
      <div className="mt-1 font-mono text-2xl font-black tabular">{value}</div>
    </div>
  );
}

export default function MetricCards({ total, normal, alarm, warning }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card
        icon={Activity}
        label="Total Zones"
        value={`${total}/${total}`}
        gradient="linear-gradient(135deg, #252B59, #1A1E3F)"
        accent="rgba(37,43,89,0.4)"
      />
      <Card
        icon={CheckCircle}
        label="Zones Normal"
        value={String(normal)}
        gradient="linear-gradient(135deg, #F79B1E, #E68A0D)"
        accent="rgba(247,155,30,0.4)"
      />
      <Card
        icon={Thermometer}
        label="Warnings"
        value={String(warning)}
        gradient={warning > 0
          ? 'linear-gradient(135deg, #EAB308, #CA8A04)'
          : 'linear-gradient(135deg, #F79B1E, #E68A0D)'}
        accent="rgba(234,179,8,0.4)"
      />
      <Card
        icon={AlertTriangle}
        label="Temp Alarms"
        value={String(alarm)}
        gradient={alarm > 0
          ? 'linear-gradient(135deg, #EF4444, #B91C1C)'
          : 'linear-gradient(135deg, #F79B1E, #E68A0D)'}
        accent="rgba(239,68,68,0.45)"
      />
    </div>
  );
}

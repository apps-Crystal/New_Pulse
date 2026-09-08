'use client';

function MetricCard({ label, value, labelClass, valueClass, style }) {
  return (
    <div className="card flex h-[84px] items-center justify-between px-5" style={style}>
      <span className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${labelClass}`}>{label}</span>
      <span className={`tabular font-mono text-[30px] font-bold leading-none ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function MetricCards({ total, normal, alarm, warning, alarmsEnabled = true }) {
  const off = !alarmsEnabled;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Total Zones"
        value={String(total)}
        labelClass="text-[#f79b1e]"
        valueClass="text-white"
        style={{
          borderColor: 'rgba(247,155,30,0.45)',
          background:
            'radial-gradient(circle at 90% 50%, rgba(247,155,30,0.16) 0%, rgba(247,155,30,0.04) 45%, rgba(255,255,255,0.03) 75%)',
        }}
      />
      <MetricCard label="Normal" value={String(normal)} labelClass="text-slate-300" valueClass="text-[#34d399]" />
      <MetricCard
        label="Warnings"
        value={off ? 'Off' : String(warning)}
        labelClass="text-slate-300"
        valueClass={off ? 'text-slate-500 text-[22px]' : 'text-[#facc15]'}
      />
      <MetricCard
        label="Temp Alarms"
        value={off ? 'Off' : String(alarm)}
        labelClass={off ? 'text-slate-300' : 'text-[#f87171]'}
        valueClass={off ? 'text-slate-500 text-[22px]' : 'text-[#f87171]'}
        style={!off && alarm > 0 ? { borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.07)' } : undefined}
      />
    </div>
  );
}

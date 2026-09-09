'use client';

const TH = 'whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:px-6';

export default function EventsTable({ events, embedded = false }) {
  return (
    <div className={embedded ? '' : 'card overflow-hidden'}>
      {/* Header (the log tabs draw their own) */}
      {!embedded && (
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">Today's Events</h2>
          <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-slate-400">
            {events.length} logs
          </span>
        </div>
      )}

      {/* Table */}
      <div className="scrollbar-thin overflow-x-auto overflow-y-auto" style={{ maxHeight: '400px' }}>
        <table className="relative w-full">
          <thead className="sticky top-0 z-10 bg-[#101527]">
            <tr>
              <th className={TH}>Timestamp</th>
              <th className={TH}>Event Type</th>
              <th className={TH}>Zone Location</th>
              <th className={TH}>Current Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {events.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-4 py-8 text-center">
                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                    System healthy - no active events
                  </span>
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.key} className="hover:bg-white/[0.03]">
                  <td className="tabular whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-400 sm:px-6">{e.time}</td>
                  <td className="px-4 py-3 sm:px-6">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-slate-100">
                      {e.active && (
                        <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 8px rgba(239,68,68,0.7)' }} />
                      )}
                      {e.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400 sm:px-6">{e.zone}</td>
                  <td className="px-4 py-3 sm:px-6">
                    <span
                      className="inline-block whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
                      style={
                        e.active
                          ? { color: '#f87171', background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)' }
                          : { color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' }
                      }
                    >
                      {e.active ? 'ALERT ACTIVE' : 'RESOLVED'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

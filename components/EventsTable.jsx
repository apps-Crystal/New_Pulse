'use client';
import { Clock, CheckCircle } from 'lucide-react';

const TH = 'px-6 py-3 text-left bg-slate-50 transition-colors duration-300 dark:bg-slate-900';

export default function EventsTable({ events }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors duration-300 dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-4 transition-colors duration-300 dark:border-slate-700 dark:bg-slate-900">
        <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-colors duration-300 dark:border-slate-700 dark:bg-slate-800">
          <Clock size={20} className="text-slate-600 transition-colors duration-300 dark:text-slate-400" />
        </div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-700 transition-colors duration-300 dark:text-slate-300">
          Today's Events
        </h2>
        <div className="ml-auto">
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600 transition-colors duration-300 dark:bg-slate-700 dark:text-slate-300">
            {events.length} LOGS
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="scrollbar-thin overflow-x-auto overflow-y-auto" style={{ maxHeight: '400px' }}>
        <table className="relative w-full">
          <thead className="sticky top-0 z-10 text-xs font-bold uppercase tracking-widest text-slate-400 transition-colors duration-300 dark:text-slate-500">
            <tr>
              <th className={TH}>Timestamp</th>
              <th className={TH}>Event Type</th>
              <th className={TH}>Zone Location</th>
              <th className={TH}>Current Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 transition-colors duration-300 dark:divide-slate-700">
            {events.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-4 py-8 text-center">
                  <div className="flex flex-col items-center gap-2 opacity-50">
                    <CheckCircle size={32} className="text-pulse-orange" />
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500 transition-colors duration-300 dark:text-slate-400">
                      System Healthy - No Active Events
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.key} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="tabular px-6 py-4 font-mono text-sm text-slate-600 transition-colors duration-300 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-slate-200">
                    {e.time}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-700 transition-colors duration-300 dark:text-slate-200">
                      {e.active && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
                      {e.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold uppercase tracking-wide text-slate-500 transition-colors duration-300 dark:text-slate-400">
                    {e.zone}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-block rounded border px-3 py-1 text-xs font-bold uppercase tracking-widest ${
                        e.active
                          ? 'border-red-200 bg-red-100 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300'
                          : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}
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

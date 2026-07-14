'use client';
import { CheckCircle } from 'lucide-react';

export default function EventsTable({ events }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
      <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
          Today's Events
        </h2>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
          <CheckCircle className="h-8 w-8 text-emerald-500" />
          <span className="text-sm">System Healthy — No Active Events</span>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900/60">
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-5 py-2 font-semibold">Timestamp</th>
                <th className="px-5 py-2 font-semibold">Event</th>
                <th className="px-5 py-2 font-semibold">Zone</th>
                <th className="px-5 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.key} className="border-t border-slate-100 dark:border-slate-700/60">
                  <td className="px-5 py-2 font-mono tabular text-slate-600 dark:text-slate-300">{e.time}</td>
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                      {e.active && <span className="h-2 w-2 animate-alarm rounded-full bg-red-500" />}
                      {e.type}
                    </span>
                  </td>
                  <td className="px-5 py-2 uppercase tracking-wide text-slate-600 dark:text-slate-300">{e.zone}</td>
                  <td className="px-5 py-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        e.active
                          ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {e.active ? 'ALERT ACTIVE' : 'RESOLVED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

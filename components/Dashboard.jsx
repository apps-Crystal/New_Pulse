'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './Header';
import MetricCards from './MetricCards';
import RoomCard from './RoomCard';
import AlarmModal from './AlarmModal';
import WarningToasts from './WarningToasts';
import AlarmSiren from './AlarmSiren';
import EventsTable from './EventsTable';
import SensorECG from './SensorECG';
import { zoneStatus, fmtClock } from '../lib/format';

// Poll interval. Override at build time with NEXT_PUBLIC_POLL_MS (e.g. 10000 on Vercel, where every
// poll is a serverless function call). Values below 1000 are ignored.
const POLL_MS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_POLL_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 2000;
})();
const MAX_EVENTS = 50;

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);        // ordered array of room objects (with id)
  const [connected, setConnected] = useState(false);
  const [alarms, setAlarms] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [events, setEvents] = useState([]);
  const [alarmsMuted, setAlarmsMuted] = useState(true); // start muted: show temperatures only

  const sinceRef = useRef(new Map());            // zoneId -> alarm start ts
  const prevStatusRef = useRef(new Map());       // zoneId -> last status
  const eventSeq = useRef(0);

  const poll = useCallback(async () => {
    let data;
    try {
      const res = await fetch('/api/plc', { cache: 'no-store' });
      data = await res.json();
    } catch {
      setConnected(false);
      return;
    }
    setConnected(Boolean(data.connected));

    const roomMap = data.rooms || {};
    const list = Object.entries(roomMap).map(([id, r]) => ({ id, ...r }));
    setRooms(list);

    const now = Date.now();
    const nextAlarms = [];
    const nextWarnings = [];
    const newEvents = [];

    for (const room of list) {
      const status = zoneStatus(room);
      const prev = prevStatusRef.current.get(room.id) || 'ok';

      if (status === 'alarm') {
        if (!sinceRef.current.has(room.id)) sinceRef.current.set(room.id, now);
        nextAlarms.push({
          id: room.id,
          label: room.label,
          temperature: room.temperature,
          setLow: room.setLow,
          setHigh: room.setHigh,
          since: sinceRef.current.get(room.id),
        });
      } else {
        sinceRef.current.delete(room.id);
      }

      if (status === 'warning') {
        nextWarnings.push({
          id: room.id,
          label: room.label,
          temperature: room.temperature,
          setLow: room.setLow,
          setHigh: room.setHigh,
        });
      }

      // event transitions
      if (status === 'alarm' && prev !== 'alarm') {
        const outHigh = room.setHigh != null && room.temperature > room.setHigh;
        newEvents.push({
          key: `e${eventSeq.current++}`,
          time: fmtClock(),
          type: outHigh ? 'TEMPERATURE HIGH' : 'TEMPERATURE LOW',
          zone: room.label,
          active: true,
        });
      } else if (prev === 'alarm' && status !== 'alarm' && status !== 'offline') {
        newEvents.push({
          key: `e${eventSeq.current++}`,
          time: fmtClock(),
          type: 'TEMPERATURE RESOLVED',
          zone: room.label,
          active: false,
        });
      }

      prevStatusRef.current.set(room.id, status);
    }

    setAlarms(nextAlarms);
    setWarnings(nextWarnings);
    if (newEvents.length) {
      setEvents((prev) => [...newEvents.reverse(), ...prev].slice(0, MAX_EVENTS));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const total = rooms.length || 16;
  const alarmCount = alarms.length;
  const warnCount = warnings.length;
  const offlineCount = rooms.filter((r) => zoneStatus(r) === 'offline').length;
  const normalCount = rooms.filter((r) => zoneStatus(r) === 'ok').length;

  return (
    <div className="min-h-screen font-sans transition-colors duration-300">
      <Header connected={connected} alarmsMuted={alarmsMuted} onToggleAlarms={() => setAlarmsMuted((m) => !m)} />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <MetricCards total={total} normal={normalCount} alarm={alarmCount} warning={warnCount} />

        {/* ECG sensor activity monitor: health = zones reporting / total zones */}
        <SensorECG activeCount={rooms.length - offlineCount} totalCount={total} connected={connected} />

        {/* Room grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.length === 0
            ? Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
              ))
            : rooms.map((room) => <RoomCard key={room.id} room={room} />)}
        </div>

        <EventsTable events={events} />

        <div className="pb-6 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
          {connected
            ? `Reading live from Supabase · ${offlineCount ? `${offlineCount} zone(s) awaiting data · ` : ''}polling every ${Math.round(POLL_MS / 1000)}s`
            : 'Database unreachable - showing last-known state. Check DATABASE_URL in .env.local and that this PC can reach Supabase (port 5432, IPv6).'}
        </div>
      </main>

      {!alarmsMuted && <WarningToasts warnings={warnings} />}
      {!alarmsMuted && <AlarmModal alarms={alarms} />}
      <AlarmSiren active={!alarmsMuted && alarmCount > 0} />
    </div>
  );
}

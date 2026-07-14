'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './Header';
import MetricCards from './MetricCards';
import RoomCard from './RoomCard';
import AlarmModal from './AlarmModal';
import WarningToasts from './WarningToasts';
import AlarmSiren from './AlarmSiren';
import EventsTable from './EventsTable';
import { zoneStatus, fmtClock } from '../lib/format';

const POLL_MS = 2000;
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
    <div className="min-h-screen">
      <Header connected={connected} alarmsMuted={alarmsMuted} onToggleAlarms={() => setAlarmsMuted((m) => !m)} />

      <main className="mx-auto max-w-[1280px] space-y-5 px-6 py-6">
        <MetricCards total={total} normal={normalCount} alarm={alarmCount} warning={warnCount} />

        {/* Room grid */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {rooms.length === 0
            ? Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              ))
            : rooms.map((room) => <RoomCard key={room.id} room={room} />)}
        </div>

        <EventsTable events={events} />

        <div className="pb-6 text-center text-xs text-slate-400">
          {connected
            ? `Reading live from HMI · ${offlineCount ? `${offlineCount} zone(s) awaiting data · ` : ''}polling every 2s`
            : 'Bridge offline — showing last-known state. Ensure the Pulse bridge is running and an HMI client slot is free.'}
        </div>
      </main>

      {!alarmsMuted && <WarningToasts warnings={warnings} />}
      {!alarmsMuted && <AlarmModal alarms={alarms} />}
      <AlarmSiren active={!alarmsMuted && alarmCount > 0} />
    </div>
  );
}

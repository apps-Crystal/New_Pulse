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
import { connectLive, liveTransport } from '../lib/live-client';

// Two ways in, one shape out. The plant collector's readings arrive live - through Supabase Realtime
// (the Vercel deployment) or the self-hosted /ws hub - and while that feed is delivering, the database
// is not polled at all. The instant the feed reports itself down, or goes quiet for LIVE_STALE_MS, the
// usual /api/plc polling takes over (same rooms, same alarm rules) and the feed keeps reconnecting in the
// background until readings flow again.

// Poll interval. Override at build time with NEXT_PUBLIC_POLL_MS (e.g. 10000 on Vercel, where every
// poll is a serverless function call). Values below 1000 are ignored.
const POLL_MS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_POLL_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 2000;
})();
// A live snapshot older than this means the feed is up but the collector has stopped pushing:
// poll the database until fresh pushes resume. The collector visits each screen every ~35 s.
const LIVE_STALE_MS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_LIVE_STALE_MS);
  return Number.isFinite(n) && n >= 5000 ? n : 90000;
})();
const STALE_MS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_STALE_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 600000;
})();
const MAX_EVENTS = 50;

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);        // ordered array of room objects (with id)
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState(null);    // 'live' | 'db' | null (nothing yet)
  const [alarms, setAlarms] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [events, setEvents] = useState([]);
  const [alarmsMuted, setAlarmsMuted] = useState(true); // start muted: show temperatures only

  const sinceRef = useRef(new Map());            // zoneId -> alarm start ts
  const prevStatusRef = useRef(new Map());       // zoneId -> last status
  const eventSeq = useRef(0);
  const liveRef = useRef({ up: false, lastAt: 0 });
  // Operator limits for snapshots built in the browser: fetched from /api/setpoints, and as a fallback
  // whatever limits the last database snapshot carried.
  const setpointsRef = useRef({});
  const dbLimitsRef = useRef({});

  // One place turns a snapshot (from either source) into cards, alarms and events.
  const applySnapshot = useCallback((data, from) => {
    setConnected(Boolean(data.connected));
    setSource(from);

    const roomMap = data.rooms || {};
    const list = Object.entries(roomMap).map(([id, r]) => ({ id, ...r }));
    setRooms(list);
    if (from === 'db') {
      const lim = {};
      for (const r of list) if (r.setLow != null || r.setHigh != null) lim[r.id] = { setLow: r.setLow, setHigh: r.setHigh };
      dbLimitsRef.current = lim;
    }

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

  // The fallback: read the newest rows from the database.
  const poll = useCallback(async () => {
    let data;
    try {
      const res = await fetch('/api/plc', { cache: 'no-store' });
      data = await res.json();
    } catch {
      setConnected(false);
      setSource('db');
      return;
    }
    applySnapshot(data, 'db');
  }, [applySnapshot]);

  const liveHealthy = () => {
    const l = liveRef.current;
    return l.up && Date.now() - l.lastAt < LIVE_STALE_MS;
  };

  // Operator set-points for browser-built snapshots. Retried on failure; refreshed every 5 minutes so an
  // edited setpoints file / env var reaches open tabs without a reload.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const load = async (delayOnFail) => {
      try {
        const res = await fetch('/api/setpoints', { cache: 'no-store' });
        const j = await res.json();
        if (j && j.setpoints) setpointsRef.current = j.setpoints;
        if (!stopped) timer = setTimeout(() => load(15000), 5 * 60 * 1000);
      } catch {
        if (!stopped) timer = setTimeout(() => load(Math.min(delayOnFail * 2, 120000)), delayOnFail);
      }
    };
    load(5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  // The live feed. Its transport reconnects on its own; we only track whether to trust it.
  useEffect(() => {
    if (typeof window === 'undefined' || !liveTransport()) return undefined;
    const l = liveRef.current;
    const conn = connectLive({
      staleMs: STALE_MS,
      getSetpoints: () => (Object.keys(setpointsRef.current).length ? setpointsRef.current : dbLimitsRef.current),
      onSnapshot: (snapshot) => {
        l.up = true;
        l.lastAt = Date.now();
        applySnapshot(snapshot, 'live');
      },
      onStatus: ({ up }) => {
        l.up = up;
        if (!up) {
          // Switch to the database right away rather than waiting for the live data to age out.
          l.lastAt = 0;
          poll();
        }
      },
    });
    return () => conn.close();
  }, [applySnapshot, poll]);

  // The database poll: runs on its usual interval, but does nothing while the live feed is healthy.
  // The first tick fires immediately, so the screen fills from the database before the feed has even
  // connected; the first live snapshot then takes over.
  useEffect(() => {
    const tick = () => {
      if (!liveHealthy()) poll();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const total = rooms.length || 16;
  const alarmCount = alarms.length;
  const warnCount = warnings.length;
  const offlineCount = rooms.filter((r) => zoneStatus(r) === 'offline').length;
  const normalCount = rooms.filter((r) => zoneStatus(r) === 'ok').length;

  let footer;
  if (!connected) {
    footer = source === 'live'
      ? 'Live feed connected but the collector has gone quiet - showing last-known state.'
      : 'Database unreachable - showing last-known state. Check DATABASE_URL in .env.local and that this PC can reach Supabase (port 5432, IPv6).';
  } else if (source === 'live') {
    footer = `Live from the plant collector · ${offlineCount ? `${offlineCount} zone(s) awaiting data · ` : ''}database kept as the record and the fallback`;
  } else {
    footer = `Reading from Supabase · ${offlineCount ? `${offlineCount} zone(s) awaiting data · ` : ''}polling every ${Math.round(POLL_MS / 1000)}s · live feed not connected`;
  }

  return (
    <div className="min-h-screen font-sans lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <Header connected={connected} source={source} alarmsMuted={alarmsMuted} onToggleAlarms={() => setAlarmsMuted((m) => !m)} />

      <main className="scrollbar-thin mx-auto w-full max-w-7xl space-y-6 px-4 pb-6 pt-2 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-y-auto lg:pb-8 lg:pt-1">
        {/* First screen: metrics + 4x4 grid. At lg+ this section is exactly the height of <main>, so all 16 zones fit without scrolling. */}
        <div className="space-y-6 lg:flex lg:h-full lg:min-h-0 lg:shrink-0 lg:flex-col lg:gap-4 lg:space-y-0 lg:pb-3">
          <MetricCards total={total} normal={normalCount} alarm={alarmCount} warning={warnCount} />

          {/* Room grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-4">
            {rooms.length === 0
              ? Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="card h-32 animate-pulse lg:h-full" />
                ))
              : rooms.map((room) => <RoomCard key={room.id} room={room} />)}
          </div>
        </div>

        <div className="lg:shrink-0">
          <EventsTable events={events} />
        </div>

        <div className="pb-6 text-center text-[11px] text-slate-500 lg:shrink-0">{footer}</div>
      </main>

      {!alarmsMuted && <WarningToasts warnings={warnings} />}
      {!alarmsMuted && <AlarmModal alarms={alarms} />}
      <AlarmSiren active={!alarmsMuted && alarmCount > 0} />
    </div>
  );
}

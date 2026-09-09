'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './Header';
import MetricCards from './MetricCards';
import RoomCard from './RoomCard';
import AlarmModal from './AlarmModal';
import WarningToasts from './WarningToasts';
import AlarmSiren from './AlarmSiren';
import LogTabs from './LogTabs';
import PanicStrip from './PanicStrip';
import { zoneStatus, fmtClock } from '../lib/format';
import { classifyInputs, doorAlarms } from '../lib/inputs';
import { applyRoomSettings, isOperational } from '../lib/rooms';

// A door open this long is an alarm (red card, takeover, siren while alarms are on).
const DOOR_ALARM_MS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_DOOR_ALARM_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 30000;
})();
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
// OFFLINE threshold for browser-built snapshots. Only the fallback before /api/setpoints has answered:
// from then on the server's PULSE_STALE_MS is used, so every path applies the same rule.
const STALE_MS_DEFAULT = (() => {
  const n = Number(process.env.NEXT_PUBLIC_STALE_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 600000;
})();
const MAX_EVENTS = 50;

export default function Dashboard() {
  const [rooms, setRooms] = useState([]);        // ordered array of room objects (with id)
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState(null);    // 'live' | 'db' | null (nothing has answered yet)
  const [alarms, setAlarms] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [events, setEvents] = useState([]);
  // Alarms are off until someone on this screen says yes. Off means: limits still shown under every
  // temperature, but no red or yellow states, no counts, no toast, no modal, no siren, no event log.
  // The choice is remembered per browser, so a wall display keeps it across reloads and deploys.
  const [alarmsEnabled, setAlarmsEnabled] = useState(false);
  const [testSiren, setTestSiren] = useState(false);      // "Test sound": run the siren for a few seconds
  // Silenced alarms: zone ids whose current alarm episode has been acknowledged on this screen. The room
  // stays red and listed, the siren and the full-screen takeover stop. An entry is dropped the moment the
  // room leaves alarm, so a room that clears and alarms again rings again; a new room in alarm always rings.
  const [silenced, setSilenced] = useState([]);
  const silencedRef = useRef(new Set());
  // The panel's INPUT screen (doors, panic buttons, phase preventer) and its own alarm log. A live message
  // that carries only readings keeps the last known inputs, so a door or panic state never flickers away.
  const [inputs, setInputs] = useState([]);
  const inputsRef = useRef([]);
  const [panelAlarms, setPanelAlarms] = useState(null);
  const prevDoorRef = useRef(new Map());   // door tag -> open
  const prevPanicRef = useRef(new Map());  // panic tag -> pressed
  // Per-room "in service / out of service", shared through the database (/api/rooms). A room that is
  // off keeps its readings on screen but can never raise an alarm, a warning or a door alarm.
  const [roomSettings, setRoomSettings] = useState({});
  const roomSettingsRef = useRef({});
  const pendingSettingsRef = useRef(new Map()); // zoneId -> operational, flipped here and not yet confirmed by the server
  const mergeSettings = (incoming) => {
    const merged = { ...(incoming || {}) };
    for (const [id, operational] of pendingSettingsRef.current) merged[id] = { ...(merged[id] || {}), operational };
    roomSettingsRef.current = merged;
    setRoomSettings(merged);
    return merged;
  };
  const testTimerRef = useRef(null);
  const testSound = useCallback(() => {
    clearTimeout(testTimerRef.current);
    setTestSiren(true);
    testTimerRef.current = setTimeout(() => setTestSiren(false), 4000);
  }, []);
  const alarmsEnabledRef = useRef(false);
  const lastSnapshotRef = useRef(null);         // { data, from } - re-evaluated when the switch flips

  const sinceRef = useRef(new Map());            // zoneId -> alarm start ts
  const prevStatusRef = useRef(new Map());       // zoneId -> last status
  const eventSeq = useRef(0);
  const liveRef = useRef({ up: false, lastAt: 0 });
  const pollBusyRef = useRef(false);
  // Operator limits for snapshots built in the browser: fetched from /api/setpoints, and as a fallback
  // whatever limits the last successful database snapshot carried.
  const setpointsRef = useRef({});
  const dbLimitsRef = useRef({});
  const staleMsRef = useRef(STALE_MS_DEFAULT);
  // The last rooms the database gave us, as collector-style readings: the live feed seeds itself from
  // these so the first (half-screen) broadcast does not blank the other rooms.
  const dbSeedRef = useRef([]);

  // One place turns a snapshot (from either source) into cards, alarms and events.
  const applySnapshot = useCallback((data, from) => {
    lastSnapshotRef.current = { data, from };
    setConnected(Boolean(data.connected));
    setSource(from);
    const armed = alarmsEnabledRef.current;

    const roomMap = data.rooms || {};
    const list = Object.entries(roomMap).map(([id, r]) => ({ id, ...r }));
    // A snapshot from the server already carries the shared settings; a live one is built here without them.
    if (data.roomSettings && typeof data.roomSettings === 'object') mergeSettings(data.roomSettings);
    applyRoomSettings(list, roomSettingsRef.current);
    const operationalById = new Map(list.map((r) => [r.id, isOperational(r)]));
    setRooms(list);
    if (from === 'db' && data.connected) {
      // Remember database-provided limits per room (merge, never wipe) so live snapshots keep them.
      const merged = { ...dbLimitsRef.current };
      for (const r of list) if (r.setLow != null || r.setHigh != null) merged[r.id] = { setLow: r.setLow, setHigh: r.setHigh, limitsSwapped: Boolean(r.limitsSwapped) };
      dbLimitsRef.current = merged;
      dbSeedRef.current = list
        .filter((r) => r.temperature != null && r.updatedAt != null)
        .map((r) => ({ tag: r.label, value: r.temperature, ts: r.updatedAt }));
    }

    const now = Date.now();
    const nextAlarms = [];
    const nextWarnings = [];
    const newEvents = [];

    const inputList = Array.isArray(data.inputs) && data.inputs.length ? data.inputs : inputsRef.current;
    inputsRef.current = inputList;
    setInputs(inputList);
    if (data.panelAlarms && (data.panelAlarms.active || data.panelAlarms.recent)) setPanelAlarms(data.panelAlarms);
    const io = classifyInputs(inputList, now);

    for (const room of list) {
      // With alarms off a room is only ever ok or offline, so the moment they are switched on every room
      // already outside its limits raises a fresh alarm and a fresh event.
      const status = !isOperational(room) ? 'off' : armed ? zoneStatus(room) : zoneStatus(room) === 'offline' ? 'offline' : 'ok';
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
          limitsInvalid: Boolean(room.limitsInvalid),
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

    // Panic buttons: a pressed button is an alarm in its own right while alarms are on, and always an event.
    for (const p of io.panic) {
      const prev = prevPanicRef.current.get(p.tag) || false;
      if (p.pressed && armed) {
        if (!sinceRef.current.has(p.tag)) sinceRef.current.set(p.tag, now);
        nextAlarms.push({ id: p.tag, label: p.tag, kind: 'panic', since: sinceRef.current.get(p.tag) });
      } else {
        sinceRef.current.delete(p.tag);
      }
      if (p.pressed !== prev) {
        newEvents.push({ key: `e${eventSeq.current++}`, time: fmtClock(), type: p.pressed ? 'PANIC BUTTON PRESSED' : 'PANIC BUTTON RELEASED', zone: p.tag, active: p.pressed });
      }
      prevPanicRef.current.set(p.tag, p.pressed);
    }
    // Doors: open for DOOR_ALARM_MS or more is an alarm (while alarms are on); every open / close is an event.
    for (const d of doorAlarms(io, now, DOOR_ALARM_MS)) {
      if (!armed || operationalById.get(d.zoneId) === false) { sinceRef.current.delete(`door:${d.tag}`); continue; }
      if (!sinceRef.current.has(`door:${d.tag}`)) {
        sinceRef.current.set(`door:${d.tag}`, now);
        newEvents.push({ key: `e${eventSeq.current++}`, time: fmtClock(), type: `DOOR OPEN ${Math.round(DOOR_ALARM_MS / 1000)} S`, zone: d.twoDoors ? `${d.room} ${d.label}` : d.room, active: true });
      }
      nextAlarms.push({ id: `door:${d.tag}`, label: d.twoDoors ? `${d.room} ${d.label}` : d.room, kind: 'door', zoneId: d.zoneId, openMs: d.openMs, since: d.since });
    }
    for (const key of [...sinceRef.current.keys()]) {
      if (key.startsWith('door:') && !nextAlarms.some((a) => a.id === key)) {
        sinceRef.current.delete(key);
        const tag = key.slice(5);
        newEvents.push({ key: `e${eventSeq.current++}`, time: fmtClock(), type: 'DOOR ALARM RESOLVED', zone: tag.replace(/\s+Door(\s+\d+)?$/i, ''), active: false });
      }
    }
    for (const list of Object.values(io.doors)) {
      for (const d of list) {
        const prev = prevDoorRef.current.get(d.tag);
        if (prev !== undefined && prev !== d.open) {
          newEvents.push({ key: `e${eventSeq.current++}`, time: fmtClock(), type: d.open ? 'DOOR OPENED' : 'DOOR CLOSED', zone: list.length > 1 ? `${d.room} ${d.label}` : d.room, active: d.open });
        }
        prevDoorRef.current.set(d.tag, d.open);
      }
    }

    setAlarms(nextAlarms);
    setWarnings(nextWarnings);
    const stillActive = new Set(nextAlarms.map((a) => a.id));
    let pruned = false;
    for (const id of silencedRef.current) if (!stillActive.has(id)) { silencedRef.current.delete(id); pruned = true; }
    if (pruned) setSilenced([...silencedRef.current]);
    if (newEvents.length) {
      setEvents((prev) => [...newEvents.reverse(), ...prev].slice(0, MAX_EVENTS));
    }
  }, []);

  // The fallback: read the newest rows from the database. One request in flight at a time, and a reply
  // that is no longer the freshest information (a live snapshot landed while it was in flight) is dropped
  // rather than allowed to overwrite the screen.
  const poll = useCallback(async () => {
    if (pollBusyRef.current) return;
    pollBusyRef.current = true;
    const startedAt = Date.now();
    let data = null;
    try {
      const res = await fetch('/api/plc', { cache: 'no-store' });
      data = await res.json();
    } catch {
      data = null;
    } finally {
      pollBusyRef.current = false;
    }
    const l = liveRef.current;
    if (l.up && l.lastAt >= startedAt) return;
    if (!data) {
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

  // Shared room settings: fetched on load and every minute so a switch flipped on another screen shows
  // up here too; a flip on this screen applies at once and is then saved through /api/rooms.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const load = async (delayOnFail) => {
      try {
        const res = await fetch('/api/rooms', { cache: 'no-store' });
        const j = await res.json();
        if (j && j.ok && j.rooms) {
          mergeSettings(j.rooms);
          const last = lastSnapshotRef.current;
          if (last) applySnapshot(last.data, last.from);
        }
        if (!stopped) timer = setTimeout(() => load(15000), 60 * 1000);
      } catch {
        if (!stopped) timer = setTimeout(() => load(Math.min(delayOnFail * 2, 120000)), delayOnFail);
      }
    };
    load(5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [applySnapshot]);

  const toggleOperational = useCallback(async (id, operational) => {
    pendingSettingsRef.current.set(id, operational);
    mergeSettings(roomSettingsRef.current);
    const label = (lastSnapshotRef.current && lastSnapshotRef.current.data.rooms && lastSnapshotRef.current.data.rooms[id] && lastSnapshotRef.current.data.rooms[id].label) || id;
    setEvents((prev) => [{ key: `e${eventSeq.current++}`, time: fmtClock(), type: operational ? 'ROOM BACK IN SERVICE' : 'ROOM OUT OF SERVICE', zone: label, active: false }, ...prev].slice(0, MAX_EVENTS));
    const last = lastSnapshotRef.current;
    if (last) applySnapshot(last.data, last.from);
    try {
      const res = await fetch('/api/rooms', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, operational }) });
      const j = await res.json();
      if (j && j.ok && j.rooms) {
        pendingSettingsRef.current.delete(id);
        mergeSettings(j.rooms);
        const again = lastSnapshotRef.current;
        if (again) applySnapshot(again.data, again.from);
      }
    } catch { /* keeps the local change pending; the minute refresh keeps it until the server answers */ }
  }, [applySnapshot]);

  // Operator set-points (and the server's OFFLINE threshold) for browser-built snapshots. Retried on
  // failure; refreshed every 5 minutes so an edited setpoints file / env var reaches open tabs.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const load = async (delayOnFail) => {
      try {
        const res = await fetch('/api/setpoints', { cache: 'no-store' });
        const j = await res.json();
        if (j && j.setpoints) setpointsRef.current = j.setpoints;
        if (j && Number.isFinite(Number(j.staleMs)) && Number(j.staleMs) > 0) staleMsRef.current = Number(j.staleMs);
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
      getStaleMs: () => staleMsRef.current,
      getSeed: () => dbSeedRef.current,
      getSetpoints: () => (Object.keys(setpointsRef.current).length ? setpointsRef.current : dbLimitsRef.current),
      onSnapshot: (snapshot) => {
        // Only a snapshot that says the collector is delivering counts as evidence the feed is healthy;
        // a replayed last-known snapshot with connected:false must not silence the database poll.
        if (snapshot && snapshot.connected) {
          l.up = true;
          l.lastAt = Date.now();
        }
        applySnapshot(snapshot, 'live');
      },
      onStatus: ({ up }) => {
        const was = l.up;
        l.up = up;
        if (!up) l.lastAt = 0;
        // Poll immediately on the up -> down edge only; the interval below covers the steady state, and a
        // channel that never manages to subscribe must not double the database traffic on every retry.
        if (was && !up) poll();
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

  // Remembered per browser; read after mount so the server render and the first client render agree.
  useEffect(() => {
    let stored = false;
    try { stored = window.localStorage.getItem('pulse.alarmsEnabled') === 'true'; } catch { stored = false; }
    if (stored) setAlarmsEnabled(true);
  }, []);
  // Door timers run between snapshots: re-evaluate the last snapshot every few seconds so a door crossing
  // the alarm threshold, and the "open for" clocks on the cards, do not wait for the next reading.
  useEffect(() => {
    const id = setInterval(() => { const last = lastSnapshotRef.current; if (last) applySnapshot(last.data, last.from); }, 5000);
    return () => clearInterval(id);
  }, [applySnapshot]);
  useEffect(() => {
    alarmsEnabledRef.current = alarmsEnabled;
    try { window.localStorage.setItem('pulse.alarmsEnabled', alarmsEnabled ? 'true' : 'false'); } catch { /* private mode: not remembered */ }
    const last = lastSnapshotRef.current;
    if (last) applySnapshot(last.data, last.from);
  }, [alarmsEnabled, applySnapshot]);

  // A pressed panic button cannot be silenced from a screen: it rings until the button is released.
  const silenceAlarms = useCallback(() => {
    for (const a of alarms) if (a.kind !== 'panic') silencedRef.current.add(a.id);
    setSilenced([...silencedRef.current]);
  }, [alarms]);
  const ringAgain = useCallback(() => {
    silencedRef.current.clear();
    setSilenced([]);
  }, []);

  const total = rooms.length || 16;
  const alarmCount = alarms.length;
  const ringing = alarms.filter((a) => !silenced.includes(a.id));
  const io = classifyInputs(inputs, Date.now());
  const doorAlarmZones = new Set(alarms.filter((a) => a.kind === 'door').map((a) => a.zoneId));
  const warnCount = warnings.length;
  const offlineCount = rooms.filter((r) => zoneStatus(r) === 'offline').length;
  const normalCount = rooms.filter((r) => isOperational(r) && (alarmsEnabled ? zoneStatus(r) === 'ok' : zoneStatus(r) !== 'offline')).length;
  const offCount = rooms.filter((r) => !isOperational(r)).length;

  let footer;
  if (source === null) {
    footer = 'Connecting - waiting for the first reading...';
  } else if (!connected) {
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
      <Header connected={connected} source={source} alarmsEnabled={alarmsEnabled} onEnableAlarms={() => setAlarmsEnabled(true)} onDisableAlarms={() => { setTestSiren(false); silencedRef.current.clear(); setSilenced([]); setAlarmsEnabled(false); }} onTestSound={testSound} testing={testSiren} />

      <main className="scrollbar-thin mx-auto w-full max-w-7xl space-y-6 px-4 pb-6 pt-2 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-y-auto lg:pb-8 lg:pt-1">
        {/* First screen: metrics + 4x4 grid. At lg+ this section is exactly the height of <main>, so all 16 zones fit without scrolling. */}
        <div className="space-y-6 lg:flex lg:h-full lg:min-h-0 lg:shrink-0 lg:flex-col lg:gap-4 lg:space-y-0 lg:pb-3">
          <MetricCards total={total} normal={normalCount} alarm={alarmCount} warning={warnCount} alarmsEnabled={alarmsEnabled} off={offCount} />
          <PanicStrip panic={io.panic} phase={io.phase} />

          {/* Room grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-4">
            {rooms.length === 0
              ? Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className="card h-32 animate-pulse lg:h-full" />
                ))
              : rooms.map((room) => <RoomCard key={room.id} room={room} alarmsEnabled={alarmsEnabled} doors={io.doors[room.id] || null} doorAlarm={doorAlarmZones.has(room.id)} onToggleOperational={toggleOperational} />)}
          </div>
        </div>

        <div className="lg:shrink-0">
          <LogTabs events={events} panelAlarms={panelAlarms} />
        </div>

        <div className="pb-6 text-center text-[11px] text-slate-500 lg:shrink-0">{footer}</div>
      </main>

      {alarmsEnabled && <WarningToasts warnings={warnings} />}
      {alarmsEnabled && <AlarmModal alarms={alarms} silenced={silenced} onSilence={silenceAlarms} onRingAgain={ringAgain} />}
      <AlarmSiren enabled={alarmsEnabled} active={alarmsEnabled && (ringing.length > 0 || testSiren)} />
    </div>
  );
}

// Small shared helpers for the Pulse dashboard.

export function fmtTemp(t) {
  if (t == null || Number.isNaN(t)) return '—';
  return `${t > 0 ? '' : ''}${t.toFixed(1)}°C`;
}

export function fmtClock(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}m ${String(rem).padStart(2, '0')}s`;
}

// Warning margin: how close (°C) to a limit before we flag a "warning".
export const WARN_MARGIN = 2;

// Classify a zone from its reported values.
// returns 'offline' | 'alarm' | 'warning' | 'ok'
export function zoneStatus(room) {
  if (!room) return 'offline';
  if (room.offline || room.temperature == null) return 'offline';
  const { temperature: t, setLow, setHigh } = room;
  if (setLow != null && setHigh != null) {
    if (t < setLow || t > setHigh) return 'alarm';
    if (t <= setLow + WARN_MARGIN || t >= setHigh - WARN_MARGIN) return 'warning';
  }
  return 'ok';
}

export function statusLabel(s) {
  return { ok: 'OK', warning: 'WARN', alarm: 'ALARM', offline: 'OFFLINE' }[s] || 'OK';
}

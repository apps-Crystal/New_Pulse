#!/usr/bin/env node
// Minimal connectivity check. Run: node --env-file=.env.local scripts/db-check.js
// Exit 0 when connected, 1 otherwise.
const { getSnapshot, getStatus, closePool } = require('../lib/db');
const { ZONES } = require('../lib/zones');

function fmt(v, digits) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(digits == null ? 1 : digits);
}

function age(updatedAt, now) {
  if (!updatedAt) return '-';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return (s / 3600).toFixed(1) + 'h';
}

function statusOf(r) {
  if (!r || r.offline) return 'OFFLINE';
  return r.alarm ? 'ALARM' : 'ok';
}

async function main() {
  const snap = await getSnapshot();
  const now = Date.now();
  const rooms = snap.rooms || {};
  const rows = [];
  const seen = new Set();
  for (const z of ZONES) {
    const r = rooms[z.id];
    seen.add(z.id);
    rows.push({
      zone: z.id,
      temperature: r ? fmt(r.temperature) : '-',
      low: r ? fmt(r.setLow) : '-',
      high: r ? fmt(r.setHigh) : '-',
      status: statusOf(r),
      age: r ? age(r.updatedAt, now) : '-',
    });
  }
  for (const id of Object.keys(rooms)) {
    if (seen.has(id)) continue;
    const r = rooms[id];
    rows.push({
      zone: id + ' (unknown)',
      temperature: fmt(r.temperature),
      low: fmt(r.setLow),
      high: fmt(r.setHigh),
      status: statusOf(r),
      age: age(r.updatedAt, now),
    });
  }
  console.table(rows);
  console.log('connected :', snap.connected);
  console.log('timestamp :', snap.timestamp);
  if (snap.error) console.log('error     :', snap.error);
  const d = snap.detected;
  if (d) {
    console.log(
      'detected  : %s.%s mode=%s room=%s temp=%s ts=%s low=%s high=%s (via %s)',
      d.schema, d.table, d.mode, d.roomCol || '-', d.tempCol || '-', d.tsCol || '-',
      d.setLowCol || '-', d.setHighCol || '-', d.via
    );
  } else {
    console.log('detected  : none');
  }
  const st = getStatus();
  console.log('setpoints :', st.setpointsSource === 'none' || !st.setpointsSource
    ? 'none' : st.setpointsSource + ' (' + st.setpointsZones + ' zones)');
  process.exitCode = snap.connected ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('db-check failed:', (err && err.message) || err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

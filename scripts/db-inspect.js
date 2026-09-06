#!/usr/bin/env node
// Schema inspector for the Pulse data layer.
// Run: node --env-file=.env.local scripts/db-inspect.js
// Prints connection target, every table/view with columns, ranked candidates,
// the chosen detection, the SQL that will run, and a live snapshot.
// Exit 0 on success, 1 on connection failure.
const { getSnapshot, getStatus, inspectSchema, closePool } = require('../lib/db');
const { ZONES } = require('../lib/zones');

function hr(title) {
  console.log('');
  console.log('=== ' + title + ' ' + '='.repeat(Math.max(0, 70 - title.length)));
}

function describeDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('DATABASE_URL : NOT SET');
    console.log('  Copy .env.example to .env.local and fill in the password, then run:');
    console.log('  node --env-file=.env.local scripts/db-inspect.js');
    return false;
  }
  try {
    const u = new URL(url);
    console.log('DATABASE_URL : set');
    console.log('  host     :', u.hostname || '(none)');
    console.log('  port     :', u.port || '5432 (default)');
    console.log('  database :', (u.pathname || '/').replace(/^\//, '') || '(none)');
    console.log('  user     :', decodeURIComponent(u.username || '') || '(none)');
    let pw = '(none)';
    if (u.password) pw = /\[.*PASSWORD.*\]/i.test(decodeURIComponent(u.password)) ? 'PLACEHOLDER (edit .env.local)' : '(hidden)';
    console.log('  password :', pw);
    if (/^db\..*\.supabase\.co$/i.test(u.hostname)) {
      console.log('  note     : direct db.*.supabase.co host is IPv6-only; use the Session pooler URL if this network has no IPv6.');
    }
  } catch (e) {
    console.log('DATABASE_URL : set but could not be parsed as a URL (' + e.message + ')');
  }
  return true;
}

function hintFor(message) {
  const m = String(message || '');
  const hints = [];
  if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND/i.test(m)) {
    hints.push('The direct host db.<project>.supabase.co is IPv6-only. If this network has no IPv6, use the');
    hints.push('Supabase "Session pooler" connection string (aws-0-<region>.pooler.supabase.com:5432) in DATABASE_URL.');
  }
  if (/password authentication failed/i.test(m)) {
    hints.push('Password rejected. Replace the [YOUR-PASSWORD] placeholder in .env.local with the real database password.');
  }
  if (/self[- ]signed certificate|SELF_SIGNED_CERT|certificate/i.test(m)) {
    hints.push('TLS certificate problem. Set PULSE_SSL_CA=./supabase-ca.crt (download the CA from Supabase Project Settings -> Database)');
    hints.push('or leave PULSE_SSL_CA unset to skip verification.');
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(m)) {
    hints.push('Connection timed out. Check that outbound TCP port 5432 is allowed by the firewall / proxy.');
  }
  if (/ECONNREFUSED/i.test(m)) {
    hints.push('Connection refused. Check host and port in DATABASE_URL.');
  }
  return hints;
}

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

function printTables(tables) {
  if (!tables || !tables.length) {
    console.log('(no tables or views found in this schema)');
    return;
  }
  for (const t of tables) {
    console.log('');
    console.log('%s  [%s]  %d column(s)', t.name, t.kind || 'table', (t.columns || []).length);
    for (const c of t.columns || []) {
      console.log('    %s  %s', String(c.name).padEnd(32), c.type || '');
    }
  }
}

function rolesToString(roles) {
  if (!roles) return '-';
  if (typeof roles === 'string') return roles;
  if (Array.isArray(roles)) return roles.join(', ');
  return Object.keys(roles)
    .filter((k) => roles[k] != null)
    .map((k) => k + '=' + (Array.isArray(roles[k]) ? roles[k].join('|') : roles[k]))
    .join(', ');
}

function printCandidates(tables) {
  const ranked = (tables || [])
    .filter((t) => typeof t.score === 'number')
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) {
    console.log('(no scored candidates)');
    return;
  }
  console.table(
    ranked.map((t) => ({
      table: t.name,
      kind: t.kind || 'table',
      score: t.score,
      mode: t.mode || '-',
      roles: rolesToString(t.roles),
    }))
  );
}

function printDetected(chosen, overrides) {
  const ov = overrides || {};
  const ovKeys = Object.keys(ov).filter((k) => ov[k] != null && ov[k] !== '');
  if (ovKeys.length) {
    console.log('Env overrides in effect:');
    for (const k of ovKeys) console.log('    %s = %s', k, ov[k]);
  } else {
    console.log('Env overrides: none (fully auto-detected)');
  }
  if (!chosen) {
    console.log('Chosen: NONE - no table looked like a temperature source.');
    console.log('  Set PULSE_TABLE / PULSE_MODE / PULSE_ROOM_COL / PULSE_TEMP_COL / PULSE_TS_COL in .env.local.');
    return;
  }
  console.log('Chosen (via %s):', chosen.via);
  console.log('    schema     :', chosen.schema);
  console.log('    table      :', chosen.table);
  console.log('    mode       :', chosen.mode);
  console.log('    roomCol    :', chosen.roomCol || '-');
  console.log('    tempCol    :', chosen.tempCol || '-');
  console.log('    tsCol      :', chosen.tsCol || '-');
  console.log('    setLowCol  :', chosen.setLowCol || '-');
  console.log('    setHighCol :', chosen.setHighCol || '-');
  console.log('    orderCol   :', chosen.orderCol || '-');
  console.log('    rooms via  :', chosen.roomResolution || '-', chosen.roomJoin ? '(' + chosen.roomJoin.table + '.' + chosen.roomJoin.nameCol + ' via FK)' : '');
  if (chosen.roomResolution === 'ordinal') console.log('    note       : numeric room ids are mapped by display order 1..16; add a FK to a names table or use a text room column.');
  if (chosen.tsTz) console.log('    tsTz       :', chosen.tsTz);
  if (chosen.wideUnmapped && chosen.wideUnmapped.length) console.log('    unmapped   :', chosen.wideUnmapped.join(', '), '(numeric columns matching no zone; use PULSE_WIDE_MAP)');
  if (chosen.mode === 'wide' && chosen.wideMap) {
    console.log('    wideMap    :');
    for (const col of Object.keys(chosen.wideMap)) {
      console.log('        %s -> %s', String(col).padEnd(32), chosen.wideMap[col]);
    }
  }
}

function q(id) {
  return '"' + String(id).replace(/"/g, '""') + '"';
}

// The query lib/db.js will run. Uses d.sql when the data layer provides it,
// otherwise reconstructs it from the detected column roles.
function buildSql(d) {
  if (!d) return '(none - nothing detected)';
  if (d.sql) return d.sql;
  const rel = q(d.schema) + '.' + q(d.table);
  const order = d.orderCol || d.tsCol;
  if (d.mode === 'long') {
    const cols = [d.roomCol, d.tempCol, d.tsCol, d.setLowCol, d.setHighCol].filter(Boolean).map(q).join(', ');
    return (
      'SELECT DISTINCT ON (' + q(d.roomCol) + ') ' + cols + '\n' +
      'FROM ' + rel + '\n' +
      'ORDER BY ' + q(d.roomCol) + (order ? ', ' + q(order) + ' DESC' : '') + ';'
    );
  }
  if (d.mode === 'per_room') {
    const cols = [d.roomCol, d.tempCol, d.tsCol, d.setLowCol, d.setHighCol].filter(Boolean).map(q).join(', ');
    return 'SELECT ' + cols + '\nFROM ' + rel + ';';
  }
  if (d.mode === 'wide') {
    const cols = Object.keys(d.wideMap || {}).concat(d.tsCol ? [d.tsCol] : []).map(q).join(', ');
    return (
      'SELECT ' + (cols || '*') + '\nFROM ' + rel + '\n' +
      (order ? 'ORDER BY ' + q(order) + ' DESC\n' : '') + 'LIMIT 1;'
    );
  }
  return '(unknown mode: ' + d.mode + ')';
}

function printSnapshot(snap) {
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
      zone: id + ' (unknown: ' + (r.label || id) + ')',
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
  if (snap.warning) console.log('warning   :', snap.warning);
  if (snap.stats) console.log('resolved  : %d of 16 zones, %d unknown room(s)', snap.stats.resolvedZones, snap.stats.unknownRooms);
}

async function main() {
  hr('Connection');
  if (!describeDatabaseUrl()) {
    process.exitCode = 1;
    return;
  }

  hr('Schema');
  let info;
  try {
    info = await inspectSchema();
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.log('Could not inspect the database: ' + msg);
    for (const h of hintFor(msg)) console.log('  hint: ' + h);
    process.exitCode = 1;
    return;
  }
  console.log('schema :', info.schema);
  printTables(info.tables);

  hr('Candidates (ranked)');
  printCandidates(info.tables);

  hr('Detection');
  printDetected(info.chosen, info.overrides);

  hr('SQL');
  console.log(buildSql(info.chosen));

  hr('Live snapshot');
  const snap = await getSnapshot();
  printSnapshot(snap);

  hr('Status');
  const st = getStatus();
  console.log('connected   :', st.connected);
  console.log('detected    :', st.detected ? 'yes' : 'no');
  console.log('lastQueryAt :', st.lastQueryAt ? new Date(st.lastQueryAt).toISOString() : '-');
  console.log('lastError   :', st.lastError || '-');
  console.log('queryCount  :', st.queryCount, '(readings queries;', st.discoveryQueryCount, 'discovery queries)');
  console.log('lastTiers   :', st.lastTiers ? st.lastTiers.join(' -> ') : '-');
  console.log('cacheMs     :', st.cacheMs);
  console.log('staleMs     :', st.staleMs);
  console.log('recentMs    :', st.recentMs);
  console.log('windowHours :', st.windowHours);
  console.log('tsTz        :', st.tsTz);
  console.log('setpoints   :', st.setpointsSource === 'none' || !st.setpointsSource
    ? 'none (set PULSE_SETPOINTS or create setpoints.json to enable alarms when the table has no low/high columns)'
    : st.setpointsSource + ' (' + st.setpointsZones + ' zones)' + (st.setpointsPath ? ' from ' + st.setpointsPath : ''));
  console.log('warning     :', st.warning || '-');

  if (!snap.connected) {
    for (const h of hintFor(snap.error || st.lastError)) console.log('hint: ' + h);
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main()
  .catch((err) => {
    const msg = (err && err.message) || String(err);
    console.error('db-inspect failed: ' + msg);
    for (const h of hintFor(msg)) console.error('  hint: ' + h);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));

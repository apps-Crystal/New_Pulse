// Pulse data layer - the ONLY module that talks to Postgres (Supabase).
// CommonJS on purpose: required by Next.js route handlers and by plain `node scripts/*.js`.
// Requiring this module never connects; the first getSnapshot() does (lazy pg.Pool singleton).

const fs = require('fs');
const path = require('path');
const { ZONES } = require('./zones');
const detect = require('./schema-detect');
const setpointsLib = require('./setpoints');

// ---------------------------------------------------------------------------
// Config (read lazily so tests / scripts can set env before the first call)
// ---------------------------------------------------------------------------

function envInt(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
function envStr(name) {
  const v = process.env[name];
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

const RECENT_MIN_MS = 15 * 60 * 1000;

function getConfig() {
  const staleMs = envInt('PULSE_STALE_MS', 600000);
  return {
    databaseUrl: envStr('DATABASE_URL'),
    schema: envStr('PULSE_SCHEMA') || 'public',
    staleMs,
    cacheMs: envInt('PULSE_CACHE_MS', 1500),
    sslCa: envStr('PULSE_SSL_CA'),
    // History tables are queried in tiers: the last `recentMs` first (max(2 x PULSE_STALE_MS, 15 min)),
    // then the last PULSE_WINDOW_HOURS hours (default 48) only when a zone is missing; 0 disables the window.
    windowHours: envInt('PULSE_WINDOW_HOURS', Math.max(48, Math.ceil(staleMs / 3600000) * 2)),
    recentMs: Math.max(2 * staleMs, RECENT_MIN_MS),
    // Time zone of `timestamp without time zone` / naive text timestamps in the DB.
    tsTz: envStr('PULSE_TS_TZ') || 'UTC',
    overrides: {
      table: envStr('PULSE_TABLE'),
      mode: envStr('PULSE_MODE'),
      roomCol: envStr('PULSE_ROOM_COL'),
      tempCol: envStr('PULSE_TEMP_COL'),
      tsCol: envStr('PULSE_TS_COL'),
      setLowCol: envStr('PULSE_SET_LOW_COL'),
      setHighCol: envStr('PULSE_SET_HIGH_COL'),
      wideMap: envStr('PULSE_WIDE_MAP'),
    },
  };
}

function hasOverrides(ov) {
  return Object.values(ov).some((v) => v);
}

// Strip "user:password@" credentials from anything that might end up in a log or an API response.
function redact(msg) {
  return String(msg == null ? '' : msg).replace(/(:\/\/)[^@\s/]*@/g, '$1***@');
}

function sslOptions(cfg) {
  const url = cfg.databaseUrl || '';
  const m = /[?&]sslmode=([a-z-]+)/i.exec(url);
  const mode = (m && m[1].toLowerCase()) || (process.env.PGSSLMODE || '').toLowerCase();
  if (mode === 'disable') return false;
  if (cfg.sslCa) {
    const caPath = path.resolve(process.cwd(), cfg.sslCa);
    return { ca: fs.readFileSync(caPath).toString(), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

// pg-connection-string turns any `sslmode=` query parameter into `ssl: {}` which OVERRIDES the ssl
// object we pass (CA and rejectUnauthorized silently dropped). sslOptions() is the single source of
// truth, so remove ssl-related parameters from the URL. Only the query string is touched: the
// user-info part (passwords with special characters) is passed through byte for byte.
const SSL_PARAMS = new Set(['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'sslca', 'uselibpqcompat']);
function stripSslParams(url) {
  const s = String(url == null ? '' : url);
  const qi = s.indexOf('?');
  if (qi < 0) return s;
  const base = s.slice(0, qi);
  const kept = s.slice(qi + 1).split('&').filter((kv) => {
    const key = decodeURIComponent(kv.split('=')[0] || '').trim().toLowerCase();
    return kv !== '' && !SSL_PARAMS.has(key);
  });
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function poolConfig(cfg) {
  return {
    connectionString: stripSslParams(cfg.databaseUrl),
    ssl: sslOptions(cfg),
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
    query_timeout: 10000,
    application_name: 'pulse-dashboard',
    keepAlive: true,
  };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const state = {
  pool: null,
  poolUrl: null,
  detected: null,        // DetectedSchema (with colTypes) or null
  detectedAt: null,
  candidates: [],
  discovery: null,       // raw tables from information_schema
  connected: false,
  lastQueryAt: null,
  lastError: null,
  queryCount: 0,         // snapshot (readings) queries only
  discoveryQueryCount: 0, // information_schema / pg_catalog / FK lookups
  lastTiers: null,       // which tiers the last snapshot needed, e.g. ['recent'] or ['recent', 'window']
  lastMissing: null,     // comma-joined zone ids missing from the last windowed read (for change-only logging)
  cache: null,           // { at, snapshot }
  inFlight: null,
  everConnected: false,
  noWindowUntil: 0,      // epoch ms: skip the windowed query until then (window returned no rows)
  limitsCache: null,     // { at, rows }: newest "<room> Set Low/High" rows, kept LIMITS_TTL_MS (they change rarely)
  limitsQueryCount: 0,   // limits queries; not counted as snapshot queries
  stats: null,           // last snapshotStats
  warning: null,
  setpoints: null,       // operator set-points by zone id (lib/setpoints.js); null = not loaded yet
  setpointsSource: null, // 'env' | 'file' | 'none'
  setpointsPath: null,
};

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[db] ${redact(msg)}`);
}

// Operator set-points (PULSE_SETPOINTS / setpoints.json) are read ONCE per process, on the first snapshot
// (or pool init), so "edit the file, restart Pulse" is the contract. DB set-point columns always win over
// them (applySetpoints only fills null limits). _resetForTests() clears them so tests can inject the env.
function ensureSetpoints() {
  if (state.setpoints) return state.setpoints;
  const sp = setpointsLib.loadSetpointsFromEnv(process.env);
  state.setpoints = sp.setpoints || {};
  state.setpointsSource = sp.source || 'none';
  state.setpointsPath = sp.source === 'file' ? sp.path : null;
  for (const w of sp.warnings || []) log(w);
  const n = Object.keys(state.setpoints).length;
  if (state.setpointsSource === 'none') log('setpoints: none (no PULSE_SETPOINTS and no setpoints.json; LOW/HIGH come from the database only)');
  else log(`setpoints: ${state.setpointsSource} (${n} zones)${state.setpointsPath ? ` from ${state.setpointsPath}` : ''}`);
  return state.setpoints;
}

function getPool() {
  const cfg = getConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL not set');
  ensureSetpoints();
  if (state.pool && state.poolUrl === cfg.databaseUrl) return state.pool;
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  const pool = new Pool(poolConfig(cfg));
  pool.on('error', (err) => {
    state.lastError = redact(err && err.message);
    log(`pool error: ${state.lastError}`);
  });
  state.pool = pool;
  state.poolUrl = cfg.databaseUrl;
  return pool;
}

async function closePool() {
  const p = state.pool;
  state.pool = null;
  state.poolUrl = null;
  state.inFlight = null;
  if (p) {
    try { await p.end(); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Schema discovery
// ---------------------------------------------------------------------------

const DISCOVERY_SQL = `
  SELECT t.table_name, t.table_type, c.column_name, c.data_type, c.udt_name, c.ordinal_position
  FROM information_schema.tables t
  JOIN information_schema.columns c USING (table_schema, table_name)
  WHERE t.table_schema = $1
  ORDER BY t.table_name, c.ordinal_position`;

// information_schema does not list MATERIALIZED VIEWs; pg_catalog does.
const MATVIEW_SQL = `
  SELECT c.relname AS table_name, 'MATERIALIZED VIEW' AS table_type, a.attname AS column_name,
         CASE WHEN t.typtype = 'e' THEN 'USER-DEFINED' ELSE format_type(a.atttypid, a.atttypmod) END AS data_type,
         t.typname AS udt_name, a.attnum AS ordinal_position
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
  WHERE n.nspname = $1 AND c.relkind = 'm' AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum`;

const FK_SQL = `
  SELECT kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2 AND kcu.column_name = $3`;

function columnType(r) {
  const dt = String(r.data_type == null ? '' : r.data_type);
  const udt = String(r.udt_name == null ? '' : r.udt_name).toLowerCase();
  if (/^user-defined$/i.test(dt)) return udt === 'citext' ? 'citext' : 'user-defined';
  if (/^array$/i.test(dt)) return 'array';
  return dt;
}

function groupDiscovery(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, { name: r.table_name, kind: r.table_type || 'BASE TABLE', columns: [] });
    map.get(r.table_name).columns.push({ name: r.column_name, type: columnType(r) });
  }
  return Array.from(map.values());
}

async function discoverTables(cfg) {
  const pool = getPool();
  const res = await pool.query({ text: DISCOVERY_SQL, values: [cfg.schema] });
  state.discoveryQueryCount += 1;
  setConnected(true); // the server answered: whatever goes wrong from here on is a schema problem, not connectivity
  let rows = res.rows;
  try {
    const mv = await pool.query({ text: MATVIEW_SQL, values: [cfg.schema] });
    state.discoveryQueryCount += 1;
    rows = rows.concat(mv.rows);
  } catch (err) {
    log(`materialized view discovery skipped: ${redact(err && err.message)}`);
  }
  return groupDiscovery(rows);
}

function describe(d) {
  if (!d) return 'nothing';
  if (d.mode === 'wide') {
    return `${d.schema}.${d.table} (wide) zones=${Object.keys(d.wideMap || {}).length}, ts=${d.tsCol || '-'} [${d.via}]`;
  }
  const join = d.roomJoin ? ` join=${d.roomJoin.table}.${d.roomJoin.nameCol}` : '';
  return `${d.schema}.${d.table} (${d.mode}) room=${d.roomCol} (${d.roomResolution})${join}, temp=${d.tempCol}, ts=${d.tsCol || '-'}, low=${d.setLowCol || '-'}, high=${d.setHighCol || '-'} [${d.via}]`;
}

// Integer / uuid / enum room columns: look for a FK to a names table so rooms resolve by name, not ordinal.
async function resolveRoomJoin(cfg, detected, tables) {
  const type = detected.colTypes[detected.roomCol] || 'unknown';
  if (detect.isTextType(type)) return { roomResolution: 'name', roomJoin: null };
  if (!(detect.isIntegerType(type) || detect.isOpaqueType(type))) return { roomResolution: 'name', roomJoin: null };
  const fallback = detect.isIntegerType(type) ? 'ordinal' : 'opaque';
  try {
    const pool = getPool();
    const res = await pool.query({ text: FK_SQL, values: [cfg.schema, detected.table, detected.roomCol] });
    state.discoveryQueryCount += 1;
    const fk = res.rows[0];
    if (!fk) return { roomResolution: fallback, roomJoin: null };
    let refTable = fk.ref_schema === cfg.schema ? tables.find((t) => t.name === fk.ref_table) : null;
    if (!refTable) {
      // referenced table in another schema (or not visible): discover its columns directly
      const cols = await pool.query({ text: 'SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', values: [fk.ref_schema, fk.ref_table] });
      state.discoveryQueryCount += 1;
      refTable = { name: fk.ref_table, columns: cols.rows.map((r) => ({ name: r.column_name, type: columnType(r) })) };
    }
    const nameCol = detect.pickNameColumn(refTable.columns);
    if (!nameCol) return { roomResolution: fallback, roomJoin: null };
    // setpoints often live on the parent (rooms.set_low / set_high): use them when the readings table has none
    const sp = detect.pickSetpointColumns(refTable.columns);
    const roomJoin = {
      schema: fk.ref_schema, table: fk.ref_table, keyCol: fk.ref_column, nameCol,
      lowCol: detected.setLowCol ? null : sp.lowCol,
      highCol: detected.setHighCol ? null : sp.highCol,
      colTypes: sp.colTypes,
    };
    return { roomResolution: 'join', roomJoin };
  } catch (err) {
    log(`FK lookup for ${detected.table}.${detected.roomCol} skipped: ${redact(err && err.message)}`);
    return { roomResolution: fallback, roomJoin: null };
  }
}

async function detectSchema(cfg) {
  const tables = await discoverTables(cfg);
  state.discovery = tables;
  const overrides = cfg.overrides;
  const candidates = detect.rankTables(tables, { overrides });
  state.candidates = candidates;
  const best = candidates[0];
  if (!best) {
    const names = tables.map((t) => t.name).join(', ') || '(none)';
    const want = overrides.table;
    if (want) {
      const exists = tables.some((t) => t.name === want || t.name.toLowerCase() === want.toLowerCase());
      throw schemaError(exists
        ? `PULSE_TABLE="${want}" has no usable room/temperature columns in schema "${cfg.schema}". Set PULSE_ROOM_COL / PULSE_TEMP_COL (and PULSE_TS_COL) in .env.local (run npm run db:inspect).`
        : `PULSE_TABLE="${want}" was not found in schema "${cfg.schema}". Tables seen: ${names}. Fix PULSE_TABLE / PULSE_SCHEMA in .env.local (run npm run db:inspect).`);
    }
    throw schemaError(`No usable temperature table found in schema "${cfg.schema}". Tables seen: ${names}. Set PULSE_TABLE/PULSE_* in .env.local (run npm run db:inspect).`);
  }
  const detected = {
    schema: cfg.schema,
    table: best.table,
    mode: best.mode,
    roomCol: best.roomCol,
    tempCol: best.tempCol,
    tsCol: best.tsCol,
    setLowCol: best.setLowCol,
    setHighCol: best.setHighCol,
    orderCol: best.orderCol,
    wideMap: best.wideMap || {},
    wideSetpoints: best.wideSetpoints || {},
    wideUnmapped: best.wideUnmapped || [],
    roomResolution: best.mode === 'wide' ? 'columns' : 'name',
    roomJoin: null,
    tsTz: cfg.tsTz,
    via: hasOverrides(overrides) ? 'env' : 'auto',
    colTypes: best.colTypes || {},
  };
  if (detected.mode !== 'wide' && detected.roomCol) {
    const r = await resolveRoomJoin(cfg, detected, tables);
    detected.roomResolution = r.roomResolution;
    detected.roomJoin = r.roomJoin;
  }
  state.detected = detected;
  state.detectedAt = Date.now();
  state.noWindowUntil = 0;
  log(`using ${describe(detected)}`);
  if (detected.roomResolution === 'ordinal') log(`room column ${detected.roomCol} is numeric with no usable FK: rooms are mapped by display order (1..16)`);
  if (detected.wideUnmapped.length) log(`wide columns mapped to no zone (ignored): ${detected.wideUnmapped.join(', ')}`);
  return detected;
}

function publicDetected(d) {
  if (!d) return null;
  const { colTypes, ...rest } = d;
  if (rest.roomJoin) {
    const { colTypes: jt, ...join } = rest.roomJoin;
    rest.roomJoin = join;
  }
  return rest;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function offlineRooms() {
  const rooms = {};
  for (const z of ZONES) {
    rooms[z.id] = { label: z.label, type: z.type, temperature: null, setLow: null, setHigh: null, alarm: false, offline: true, updatedAt: null };
  }
  // LOW/HIGH still display while the DB is unreachable; alarm stays false (temperature is null).
  return setpointsLib.applySetpoints(rooms, ensureSetpoints());
}

function setConnected(flag, reason) {
  if (flag !== state.connected) {
    state.connected = flag;
    log(flag ? 'connected to Postgres' : `disconnected: ${reason || 'unknown error'}`);
  }
  if (flag) state.everConnected = true;
}

function setWarning(w) {
  if (w !== state.warning) {
    state.warning = w;
    if (w) log(`warning: ${w}`);
  }
}

const SCHEMA_ERR_CODES = new Set(['42P01', '42703', '42P10', '42883', '22P02', '42804']);
const NO_WINDOW_HOLD_MS = 60000;
const LIMITS_TTL_MS = 60000;

// Errors raised after the server has answered (nothing usable found, SQL rejected): the DB is reachable.
function schemaError(message) {
  const err = new Error(message);
  err.schemaError = true;
  return err;
}
// SQLSTATE classes that mean "the server could not be used at all" rather than "the query was wrong".
const DISCONNECT_CLASSES = /^(08|28|3D|53|57|58|XX)/;
function errorMeansConnected(err) {
  if (!err) return false;
  if (err.schemaError) return true;
  const code = typeof err.code === 'string' ? err.code : '';
  return /^[0-9A-Z]{5}$/.test(code) && !DISCONNECT_CLASSES.test(code);
}

// Run one readings query; `tiers` records what was needed (for getStatus / logs).
async function readRows(pool, d, cfg, windowHours) {
  const q = detect.buildQuery(d, { windowHours, tz: cfg.tsTz });
  const res = await pool.query({ text: q.text, values: q.values || [] });
  state.queryCount += 1;
  return { rows: res.rows, windowed: q.windowed };
}

// The collector's "<room> Set Low/High" rows are written only when a limit changes, so they age out of the
// tiered windows while still being the current limits. Read the newest row per limit tag with no window,
// refreshed every LIMITS_TTL_MS, and merge them into the snapshot rows (rowsToSnapshot folds them into rooms).
async function readLimits(pool, d, cfg, now) {
  const c = state.limitsCache;
  if (c && now - c.at < LIMITS_TTL_MS) return c.rows;
  const q = detect.buildLimitsQuery(d, { tz: cfg.tsTz });
  if (!q) { state.limitsCache = { at: now, rows: [] }; return []; }
  const res = await pool.query({ text: q.text, values: q.values || [] });
  state.limitsQueryCount += 1;
  state.limitsCache = { at: now, rows: res.rows || [] };
  return state.limitsCache.rows;
}

// Long history tables are read in tiers so the common case (every zone logged in the last few minutes)
// touches only the newest slice of the table:
//   1. recent  : last max(2 x PULSE_STALE_MS, 15 min)            -> done when all 16 zones are present
//   2. window  : last PULSE_WINDOW_HOURS (default 48 h), merged   -> done unless it returned NO rows at all
//   3. unbound : whole table (logger down for days); held for NO_WINDOW_HOLD_MS so it is not re-run every poll
// Newest row per room wins on merge (rowsToSnapshot keeps the newest timestamp).
async function readTiered(pool, d, cfg) {
  const now = Date.now();
  const tiers = [];
  const unbounded = async () => {
    tiers.push('unbounded');
    return (await readRows(pool, d, cfg, 0)).rows;
  };
  if (cfg.windowHours <= 0) { const rows = await unbounded(); state.lastTiers = tiers; return rows; }
  if (now < state.noWindowUntil) { const rows = await unbounded(); state.lastTiers = tiers; return rows; }

  const recentHours = Math.min(cfg.recentMs / 3600000, cfg.windowHours);
  tiers.push('recent');
  const recent = await readRows(pool, d, cfg, recentHours);
  let rows = recent.rows;
  if (!recent.windowed) { state.lastTiers = tiers; return rows; } // not a windowable table: one query is all there is
  let missing = detect.missingZones(rows);
  if (missing.length && cfg.windowHours * 3600000 > cfg.recentMs) {
    tiers.push('window');
    const win = await readRows(pool, d, cfg, cfg.windowHours);
    rows = rows.concat(win.rows);
    if (win.rows.length === 0) {
      // Nothing in the last N hours at all (logger down?): fetch the last known readings without the window
      // so they show as stale/offline instead of missing, and hold off the windowed queries for a minute.
      log(`no rows in the last ${cfg.windowHours}h from ${d.table}; falling back to an unbounded query`);
      state.noWindowUntil = now + NO_WINDOW_HOLD_MS;
      rows = await unbounded();
    }
    missing = detect.missingZones(rows);
    const key = rows.length ? missing.join(',') : ''; // an empty table is reported by snapshotStats instead
    if (key !== state.lastMissing) { // log on change only (the kiosk polls every 2 s)
      state.lastMissing = key;
      if (key) log(`${missing.length} zone(s) without a reading in the last ${cfg.windowHours}h: ${key}`);
    }
  } else if (missing.length && rows.length === 0) {
    log(`no rows in the last ${Math.round(cfg.recentMs / 60000)} min from ${d.table}; falling back to an unbounded query`);
    state.noWindowUntil = now + NO_WINDOW_HOLD_MS;
    rows = await unbounded();
  }
  state.lastTiers = tiers;
  return rows;
}

async function runQuery(cfg) {
  const pool = getPool();
  let detected = state.detected;
  if (!detected) detected = await detectSchema(cfg);
  const attempt = async (d) => {
    const rows = await readTiered(pool, d, cfg);
    const limits = await readLimits(pool, d, cfg, Date.now());
    return limits.length ? rows.concat(limits) : rows;
  };
  try {
    return { detected, rows: await attempt(detected) };
  } catch (err) {
    if (err && SCHEMA_ERR_CODES.has(err.code)) {
      log(`query failed with ${err.code} (${redact(err.message)}); re-detecting schema`);
      state.detected = null;
      state.limitsCache = null;
      detected = await detectSchema(cfg);
      return { detected, rows: await attempt(detected) };
    }
    throw err;
  }
}

// The collector's extra tables: the panel's INPUT screen (doors, panic buttons, phase preventer) and its
// own alarm log. Optional - a deployment whose collector does not write them just gets empty lists, and
// the reason is logged once.
const extrasErrors = new Set();
function noteExtrasError(table, err) {
  const key = `${table}:${(err && err.code) || ''}`;
  if (extrasErrors.has(key)) return;
  extrasErrors.add(key);
  log(`${table}: ${redact((err && err.message) || String(err))} (shown empty until the collector creates it)`);
}
const msIso = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? null : new Date(Number(ms)).toISOString());
function shapeAlarm(x) {
  return {
    id: Number(x.id), at: msIso(x.at_ms), message: String(x.message ?? ''), state: String(x.state ?? ''),
    resetAt: msIso(x.reset_ms), active: Boolean(x.active),
  };
}
const ALARMS_SELECT = `SELECT "alarm_id" AS id, (EXTRACT(EPOCH FROM "raised_at") * 1000)::bigint AS at_ms, "message", "state",
  (EXTRACT(EPOCH FROM "reset_at") * 1000)::bigint AS reset_ms, "active" FROM "public"."panel_alarms"`;
async function readExtras(now) {
  const pool = getPool();
  const out = { inputs: [], panelAlarms: { active: [], recent: [], at: null } };
  try {
    const r = await pool.query({ text: `/* inputs */ SELECT DISTINCT ON ("tag") "tag", "value", (EXTRACT(EPOCH FROM "ts") * 1000)::bigint AS ts_ms FROM "public"."panel_inputs" ORDER BY "tag", "ts" DESC`, values: [] });
    out.inputs = (r.rows || []).filter((x) => x && typeof x.tag === 'string').map((x) => ({ tag: x.tag, value: Number(x.value), ts: msIso(x.ts_ms) })).filter((x) => Number.isFinite(x.value));
  } catch (err) { noteExtrasError('panel_inputs', err); }
  try {
    const r = await pool.query({ text: `/* alarms */ ${ALARMS_SELECT} ORDER BY "active" DESC, "raised_at" DESC LIMIT 60`, values: [] });
    const rows = (r.rows || []).filter((x) => x && x.id != null).map(shapeAlarm).filter((a) => Number.isInteger(a.id) && a.at);
    out.panelAlarms = { active: rows.filter((a) => a.active), recent: rows.filter((a) => !a.active), at: new Date(now).toISOString() };
  } catch (err) { noteExtrasError('panel_alarms', err); }
  return out;
}
// GET /api/alarms: the panel's alarm log, newest first.
async function getPanelAlarms(limit) {
  const pool = getPool();
  const r = await pool.query({ text: `/* alarms */ ${ALARMS_SELECT} ORDER BY "raised_at" DESC LIMIT $1`, values: [Math.max(1, Math.min(1000, Number(limit) || 300))] });
  return (r.rows || []).filter((x) => x && x.id != null).map(shapeAlarm).filter((a) => Number.isInteger(a.id) && a.at);
}

async function fetchSnapshot() {
  const cfg = getConfig();
  const timestamp = new Date().toISOString();
  if (!cfg.databaseUrl) {
    const error = 'DATABASE_URL not set';
    state.lastError = error;
    setConnected(false, error);
    return { ok: false, connected: false, source: 'supabase', timestamp, error, detected: null, rooms: offlineRooms() };
  }
  try {
    const { detected, rows } = await runQuery(cfg);
    const now = Date.now();
    const rooms = detect.rowsToSnapshot(detected, rows, { now, staleMs: cfg.staleMs, tz: cfg.tsTz });
    // Operator set-points fill only the limits the DB did not provide, then `alarm` is recomputed for every
    // room from the limits actually shown, so stats / warning below see the final flags.
    setpointsLib.applySetpoints(rooms, ensureSetpoints());
    const extras = await readExtras(now);
    const stats = detect.snapshotStats(rooms, { now, rowCount: rows.length });
    state.stats = stats;
    setWarning(stats.warning);
    state.lastQueryAt = now;
    state.lastError = null;
    setConnected(true);
    return {
      ok: true, connected: true, source: 'supabase', timestamp: new Date(now).toISOString(),
      detected: publicDetected(detected), rooms, stats, warning: stats.warning,
      inputs: extras.inputs, panelAlarms: extras.panelAlarms,
    };
  } catch (err) {
    const error = redact((err && err.message) || String(err));
    const changed = error !== state.lastError;
    state.lastError = error;
    state.lastQueryAt = Date.now();
    // "no usable table" / rejected SQL means the server answered: connected but not ok.
    const connected = errorMeansConnected(err);
    if (connected) setConnected(true); else setConnected(false, error);
    if (connected && changed) log(`snapshot failed: ${error}`);
    return { ok: false, connected, source: 'supabase', timestamp, error, detected: publicDetected(state.detected), rooms: offlineRooms() };
  }
}

// getSnapshot(): never throws; coalesces concurrent callers; serves a short-lived cache.
async function getSnapshot() {
  const cfg = getConfig();
  const now = Date.now();
  if (state.cache && now - state.cache.at < cfg.cacheMs) return state.cache.snapshot;
  if (state.inFlight) return state.inFlight;
  state.inFlight = (async () => {
    let snap;
    try {
      snap = await fetchSnapshot();
    } catch (err) {
      const error = redact((err && err.message) || String(err));
      state.lastError = error;
      setConnected(false, error);
      snap = { ok: false, connected: false, source: 'supabase', timestamp: new Date().toISOString(), error, detected: null, rooms: offlineRooms() };
    }
    state.cache = { at: Date.now(), snapshot: snap };
    return snap;
  })();
  try {
    return await state.inFlight;
  } finally {
    state.inFlight = null;
  }
}

function getStatus() {
  const cfg = getConfig();
  const setpoints = ensureSetpoints();
  return {
    setpointsSource: state.setpointsSource,
    setpointsZones: Object.keys(setpoints).length,
    setpointsPath: state.setpointsPath,
    connected: state.connected,
    detected: publicDetected(state.detected),
    lastQueryAt: state.lastQueryAt ? new Date(state.lastQueryAt).toISOString() : null,
    lastError: state.lastError,
    queryCount: state.queryCount,
    discoveryQueryCount: state.discoveryQueryCount,
    lastTiers: state.lastTiers,
    cacheMs: cfg.cacheMs,
    staleMs: cfg.staleMs,
    recentMs: cfg.recentMs,
    windowHours: cfg.windowHours,
    tsTz: cfg.tsTz,
    configured: Boolean(cfg.databaseUrl),
    schema: cfg.schema,
    via: state.detected ? state.detected.via : (hasOverrides(cfg.overrides) ? 'env' : 'auto'),
    roomResolution: state.detected ? state.detected.roomResolution : null,
    resolvedZones: state.stats ? state.stats.resolvedZones : null,
    unknownRooms: state.stats ? state.stats.unknownRooms : null,
    warning: state.warning,
  };
}

// inspectSchema(): discovery + ranked candidates + chosen, for scripts/db-inspect.js.
async function inspectSchema() {
  const cfg = getConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL not set');
  const tables = await discoverTables(cfg);
  state.discovery = tables;
  const analysed = tables.map((t) => detect.analyseTable(t, cfg.overrides.table && t.name === cfg.overrides.table ? cfg.overrides : {}));
  const candidates = detect.rankTables(tables, { overrides: cfg.overrides });
  let chosen = null;
  try {
    const full = await detectSchema(cfg);
    chosen = publicDetected(full);
    chosen.sql = detect.buildQuery(full, { windowHours: cfg.windowHours, tz: cfg.tsTz }).text; // shown by scripts/db-inspect.js
  } catch (err) {
    state.lastError = redact(err.message);
  }
  return {
    schema: cfg.schema,
    tables: analysed
      .map((a, i) => ({
        name: a.table,
        kind: a.kind,
        columns: tables[i].columns.map((c) => ({ name: c.name, type: c.type })),
        score: a.score,
        mode: a.mode,
        roles: a.roles,
        reasons: a.reasons,
        roomCol: a.roomCol,
        tempCol: a.tempCol,
        tsCol: a.tsCol,
        setLowCol: a.setLowCol,
        setHighCol: a.setHighCol,
        wideMap: a.wideMap,
        wideUnmapped: a.wideUnmapped,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    candidates: candidates.map(({ colTypes, roles, ...c }) => c),
    chosen,
    overrides: cfg.overrides,
    error: chosen ? null : state.lastError,
  };
}

// Test hooks: reset module state (does not close the pool) / inject a fake pool.
function _resetForTests() {
  state.detected = null;
  state.detectedAt = null;
  state.candidates = [];
  state.discovery = null;
  state.cache = null;
  state.inFlight = null;
  state.lastError = null;
  state.queryCount = 0;
  state.discoveryQueryCount = 0;
  state.lastTiers = null;
  state.lastMissing = null;
  state.limitsCache = null;
  state.limitsQueryCount = 0;
  state.connected = false;
  state.noWindowUntil = 0;
  state.stats = null;
  state.warning = null;
  state.setpoints = null; // re-read PULSE_SETPOINTS / setpoints.json on the next call
  state.setpointsSource = null;
  state.setpointsPath = null;
}
function _setPoolForTests(pool) {
  state.pool = pool;
  state.poolUrl = pool ? getConfig().databaseUrl : null;
}

module.exports = {
  getSnapshot,
  getPanelAlarms,
  getSetpoints: ensureSetpoints,
  getStatus,
  inspectSchema,
  closePool,
  redact,
  getConfig,
  poolConfig,
  stripSslParams,
  _resetForTests,
  _setPoolForTests,
};

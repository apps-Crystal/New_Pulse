# Pulse - Crystal Cold Storage Dashboard

Pulse is a Next.js 14 dashboard that shows the live temperature of the 16 cold-storage zones at Crystal Cold Storage. It shows the readings the plant collector pushes to it live over a WebSocket, falls back to reading them straight from the Supabase Postgres database (which the collector always writes) whenever that feed is absent, classifies every zone as OK / WARN / ALARM / OFFLINE, and raises on-screen alarms with a siren. The old WECON HMI "bridge" (a headless-Chrome scraper) is gone: the collector is the only thing that talks to the panel.

```
+---------------------------+      +-----------------------------+      +------------------------+
|   Supabase Postgres       |      |   Next.js (this app)        |      |   Browser / Kiosk      |
|   temperature table(s)    | ---> |   lib/db.js  (pg client,    | ---> |   Dashboard polls      |
|   16 rooms, newest rows   | SQL  |   schema auto-detect)       | JSON |   GET /api/plc every   |
|                           |      |   GET /api/plc, /api/health |      |   2 seconds            |
+---------------------------+      +-----------------------------+      +------------------------+
```

## Live feed from the plant collector (WebSocket) with the database as fallback

The plant collector (`apps-Crystal/pulse-server`, running on the PC next to the HMI) pushes every batch of
readings to this dashboard the moment it reads them, over an outbound WebSocket to `ws://<dashboard>:3000/ws`.
While that feed is delivering, the browser shows those readings and does **not** poll the database at all.
The instant the socket closes, errors, or goes quiet, the dashboard falls back to polling `GET /api/plc` -
the same database path as before, with the same rooms and alarm rules - and keeps trying to reconnect the
socket in the background. The database is always written by the collector regardless, so it stays the
record and the fallback.

```
collector (plant PC) --ws://.../ws, token--> node server.js (this app) --push--> every open dashboard tab
        |                                          |
        +------- always, every reading ----------> Supabase Postgres <--- GET /api/plc when no live feed
```

- Readings received over the socket go through the **same** snapshot builder as database rows
  (`rowsToSnapshot` in `lib/schema-detect.js`), so zone names, OFFLINE rules and set-points are identical
  on both paths. The header pill says which one is on screen: `Live · socket` or `Live · DB`.
- The feed needs a long-lived process: `npm start` now runs `node server.js` (Next.js plus the `/ws` hub).
  `start-pulse.bat` already uses `npm start`. **Vercel** has no long-lived server, so there the dashboard is
  always on the polling path - nothing to configure, it just never sees a socket.
- The collector must present a shared secret. Put the same value in both places:
  `PULSE_LIVE_TOKEN` in this app's `.env.local`, `LIVE_WS_TOKEN` in the collector's `.env`.
  With no token configured the hub refuses every publisher (safe default) and the dashboard polls.
- Only one collector is attached at a time; a restarted collector replaces the previous connection.
- `GET /api/live` returns the newest pushed snapshot (503 until something arrives, always 503 on Vercel).
  `GET /api/health` now includes a `live` block: `publisher`, `live`, `lastReadingsAt`, `feedAgeMs`,
  `subscribers`, `rejectedPublishers`.
- If the collector is set to record set-points (`RECORD_SETPOINTS=true`), the `"<room> Set Low"` /
  `"<room> Set High"` tags it sends become that room's limits on the live path and win over `setpoints.json`,
  matching the rule that database limits win over the file.

Settings (all optional, see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `PULSE_LIVE_TOKEN` | Shared secret the collector must present. Unset = collector refused |
| `PULSE_LIVE_STALE_MS` | No readings for this long -> feed considered down, `connected` false (default 90000) |
| `NEXT_PUBLIC_LIVE_STALE_MS` | Browser: a live snapshot older than this triggers database polling (build-time, default 90000) |
| `NEXT_PUBLIC_LIVE_WS` | Browser: full `ws://` URL when the feed is on another host (default: same host, `/ws`) |
| `PULSE_LIVE_PATH` | Hub path (default `/ws`) |

Collector side (in `pulse-server`'s `.env`): `LIVE_WS_URL=ws://<this-pc-ip>:3000/ws` and
`LIVE_WS_TOKEN=<the same secret>`. The collector logs `live=sent` on every batch it pushed and `live=down`
while it cannot, and keeps writing to Postgres either way.

## Zones (16)

TEMP-1 (8 zones)

- Frozen Room 1
- Frozen Room 2
- Frozen Room 3
- Frozen Room 4
- Frozen Room 5
- Frozen Anteroom
- Chiller Room 1
- Chiller Room 2

TEMP-2 (8 zones)

- Chiller Room 3
- Chiller Room 4
- Chiller Room 5
- Chiller Room 6
- Chiller Anteroom
- Blast Freezer 1
- Blast Freezer 2
- Dock Area

Status rules (see `lib/format.js`):

- ALARM - temperature is outside [SET LOW, SET HIGH]
- WARN - temperature is within 2 C of either limit
- OFFLINE - no reading for the zone, or the newest reading is older than `PULSE_STALE_MS` (default 10 minutes)
- OK - anything else

## Setpoints and alarms

The plant database as detected by `npm run db:inspect` is one long-format table, `public.readings(tag, value, ts)`: `tag` is the exact zone label ("Frozen Room 1" ... "Dock Area"), `value` the temperature in degrees C, `ts` a UTC timestamp, one row per zone every few seconds. It has no low/high set-point columns. Without set-points every zone shows LOW/HIGH as "-" and can never become WARN or ALARM, so the limits are supplied by the operator:

1. Copy `setpoints.example.json` to `setpoints.json` in the project folder (next to `package.json`). The file is site configuration and stays in the repository.
2. Fill in `low` / `high` per zone in degrees C. Leave a side `null` for no limit on that side; a zone with both sides `null` never alarms. Type-wide defaults are accepted as keys (`"frozen"`, `"chiller"`, `"other"`, or `"*"` for all zones) and an explicit zone entry overrides them. Zone keys may be ids (`frozen_room_1`), labels (`Frozen Room 1`) or short codes (`FR1`).
3. Restart Pulse. `setpoints.json` is read once at startup, so restart after every edit. Unknown zone names and malformed entries are skipped and logged as warnings; they never stop the dashboard.

Instead of the file you can set `PULSE_SETPOINTS` in `.env.local`, either compact (`frozen_room_1=-25:-15,chiller_room_1=0:8,dock=5:18`, `zone=low:high`, either side may be empty) or as JSON. `PULSE_SETPOINTS` wins over the file; `PULSE_SETPOINTS_FILE` points at a different file than `./setpoints.json`.

Precedence: set-point columns in the database (auto-detected or `PULSE_SET_LOW_COL` / `PULSE_SET_HIGH_COL`) always win; a configured value only fills a limit the database did not provide. `alarm` in `/api/plc` is recomputed from the limits actually shown.

Alarms start muted: the header shows ALARMS OFF and the bell button enables the siren, the alarm modal and the warning toasts. Cards still turn amber / red and events are still recorded while muted.

## Setup

1. Install Node.js 20 or newer. A portable copy may already be present at `C:\Users\CRPL-21\.node\current` (node.exe and npm.cmd); `start-pulse.bat` finds it automatically.
2. Copy `.env.example` to `.env.local` and replace `[YOUR-PASSWORD]` in `DATABASE_URL` with the Supabase database password.
3. `npm install`
4. `npm run db:inspect` - connects to the database, lists the candidate tables and columns, shows which table / mode / columns were auto-detected, and prints a live readout of the 16 zones. Run this first whenever something looks wrong.
5. `npm run dev` and open http://localhost:3000

Or simply double-click `start-pulse.bat`: it resolves Node, checks for `.env.local`, runs `npm install` on first launch, starts the dev server in its own window and opens Chrome in kiosk mode after 12 seconds.

Kiosk shortcut (for a desktop / startup shortcut): `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="C:\PulseKiosk" http://localhost:3000`

## How the schema is detected

The exact table layout in Supabase is not hard-coded. On the first query `lib/db.js` reads `information_schema` for the configured schema (default `public`), scores every table and view by its column names, and picks the best match in one of three modes:

- `long` - one row per reading: `room | temperature | recorded_at [| set_low | set_high]`. The newest row per room is used.
- `per_room` - one row per room holding its current value: `room | temperature | updated_at [| set_low | set_high]` (a table with one row per room and no history).
- `wide` - one row per timestamp, one column per room: `recorded_at | frozen_room_1 | frozen_room_2 | ... | dock_area`. Each column is mapped to a zone.

Room names are matched with `lib/zones.js`: display names ("Frozen Room 1"), slugs (`frozen_room_1`, `frozen-room-1`), short codes (`FR1`, `CR3`, `BF2`), and plain numbers 1..16 in the zone order listed above (1 = Frozen Room 1 ... 16 = Dock Area) all resolve to the same canonical zone. A room name that does not match any zone is still shown, as an extra card, so nothing from the database is silently dropped.

Auto-detection can be overridden or pinned with these variables in `.env.local` (all optional, see `.env.example`):

| Variable | Meaning |
| --- | --- |
| `PULSE_SCHEMA` | Postgres schema to scan (default `public`) |
| `PULSE_TABLE` | Force a specific table or view |
| `PULSE_MODE` | `long`, `per_room` or `wide` |
| `PULSE_ROOM_COL` | Column holding the room name / id |
| `PULSE_TEMP_COL` | Column holding the temperature |
| `PULSE_TS_COL` | Timestamp column (used for ordering and the stale check) |
| `PULSE_SET_LOW_COL` | Low set-point column |
| `PULSE_SET_HIGH_COL` | High set-point column |
| `PULSE_SETPOINTS` | Operator set-points when the table has none: `zone=low:high,...` or JSON (see Setpoints and alarms) |
| `PULSE_SETPOINTS_FILE` | Path of the set-points file (default `./setpoints.json`) |
| `PULSE_WIDE_MAP` | Wide tables: force `column=zone,column=zone` when column names are not recognisable (e.g. `TC1=frozen_room_1`) |
| `PULSE_TS_TZ` | Time zone of naive (`timestamp without time zone` / text) timestamps, e.g. `Asia/Kolkata` (default `UTC`) |
| `PULSE_WINDOW_HOURS` | History tables are read in tiers: the last max(2 x `PULSE_STALE_MS`, 15 min) first, then the last N hours only when a zone is missing, unbounded only when that returned nothing (default 48, 0 = off) |
| `PULSE_STALE_MS` | Readings older than this are OFFLINE (default 600000) |
| `PULSE_CACHE_MS` | Server-side cache for `/api/plc` (default 1500) |
| `PULSE_SSL_CA` | Path to a CA file to verify the Supabase certificate |

## API

`GET /api/plc` - polled by the dashboard every 2 s **when the live feed is not delivering**. Always returns HTTP 200; `connected` is false when the database could not be reached and the last-known rooms are returned.

```json
{
  "ok": true,
  "connected": true,
  "source": "supabase",
  "timestamp": "2026-09-06T08:00:00.000Z",
  "detected": {
    "schema": "public",
    "table": "temperature_readings",
    "mode": "long",
    "roomCol": "room",
    "tempCol": "temperature",
    "tsCol": "recorded_at",
    "setLowCol": "set_low",
    "setHighCol": "set_high",
    "via": "auto"
  },
  "rooms": {
    "frozen_room_1": {
      "label": "Frozen Room 1",
      "type": "frozen",
      "temperature": -18.4,
      "setLow": -22,
      "setHigh": -15,
      "alarm": false,
      "offline": false,
      "updatedAt": 1788249600000
    }
  }
}
```

Room shape: `label`, `type` (`frozen` | `chiller` | `other`), `temperature` (number or null), `setLow` / `setHigh` (number or null), `alarm`, `offline`, `updatedAt` (epoch ms or null). `rooms` always contains all 16 canonical zones in display order, followed by any unknown rooms found in the database.

`GET /api/health` - connection status for monitoring: `connected`, `detected`, `lastQueryAt`, `lastError`, `queryCount` (readings queries), `discoveryQueryCount`, `lastTiers` (for example `["recent"]` or `["recent","window"]`), `cacheMs`, `staleMs`, `recentMs`, `windowHours`, `setpointsSource` (`env` | `file` | `none`), `setpointsZones`.

## Deploying to Vercel

The app deploys as a normal Next.js project; the API routes become serverless functions.
`vercel.json` pins the functions to Singapore (`sin1`), next to the Supabase project.

1. Environment variables (Project Settings -> Environment Variables):
   - `DATABASE_URL` - use the **Transaction pooler** URL, not the direct host. Vercel functions
     have no IPv6 and the direct `db.*.supabase.co` host is IPv6-only. The pooler for this project is
     `postgresql://postgres.pyrulkcujxvioxijvtlx:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
     (URL-encode `@` in the password as `%40`).
   - `NEXT_PUBLIC_POLL_MS=10000` - poll every 10 s instead of 2 s; every poll is a function call.
   - `PULSE_SETPOINTS` - alarm limits as `frozen_room_1=-25:-15,chiller_room_1=0:8,...`
     (a `setpoints.json` file is not used on Vercel).
2. Deploy: `npx vercel --prod` from this folder, or connect the GitHub repo in the Vercel dashboard.
3. Check `https://<your-app>.vercel.app/api/health` - `connected: true` and `detected.table: readings`.

The URL is public. Turn on Deployment Protection (Vercel Authentication or a password) in the
project settings if the temperatures should not be visible to anyone with the link.

## Troubleshooting

- Header shows DB OFFLINE / "Database unreachable": the direct host `db.<project>.supabase.co` is IPv6-only. If this PC has no IPv6 route, switch `DATABASE_URL` to the Supabase Session pooler URL (Project Settings -> Database -> Connection string, port 5432). Also check that outbound port 5432 is not blocked by the firewall.
- Authentication failed: `[YOUR-PASSWORD]` in `.env.local` was not replaced, or the password contains characters that must be URL-encoded (for example `@` becomes `%40`).
- SSL / certificate errors: Supabase requires SSL. By default the server certificate is not verified; to verify it, download the Supabase CA certificate and set `PULSE_SSL_CA=./supabase-ca.crt`.
- Alarms never fire / LOW and HIGH show "-": the table has no set-point columns and no set-points are configured. The server log prints `[db] setpoints: none` at startup; create `setpoints.json` or set `PULSE_SETPOINTS` (see Setpoints and alarms) and restart.
- All zones OFFLINE while DB ONLINE: the table has no rows for those rooms, or the newest rows are older than `PULSE_STALE_MS`. Run `npm run db:inspect` to see the newest timestamp per room; raise `PULSE_STALE_MS` if the logger writes less often than every 10 minutes.
- Wrong table picked: auto-detection scores tables by column names and can choose a log or backup table. Set `PULSE_TABLE` (and `PULSE_MODE` / column overrides if needed) in `.env.local` and restart.
- Extra cards with unfamiliar names: the database contains room names that do not match any of the 16 zones. They are shown as extra cards rather than dropped; add the name as an alias in `lib/zones.js` or fix the name in the database.
- `npm run db:inspect` fails on `--env-file`: Node is older than 20.6. Upgrade, or use the portable copy in `C:\Users\CRPL-21\.node\current`.

## Files

- `app/layout.js`, `app/page.js`, `app/globals.css` - Next.js app shell and global styles
- `server.js` - custom Next.js server: the app plus the `/ws` live feed hub (`npm start`)
- `lib/live.js` - live feed hub: authenticates the collector, keeps the newest reading per room, pushes snapshots to dashboards
- `app/api/plc/route.js` - JSON snapshot polled by the dashboard when the live feed is absent
- `app/api/live/route.js` - the newest live snapshot (503 until the collector has pushed)
- `app/api/health/route.js` - connection / detection status
- `components/Dashboard.jsx` - live feed subscription, database polling fallback, status classification, alarms and events
- `components/Header.jsx` - logo tile, brand, feed pill (`Live · socket` / `Live · DB` / `DB offline`), alarms toggle pill, clock
- `components/MetricCards.jsx`, `components/RoomCard.jsx`, `components/EventsTable.jsx` - display widgets
- `components/AlarmModal.jsx`, `components/WarningToasts.jsx`, `components/AlarmSiren.jsx` - alarm UI and siren
- `lib/db.js` - Postgres pool, schema auto-detection, tiered reads, snapshot builder (applies the operator set-points)
- `lib/zones.js` - the 16 canonical zones, aliases and name resolution
- `lib/format.js` - formatting helpers and status rules
- `lib/setpoints.js` - operator set-points: parse `setpoints.json` / `PULSE_SETPOINTS`, fill missing limits, recompute alarms
- `setpoints.example.json` - template for `setpoints.json` (all 16 zones, values empty)
- `scripts/db-inspect.js` - prints detected schema and a live readout (`npm run db:inspect`)
- `scripts/db-check.js` - quick connectivity check (`npm run db:check`)
- `.env.example` - environment contract; copy to `.env.local`
- `start-pulse.bat` - one-click launcher for the plant PC (dev server + Chrome kiosk)

## UI

The dashboard is a dark-only kiosk design on a deep navy ground: a slim header with the Crystal logo tile, the LIVE / DB pill, the alarms toggle pill and a large mono clock, then four flat metric cards and a 4x4 grid of zone cards that fill the screen without scrolling, each showing the zone name, a status dot, the temperature in JetBrains Mono, the set-point range and a NEAR / TEMP TOO status label, with warning and alarm states tinted yellow and red. Text uses Space Grotesk and numbers use JetBrains Mono (both from Google Fonts with system fallbacks); the full-screen alarm takeover, the warning toasts and the "Today's Events" table share the same dark card language, and the data flow, `/api/plc` contract, polling and alarm rules are unchanged.

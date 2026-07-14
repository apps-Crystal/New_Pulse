# Pulse — Crystal Cold Storage Temperature Monitor

Live temperature dashboard for the Crystal cold-storage facility. It reads the plant's
WECON HMI (`http://192.168.0.51`, reached over the FortiClient **PLC** VPN) and shows all
**16 zones** on one wall-display-friendly screen, with out-of-range temperature alarms.

```
┌────────────────────┐  renders  ┌──────────────────────────┐  http  ┌──────────────────────┐
│  WECON HMI          │◄─────────►│  Pulse bridge (port 4000)│◄──────►│  Pulse dashboard     │
│  192.168.0.51 :80   │  headless │  headless Chrome as the  │  JSON  │  Next.js (port 3000) │
│  (Siemens PLC)      │  Chrome   │  HMI's single client     │        │  browser / kiosk     │
└────────────────────┘           └──────────────────────────┘        └──────────────────────┘
```

## Zones (16)

**TEMP-1 screen:** Frozen Room 1–5, Frozen Anteroom, Chiller Room 1–2
**TEMP-2 screen:** Chiller Room 3–6, Chiller Anteroom, Blast Freezer 1–2, Dock Area

Each zone reports **SET LOW / SET HIGH / ACTUAL**. A zone alarms (red card + full-screen
takeover + siren + event log) when ACTUAL falls outside its `[SET LOW, SET HIGH]` band, and
warns (amber) when within 2 °C of a limit.

## Running it

Two processes. On the plant PC (with the VPN connected):

```bash
# 1) install (once)
cd Pulse
npm install
cd bridge && npm install && cd ..

# 2) start the bridge (holds the single HMI connection, serves temperatures)
npm run bridge          # -> http://localhost:4000/api/plc

# 3) start the dashboard
npm run dev             # -> http://localhost:3000
```

Or just double-click **`start-pulse.bat`**, which starts the bridge, the dashboard, and opens
the kiosk view automatically.

Kiosk shortcut (Windows), full-screen with audio enabled from boot:

```
"chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --user-data-dir="C:\PulseKiosk" http://localhost:3000
```

**Requirements:** Node.js, Google Chrome installed, and the FortiClient **PLC** VPN connected.

## How the HMI is read

The HMI exposes no REST/Modbus endpoint (only port 80). It is a WECON "LAN monitoring" web
viewer, and it renders the live temperature numbers as **HTML elements overlaid on a canvas**
— they are *not* present in its WebSocket data, and it emits them only to a full **rendering**
client (a real browser), of which it allows just **one**.

So the bridge runs a **headless Chrome** (via `puppeteer-core` + your installed Chrome) as that
single client. It:
1. seeds a `weconLANCookie` in localStorage so the login redirect is skipped,
2. loads the HMI and claims the sole remote-client slot,
3. navigates the **TEMP-1** and **TEMP-2** screens,
4. reads the temperature values straight from the rendered DOM and maps each to a zone by its
   on-screen position.

Full protocol notes: see the reference memory `reference_wecon_hmi_protocol`.

### ⚠ Important operational notes

1. **Do not keep the raw HMI open in a browser.** The HMI allows only **one** remote client.
   While the bridge runs it holds that slot; the Pulse dashboard *replaces* watching the raw
   HMI. If a browser tab is on `192.168.0.51`, the bridge is refused (`remote_nomore_client`)
   and will retry every 90 s until the slot frees.

2. **Slot-release timing.** This HMI holds a slot for ~2–3 minutes after a client disconnects,
   and rapid reconnects perpetuate the busy state — so the bridge deliberately waits 90 s
   between attempts. After a clean start it usually claims the slot on the first try.

3. **`CHROME_PATH`** — defaults to `C:\Program Files\Google\Chrome\Application\chrome.exe`.
   Override via env var if Chrome is elsewhere.

4. **Even-more-reliable option (optional, needs IT).** Reading the Siemens PLC directly avoids
   the HMI entirely: forward the PLC's **S7 port 102** (or enable **Modbus TCP 502**) through
   the FortiGate, then a small S7/Modbus adapter can replace the browser engine. The PLC I/O
   map is already known from the HMI INPUT screen (e.g. panic buttons on I0.0–I0.4).

## API

`GET /api/plc` (bridge :4000, proxied by the dashboard at `/api/plc`):

```jsonc
{
  "ok": true, "connected": true, "source": "hmi",
  "timestamp": "…",
  "rooms": {
    "frozen_room_1": {
      "label": "Frozen Room 1", "type": "frozen",
      "temperature": -13.2, "setLow": -25, "setHigh": -5,
      "alarm": false, "offline": false, "updatedAt": 1784000000000
    }
    // … 16 zones
  }
}
```

`GET /api/health` — bridge connection status.

## Files

- `bridge/hmi-client.js` — persistent WECON-HMI websocket client + temperature parser
- `bridge/warehouse-map.js` — the 16 zones and their screen geometry
- `bridge/server.js` — HTTP API
- `app/` , `components/` — Next.js dashboard (header, metric cards, room grid, alarm modal, siren, toasts, events)
- `lib/format.js` — status/formatting helpers

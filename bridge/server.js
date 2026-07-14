// Pulse bridge server. Holds the single persistent HMI connection and exposes a small
// read-only HTTP API the Next.js dashboard polls. No PLC writes are ever performed.
const http = require('http');
const { HmiClient } = require('./hmi-client');

const PORT = Number(process.env.BRIDGE_PORT || 4000);
const HOST = process.env.HMI_HOST || '192.168.0.51';

const hmi = new HmiClient({ host: HOST });
hmi.start();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  if (url === '/api/health') {
    send(res, 200, {
      ok: true,
      connected: hmi.connected,
      currentScreen: hmi.currentScreen,
      clientId: hmi.clientId,
      lastFrameAt: hmi.lastFrameAt || null,
      uptime: process.uptime(),
    });
    return;
  }

  if (url === '/api/plc') {
    const state = hmi.getState();
    send(res, state.connected ? 200 : 503, { source: 'hmi', ...state });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on http://localhost:${PORT}  (HMI ${HOST})`);
  console.log(`[bridge] GET /api/plc  |  GET /api/health`);
});

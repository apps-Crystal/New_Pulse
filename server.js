// Custom Next.js server: the same dashboard, plus the /ws live feed.
//
// A WebSocket needs a long-lived process. `node server.js` (what `npm start` and start-pulse.bat run on the
// plant PC) is one; Vercel's serverless functions are not, so this file is simply never used there and the
// dashboard keeps polling the database - the fallback path is the only path on Vercel.
//
//   node server.js          production (run `npm run build` first)
//   node server.js --dev    development, with hot reload

const http = require('http');
const next = require('next');
const live = require('./lib/live');

const dev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const port = Number(process.env.PORT || 3000);
// 0.0.0.0 so the collector on the plant LAN can reach the feed; `next start` binds the same way.
const hostname = process.env.HOST || '0.0.0.0';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
// Next's own upgrade handler (dev hot reload) - everything that is not /ws goes there.
const nextUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null;

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => handle(req, res));
    live.attach(server, { fallbackUpgrade: nextUpgrade });

    server.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`[pulse] server error: ${err && err.message}`);
      process.exit(1);
    });

    const shutdown = (signal) => {
      // eslint-disable-next-line no-console
      console.log(`[pulse] ${signal} received, shutting down`);
      live.detach();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    server.listen(port, hostname, () => {
      // eslint-disable-next-line no-console
      console.log(`[pulse] ${dev ? 'dev' : 'production'} server on http://localhost:${port} - live feed at ws://localhost:${port}/ws`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[pulse] failed to start: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });

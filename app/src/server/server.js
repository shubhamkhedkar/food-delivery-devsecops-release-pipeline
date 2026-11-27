// Entry point: wires config, metrics, static files and the handler, and drains gracefully on SIGTERM.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHandler } from './app.js';
import { loadConfig } from './config.js';
import { createMetrics } from './metrics.js';
import { loadStatic } from './static.js';

const log = (level, msg, extra = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

export function start(env = process.env) {
  const cfg = loadConfig(env);
  const metrics = createMetrics({ version: cfg.version, commit: cfg.commit, city: cfg.city });
  const files = loadStatic(cfg.staticDir);
  const state = { draining: false };
  const server = createServer(createHandler({ cfg, metrics, files, state }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts

  server.listen(cfg.port, cfg.host, () =>
    log('info', 'platewise listening', { port: cfg.port, staticFiles: files.size, version: cfg.version, signingKey: cfg.signingKeySource }),
  );
  if (cfg.signingKeySource === 'ephemeral') {
    log('warn', 'ORDER_SIGNING_KEY not set: using a random per-process key; order ids will not survive restarts or work across replicas');
  }

  const shutdown = (signal) => {
    if (state.draining) return;
    state.draining = true;
    log('info', 'draining', { signal, seconds: cfg.drainSeconds });
    setTimeout(() => {
      server.close(() => {
        log('info', 'stopped');
        process.exit(0);
      });
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 10_000).unref();
    }, cfg.drainSeconds * 1000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    start();
  } catch (err) {
    log('error', 'startup failed', { error: err.message });
    process.exit(1);
  }
}

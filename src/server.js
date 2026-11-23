'use strict';
const { openDb } = require('./db');
const { buildRouter } = require('./app');
const { createServer } = require('./lib/http');
const logger = require('./lib/logger');
const configLib = require('./lib/config');
const notificationService = require('./modules/notifications/notification.service');

function startServer({ dbFile = ':memory:', port = 0, host = '127.0.0.1', config } = {}) {
  const db = openDb(dbFile);
  const router = buildRouter(db);
  const server = createServer(router, config ? { config } : {});
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({ server, db, router, port: server.address().port });
    });
  });
}

// No separate queue/worker process exists (no Redis, no job runner -- see
// README). This interval is the ENTIRE "worker": it polls the same SQLite
// table every few seconds. Fine for one instance; a multi-instance
// deployment needs a proper queue (documented gap, not hidden).
function startNotificationWorker(db, { intervalMs = 3000 } = {}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // never overlap two ticks
    running = true;
    notificationService.processQueue(db)
      .catch((err) => logger.error('notification_worker_error', { error: err.message }))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref(); // never keeps the process alive by itself
  return () => clearInterval(timer);
}

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish (bounded), stop the worker, then close the DB so the WAL is
// checkpointed and no write is cut off mid-transaction.
function installShutdown({ server, db, stopWorker }) {
  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info('shutdown_started', { signal });
    stopWorker();
    const force = setTimeout(() => { logger.error('shutdown_forced', {}); process.exit(1); }, 10_000);
    force.unref();
    server.close(() => {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (err) { logger.error('shutdown_db_error', { error: err.message }); }
      logger.info('shutdown_complete', {});
      process.exit(0);
    });
    server.closeIdleConnections();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  const cfg = configLib.get();
  if (cfg.isProduction && cfg.allowMockProviders) {
    logger.warn('mock_providers_enabled_in_production', { note: 'ALLOW_MOCK_PROVIDERS is set: simulated payments/WhatsApp are reachable. Do not use with real customers.' });
  }
  if (cfg.isProduction && !cfg.hsts) {
    logger.warn('hsts_disabled', { note: 'Set HSTS=true once the app is served over HTTPS only.' });
  }
  process.on('unhandledRejection', (err) => {
    // Last-resort net: log with context and keep serving instead of dying silently.
    logger.error('unhandled_rejection', { error: err && err.message, stack: err && err.stack });
  });
  startServer({ dbFile: cfg.dbFile, port: cfg.port, host: cfg.host })
    .then(({ server, db }) => {
      const stopWorker = startNotificationWorker(db);
      installShutdown({ server, db, stopWorker });
      logger.info('server_started', { host: cfg.host, port: cfg.port, env: cfg.nodeEnv, db: cfg.dbFile });
    })
    .catch((err) => { logger.error('startup_failed', { error: err.message }); process.exit(1); });
}

module.exports = { startServer, startNotificationWorker };

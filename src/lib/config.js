'use strict';
const path = require('node:path');

// Central, validated configuration. Read from the environment on every
// call (cheap) so tests can flip a variable and see the effect. NOTHING
// here has a secret default: an unset secret means "feature disabled",
// never "use a well-known value".

function truthy(v) { return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase()); }
function posInt(v, d) { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; }

function get(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  return Object.freeze({
    nodeEnv,
    isProduction,
    host: env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    port: posInt(env.PORT, 3000),
    dbFile: env.XR_DB_FILE || './data/xr.db',
    maxBodyBytes: posInt(env.MAX_BODY_BYTES, 1024 * 1024),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: truthy(env.TRUST_PROXY),
    hsts: truthy(env.HSTS),
    sessionTtlMs: posInt(env.SESSION_TTL_HOURS, 24) * 3600 * 1000,
    sessionIdleMs: posInt(env.SESSION_IDLE_MINUTES, 60) * 60 * 1000,
    // MOCK payment/WhatsApp providers simulate delivery with no network
    // call. They are allowed by default ONLY outside production — a mock
    // "payment success" or "message delivered" must never be reachable in
    // a production path (master prompt Rule E).
    allowMockProviders: env.ALLOW_MOCK_PROVIDERS !== undefined ? truthy(env.ALLOW_MOCK_PROVIDERS) : !isProduction,
    paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET && env.PAYMENT_WEBHOOK_SECRET.length >= 32 ? env.PAYMENT_WEBHOOK_SECRET : null,
    publicDir: env.PUBLIC_DIR || path.join(__dirname, '..', '..', 'public'),
    backupDir: env.XR_BACKUP_DIR || './backups',
    backupRetain: posInt(env.XR_BACKUP_RETAIN, 14),
  });
}

module.exports = { get };

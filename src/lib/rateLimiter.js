'use strict';
const { ApiError } = require('./errors');

// In-memory, per-process fixed-window limiter. Documented limitation: this
// does NOT protect across multiple backend instances — a deployment with
// more than one process needs a shared store (e.g. Redis). The XR default
// deployment is a single instance (see docs/operations/DEPLOYMENT.md).
//
// Stage 12: expired windows are now purged, so the map can no longer grow
// without bound under a flood of distinct keys.
function createRateLimiter({ maxAttempts, windowMs, maxKeys = 10000 }) {
  const hits = new Map(); // key -> { count, windowStart }

  function purge(now) {
    for (const [k, v] of hits) if (now - v.windowStart > windowMs) hits.delete(k);
  }

  function check(key) {
    const now = Date.now();
    if (hits.size >= maxKeys) purge(now);
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
    if (entry.count > maxAttempts) {
      const retryAfterMs = windowMs - (now - entry.windowStart);
      throw new ApiError('RATE_LIMITED', `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
    }
  }

  function reset(key) { hits.delete(key); }
  function size() { return hits.size; }

  return { check, reset, size };
}

module.exports = { createRateLimiter };

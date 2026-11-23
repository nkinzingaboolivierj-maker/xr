'use strict';

// Structured JSON logging (Stage 11 / Observability). One JSON object per
// line on stdout/stderr -- the shape a real log aggregator (CloudWatch,
// Loki, whatever is chosen at deployment time) expects, instead of
// free-text console.log calls that are hard to query later.
//
// NEVER logs a raw secret: any key matching SENSITIVE_KEYS (case-
// insensitive, checked by substring so 'passwordHash' and
// 'sessionId' both match) is redacted before the line is written, no
// matter how deep it sits in the object.

const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'sessionid', 'secret', 'apikey', 'authorization', 'signature'];

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : redact(v, seen);
    }
    return out;
  }
  return value;
}

function write(level, message, fields) {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...(fields ? redact(fields) : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

module.exports = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
  redact, // exported for tests
  SENSITIVE_KEYS,
};

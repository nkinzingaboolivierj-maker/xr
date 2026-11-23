'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('./errors');
const logger = require('./logger');
const configLib = require('./config');

class Router {
  constructor() {
    this.routes = []; // { method, pattern, keys, handler }
  }

  // opts.maxBodyBytes raises the body limit for ONE route (e.g. the GPC import,
  // whose full dataset exceeds the 1 MB default). It only applies to requests
  // that already carry a Bearer token, so anonymous callers keep the default cap.
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const regexStr = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const regex = new RegExp(`^${regexStr}$`);
    this.routes.push({ method, pattern, regex, keys, handler, maxBodyBytes: opts.maxBodyBytes || null });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h, opts) { return this.add('POST', p, h, opts); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  // Defect fixed (Stage 12): decodeURIComponent used to throw an uncaught
  // URIError for a path like /sales/%E0%A4%A, which became an unhandled
  // promise rejection and terminated the whole process from ONE
  // unauthenticated request. Malformed encoding is now a 400.
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        try {
          r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        } catch {
          throw new ApiError('VALIDATION_ERROR', 'Malformed percent-encoding in request path');
        }
        return { handler: r.handler, params, maxBodyBytes: r.maxBodyBytes };
      }
    }
    return null;
  }

  // Used by the OpenAPI contract test: "METHOD /path/{param}" for every route.
  describe() {
    return this.routes.map((r) => `${r.method} ${r.pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`);
  }
}

// Returns BOTH the parsed body and the exact raw bytes received. The raw
// text is needed verbatim (not a re-serialized JSON.stringify(parsed)) by
// anything that verifies a signature over the request body -- e.g. the
// payment webhook handler -- since JSON.parse -> JSON.stringify is not
// guaranteed to reproduce byte-identical output.
//
// Stage 12: the body is now size-limited (previously unbounded, so a
// single large POST could exhaust memory).
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return reject(new ApiError('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`));
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) { tooLarge = true; chunks.length = 0; reject(new ApiError('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return resolve({ raw: '', parsed: {} });
      let parsed;
      try { parsed = JSON.parse(data); } catch { return reject(new ApiError('VALIDATION_ERROR', 'Request body is not valid JSON')); }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(new ApiError('VALIDATION_ERROR', 'Request body must be a JSON object'));
      }
      resolve({ raw: data, parsed });
    });
    req.on('error', reject);
  });
}

const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
};

// Strict CSP for the bundled web app: no inline script, no inline style,
// no third-party origins. (Camera is allowed for same-origin barcode scanning.)
const HTML_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function applyBaseHeaders(res, cfg) {
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) res.setHeader(k, v);
  if (cfg.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function applyCors(req, res, cfg) {
  const origin = req.headers.origin;
  if (!origin || cfg.corsOrigins.length === 0) return false;
  if (!cfg.corsOrigins.includes(origin)) return false; // not allow-listed: no CORS headers at all
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function sendJson(res, status, body) {
  if (status === 204 || body === null || body === undefined) {
    res.writeHead(status, { 'Content-Length': 0, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendBinary(res, status, contentType, buffer, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(buffer);
}

function sendProblem(res, apiError, requestId) {
  const problem = apiError.toProblem();
  if (requestId) problem.requestId = requestId; // RFC 9457 extension member: lets support find the log line
  const payload = JSON.stringify(problem);
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

// Serves the bundled web app. Path traversal is blocked by resolving the
// candidate path and requiring it to stay inside publicDir.
function tryServeStatic(req, res, pathname, cfg) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel.includes('\0')) return false;
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.resolve(cfg.publicDir);
  const full = path.resolve(root, '.' + rel);
  if (full !== root && !full.startsWith(root + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(full); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext];
  if (!type) return false;
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
  if (ext === '.html') headers['Content-Security-Policy'] = HTML_CSP;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(full).pipe(res);
  return true;
}

function clientIp(req, cfg) {
  if (cfg.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function createServer(router, options = {}) {
  const http = require('node:http');
  const server = http.createServer(async (req, res) => {
    const cfg = options.config || configLib.get();
    // Per-request correlation ID. Echoed back on every response so a
    // client-reported problem can be matched to the server-side log lines.
    const requestId = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-Id', requestId);
    applyBaseHeaders(res, cfg);
    const start = process.hrtime.bigint();

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { url = new URL('http://localhost/'); }

    function finish(status) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('http_request', {
        requestId, method: req.method, path: url.pathname, status, durationMs: Math.round(durationMs * 100) / 100,
      });
    }

    try {
      const corsOk = applyCors(req, res, cfg);
      if (req.method === 'OPTIONS') {
        finish(corsOk ? 204 : 403);
        if (corsOk) { res.writeHead(204, { 'Content-Length': 0 }); return res.end(); }
        return sendProblem(res, new ApiError('PERMISSION_DENIED', 'Cross-origin request not allowed', url.pathname), requestId);
      }

      const match = router.match(req.method, url.pathname);
      if (!match) {
        if (tryServeStatic(req, res, url.pathname, cfg)) { finish(res.statusCode); return; }
        finish(404);
        return sendProblem(res, new ApiError('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, url.pathname), requestId);
      }

      const { raw, parsed } = (req.method === 'POST' || req.method === 'PATCH')
        ? await readBody(req, match.maxBodyBytes && /^Bearer \S+/.test(req.headers.authorization || '') ? Math.max(match.maxBodyBytes, cfg.maxBodyBytes) : cfg.maxBodyBytes)
        : { raw: '', parsed: {} };
      const ctx = {
        req, res, params: match.params, query: Object.fromEntries(url.searchParams),
        body: parsed, rawBody: raw, requestId, ip: clientIp(req, cfg), path: url.pathname,
      };
      const result = await match.handler(ctx);
      if (result && result.__handled) { finish(res.statusCode); return; } // handler already sent the response
      if (result && result.binary) {
        finish(result.status || 200);
        return sendBinary(res, result.status || 200, result.binary.contentType, result.binary.buffer, result.binary.headers);
      }
      const status = result && result.status ? result.status : 200;
      finish(status);
      sendJson(res, status, result && result.body !== undefined ? result.body : result);
    } catch (err) {
      if (err instanceof ApiError) {
        finish(err.status);
        if (err.code === 'PAYLOAD_TOO_LARGE') {
          res.setHeader('Connection', 'close');
          res.on('finish', () => req.destroy());
        }
        return sendProblem(res, err, requestId);
      }
      // Never leak stack traces / internals to the client (NFR-SEC-001).
      // Stage 12: this used to be reported as HTTP 400 VALIDATION_ERROR,
      // which made server faults look like client mistakes.
      logger.error('unhandled_error', { requestId, method: req.method, path: url.pathname, error: err.message, stack: err.stack });
      finish(500);
      if (res.headersSent) return res.end();
      return sendProblem(res, new ApiError('INTERNAL_ERROR', 'An unexpected error occurred. Quote the request id when reporting it.', url.pathname), requestId);
    }
  });
  // Slow-client / slowloris protection.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

module.exports = { Router, sendJson, sendProblem, createServer, HTML_CSP };

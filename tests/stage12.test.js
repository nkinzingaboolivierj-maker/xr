'use strict';
// Stage 12 -- production hardening. Every test here pins a defect that was
// reproduced against the 152-test baseline (see docs/audit/AUDIT_REPORT.md)
// or a security/operations control added to close it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { setup } = require('./helpers');
const { startServer } = require('../src/server');
const configLib = require('../src/lib/config');
const { createBusiness } = require('../src/modules/business/business.service');
const authService = require('../src/modules/auth/auth.service');
const { openDb } = require('../src/db');
const { migrate, MIGRATIONS } = require('../src/migrate');
const { MOCK_WEBHOOK_SECRET } = require('../src/modules/payments/payment.provider');
const notificationService = require('../src/modules/notifications/notification.service');
const { sha256Hex } = require('../src/lib/crypto');
const { createRateLimiter } = require('../src/lib/rateLimiter');
const { backup } = require('../scripts/backup');
const { restore } = require('../scripts/restore');

const ROOT = path.join(__dirname, '..');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const restoreEnv = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  let result;
  try { result = fn(); } catch (e) { restoreEnv(); throw e; }
  if (result && typeof result.then === 'function') return result.finally(restoreEnv);
  restoreEnv();
  return result;
}

function rawRequest(base, rawPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function seedProduct(ctx, { sku = `S12-${Math.random().toString(36).slice(2, 8)}`, qty = 10, cost = 300, min = 300, rec = 500, max = 800 } = {}) {
  const { api, tokens } = ctx;
  min = Math.min(min, rec); max = Math.max(max, rec);
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: min, recommendedPrice: rec, maxPrice: max, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: qty, unitCost: cost }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  return prod;
}

async function stockOf(ctx, productId) {
  return (await ctx.api('GET', `/inventory/stock/${productId}`, { token: ctx.tokens.manager })).json.data.stock;
}

async function login(api, email, password, extra = {}) {
  return api('POST', '/auth/login', { body: { email, password, ...extra } });
}

// ===========================================================================
test('Stage 12 — HTTP robustness and security headers', async (t) => {
  const ctx = await setup();
  const { api, base } = ctx;
  t.after(ctx.teardown);

  await t.test('DEFECT D1: malformed percent-encoding is a 400, not a process crash', async () => {
    let unhandled = null;
    const onUnhandled = (e) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    const res = await rawRequest(base, '/sales/%E0%A4%A');
    await new Promise((r) => setTimeout(r, 100));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(res.status, 400);
    assert.equal(unhandled, null, 'no unhandled promise rejection may escape (it terminates Node by default)');
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200, 'server must still be serving');
  });

  await t.test('DEFECT D3: an unexpected exception is HTTP 500 INTERNAL_ERROR with a request id, and leaks nothing', async () => {
    ctx.router.get('/__boom', () => { throw new Error('secret internal detail /etc/passwd'); });
    const res = await api('GET', '/__boom');
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'INTERNAL_ERROR');
    assert.ok(res.json.requestId, 'problem+json carries the request id');
    assert.ok(!JSON.stringify(res.json).includes('secret internal detail'));
  });

  await t.test('DEFECT D4: request bodies above MAX_BODY_BYTES are rejected with 413', async () => {
    const big = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1.2 * 1024 * 1024) });
    const res = await rawRequest(base, '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(big) }, body: big });
    assert.equal(res.status, 413);
    assert.equal(JSON.parse(res.body.toString()).code, 'PAYLOAD_TOO_LARGE');
  });

  await t.test('A JSON body that is not an object is rejected', async () => {
    const res = await rawRequest(base, '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2,3]' });
    assert.equal(res.status, 400);
  });

  await t.test('Security headers are present on API responses', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  await t.test('Unknown routes and no CORS: a cross-origin preflight is refused when no origin is allow-listed', async () => {
    const res = await rawRequest(base, '/products', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(res.status, 403);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  await t.test('/ready does not echo driver errors', async () => {
    const res = await fetch(`${base}/ready`);
    assert.deepEqual(await res.json(), { status: 'ready' });
  });

  await t.test('Paging inputs are bounded (D5b): NaN, 0 and huge pageSize are 400, not 500 or a full-table read', async () => {
    const token = ctx.tokens.owner;
    for (const q of ['pageSize=abc', 'page=0', 'pageSize=100000', 'page=-3']) {
      const res = await api('GET', `/sales?${q}`, { token });
      assert.equal(res.status, 400, q);
    }
    assert.equal((await api('GET', '/sales?page=1&pageSize=5', { token })).status, 200);
  });
});

test('Stage 12 — CORS allow-list and static hosting', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-pub-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export {};');
  fs.writeFileSync(path.join(dir, 'secret.txt.bak'), 'nope');
  const cfg = Object.freeze({ ...configLib.get(), publicDir: dir, corsOrigins: ['https://app.example'], hsts: true });
  const { server, port } = await startServer({ dbFile: ':memory:', port: 0, config: cfg });
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  await t.test('allow-listed origin gets CORS headers; others get none', async () => {
    const ok = await rawRequest(base, '/health', { headers: { Origin: 'https://app.example' } });
    assert.equal(ok.headers['access-control-allow-origin'], 'https://app.example');
    const bad = await rawRequest(base, '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
    const pre = await rawRequest(base, '/products', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers['access-control-allow-headers'], /Authorization/);
  });

  await t.test('index.html is served with a strict CSP; HSTS when enabled', async () => {
    const res = await rawRequest(base, '/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(res.headers['content-security-policy']));
    assert.match(res.headers['strict-transport-security'], /max-age=/);
  });

  await t.test('static files: JS served, unknown extensions and path traversal are not', async () => {
    assert.equal((await rawRequest(base, '/app.js')).status, 200);
    assert.equal((await rawRequest(base, '/secret.txt.bak')).status, 404);
    assert.equal((await rawRequest(base, '/%2e%2e/%2e%2e/etc/passwd')).status, 404);
    assert.equal((await rawRequest(base, '/..%2f..%2fetc%2fpasswd')).status, 404);
    assert.equal((await rawRequest(base, '/%00')).status, 404);
  });

  await t.test('API routes take precedence over static files and POST to a static path is not served', async () => {
    assert.equal((await rawRequest(base, '/health')).status, 200);
    assert.equal((await rawRequest(base, '/app.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  });
});

// ===========================================================================
test('Stage 12 — authentication and session hardening', async (t) => {
  const ctx = await setup();
  const { api, db, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('DEFECT D2: the same email in two businesses can each log in (previously the 2nd business was locked out)', async () => {
    const a = createBusiness(db, { name: 'Shared A' });
    const b = createBusiness(db, { name: 'Shared B' });
    authService.createUser(db, { businessId: a.id, email: 'shared@x.com', password: 'passwordAAA', role: 'Owner' });
    authService.createUser(db, { businessId: b.id, email: 'shared@x.com', password: 'passwordBBB', role: 'Owner' });
    const la = await login(api, 'shared@x.com', 'passwordAAA');
    const lb = await login(api, 'shared@x.com', 'passwordBBB');
    assert.equal(la.status, 200); assert.equal(la.json.data.businessId, a.id);
    assert.equal(lb.status, 200); assert.equal(lb.json.data.businessId, b.id);
  });

  await t.test('identical credentials in two businesses require an explicit business choice', async () => {
    const a = createBusiness(db, { name: 'Twin A' });
    const b = createBusiness(db, { name: 'Twin B' });
    authService.createUser(db, { businessId: a.id, email: 'twin@x.com', password: 'samepassword1', role: 'Owner' });
    authService.createUser(db, { businessId: b.id, email: 'twin@x.com', password: 'samepassword1', role: 'Owner' });
    const amb = await login(api, 'twin@x.com', 'samepassword1');
    assert.equal(amb.status, 409);
    assert.equal(amb.json.code, 'BUSINESS_SELECTION_REQUIRED');
    assert.equal(amb.json.businesses.length, 2);
    const chosen = await login(api, 'twin@x.com', 'samepassword1', { businessId: b.id });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.json.data.businessId, b.id);
    const wrong = await login(api, 'twin@x.com', 'wrong-password', { businessId: b.id });
    assert.equal(wrong.status, 401);
  });

  await t.test('email matching is case-insensitive', async () => {
    const res = await login(api, 'OWNER@TEST.COM', 'password123');
    assert.equal(res.status, 200);
  });

  await t.test('session tokens are stored only as SHA-256 digests', async () => {
    const res = await login(api, 'owner@test.com', 'password123');
    const token = res.json.data.sessionId;
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE id = ?`).get(token).c, 0, 'raw token must not be a stored key');
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE id = ?`).get(sha256Hex(token)).c, 1);
    assert.equal((await api('GET', '/me', { token })).status, 200);
  });

  await t.test('ASVS 7.3: an idle session is rejected after the idle timeout', async () => {
    const token = (await login(api, 'owner@test.com', 'password123')).json.data.sessionId;
    const longAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(longAgo, sha256Hex(token));
    const res = await api('GET', '/me', { token });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'SESSION_EXPIRED');
    assert.match(res.json.detail, /inactivity/);
    // and it stays dead
    assert.equal((await api('GET', '/me', { token })).status, 401);
  });

  await t.test('idle timeout is configurable (SESSION_IDLE_MINUTES)', async () => {
    const token = (await login(api, 'owner@test.com', 'password123')).json.data.sessionId;
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(new Date(Date.now() - 20 * 60 * 1000).toISOString(), sha256Hex(token));
    await withEnv({ SESSION_IDLE_MINUTES: '10' }, async () => {
      assert.equal((await api('GET', '/me', { token })).status, 401);
    });
    const token2 = (await login(api, 'owner@test.com', 'password123')).json.data.sessionId;
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(new Date(Date.now() - 20 * 60 * 1000).toISOString(), sha256Hex(token2));
    assert.equal((await api('GET', '/me', { token: token2 })).status, 200, 'default idle limit is 60 minutes');
  });

  await t.test('listSessions exposes device info and marks the current session', async () => {
    const res = await api('GET', '/auth/sessions', { token: tokens.owner });
    assert.equal(res.status, 200);
    assert.ok(res.json.data.some((s) => s.current));
    assert.ok('lastSeenAt' in res.json.data[0] && 'ipAddress' in res.json.data[0]);
  });

  await t.test('login failures and successes are audited', async () => {
    await login(api, 'owner@test.com', 'definitely-wrong');
    const n = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'LOGIN_FAILED'`).get().c;
    assert.ok(n >= 1);
    assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'LOGIN'`).get().c >= 1);
  });

  await t.test('rate limiter purges expired windows instead of growing without bound', () => {
    const rl = createRateLimiter({ maxAttempts: 2, windowMs: 1, maxKeys: 5 });
    for (let i = 0; i < 5; i++) rl.check(`k${i}`);
    return new Promise((resolve) => setTimeout(() => { rl.check('trigger'); assert.ok(rl.size() <= 2); resolve(); }, 10));
  });

  await t.test('/me returns identity, business and the role\'s permission list', async () => {
    const owner = (await api('GET', '/me', { token: tokens.owner })).json.data;
    assert.equal(owner.user.role, 'Owner');
    assert.equal(owner.business.currency, 'RWF');
    assert.ok(owner.permissions.includes('user.write'));
    const cashier = (await api('GET', '/me', { token: tokens.cashier })).json.data;
    assert.ok(cashier.permissions.includes('sale.write'));
    assert.ok(!cashier.permissions.includes('sale.discount'));
    assert.ok(!cashier.permissions.includes('user.write'));
    assert.equal((await api('GET', '/me')).status, 401);
  });
});

// ===========================================================================
test('Stage 12 — user administration and business profile', async (t) => {
  const ctx = await setup();
  const { api, db, tokens, business, businessB } = ctx;
  t.after(ctx.teardown);
  let createdId;

  await t.test('only the Owner can create users (Manager and Cashier get 403)', async () => {
    for (const who of ['manager', 'cashier', 'inventory']) {
      const res = await api('POST', '/users', { token: tokens[who], body: { email: 'x@y.com', role: 'Cashier', temporaryPassword: 'temp-pass-1' } });
      assert.equal(res.status, 403, who);
    }
  });

  await t.test('Owner creates a user with a temporary password; it must be changed before anything else works', async () => {
    const created = await api('POST', '/users', { token: tokens.owner, body: { email: 'New.Hire@Test.com', role: 'Cashier', temporaryPassword: 'temp-pass-1' } });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.email, 'new.hire@test.com');
    assert.equal(created.json.data.mustChangePassword, true);
    createdId = created.json.data.id;

    const lg = await login(api, 'new.hire@test.com', 'temp-pass-1');
    assert.equal(lg.status, 200);
    assert.equal(lg.json.data.mustChangePassword, true);
    const token = lg.json.data.sessionId;
    const blocked = await api('GET', '/products', { token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await api('GET', '/me', { token })).status, 200, '/me stays reachable so the UI can show the prompt');

    const same = await api('POST', '/auth/change-password', { token, body: { currentPassword: 'temp-pass-1', newPassword: 'temp-pass-1' } });
    assert.equal(same.status, 400, 'new password must differ');
    const changed = await api('POST', '/auth/change-password', { token, body: { currentPassword: 'temp-pass-1', newPassword: 'a-much-better-pass' } });
    assert.equal(changed.status, 200);
    assert.equal((await api('GET', '/products', { token })).status, 200);
  });

  await t.test('invalid email / role / short password are rejected', async () => {
    const bad = [
      { email: 'not-an-email', role: 'Cashier', temporaryPassword: 'temp-pass-1' },
      { email: 'ok@test.com', role: 'God', temporaryPassword: 'temp-pass-1' },
      { email: 'ok2@test.com', role: 'Cashier', temporaryPassword: 'short' },
    ];
    for (const body of bad) assert.equal((await api('POST', '/users', { token: tokens.owner, body })).status, 400);
    const dup = await api('POST', '/users', { token: tokens.owner, body: { email: 'new.hire@test.com', role: 'Cashier', temporaryPassword: 'temp-pass-1' } });
    assert.equal(dup.status, 400);
  });

  await t.test('tenant isolation: Owner of business B cannot read or modify a user of business A', async () => {
    const list = (await api('GET', '/users', { token: tokens.ownerB })).json.data;
    assert.ok(!list.some((u) => u.id === createdId));
    const upd = await api('PATCH', `/users/${createdId}`, { token: tokens.ownerB, body: { status: 'inactive' } });
    assert.equal(upd.status, 403);
    assert.equal(upd.json.code, 'CROSS_BUSINESS_ACCESS');
    const rst = await api('POST', `/users/${createdId}/reset-password`, { token: tokens.ownerB, body: { temporaryPassword: 'hijack-pass-1' } });
    assert.equal(rst.status, 403);
  });

  await t.test('guards: an Owner cannot change their own role/status; one Owner demoting another keeps the business owned', async () => {
    // Uses a separate business so the shared Owner session is not consumed by the demotion.
    const c = createBusiness(db, { name: 'Guard Co' });
    authService.createUser(db, { businessId: c.id, email: 'c1@guard.co', password: 'guard-pass-1', role: 'Owner' });
    const c1 = (await login(api, 'c1@guard.co', 'guard-pass-1')).json.data;
    assert.equal((await api('PATCH', `/users/${c1.userId}`, { token: c1.sessionId, body: { role: 'Cashier' } })).status, 400);
    assert.equal((await api('PATCH', `/users/${c1.userId}`, { token: c1.sessionId, body: { status: 'inactive' } })).status, 400);
    const second = (await api('POST', '/users', { token: c1.sessionId, body: { email: 'c2@guard.co', role: 'Owner', temporaryPassword: 'temp-guard-2' } })).json.data;
    const c2 = (await login(api, 'c2@guard.co', 'temp-guard-2')).json.data;
    await api('POST', '/auth/change-password', { token: c2.sessionId, body: { currentPassword: 'temp-guard-2', newPassword: 'guard-pass-two' } });
    const demote = await api('PATCH', `/users/${c1.userId}`, { token: c2.sessionId, body: { role: 'Manager' } });
    assert.equal(demote.status, 200);
    assert.equal((await api('GET', '/me', { token: c1.sessionId })).status, 401, 'the demoted user\'s sessions end immediately');
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND role = 'Owner' AND status = 'active'`).get(c.id).c, 1);
    assert.ok(second.id);
  });

  await t.test('deactivating a user ends their sessions and blocks login; reactivating restores access', async () => {
    const victim = (await api('POST', '/users', { token: tokens.owner, body: { email: 'temp.worker@test.com', role: 'Cashier', temporaryPassword: 'temp-pass-3' } })).json.data;
    const s = (await login(api, 'temp.worker@test.com', 'temp-pass-3')).json.data.sessionId;
    assert.equal((await api('GET', '/me', { token: s })).status, 200);
    const off = await api('PATCH', `/users/${victim.id}`, { token: tokens.owner, body: { status: 'inactive' } });
    assert.equal(off.status, 200);
    assert.equal((await api('GET', '/me', { token: s })).status, 401);
    assert.equal((await login(api, 'temp.worker@test.com', 'temp-pass-3')).status, 401);
    assert.equal((await api('PATCH', `/users/${victim.id}`, { token: tokens.owner, body: { status: 'active' } })).status, 200);
    assert.equal((await login(api, 'temp.worker@test.com', 'temp-pass-3')).status, 200);
  });

  await t.test('reset-password revokes the user\'s sessions and forces a change', async () => {
    const victim = (await api('POST', '/users', { token: tokens.owner, body: { email: 'reset.me@test.com', role: 'Manager', temporaryPassword: 'temp-pass-4' } })).json.data;
    const s = (await login(api, 'reset.me@test.com', 'temp-pass-4')).json.data.sessionId;
    const r = await api('POST', `/users/${victim.id}/reset-password`, { token: tokens.owner, body: { temporaryPassword: 'reset-pass-55' } });
    assert.equal(r.status, 200);
    assert.equal((await api('GET', '/me', { token: s })).status, 401);
    const again = await login(api, 'reset.me@test.com', 'reset-pass-55');
    assert.equal(again.json.data.mustChangePassword, true);
  });

  await t.test('user administration is audited', async () => {
    const actions = db.prepare(`SELECT DISTINCT action FROM audit_logs WHERE resource = 'user' AND business_id = ?`).all(business.id).map((r) => r.action);
    for (const a of ['CREATE', 'UPDATE', 'PASSWORD_RESET']) assert.ok(actions.includes(a), a);
  });

  await t.test('business profile: any role can read, only Owner can change; currency is ISO-shaped and locked once sales exist', async () => {
    assert.equal((await api('GET', '/business', { token: tokens.cashier })).status, 200);
    assert.equal((await api('PATCH', '/business', { token: tokens.manager, body: { name: 'Hack' } })).status, 403);
    const ok = await api('PATCH', '/business', { token: tokens.owner, body: { name: 'Kigali Electronics', phone: '+250788000000', address: 'KN 4 Ave', taxId: '123456789', timezone: 'Africa/Kigali' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.name, 'Kigali Electronics');
    assert.equal((await api('PATCH', '/business', { token: tokens.owner, body: { currency: 'rwf' } })).status, 400);
    assert.equal((await api('PATCH', '/business', { token: tokens.owner, body: { timezone: 'Mars/Olympus' } })).status, 400);
    assert.equal((await api('PATCH', '/business', { token: tokens.owner, body: {} })).status, 400);
    // currency can change while the business has no history...
    assert.equal((await api('PATCH', '/business', { token: tokens.ownerB, body: { currency: 'USD' } })).status, 200);
    // ...but not after a sale exists
    const prod = await seedProduct(ctx);
    await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'cur-lock-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 1000 } });
    const locked = await api('PATCH', '/business', { token: tokens.owner, body: { currency: 'USD' } });
    assert.equal(locked.status, 400);
    assert.match(locked.json.detail, /historical/);
    assert.equal(businessB.id !== business.id, true);
  });
});

// ===========================================================================
test('Stage 12 — payment verification, webhook secret, production gating', async (t) => {
  const ctx = await setup();
  const { api, base, db, tokens } = ctx;
  t.after(ctx.teardown);

  function sign(raw, secret = MOCK_WEBHOOK_SECRET) { return crypto.createHmac('sha256', secret).update(raw).digest('hex'); }
  async function webhook(payload, secret) {
    const raw = JSON.stringify(payload);
    const res = await fetch(`${base}/payments/webhook/mock`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sign(raw, secret) }, body: raw });
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  }
  async function successfulIntent({ method = 'Card', amount = 500, network } = {}) {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method, network, amount, idempotencyKey: `k-${crypto.randomBytes(5).toString('hex')}` } })).json.data;
    await webhook({ eventId: `e-${crypto.randomBytes(5).toString('hex')}`, providerReference: created.providerReference, status: 'SUCCESS' });
    return created;
  }

  await t.test('DEFECT D6 (critical): the mock webhook is closed in production, so its public default secret cannot forge a payment', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: 'prod-forge-1' } })).json.data;
    await withEnv({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDERS: undefined, PAYMENT_WEBHOOK_SECRET: undefined }, async () => {
      const forged = await webhook({ eventId: 'forged-1', providerReference: created.providerReference, status: 'SUCCESS' });
      assert.equal(forged.status, 503);
      assert.equal(forged.json.code, 'PROVIDER_NOT_CONFIGURED');
    });
    const row = db.prepare(`SELECT status FROM payment_intents WHERE id = ?`).get(created.id);
    assert.equal(row.status, 'PENDING', 'the forged event must not change the payment');
  });

  await t.test('in production a MOCK business cannot initiate a simulated payment at all (no fake success path)', async () => {
    await withEnv({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDERS: undefined }, async () => {
      const before = db.prepare(`SELECT COUNT(*) AS c FROM payment_intents`).get().c;
      const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'MTN_MOMO', amount: 1000, idempotencyKey: 'prod-mock-1' } });
      assert.equal(res.status, 503);
      assert.match(res.json.detail, /BLOCKED_PENDING_PROVIDER/);
      assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM payment_intents`).get().c, before, 'nothing was claimed or recorded');
    });
  });

  await t.test('a configured PAYMENT_WEBHOOK_SECRET replaces the public default (the default no longer verifies)', async () => {
    const secret = 'x'.repeat(48);
    await withEnv({ PAYMENT_WEBHOOK_SECRET: secret }, async () => {
      const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: 'secret-1' } })).json.data;
      const withDefault = await webhook({ eventId: 'sec-a', providerReference: created.providerReference, status: 'SUCCESS' }, MOCK_WEBHOOK_SECRET);
      assert.equal(withDefault.status, 401);
      assert.equal(withDefault.json.code, 'INVALID_WEBHOOK_SIGNATURE');
      const withReal = await webhook({ eventId: 'sec-b', providerReference: created.providerReference, status: 'SUCCESS' }, secret);
      assert.equal(withReal.status, 200);
    });
    withEnv({ PAYMENT_WEBHOOK_SECRET: 'too-short' }, () => assert.equal(configLib.get().paymentWebhookSecret, null));
  });

  await t.test('webhook state machine: a settled payment cannot be flipped; a late SUCCESS after EXPIRED is accepted for reconciliation', async () => {
    const a = await successfulIntent();
    const flip = await webhook({ eventId: `flip-${Date.now()}`, providerReference: a.providerReference, status: 'FAILED' });
    assert.equal(flip.status, 200);
    assert.equal(flip.json.data.status, 'SUCCESS', 'SUCCESS is final');
    assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'WEBHOOK_REJECTED_TRANSITION'`).get().c >= 1);

    const b = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 700, idempotencyKey: 'late-1' } })).json.data;
    await webhook({ eventId: 'late-a', providerReference: b.providerReference, status: 'EXPIRED' });
    const late = await webhook({ eventId: 'late-b', providerReference: b.providerReference, status: 'SUCCESS' });
    assert.equal(late.json.data.status, 'SUCCESS');
    const unrec = await api('GET', '/payments/unreconciled', { token: tokens.manager });
    assert.ok(unrec.json.data.some((p) => p.id === b.id), 'late-paid money surfaces for reconciliation');
  });

  await t.test('attach-sale rejects an amount, currency or method mismatch (422) and accepts an exact match', async () => {
    const prod = await seedProduct(ctx, { rec: 500 });
    const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `att-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Card' } })).json.data;
    assert.equal(sale.payment.status, 'PENDING');

    const wrongAmount = await successfulIntent({ amount: 499 });
    const r1 = await api('POST', `/payment-intents/${wrongAmount.id}/attach-sale`, { token: tokens.manager, body: { saleId: sale.id } });
    assert.equal(r1.status, 422); assert.equal(r1.json.code, 'PAYMENT_AMOUNT_MISMATCH');

    const wrongMethod = await successfulIntent({ method: 'MobileMoney', network: 'AIRTEL_MONEY', amount: 500 });
    const r2 = await api('POST', `/payment-intents/${wrongMethod.id}/attach-sale`, { token: tokens.manager, body: { saleId: sale.id } });
    assert.equal(r2.status, 422);

    const good = await successfulIntent({ amount: 500 });
    const r3 = await api('POST', `/payment-intents/${good.id}/attach-sale`, { token: tokens.manager, body: { saleId: sale.id } });
    assert.equal(r3.status, 200);
    const after = (await api('GET', `/sales/${sale.id}`, { token: tokens.manager })).json.data;
    assert.equal(after.payment.status, 'SUCCESS');
    assert.equal(after.payment.confirmation, 'PROVIDER_VERIFIED');
    assert.ok(after.payment.reference.startsWith('MOCK-'));
  });

  await t.test('POS sale with a verified paymentIntentId settles atomically; the intent cannot be reused', async () => {
    const prod = await seedProduct(ctx, { rec: 500 });
    const intent = await successfulIntent({ amount: 500 });
    const sale = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `pos-int-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Card', paymentIntentId: intent.id } });
    assert.equal(sale.status, 201);
    assert.equal(sale.json.data.payment.status, 'SUCCESS');
    assert.equal(sale.json.data.payment.confirmation, 'PROVIDER_VERIFIED');
    const reuse = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `pos-int2-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Card', paymentIntentId: intent.id } });
    assert.equal(reuse.status, 409);
  });

  await t.test('a PENDING or mismatched intent fails the sale and rolls back stock and the sale row (no half-recorded sale)', async () => {
    const prod = await seedProduct(ctx, { rec: 500, qty: 10 });
    const pending = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: `pend-${prod.id}` } })).json.data;
    const r1 = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `rb1-${prod.id}`, items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Card', paymentIntentId: pending.id } });
    assert.equal(r1.status, 422); assert.equal(r1.json.code, 'PAYMENT_NOT_VERIFIED');
    const mism = await successfulIntent({ amount: 500 });
    const r2 = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `rb2-${prod.id}`, items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Card', paymentIntentId: mism.id } });
    assert.equal(r2.status, 422); assert.equal(r2.json.code, 'PAYMENT_AMOUNT_MISMATCH'); // total is 1000, intent is 500
    assert.equal(await stockOf(ctx, prod.id), 10, 'stock untouched');
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM sales WHERE operation_id IN (?, ?)`).get(`rb1-${prod.id}`, `rb2-${prod.id}`).c, 0);
    assert.equal(db.prepare(`SELECT sale_id FROM payment_intents WHERE id = ?`).get(mism.id).sale_id, null);
  });

  await t.test('manual confirmation: a recorded reference settles a Mobile Money sale (audited); without one it stays PENDING until confirmed', async () => {
    const prod = await seedProduct(ctx, { rec: 500 });
    const withRef = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `man1-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'MobileMoney', paymentReference: 'MP240612.1234.A56789' } })).json.data;
    assert.equal(withRef.payment.status, 'SUCCESS');
    assert.equal(withRef.payment.confirmation, 'MANUAL');
    assert.equal(withRef.payment.reference, 'MP240612.1234.A56789');

    const noRef = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `man2-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'MobileMoney' } })).json.data;
    assert.equal(noRef.payment.status, 'PENDING');
    assert.equal((await api('POST', `/sales/${noRef.id}/confirm-payment`, { token: tokens.cashier, body: {} })).status, 400, 'reference required');
    const done = await api('POST', `/sales/${noRef.id}/confirm-payment`, { token: tokens.cashier, body: { reference: 'TXN-77' } });
    assert.equal(done.status, 200);
    assert.equal(done.json.data.payment.status, 'SUCCESS');
    assert.equal((await api('POST', `/sales/${noRef.id}/confirm-payment`, { token: tokens.cashier, body: { reference: 'TXN-77' } })).status, 200, 'idempotent');
    assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'CONFIRM_PAYMENT'`).get().c >= 1);
    // cash needs no confirmation; inventory staff cannot confirm
    const cash = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `man3-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 500 } })).json.data;
    assert.equal(cash.payment.confirmation, 'CASH');
    assert.equal((await api('POST', `/sales/${cash.id}/confirm-payment`, { token: tokens.cashier, body: { reference: 'x' } })).status, 400);
    assert.equal((await api('POST', `/sales/${noRef.id}/confirm-payment`, { token: tokens.inventory, body: { reference: 'x' } })).status, 403);
    // other tenants cannot confirm
    assert.equal((await api('POST', `/sales/${noRef.id}/confirm-payment`, { token: tokens.ownerB, body: { reference: 'x' } })).status, 403);
  });

  await t.test('requireVerifiedPayments forbids manual non-cash settlement', async () => {
    assert.equal((await api('PATCH', '/business', { token: tokens.owner, body: { requireVerifiedPayments: true } })).status, 200);
    const prod = await seedProduct(ctx, { rec: 500 });
    const res = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `ver-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'MobileMoney', paymentReference: 'TXN-1' } });
    assert.equal(res.status, 422); assert.equal(res.json.code, 'PAYMENT_NOT_VERIFIED');
    const cash = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `ver2-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 500 } });
    assert.equal(cash.status, 201, 'cash is unaffected');
    await api('PATCH', '/business', { token: tokens.owner, body: { requireVerifiedPayments: false } });
  });

  await t.test('sale input validation: NaN/negative/absurd price and quantity are rejected up front', async () => {
    const prod = await seedProduct(ctx);
    const cases = [
      { productId: prod.id, quantity: 1, unitPrice: 'abc' },
      { productId: prod.id, quantity: 1, unitPrice: -5 },
      { productId: prod.id, quantity: '1e999' },
      { productId: prod.id, quantity: 0 },
      { quantity: 1 },
    ];
    for (const [i, item] of cases.entries()) {
      const res = await api('POST', '/sales', { token: tokens.manager, body: { operationId: `val-${prod.id}-${i}`, items: [item], paymentMethod: 'Cash', cashReceived: 100000 } });
      assert.equal(res.status, 400, JSON.stringify(item));
    }
    assert.equal(await stockOf(ctx, prod.id), 10);
  });

  await t.test('in production a MOCK WhatsApp delivery can never be reported SENT', async () => {
    const prod = await seedProduct(ctx, { rec: 500 });
    const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `wa-${prod.id}`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 500 } })).json.data;
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788123456' } })).json.data;
    await withEnv({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDERS: undefined }, async () => {
      await notificationService.attemptDelivery(db, queued.id);
    });
    const row = db.prepare(`SELECT status, failure_reason, provider_message_id FROM notification_deliveries WHERE id = ?`).get(queued.id);
    assert.notEqual(row.status, 'SENT');
    assert.equal(row.provider_message_id, null);
    assert.match(row.failure_reason, /BLOCKED_PENDING_PROVIDER/);
    // The sale itself is untouched by the delivery failure.
    assert.equal((await api('GET', `/sales/${sale.id}`, { token: tokens.cashier })).json.data.status, 'completed');
  });
});

// ===========================================================================
test('Stage 12 — database: migrations, indexes, append-only ledgers', async (t) => {
  await t.test('a fresh database records every migration and re-running is a no-op', () => {
    const db = openDb(':memory:');
    const ids = db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all().map((r) => r.id);
    assert.deepEqual(ids, MIGRATIONS.map((m) => m.id).sort());
    assert.deepEqual(migrate(db), []);
  });

  await t.test('DEFECT D5: tenant-scoped hot paths are index-backed (baseline had none)', () => {
    const db = openDb(':memory:');
    const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
    assert.match(plan(`SELECT id FROM sales WHERE business_id = 'b' ORDER BY created_at DESC LIMIT 10`), /idx_sales_business_time/);
    assert.match(plan(`SELECT * FROM inventory_batches WHERE business_id = 'b' AND product_id = 'p' AND quantity_remaining > 0 ORDER BY received_at ASC`), /idx_batches/);
    assert.match(plan(`SELECT * FROM inventory_movements WHERE business_id = 'b' AND product_id = 'p' ORDER BY created_at`), /idx_movements_product_time/);
    assert.match(plan(`SELECT * FROM sale_items WHERE sale_id = 's'`), /idx_sale_items_sale/);
    assert.match(plan(`SELECT * FROM users WHERE lower(email) = 'a@b.c'`), /idx_users_email_lower/);
    assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`).get().c >= 35);
  });

  await t.test('upgrading a pre-Stage-12 database in place keeps every row and adds the new structure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-mig-'));
    const file = path.join(dir, 'legacy.db');
    const legacy = new DatabaseSync(file);
    legacy.exec('PRAGMA foreign_keys = ON;');
    legacy.exec(fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf8')); // exactly what the old openDb did
    legacy.prepare(`INSERT INTO businesses (id, name, low_stock_threshold, created_at) VALUES ('biz_old', 'Legacy Shop', 5, '2026-01-01T00:00:00.000Z')`).run();
    legacy.prepare(`INSERT INTO users (id, business_id, email, password_hash, role, status, created_at) VALUES ('usr_old', 'biz_old', 'old@shop.rw', 'scrypt$aa$bb', 'Owner', 'active', '2026-01-01T00:00:00.000Z')`).run();
    legacy.prepare(`INSERT INTO sessions (id, user_id, business_id, created_at, expires_at, revoked_at) VALUES ('plaintext-token', 'usr_old', 'biz_old', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', NULL)`).run();
    legacy.prepare(`INSERT INTO payments (id, business_id, sale_id, method, status, amount, created_at) VALUES ('pay1', 'biz_old', 'x', 'Cash', 'SUCCESS', 10, '2026-01-01T00:00:00.000Z')`).run?.call; // (FK to sales: not inserted; payments left empty)
    legacy.close();

    const db = openDb(file);
    assert.equal(db.prepare(`SELECT name FROM businesses WHERE id = 'biz_old'`).get().name, 'Legacy Shop');
    assert.equal(db.prepare(`SELECT currency FROM businesses WHERE id = 'biz_old'`).get().currency, 'RWF', 'new column backfilled with the documented default');
    assert.equal(db.prepare(`SELECT email FROM users WHERE id = 'usr_old'`).get().email, 'old@shop.rw');
    assert.ok(db.prepare(`SELECT revoked_at FROM sessions WHERE id = 'plaintext-token'`).get().revoked_at, 'legacy plaintext sessions are revoked on upgrade');
    assert.equal(db.prepare(`PRAGMA journal_mode`).get().journal_mode, 'wal');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('audit_logs and inventory_movements are append-only at the database level', async () => {
    const ctx = await setup();
    try {
      const prod = await seedProduct(ctx);
      const mv = ctx.db.prepare(`SELECT id FROM inventory_movements LIMIT 1`).get();
      assert.ok(mv, 'a PURCHASE movement exists');
      assert.throws(() => ctx.db.prepare(`UPDATE inventory_movements SET quantity = 999 WHERE id = ?`).run(mv.id), /append-only/);
      assert.throws(() => ctx.db.prepare(`DELETE FROM inventory_movements WHERE id = ?`).run(mv.id), /append-only/);
      const aud = ctx.db.prepare(`SELECT id FROM audit_logs LIMIT 1`).get();
      assert.throws(() => ctx.db.prepare(`UPDATE audit_logs SET action = 'tamper' WHERE id = ?`).run(aud.id), /append-only/);
      assert.throws(() => ctx.db.prepare(`DELETE FROM audit_logs WHERE id = ?`).run(aud.id), /append-only/);
      assert.equal(await stockOf(ctx, prod.id), 10, 'ledger-derived stock is intact');
    } finally { ctx.teardown(); }
  });
});

// ===========================================================================
test('Stage 12 — operations: backup, restore, bootstrap, graceful shutdown', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-ops-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, 'xr.db');
  const env = { ...process.env, XR_DB_FILE: dbFile, NODE_ENV: 'production', XR_BACKUP_DIR: path.join(dir, 'backups') };

  await t.test('bootstrap creates the first business + Owner from the environment; there are no default accounts', () => {
    const none = openDb(dbFile);
    assert.equal(none.prepare(`SELECT COUNT(*) AS c FROM users`).get().c, 0, 'a fresh database has no users at all');
    none.close();
    const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/bootstrap.js', '--business', 'Ops Shop', '--email', 'Boss@Ops.rw'], { cwd: ROOT, env: { ...env, XR_BOOTSTRAP_PASSWORD: 'a-long-bootstrap-pass' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('a-long-bootstrap-pass') && !r.stderr.includes('a-long-bootstrap-pass'), 'password is never printed');
    const db = openDb(dbFile);
    const u = db.prepare(`SELECT * FROM users`).get();
    assert.equal(u.email, 'boss@ops.rw'); assert.equal(u.role, 'Owner');
    assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'BOOTSTRAP'`).get().c === 1);
    db.close();
  });

  await t.test('bootstrap refuses a weak password and missing arguments', () => {
    const weak = spawnSync(process.execPath, ['--no-warnings', 'scripts/bootstrap.js', '--business', 'Weak', '--email', 'w@w.co'], { cwd: ROOT, env: { ...env, XR_BOOTSTRAP_PASSWORD: 'short' }, encoding: 'utf8' });
    assert.equal(weak.status, 1);
    const noArgs = spawnSync(process.execPath, ['--no-warnings', 'scripts/bootstrap.js'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(noArgs.status, 2);
    const db = openDb(dbFile);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM businesses WHERE name = 'Weak'`).get().c, 0, 'a failed bootstrap leaves no half-created business');
    db.close();
  });

  await t.test('backup -> mutate -> restore round trip returns the exact earlier state', () => {
    const db = openDb(dbFile);
    const before = db.prepare(`SELECT COUNT(*) AS c FROM businesses`).get().c;
    db.close();
    const b1 = backup({ dbFile, outDir: env.XR_BACKUP_DIR, retain: 3 });
    assert.ok(fs.existsSync(b1.file));
    assert.equal(fs.statSync(b1.file).mode & 0o777, 0o600, 'backups are owner-readable only');

    const live = openDb(dbFile);
    createBusiness(live, { name: 'Created after backup' });
    assert.equal(live.prepare(`SELECT COUNT(*) AS c FROM businesses`).get().c, before + 1);
    live.close();

    const r = restore({ backupFile: b1.file, dbFile });
    assert.ok(r.preservedPrevious && fs.existsSync(r.preservedPrevious), 'the pre-restore database is kept');
    const restored = openDb(dbFile);
    assert.equal(restored.prepare(`SELECT COUNT(*) AS c FROM businesses`).get().c, before);
    assert.equal(restored.prepare(`SELECT COUNT(*) AS c FROM businesses WHERE name = 'Created after backup'`).get().c, 0);
    assert.equal(restored.prepare(`PRAGMA integrity_check`).get().integrity_check, 'ok');
    restored.close();
  });

  await t.test('restore refuses a corrupt file and a non-XR database; backup retention prunes old copies', () => {
    const junk = path.join(dir, 'junk.db');
    fs.writeFileSync(junk, 'this is not a sqlite database at all, just text'.repeat(50));
    assert.throws(() => restore({ backupFile: junk, dbFile }));
    const other = path.join(dir, 'other.db');
    const o = new DatabaseSync(other); o.exec('CREATE TABLE t (x)'); o.close();
    assert.throws(() => restore({ backupFile: other, dbFile }), /not an XR database|no such table/);
    for (let i = 0; i < 4; i++) { backup({ dbFile, outDir: env.XR_BACKUP_DIR, retain: 3 }); }
    assert.ok(fs.readdirSync(env.XR_BACKUP_DIR).filter((f) => f.endsWith('.db')).length <= 3);
  });

  await t.test('the real server process boots from the bootstrapped DB, serves the API, and exits 0 on SIGTERM', async () => {
    const port = 39000 + Math.floor(Math.random() * 500);
    const child = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { cwd: ROOT, env: { ...env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_DIR: path.join(dir, 'nopublic') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
    const deadline = Date.now() + 8000;
    while (!out.includes('server_started') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(out.includes('server_started'), out);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const lg = await fetch(`http://127.0.0.1:${port}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'boss@ops.rw', password: 'a-long-bootstrap-pass' }) });
    assert.equal(lg.status, 200);
    // production posture: the mock payment webhook is closed
    const wh = await fetch(`http://127.0.0.1:${port}/payments/webhook/mock`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'x' }, body: '{}' });
    assert.equal(wh.status, 503);
    // the healthcheck script agrees
    const hc = spawnSync(process.execPath, ['scripts/healthcheck.js'], { cwd: ROOT, env: { ...env, PORT: String(port) } });
    assert.equal(hc.status, 0);
    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 0, 'graceful shutdown exits cleanly');
    assert.ok(out.includes('shutdown_complete'));
    assert.ok(!out.includes('a-long-bootstrap-pass'), 'no password in logs');
  });
});

// ===========================================================================
test('Stage 12 — PDF receipt', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);
  await api('PATCH', '/business', { token: tokens.owner, body: { name: 'Kigali Electronics', phone: '+250 788 000 000', address: 'KN 4 Ave, Kigali', taxId: 'TIN-123456' } });
  await api('POST', '/tax-configurations', { token: tokens.owner, body: { name: 'VAT', ratePercent: 18, effectiveFrom: '2020-01-01' } });
  const prod = await seedProduct(ctx, { rec: 1000 });
  const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'pdf-sale-1', items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Cash', cashReceived: 5000 } })).json.data;

  const hasPoppler = spawnSync('pdfinfo', ['-v']).status !== null;

  await t.test('GET /documents/receipt/:id/pdf returns a structurally valid PDF', async () => {
    const res = await fetch(`${ctx.base}/documents/receipt/${sale.id}/pdf`, { headers: { Authorization: `Bearer ${tokens.cashier}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /^inline; filename="receipt-/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    assert.match(buf.subarray(-6).toString('latin1'), /%%EOF/);
    const file = path.join(os.tmpdir(), `xr-receipt-${Date.now()}.pdf`);
    fs.writeFileSync(file, buf);
    if (hasPoppler) {
      const info = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
      assert.equal(info.status, 0, info.stderr);
      assert.match(info.stdout, /Pages:\s+1/);
      const text = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout;
      for (const needle of ['Kigali Electronics', 'TIN-123456', sale.id, `Product ${prod.id.slice(0, 0)}`.trim() || 'Product', 'Subtotal', 'Tax 18%', 'TOTAL RWF', '2,360', 'Cash received', '5,000', 'Change']) {
        assert.ok(text.includes(needle), `PDF text must contain "${needle}", got:\n${text}`);
      }
      // 2 x 1000 = 2000, tax 18% = 360, total 2360, change 2640
      assert.ok(text.includes('2,640'));
    }
    fs.rmSync(file, { force: true });
  });

  await t.test('the receipt is built from snapshot values: a later price change does not rewrite it', async () => {
    await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 100, recommendedPrice: 9999, maxPrice: 20000, reason: 'later change' } });
    const json = (await api('GET', `/documents/receipt/${sale.id}`, { token: tokens.cashier })).json.data;
    assert.equal(json.items[0].unitPrice, 1000);
    assert.equal(json.total, 2360);
    assert.equal(json.taxRate, 18);
    assert.equal(json.currency, 'RWF');
    assert.equal(json.business.taxId, 'TIN-123456');
  });

  await t.test('access control: unauthenticated 401, other business 403, unknown sale 404, no-permission role 403', async () => {
    assert.equal((await fetch(`${ctx.base}/documents/receipt/${sale.id}/pdf`)).status, 401);
    const other = await fetch(`${ctx.base}/documents/receipt/${sale.id}/pdf`, { headers: { Authorization: `Bearer ${tokens.ownerB}` } });
    assert.equal(other.status, 403);
    assert.equal((await fetch(`${ctx.base}/documents/receipt/nope/pdf`, { headers: { Authorization: `Bearer ${tokens.cashier}` } })).status, 404);
    assert.equal((await fetch(`${ctx.base}/documents/receipt/${sale.id}/pdf`, { headers: { Authorization: `Bearer ${tokens.inventory}` } })).status, 403);
  });

  await t.test('hostile text (parentheses, backslashes, non-Latin-1) cannot corrupt the PDF', async () => {
    const { buildReceiptPdf } = require('../src/modules/documents/receipt.pdf');
    const nasty = { receiptNumber: 'r(1)\\x', issuedAt: 'now', currency: 'RWF', business: { name: 'A) Tj ET (evil \\ 日本語' }, customer: { name: 'Zoë' },
      items: [{ productName: 'Item (with) parens \\ and 😀 emoji and a very long name that must wrap across several lines without overflowing', quantity: 1, unitPrice: 10, lineTotal: 10 }],
      subtotal: 10, total: 10, paymentMethod: 'Cash', cashReceived: 10, changeDue: 0 };
    const buf = buildReceiptPdf(nasty);
    const file = path.join(os.tmpdir(), `xr-nasty-${Date.now()}.pdf`);
    fs.writeFileSync(file, buf);
    if (hasPoppler) {
      assert.equal(spawnSync('pdfinfo', [file]).status, 0);
      const text = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }).stdout;
      assert.ok(text.includes('(evil'), text);
    }
    fs.rmSync(file, { force: true });
  });
});

// ===========================================================================
test('Stage 12 — API contract parity (OpenAPI is generated from, and checked against, the real router)', async (t) => {
  const { ROUTES, generate } = require('../scripts/generate-openapi');
  const { buildRouter } = require('../src/app');
  const router = buildRouter(openDb(':memory:'));
  const real = new Set(router.describe());
  const documented = new Set(ROUTES.map((r) => `${r[0]} ${r[1]}`));

  await t.test('every real route is documented and every documented route exists', () => {
    assert.deepEqual([...real].filter((x) => !documented.has(x)), [], 'undocumented routes');
    assert.deepEqual([...documented].filter((x) => !real.has(x)), [], 'documented routes that do not exist');
  });

  await t.test('the committed docs/contracts/openapi.json is exactly what the generator emits (no drift)', () => {
    const committed = fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'openapi.json'), 'utf8');
    assert.equal(committed, generate(), 'run: node scripts/generate-openapi.js');
  });

  await t.test('operationIds are unique and public routes opt out of auth', () => {
    const spec = JSON.parse(generate());
    const ids = [];
    for (const p of Object.values(spec.paths)) for (const op of Object.values(p)) ids.push(op.operationId);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(spec.paths['/auth/login'].post.security, []);
    assert.deepEqual(spec.paths['/payments/webhook/{provider}'].post.security, []);
    assert.equal(spec.paths['/sales'].get.security, undefined, 'default bearerAuth applies');
  });

  await t.test('documented success statuses match real behavior on spot-checked endpoints', async () => {
    const ctx = await setup();
    try {
      const { api, tokens } = ctx;
      assert.equal((await api('POST', '/customers', { token: tokens.manager, body: { name: 'Doc Check' } })).status, 201);
      const prod = await seedProduct(ctx);
      const sale = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'oas-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 1000 } });
      assert.equal(sale.status, 201);
      assert.equal((await api('POST', `/sales/${sale.json.data.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788123456' } })).status, 202);
      assert.equal((await api('POST', '/inventory/adjustments', { token: tokens.manager, body: { productId: prod.id, type: 'DAMAGE', quantity: 1, reason: 'dropped' } })).status, 201);
      const spec = JSON.parse(generate());
      assert.ok(spec.paths['/customers'].post.responses['201']);
      assert.ok(spec.paths['/sales/{saleId}/send-receipt'].post.responses['202']);
      assert.ok(spec.paths['/inventory/adjustments'].post.responses['201']);
      assert.ok(spec.paths['/auth/logout'].post.responses['204']);
    } finally { ctx.teardown(); }
  });
});

// ===========================================================================
test('Stage 12 — returns/refunds money correctness (discount + tax pro-rata)', async (t) => {
  const ctx = await setup();
  const { api, tokens, db } = ctx;
  t.after(ctx.teardown);
  await api('POST', '/tax-configurations', { token: tokens.owner, body: { name: 'VAT', ratePercent: 18, effectiveFrom: '2020-01-01' } });
  const prod = await seedProduct(ctx, { rec: 1000, qty: 50 });
  const sale = (await api('POST', '/sales', { token: tokens.manager, body: { operationId: 'ret-money-1', items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Cash', cashReceived: 100000, discount: { type: 'percent', value: 10, reason: 'loyal customer' } } })).json.data;

  await t.test('DEFECT: GET /sales/:id exposes sale item ids (a return could not be created through the API otherwise)', () => {
    assert.ok(sale.items[0].id && typeof sale.items[0].id === 'string');
  });

  await t.test('DEFECT: a missing saleItemId is a 400, not a 500', async () => {
    const res = await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale.id, items: [{ quantity: 1 }] } });
    assert.equal(res.status, 400);
  });

  await t.test('DEFECT: refundable value is what the customer actually paid (after discount, incl. tax), not list price x qty', async () => {
    assert.ok(sale.total < 2 * 1000 * 1.18, 'sanity: discount applied');
    const one = (await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1, condition: 'good' }] } })).json.data;
    assert.equal(one.total, Math.round((sale.total / 2) * 100) / 100, 'one of two units = half of the amount paid');
    const rest = (await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1, condition: 'good' }] } })).json.data;
    assert.equal(Math.round((one.total + rest.total) * 100) / 100, sale.total, 'returning everything refunds exactly sale.total, no more, no less');
    const over = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: one.id, amount: one.total + 0.01, method: 'Cash' } });
    assert.equal(over.status, 422);
    assert.equal(over.json.code, 'REFUND_EXCEEDS_REFUNDABLE');
    const ok = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: one.id, amount: one.total, method: 'Cash' } });
    assert.equal(ok.status, 201);
    assert.equal((await api('GET', `/returns/${one.id}`, { token: tokens.manager })).json.data.refundableRemaining, 0);
    // a third unit cannot be returned
    const third = await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }] } });
    assert.equal(third.status, 422);
    assert.equal(db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM return_items WHERE sale_item_id = ?`).get(sale.items[0].id).q, 2);
  });

  await t.test('finance stays consistent: returning a whole discounted+taxed sale nets revenue, COGS, profit and tax to exactly zero', async () => {
    const f = (await api('GET', '/finance/summary', { token: tokens.owner })).json.data;
    assert.equal(f.salesCount, 1);
    assert.ok(f.grossRevenue > 0 && f.taxCollected > 0);
    assert.ok(Math.abs(f.netRevenue) < 0.011, `netRevenue ${f.netRevenue}`);
    assert.ok(Math.abs(f.netCogs) < 0.011, `netCogs ${f.netCogs}`);
    assert.ok(Math.abs(f.grossProfit) < 0.011);
    assert.ok(Math.abs(f.taxReturned - f.taxCollected) < 0.011, 'all collected tax was handed back');
    assert.ok(Math.abs(f.netTaxHeld) < 0.011);
  });

  await t.test('finance: a partial return reduces revenue by the PRE-tax share only', async () => {
    const sale2 = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'ret-money-2', items: [{ productId: prod.id, quantity: 4 }], paymentMethod: 'Cash', cashReceived: 100000 } })).json.data;
    const before = (await api('GET', '/finance/summary', { token: tokens.owner })).json.data;
    await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale2.id, items: [{ saleItemId: sale2.items[0].id, quantity: 1 }] } });
    const after = (await api('GET', '/finance/summary', { token: tokens.owner })).json.data;
    assert.ok(Math.abs((after.returnsRevenue - before.returnsRevenue) - sale2.taxableAmount / 4) < 0.011, 'one of four units = a quarter of pre-tax revenue');
    assert.ok(Math.abs((after.taxReturned - before.taxReturned) - sale2.taxAmount / 4) < 0.011);
  });
});

// ===========================================================================
test('Stage 12 — product search and listing', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);
  for (const [sku, name, barcode] of [['A-1', '50% Off Cable', '6001111'], ['B-2', 'Wireless Mouse', '6002222'], ['C_3', 'Under_score Item', null]]) {
    await api('POST', '/products', { token: tokens.manager, body: { sku, name, barcode } });
  }
  const names = async (q) => (await api('GET', `/products?q=${encodeURIComponent(q)}`, { token: tokens.manager })).json.data.map((p) => p.name);

  await t.test('search matches name, SKU and barcode', async () => {
    assert.deepEqual(await names('mouse'), ['Wireless Mouse']);
    assert.deepEqual(await names('B-2'), ['Wireless Mouse']);
    assert.deepEqual(await names('6001111'), ['50% Off Cable']);
  });

  await t.test('LIKE wildcards in the search text are matched literally, not as wildcards', async () => {
    assert.deepEqual(await names('50%'), ['50% Off Cable']);
    assert.deepEqual(await names('%'), ['50% Off Cable']);
    assert.deepEqual(await names('_'), ['Under_score Item']);
  });

  await t.test('search is tenant-scoped and the product payload exposes barcode', async () => {
    assert.deepEqual((await api('GET', '/products?q=mouse', { token: tokens.ownerB })).json.data, []);
    const p = (await api('GET', '/products?q=mouse', { token: tokens.manager })).json.data[0];
    assert.equal(p.barcode, '6002222');
    const res = await api('GET', '/products?q=x&page=0', { token: tokens.manager });
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
test('Stage 12 — finance: revenue is not collected cash', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);
  const prod = await seedProduct(ctx, { rec: 1000, qty: 20 });
  const fin = async () => (await api('GET', '/finance/summary', { token: tokens.owner })).json.data;

  await t.test('cash sale: revenue and collected cash both rise; a pending Mobile Money sale is revenue but NOT collected cash', async () => {
    await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'fc-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 1000 } });
    const pending = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'fc-2', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'MobileMoney' } })).json.data;
    let f = await fin();
    assert.equal(f.grossRevenue, 2000);
    assert.equal(f.collectedCash, 1000);
    assert.equal(f.pendingPayments, 1000);
    await api('POST', `/sales/${pending.id}/confirm-payment`, { token: tokens.cashier, body: { reference: 'TXN-9' } });
    f = await fin();
    assert.equal(f.collectedCash, 2000);
    assert.equal(f.pendingPayments, 0);
    assert.equal(f.grossRevenue, 2000, 'confirming a payment never changes revenue');
  });

  await t.test('refunds reduce collected cash but are separate from the revenue calculation', async () => {
    const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'fc-3', items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Cash', cashReceived: 5000 } })).json.data;
    const before = await fin();
    const ret = (await api('POST', '/returns', { token: tokens.manager, body: { saleId: sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }] } })).json.data;
    await api('POST', '/refunds', { token: tokens.manager, body: { returnId: ret.id, amount: ret.total, method: 'Cash' } });
    const after = await fin();
    assert.equal(after.collectedCash, before.collectedCash - 1000);
    assert.equal(after.refundsPaid, 1000);
    assert.equal(after.netRevenue, before.netRevenue - 1000);
  });

  await t.test('date filters apply to collected cash and the Cashier cannot read finance', async () => {
    const future = (await api('GET', `/finance/summary?from=${encodeURIComponent('2099-01-01')}`, { token: tokens.owner })).json.data;
    assert.equal(future.collectedCash, 0);
    assert.equal((await api('GET', '/finance/summary', { token: tokens.cashier })).status, 403);
  });
});

// ===========================================================================
test('Stage 12 — large GPC import body', async (t) => {
  const ctx = await setup();
  const { base, tokens } = ctx;
  t.after(ctx.teardown);
  const rows = [];
  for (let i = 0; i < 9000; i++) rows.push({ segmentCode: '10', segmentTitle: 'S', familyCode: '1010', familyTitle: 'F', classCode: '101010', classTitle: 'C', brickCode: String(10000000 + i), brickTitle: `Brick number ${i} with a reasonably descriptive title` });
  const body = JSON.stringify({ versionName: 'size-test', rows, dryRun: true });
  assert.ok(body.length > 1024 * 1024, 'fixture must exceed the default 1 MB limit');

  await t.test('an authenticated Owner can dry-run an import larger than the default body limit', async () => {
    const res = await fetch(`${base}/gpc/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.owner}` }, body });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.stats.bricks, 9000);
  });

  await t.test('the same size without a token is still rejected at the default limit (413), and other routes keep the default', async () => {
    const anon = await rawRequest(base, '/gpc/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body });
    assert.equal(anon.status, 413);
    const other = await rawRequest(base, '/customers', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.owner}`, 'Content-Length': Buffer.byteLength(body) }, body });
    assert.equal(other.status, 413);
  });
});

// ===========================================================================
test('Stage 12 — documented error catalog matches the code', async (t) => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'errors.js'), 'utf8');
  const inCode = new Map([...src.matchAll(/^\s+([A-Z_]+):\s*\{ status: (\d+),/gm)].map((m) => [m[1], Number(m[2])]));
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'API_ERROR_MODEL.md'), 'utf8');
  const rows = [...doc.matchAll(/^\| `([A-Z_]+)` \| ([^|]+) \|([^|]*)\|/gm)].map((m) => ({ code: m[1], status: m[2].trim(), meaning: m[3] }));

  await t.test('every code in src/lib/errors.js is documented with the same HTTP status', () => {
    for (const [code, status] of inCode) {
      const row = rows.find((r) => r.code === code);
      assert.ok(row, `${code} is missing from docs/contracts/API_ERROR_MODEL.md`);
      assert.ok(row.status.startsWith(String(status)), `${code}: doc says ${row.status}, code says ${status}`);
    }
  });

  await t.test('every documented code exists in code unless explicitly marked (not emitted)', () => {
    for (const r of rows) assert.ok(inCode.has(r.code) || r.meaning.includes('(not emitted)'), `${r.code} is documented but does not exist`);
  });
});

// ===========================================================================
test('Stage 12 — operator password recovery', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-rec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, 'xr.db');
  const db = openDb(dbFile);
  const biz = createBusiness(db, { name: 'Recovery Co' });
  authService.createUser(db, { businessId: biz.id, email: 'owner@rec.rw', password: 'original-password', role: 'Owner' });
  const sessionBefore = authService.login(db, { email: 'owner@rec.rw', password: 'original-password' });
  db.prepare(`UPDATE users SET status = 'inactive' WHERE email = 'owner@rec.rw'`).run();
  db.close();
  const run = (extra = []) => spawnSync(process.execPath, ['--no-warnings', 'scripts/reset-password.js', '--email', 'owner@rec.rw', ...extra], { cwd: ROOT, env: { ...process.env, XR_DB_FILE: dbFile, XR_RESET_PASSWORD: 'temporary-passphrase' }, encoding: 'utf8' });

  await t.test('resets, re-activates, revokes sessions, forces a password change, and is audited', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('temporary-passphrase'));
    const d = openDb(dbFile);
    const u = d.prepare(`SELECT * FROM users WHERE email = 'owner@rec.rw'`).get();
    assert.equal(u.status, 'active'); assert.equal(u.must_change_password, 1);
    assert.throws(() => authService.resolveSession(d, sessionBefore.sessionId), /revoked|expired/i);
    assert.equal(authService.login(d, { email: 'owner@rec.rw', password: 'temporary-passphrase' }).mustChangePassword, true);
    assert.ok(d.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'PASSWORD_RESET'`).get().c >= 1);
    d.close();
  });

  await t.test('refuses unknown users, weak passwords and missing arguments', () => {
    const unknown = spawnSync(process.execPath, ['--no-warnings', 'scripts/reset-password.js', '--email', 'nobody@rec.rw'], { cwd: ROOT, env: { ...process.env, XR_DB_FILE: dbFile, XR_RESET_PASSWORD: 'temporary-passphrase' }, encoding: 'utf8' });
    assert.equal(unknown.status, 1);
    const weak = spawnSync(process.execPath, ['--no-warnings', 'scripts/reset-password.js', '--email', 'owner@rec.rw'], { cwd: ROOT, env: { ...process.env, XR_DB_FILE: dbFile, XR_RESET_PASSWORD: 'short' }, encoding: 'utf8' });
    assert.equal(weak.status, 1);
    assert.equal(spawnSync(process.execPath, ['--no-warnings', 'scripts/reset-password.js'], { cwd: ROOT, env: process.env, encoding: 'utf8' }).status, 2);
  });
});

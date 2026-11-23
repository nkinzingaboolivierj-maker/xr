'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('Stage 1 — Foundation', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('login succeeds with valid credentials', async () => {
    const res = await api('POST', '/auth/login', { body: { email: 'owner@test.com', password: 'password123' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.role, 'Owner');
  });

  await t.test('login fails with wrong password, generic error', async () => {
    const res = await api('POST', '/auth/login', { body: { email: 'owner@test.com', password: 'wrong' } });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'INVALID_CREDENTIALS');
  });

  await t.test('login fails for unknown email with the SAME generic error', async () => {
    const res = await api('POST', '/auth/login', { body: { email: 'nobody@test.com', password: 'password123' } });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'INVALID_CREDENTIALS');
  });

  await t.test('request without a session is rejected', async () => {
    const res = await api('GET', '/products');
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'UNAUTHENTICATED');
  });

  await t.test('logout revokes the session', async () => {
    const login = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const token = login.json.data.sessionId;
    const logoutRes = await api('POST', '/auth/logout', { token });
    assert.equal(logoutRes.status, 204);
    const afterLogout = await api('GET', '/products', { token });
    assert.equal(afterLogout.status, 401);
    assert.equal(afterLogout.json.code, 'SESSION_EXPIRED');
  });

  await t.test('RBAC: Cashier cannot create a product', async () => {
    const res = await api('POST', '/products', { token: tokens.cashier, body: { sku: 'X1', name: 'X' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'PERMISSION_DENIED');
  });

  await t.test('RBAC: Manager CAN create a product', async () => {
    const res = await api('POST', '/products', { token: tokens.manager, body: { sku: 'MOUSE-1', name: 'Wireless Mouse', category: 'Computer Accessories' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.sku, 'MOUSE-1');
  });

  await t.test('Products: duplicate SKU within the same business is rejected', async () => {
    await api('POST', '/products', { token: tokens.owner, body: { sku: 'DUP-1', name: 'A' } });
    const res = await api('POST', '/products', { token: tokens.owner, body: { sku: 'DUP-1', name: 'B' } });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'DUPLICATE_SKU');
  });

  await t.test('Pricing: MIN <= RECOMMENDED <= MAX is enforced', async () => {
    const p = await api('POST', '/products', { token: tokens.owner, body: { sku: 'PRICE-1', name: 'Priced Item' } });
    const bad = await api('POST', `/products/${p.json.data.id}/price`, {
      token: tokens.owner, body: { minPrice: 100, recommendedPrice: 50, maxPrice: 200, reason: 'test' },
    });
    assert.equal(bad.status, 422);
    assert.equal(bad.json.code, 'INVALID_PRICE_BAND');

    const good = await api('POST', `/products/${p.json.data.id}/price`, {
      token: tokens.owner, body: { minPrice: 100, recommendedPrice: 150, maxPrice: 200, reason: 'initial' },
    });
    assert.equal(good.status, 200);
    assert.equal(good.json.data.pricing.minPrice, 100);
  });

  await t.test('Pricing: every change is recorded in price history', async () => {
    const p = await api('POST', '/products', { token: tokens.owner, body: { sku: 'PRICE-2', name: 'Priced Item 2' } });
    await api('POST', `/products/${p.json.data.id}/price`, { token: tokens.owner, body: { minPrice: 100, recommendedPrice: 120, maxPrice: 150, reason: 'initial' } });
    await api('POST', `/products/${p.json.data.id}/price`, { token: tokens.owner, body: { minPrice: 100, recommendedPrice: 130, maxPrice: 150, reason: 'raise' } });
    const history = await api('GET', `/products/${p.json.data.id}/price-history`, { token: tokens.owner });
    assert.equal(history.status, 200);
    assert.ok(history.json.data.length >= 4); // 3 initial + 1 changed
    assert.ok(history.json.data.some((h) => h.reason === 'raise' && h.newValue === 130));
  });

  await t.test('Tenant isolation: Business B cannot read Business A product', async () => {
    const p = await api('POST', '/products', { token: tokens.owner, body: { sku: 'ISOLATE-1', name: 'Secret Product' } });
    const asOther = await api('POST', `/products/${p.json.data.id}/price`, {
      token: tokens.ownerB, body: { minPrice: 1, recommendedPrice: 2, maxPrice: 3, reason: 'attempt' },
    });
    assert.equal(asOther.status, 403);
    assert.equal(asOther.json.code, 'CROSS_BUSINESS_ACCESS');
  });

  await t.test('Audit: creating a product writes an audit log entry', async () => {
    const before = ctx.db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE business_id = ?`).get(ctx.business.id).c;
    await api('POST', '/products', { token: tokens.owner, body: { sku: 'AUDIT-1', name: 'Audited Item' } });
    const after = ctx.db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE business_id = ?`).get(ctx.business.id).c;
    assert.equal(after, before + 1);
  });
});

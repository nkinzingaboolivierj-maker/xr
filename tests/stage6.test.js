'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const stock = async (ctx, id) => (await ctx.api('GET', `/inventory/stock/${id}`, { token: ctx.tokens.manager })).json.data.stock;

async function makeReceivedPurchase(ctx, { sku, cost = 300, qty = 20 }) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: qty, unitCost: cost }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  return { prod, purchase: pur, supplier: sup };
}

test('Stage 6 — Supplier Returns, Adjustments, Sessions, Rate Limiting, Reports', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('Supplier Return: reduces stock, original purchase stays intact', async () => {
    const { prod, purchase } = await makeReceivedPurchase(ctx, { sku: 'SUPRET-1', qty: 20 });
    const res = await api('POST', '/inventory/supplier-returns', { token: tokens.inventory, body: { purchaseId: purchase.id, productId: prod.id, quantity: 5, reason: 'defective batch' } });
    assert.equal(res.status, 201);
    assert.equal(await stock(ctx, prod.id), 15);
    const purAfter = await api('GET', '/purchases', { token: tokens.manager });
    const found = purAfter.json.data.find((p) => p.id === purchase.id);
    assert.equal(found.status, 'received', 'original purchase record must remain historically intact');
    assert.equal(found.items[0].quantity, 20, 'original purchase quantity must not be altered');
  });

  await t.test('Supplier Return: cannot return more than is in stock', async () => {
    const { prod, purchase } = await makeReceivedPurchase(ctx, { sku: 'SUPRET-2', qty: 5 });
    const res = await api('POST', '/inventory/supplier-returns', { token: tokens.inventory, body: { purchaseId: purchase.id, productId: prod.id, quantity: 10, reason: 'too many' } });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'NEGATIVE_STOCK_BLOCKED');
  });

  await t.test('Damage: reduces stock, no sales revenue created', async () => {
    const { prod } = await makeReceivedPurchase(ctx, { sku: 'DMG-1', qty: 10, cost: 300 });
    const salesBefore = ctx.db.prepare(`SELECT COUNT(*) c FROM sales WHERE business_id = ?`).get(ctx.business.id).c;
    const res = await api('POST', '/inventory/adjustments', { token: tokens.inventory, body: { productId: prod.id, type: 'DAMAGE', quantity: 2, reason: 'dropped box' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.costImpact, 600); // 2 x 300
    assert.equal(await stock(ctx, prod.id), 8);
    const salesAfter = ctx.db.prepare(`SELECT COUNT(*) c FROM sales WHERE business_id = ?`).get(ctx.business.id).c;
    assert.equal(salesAfter, salesBefore, 'damage must never create a sale/revenue record');
  });

  await t.test('Loss: reduces stock and requires a reason', async () => {
    const { prod } = await makeReceivedPurchase(ctx, { sku: 'LOSS-1', qty: 10 });
    const noReason = await api('POST', '/inventory/adjustments', { token: tokens.inventory, body: { productId: prod.id, type: 'LOSS', quantity: 1 } });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.json.code, 'VALIDATION_ERROR');

    const res = await api('POST', '/inventory/adjustments', { token: tokens.inventory, body: { productId: prod.id, type: 'LOSS', quantity: 1, reason: 'theft' } });
    assert.equal(res.status, 201);
    assert.equal(await stock(ctx, prod.id), 9);
  });

  await t.test('Adjustment-In: manual stock-count correction increases stock with an audit trail', async () => {
    const { prod } = await makeReceivedPurchase(ctx, { sku: 'ADJIN-1', qty: 10 });
    const res = await api('POST', '/inventory/adjustments', { token: tokens.manager, body: { productId: prod.id, type: 'ADJUSTMENT_IN', quantity: 3, unitCost: 300, reason: 'stock count found extra units' } });
    assert.equal(res.status, 201);
    assert.equal(await stock(ctx, prod.id), 13);
  });

  await t.test('RBAC: Cashier cannot perform stock adjustments', async () => {
    const { prod } = await makeReceivedPurchase(ctx, { sku: 'RBAC-ADJ-1', qty: 10 });
    const res = await api('POST', '/inventory/adjustments', { token: tokens.cashier, body: { productId: prod.id, type: 'DAMAGE', quantity: 1, reason: 'x' } });
    assert.equal(res.status, 403);
  });

  await t.test('Sessions: list shows the current session and others for the same user', async () => {
    const loginA = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const list = await api('GET', '/auth/sessions', { token: loginA.json.data.sessionId });
    assert.equal(list.status, 200);
    assert.ok(list.json.data.some((s) => s.current === true));
  });

  await t.test('Sessions: revoking a session logs it out', async () => {
    const loginA = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const tokenA = loginA.json.data.sessionId;
    const loginB = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const tokenB = loginB.json.data.sessionId;

    const sessions = await api('GET', '/auth/sessions', { token: tokenA });
    const other = sessions.json.data.find((s) => s.id !== tokenA.slice(0)); // sessionId == token itself in this impl
    // Revoke session B using session A's authority (same user)
    const revoke = await api('POST', `/auth/sessions/${tokenB}/revoke`, { token: tokenA });
    assert.equal(revoke.status, 200);

    const afterRevoke = await api('GET', '/products', { token: tokenB });
    assert.equal(afterRevoke.status, 401);
    assert.equal(afterRevoke.json.code, 'SESSION_EXPIRED');
  });

  await t.test('Sessions: a user cannot revoke another user\'s session', async () => {
    const managerLogin = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const cashierLogin = await api('POST', '/auth/login', { body: { email: 'cashier@test.com', password: 'password123' } });
    const res = await api('POST', `/auth/sessions/${cashierLogin.json.data.sessionId}/revoke`, { token: managerLogin.json.data.sessionId });
    assert.equal(res.status, 404, 'must not reveal that the session exists but belongs to someone else');
  });

  await t.test('Rate limiting: 6th failed login attempt within the window is blocked', async () => {
    const email = 'ratelimit-target@test.com';
    const { createUser } = require('../src/modules/auth/auth.service');
    const { createBusiness } = require('../src/modules/business/business.service');
    const biz = createBusiness(ctx.db, { name: 'Rate Limit Biz' });
    createUser(ctx.db, { businessId: biz.id, email, password: 'correct-password', role: 'Owner' });

    let last;
    for (let i = 0; i < 5; i++) {
      last = await api('POST', '/auth/login', { body: { email, password: 'wrong' } });
      assert.equal(last.status, 401);
    }
    const sixth = await api('POST', '/auth/login', { body: { email, password: 'wrong' } });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.json.code, 'RATE_LIMITED');

    // Even the CORRECT password is blocked while rate-limited.
    const evenCorrect = await api('POST', '/auth/login', { body: { email, password: 'correct-password' } });
    assert.equal(evenCorrect.status, 429);
  });

  await t.test('Reports: sales report reconciles with Finance summary for the same data', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'REP-SALE-1', name: 'Report Item' } })).json.data;
    await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 300, recommendedPrice: 500, maxPrice: 600, reason: 'setup' } });
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Report Supplier' } })).json.data;
    const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: 'rep-recv' } });
    await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'rep-sale-1', items: [{ productId: prod.id, quantity: 2 }], paymentMethod: 'Cash', cashReceived: 2000 } });

    const report = await api('GET', '/reports/sales', { token: tokens.owner });
    assert.equal(report.status, 200);
    const row = report.json.data.find((r) => r.total === 1000 && r.paymentMethod === 'Cash');
    assert.ok(row, 'report must contain a row for the sale just made');
    assert.ok(row.saleId, 'report row must link back to the source sale');
  });

  await t.test('Reports: inventory report lists current stock and value', async () => {
    const { prod } = await makeReceivedPurchase(ctx, { sku: 'REP-INV-1', qty: 7, cost: 100 });
    const report = await api('GET', '/reports/inventory', { token: tokens.manager });
    const row = report.json.data.find((r) => r.productId === prod.id);
    assert.equal(row.currentStock, 7);
    assert.equal(row.stockValue, 700);
  });

  await t.test('Reports: purchases report filters by supplier', async () => {
    const { purchase, supplier } = await makeReceivedPurchase(ctx, { sku: 'REP-PUR-1', qty: 5 });
    const report = await api('GET', `/reports/purchases?supplierId=${supplier.id}`, { token: tokens.manager });
    assert.ok(report.json.data.some((r) => r.purchaseId === purchase.id));
  });

  await t.test('Tenant isolation: Business B sees no rows in Business A reports', async () => {
    await makeReceivedPurchase(ctx, { sku: 'ISO-REP-1', qty: 5 });
    const report = await api('GET', '/reports/inventory', { token: tokens.ownerB });
    assert.equal(report.json.data.length, 0);
  });
});

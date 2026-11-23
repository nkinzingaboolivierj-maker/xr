'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

async function stockedProduct(ctx, { sku, min = 300, rec = 500, max = 2000, qty = 20, cost = 300 }) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  const priceRes = await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: min, recommendedPrice: rec, maxPrice: max, reason: 'setup' } });
  if (priceRes.status !== 200) throw new Error(`stockedProduct price setup failed: ${JSON.stringify(priceRes.json)}`);
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: qty, unitCost: cost }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  return prod;
}

test('Stage 8 — Tax, Discounts, Price Override', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('No tax configured: tax is zero, never fabricated', async () => {
    const prod = await stockedProduct(ctx, { sku: 'NOTAX-1' });
    const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'notax-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } })).json.data;
    assert.equal(sale.taxRate, 0);
    assert.equal(sale.taxAmount, 0);
    assert.equal(sale.total, sale.taxableAmount);
  });

  await t.test('Tax: configured rate is applied and snapshotted on the sale', async () => {
    const tax = await api('POST', '/tax-configurations', { token: tokens.owner, body: { name: 'VAT', ratePercent: 18 } });
    assert.equal(tax.status, 201);
    const prod = await stockedProduct(ctx, { sku: 'TAX-1', rec: 1000 });
    const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'tax-sale-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } })).json.data;
    assert.equal(sale.taxRate, 18);
    assert.equal(sale.taxableAmount, 1000);
    assert.equal(sale.taxAmount, 180);
    assert.equal(sale.total, 1180);
  });

  await t.test('Tax: a later rate change does not alter a historical sale', async () => {
    // Business B (fresh, isolated) so the rate history is unambiguous.
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser, login } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Tax Snapshot Biz' });
    createUser(ctx.db, { businessId: biz.id, email: 'tax-owner@test.com', password: 'password123', role: 'Owner' });
    createUser(ctx.db, { businessId: biz.id, email: 'tax-manager@test.com', password: 'password123', role: 'Manager' });
    createUser(ctx.db, { businessId: biz.id, email: 'tax-cashier@test.com', password: 'password123', role: 'Cashier' });
    createUser(ctx.db, { businessId: biz.id, email: 'tax-inv@test.com', password: 'password123', role: 'InventoryStaff' });
    const owner = login(ctx.db, { email: 'tax-owner@test.com', password: 'password123' }).sessionId;
    const manager = login(ctx.db, { email: 'tax-manager@test.com', password: 'password123' }).sessionId;
    const cashier = login(ctx.db, { email: 'tax-cashier@test.com', password: 'password123' }).sessionId;
    const inv = login(ctx.db, { email: 'tax-inv@test.com', password: 'password123' }).sessionId;

    await api('POST', '/tax-configurations', { token: owner, body: { name: 'VAT 10', ratePercent: 10 } });
    const prod = (await api('POST', '/products', { token: manager, body: { sku: 'TAXSNAP-1', name: 'Snap Item' } })).json.data;
    await api('POST', `/products/${prod.id}/price`, { token: manager, body: { minPrice: 300, recommendedPrice: 1000, maxPrice: 1500, reason: 'setup' } });
    const sup = (await api('POST', '/suppliers', { token: manager, body: { name: 'Snap Sup' } })).json.data;
    const pur = (await api('POST', '/purchases', { token: manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 5, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${pur.id}/receive`, { token: inv, body: { operationId: 'snap-recv' } });

    const sale = (await api('POST', '/sales', { token: cashier, body: { operationId: 'snap-sale-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } })).json.data;
    assert.equal(sale.taxRate, 10);
    assert.equal(sale.total, 1100);

    // Raise the rate AFTER the sale.
    await api('POST', '/tax-configurations', { token: owner, body: { name: 'VAT 20', ratePercent: 20 } });
    const again = await api('GET', `/sales/${sale.id}`, { token: cashier });
    assert.equal(again.json.data.taxRate, 10, 'historical sale must keep the rate that was active when it was made');
    assert.equal(again.json.data.total, 1100);
  });

  await t.test('Discount: Cashier cannot apply a discount without sale.discount permission', async () => {
    const prod = await stockedProduct(ctx, { sku: 'DISC-RBAC-1' });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'disc-rbac-1', items: [{ productId: prod.id, quantity: 1, discount: { type: 'percent', value: 10 } }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'PERMISSION_DENIED');
  });

  await t.test('Discount: Manager CAN apply a line-level percent discount, computed correctly', async () => {
    // Fresh, untaxed business — this file's earlier test ("Tax: configured
    // rate...") intentionally turns on 18% VAT for the shared ctx business,
    // and discount math is easiest to verify with no tax mixed in.
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser, login } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Discount Biz 1' });
    createUser(ctx.db, { businessId: biz.id, email: 'd1-manager@test.com', password: 'password123', role: 'Manager' });
    createUser(ctx.db, { businessId: biz.id, email: 'd1-inv@test.com', password: 'password123', role: 'InventoryStaff' });
    const manager = login(ctx.db, { email: 'd1-manager@test.com', password: 'password123' }).sessionId;
    const inv = login(ctx.db, { email: 'd1-inv@test.com', password: 'password123' }).sessionId;
    const freshCtx = { ...ctx, api, tokens: { manager, inventory: inv } };

    const prod = await stockedProduct(freshCtx, { sku: 'DISC-1', rec: 1000 });
    const sale = (await api('POST', '/sales', {
      token: manager,
      body: { operationId: 'disc-sale-1', items: [{ productId: prod.id, quantity: 1, discount: { type: 'percent', value: 10, reason: 'loyalty' } }], paymentMethod: 'Cash', cashReceived: 9999 },
    })).json.data;
    assert.equal(sale.items[0].lineDiscountAmount, 100); // 10% of 1000
    assert.equal(sale.items[0].lineTotal, 900);
    assert.equal(sale.subtotal, 1000);
    assert.equal(sale.discountAmount, 100);
    assert.equal(sale.total, 900);
  });

  await t.test('Discount: sale-level fixed discount applied after line discounts', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser, login } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Discount Biz 2' });
    createUser(ctx.db, { businessId: biz.id, email: 'd2-manager@test.com', password: 'password123', role: 'Manager' });
    createUser(ctx.db, { businessId: biz.id, email: 'd2-inv@test.com', password: 'password123', role: 'InventoryStaff' });
    const manager = login(ctx.db, { email: 'd2-manager@test.com', password: 'password123' }).sessionId;
    const inv = login(ctx.db, { email: 'd2-inv@test.com', password: 'password123' }).sessionId;
    const freshCtx = { ...ctx, api, tokens: { manager, inventory: inv } };

    const prod = await stockedProduct(freshCtx, { sku: 'DISC-2', rec: 1000 });
    const sale = (await api('POST', '/sales', {
      token: manager,
      body: { operationId: 'disc-sale-2', items: [{ productId: prod.id, quantity: 2 }], discount: { type: 'fixed', value: 300, reason: 'bulk deal' }, paymentMethod: 'Cash', cashReceived: 9999 },
    })).json.data;
    assert.equal(sale.subtotal, 2000);
    assert.equal(sale.discountAmount, 300);
    assert.equal(sale.total, 1700);
  });

  await t.test('Discount: cannot exceed the line/sale amount (prevents negative totals)', async () => {
    const prod = await stockedProduct(ctx, { sku: 'DISC-NEG-1', rec: 500 });
    const res = await api('POST', '/sales', {
      token: tokens.manager,
      body: { operationId: 'disc-neg-1', items: [{ productId: prod.id, quantity: 1 }], discount: { type: 'fixed', value: 600, reason: 'too much' }, paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'VALIDATION_ERROR');
  });

  await t.test('Price Override: Cashier proposing a below-minimum price without override is BLOCKED', async () => {
    const prod = await stockedProduct(ctx, { sku: 'OVR-1', min: 500, rec: 600, max: 700 });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'ovr-1', items: [{ productId: prod.id, quantity: 1, unitPrice: 400 }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'PRICE_BELOW_MINIMUM');
  });

  await t.test('Price Override: Cashier CANNOT self-authorize even with a reason', async () => {
    const prod = await stockedProduct(ctx, { sku: 'OVR-2', min: 500, rec: 600, max: 700 });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'ovr-2', items: [{ productId: prod.id, quantity: 1, unitPrice: 400, priceOverride: { reason: 'regular customer' } }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 403, 'Cashier lacks price.override.below_min entirely');
  });

  await t.test('Price Override: Manager CAN authorize below-minimum with a reason, fully audited', async () => {
    const prod = await stockedProduct(ctx, { sku: 'OVR-3', min: 500, rec: 600, max: 700 });
    const sale = await api('POST', '/sales', {
      token: tokens.manager,
      body: { operationId: 'ovr-3', items: [{ productId: prod.id, quantity: 1, unitPrice: 400, priceOverride: { reason: 'damaged packaging' } }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(sale.status, 201);
    assert.equal(sale.json.data.items[0].unitPrice, 400);
    assert.equal(sale.json.data.priceOverrides.length, 1);
    assert.equal(sale.json.data.priceOverrides[0].permissionUsed, 'PRICE_OVERRIDE_BELOW_MIN');
    assert.equal(sale.json.data.priceOverrides[0].reason, 'damaged packaging');

    const dbRow = ctx.db.prepare(`SELECT * FROM price_overrides WHERE sale_id = ?`).get(sale.json.data.id);
    assert.ok(dbRow, 'price_overrides table must have a row for this');
    assert.equal(dbRow.standard_price, 600);
  });

  await t.test('Price Override: above-maximum requires price.override.above_max specifically', async () => {
    const prod = await stockedProduct(ctx, { sku: 'OVR-4', min: 500, rec: 600, max: 700 });
    const sale = await api('POST', '/sales', {
      token: tokens.manager,
      body: { operationId: 'ovr-4', items: [{ productId: prod.id, quantity: 1, unitPrice: 900, priceOverride: { reason: 'rare item, high demand' } }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(sale.status, 201);
    assert.equal(sale.json.data.priceOverrides[0].permissionUsed, 'PRICE_OVERRIDE_ABOVE_MAX');
  });

  await t.test('Finance: tax collected is excluded from revenue and gross profit', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser, login } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Tax Finance Biz' });
    createUser(ctx.db, { businessId: biz.id, email: 'tf-owner@test.com', password: 'password123', role: 'Owner' });
    createUser(ctx.db, { businessId: biz.id, email: 'tf-manager@test.com', password: 'password123', role: 'Manager' });
    createUser(ctx.db, { businessId: biz.id, email: 'tf-cashier@test.com', password: 'password123', role: 'Cashier' });
    createUser(ctx.db, { businessId: biz.id, email: 'tf-inv@test.com', password: 'password123', role: 'InventoryStaff' });
    const owner = login(ctx.db, { email: 'tf-owner@test.com', password: 'password123' }).sessionId;
    const manager = login(ctx.db, { email: 'tf-manager@test.com', password: 'password123' }).sessionId;
    const cashier = login(ctx.db, { email: 'tf-cashier@test.com', password: 'password123' }).sessionId;
    const inv = login(ctx.db, { email: 'tf-inv@test.com', password: 'password123' }).sessionId;

    await api('POST', '/tax-configurations', { token: owner, body: { name: 'VAT', ratePercent: 20 } });
    const prod = (await api('POST', '/products', { token: manager, body: { sku: 'TF-1', name: 'TF Item' } })).json.data;
    await api('POST', `/products/${prod.id}/price`, { token: manager, body: { minPrice: 300, recommendedPrice: 1000, maxPrice: 1200, reason: 'setup' } });
    const sup = (await api('POST', '/suppliers', { token: manager, body: { name: 'TF Sup' } })).json.data;
    const pur = (await api('POST', '/purchases', { token: manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 5, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${pur.id}/receive`, { token: inv, body: { operationId: 'tf-recv' } });
    await api('POST', '/sales', { token: cashier, body: { operationId: 'tf-sale-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } });

    const summary = (await api('GET', '/finance/summary', { token: owner })).json.data;
    assert.equal(summary.netRevenue, 1000, 'revenue excludes the 200 tax collected');
    assert.equal(summary.taxCollected, 200);
    assert.equal(summary.grossProfit, 700); // 1000 revenue - 300 cogs
  });

  await t.test('Tenant isolation: Business B cannot read Business A tax configuration', async () => {
    const taxCfg = await api('POST', '/tax-configurations', { token: tokens.owner, body: { name: 'Isolated Tax', ratePercent: 5 } });
    const list = await api('GET', '/tax-configurations', { token: tokens.ownerB });
    assert.ok(!list.json.data.some((t) => t.id === taxCfg.json.data.id));
  });
});

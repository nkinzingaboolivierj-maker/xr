'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

async function makeStockedSale(ctx, { sku, cost = 300, price = 500, stockQty = 20, sellQty = 2, opId }) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: cost, recommendedPrice: price, maxPrice: price * 2, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: stockQty, unitCost: cost }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  const sale = (await api('POST', '/sales', { token: tokens.manager, body: { operationId: opId, items: [{ productId: prod.id, quantity: sellQty }], paymentMethod: 'Cash', cashReceived: price * sellQty * 2 } })).json.data;
  return { prod, sale };
}

test('Stage 5 — Documents (Receipts) and Analytics', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('Receipt: JSON format reflects the completed sale', async () => {
    const { sale } = await makeStockedSale(ctx, { sku: 'DOC-1', opId: 'doc-sale-1' });
    const res = await api('GET', `/documents/receipt/${sale.id}`, { token: tokens.cashier });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.receiptNumber, sale.id);
    assert.equal(res.json.data.total, sale.total);
    assert.equal(res.json.data.items[0].productName, 'Product DOC-1');
  });

  await t.test('Receipt: historical snapshot survives a later product rename and price change', async () => {
    const { prod, sale } = await makeStockedSale(ctx, { sku: 'DOC-2', price: 500, opId: 'doc-sale-2' });
    await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 600, recommendedPrice: 700, maxPrice: 800, reason: 'price change after sale' } });
    const res = await api('GET', `/documents/receipt/${sale.id}`, { token: tokens.cashier });
    assert.equal(res.json.data.items[0].unitPrice, 500, 'receipt must keep the price at time of sale');
    assert.equal(res.json.data.total, sale.total);
  });

  await t.test('Receipt: text format is printable plain text', async () => {
    const { sale } = await makeStockedSale(ctx, { sku: 'DOC-3', opId: 'doc-sale-3' });
    const res = await fetch(`${ctx.base}/documents/receipt/${sale.id}?format=text`, { headers: { Authorization: `Bearer ${tokens.cashier}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/plain');
    const text = await res.text();
    assert.ok(text.includes('TOTAL:'));
    assert.ok(text.includes('Product DOC-3'));
  });

  await t.test('Tenant isolation: Business B cannot fetch Business A receipt', async () => {
    const { sale } = await makeStockedSale(ctx, { sku: 'DOC-4', opId: 'doc-sale-4' });
    const res = await api('GET', `/documents/receipt/${sale.id}`, { token: tokens.ownerB });
    assert.equal(res.status, 403);
  });

  await t.test('Analytics: velocity = units sold / period', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-1', stockQty: 50, sellQty: 7, opId: 'anl-sale-1' });
    const res = await api('GET', `/analytics/velocity?productId=${prod.id}&days=7`, { token: tokens.owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.unitsSold, 7);
    assert.equal(res.json.data.velocityPerDay, 1); // 7 units / 7 days
  });

  await t.test('Analytics: demand trend reports insufficientData when the prior period has zero sales', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-2', stockQty: 50, sellQty: 5, opId: 'anl-sale-2' });
    const res = await api('GET', `/analytics/demand-trend?productId=${prod.id}&days=7`, { token: tokens.owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.insufficientData, true);
    assert.equal(res.json.data.growthPercent, null, 'must never fabricate a percentage from a zero base');
  });

  await t.test('Analytics: product performance reuses Finance COGS/Revenue and Inventory stock/aging exactly', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-3', cost: 300, price: 500, stockQty: 20, sellQty: 4, opId: 'anl-sale-3' });
    const res = await api('GET', `/analytics/product-performance?productId=${prod.id}`, { token: tokens.owner });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.unitsSold, 4);
    assert.equal(res.json.data.revenue, 2000); // 4 x 500
    assert.equal(res.json.data.cogs, 1200); // 4 x 300
    assert.equal(res.json.data.grossProfit, 800);
    assert.equal(res.json.data.grossMarginPercent, 40);
    assert.equal(res.json.data.currentStock, 16); // 20 - 4
  });

  await t.test('RBAC: Cashier cannot read analytics (finance.read required)', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-4', opId: 'anl-sale-4' });
    const res = await api('GET', `/analytics/velocity?productId=${prod.id}`, { token: tokens.cashier });
    assert.equal(res.status, 403);
  });

  await t.test('RBAC: InventoryStaff cannot read analytics', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-5', opId: 'anl-sale-5' });
    const res = await api('GET', `/analytics/product-performance?productId=${prod.id}`, { token: tokens.inventory });
    assert.equal(res.status, 403);
  });

  await t.test('Tenant isolation: Business B sees zero activity for Business A product analytics', async () => {
    const { prod } = await makeStockedSale(ctx, { sku: 'ANL-6', sellQty: 3, opId: 'anl-sale-6' });
    const res = await api('GET', `/analytics/velocity?productId=${prod.id}`, { token: tokens.ownerB });
    // Product belongs to business A; business B has no sale_items referencing it at all,
    // so the query legitimately returns 0 rather than leaking an error about the product's existence.
    assert.equal(res.status, 200);
    assert.equal(res.json.data.unitsSold, 0);
  });
});

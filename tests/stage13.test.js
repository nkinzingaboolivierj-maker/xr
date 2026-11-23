'use strict';
// Stage 13 — enforce financial-data least privilege in API responses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('Stage 13 — Cashier cannot read COGS, margin or stock valuation from APIs', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.teardown());
  const { api, tokens } = ctx;

  const product = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'SEC-13', name: 'Restricted cost product' } })).json.data;
  await api('POST', `/products/${product.id}/price`, { token: tokens.manager, body: { minPrice: 100, recommendedPrice: 150, maxPrice: 200, reason: 'test setup' } });
  const supplier = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Secure supplier' } })).json.data;
  const purchase = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: supplier.id, items: [{ productId: product.id, quantity: 5, unitCost: 75 }] } })).json.data;
  await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.manager });
  const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'stage13-sec-sale', paymentMethod: 'Cash', cashReceived: 150, items: [{ productId: product.id, quantity: 1, unitPrice: 150 }] } })).json.data;

  await t.test('Cashier sale detail omits sale and batch costs', async () => {
    const res = await api('GET', `/sales/${sale.id}`, { token: tokens.cashier });
    assert.equal(res.status, 200);
    assert.equal('cogs' in res.json.data, false);
    assert.equal('grossProfit' in res.json.data, false);
    assert.equal('unitCost' in res.json.data.items[0].batchAllocations[0], false);
  });

  await t.test('Cashier inventory aging and inventory report omit valuation', async () => {
    const aging = await api('GET', '/inventory/aging', { token: tokens.cashier });
    assert.equal(aging.status, 200);
    assert.equal('unitCost' in aging.json.data[0], false);
    const report = await api('GET', '/reports/inventory', { token: tokens.cashier });
    assert.equal(report.status, 200);
    assert.equal('stockValue' in report.json.data[0], false);
    assert.equal('totalStockValue' in report.json.summary, false);
  });

  await t.test('Manager retains authorized financial visibility', async () => {
    const detail = await api('GET', `/sales/${sale.id}`, { token: tokens.manager });
    assert.equal(typeof detail.json.data.cogs, 'number');
    assert.equal(typeof detail.json.data.grossProfit, 'number');
    assert.equal(typeof detail.json.data.items[0].batchAllocations[0].unitCost, 'number');
    const aging = await api('GET', '/inventory/aging', { token: tokens.manager });
    assert.equal(typeof aging.json.data[0].unitCost, 'number');
    const report = await api('GET', '/reports/inventory', { token: tokens.manager });
    assert.equal(typeof report.json.data[0].stockValue, 'number');
  });
});

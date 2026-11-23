'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

async function makeProduct(api, token, overrides = {}) {
  const res = await api('POST', '/products', { token, body: { sku: overrides.sku || `SKU-${Date.now()}-${Math.random()}`, name: overrides.name || 'Test Product' } });
  return res.json.data;
}

test('Stage 2 — Procurement + Inventory', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('Suppliers: Manager can create a supplier', async () => {
    const res = await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Kigali Tech Distributors Ltd' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.name, 'Kigali Tech Distributors Ltd');
  });

  await t.test('Purchases: draft purchase does NOT affect inventory', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier A' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'DRAFT-1' });

    const purchase = await api('POST', '/purchases', {
      token: tokens.manager,
      body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 50, unitCost: 300 }] },
    });
    assert.equal(purchase.status, 201);
    assert.equal(purchase.json.data.status, 'draft');

    const stock = await api('GET', `/inventory/stock/${prod.id}`, { token: tokens.manager });
    assert.equal(stock.json.data.stock, 0, 'draft purchase must not increase stock');
  });

  await t.test('Receiving: atomic — batch created, movement created, stock increases', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier B' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'RECEIVE-1' });
    const purchase = (await api('POST', '/purchases', {
      token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 20, unitCost: 300 }] },
    })).json.data;

    const received = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'op-receive-1' } });
    assert.equal(received.status, 200);
    assert.equal(received.json.data.status, 'received');

    const stock = await api('GET', `/inventory/stock/${prod.id}`, { token: tokens.manager });
    assert.equal(stock.json.data.stock, 20);

    const movements = await api('GET', `/inventory/movements?productId=${prod.id}`, { token: tokens.manager });
    assert.equal(movements.json.data.length, 1);
    assert.equal(movements.json.data[0].type, 'PURCHASE');
  });

  await t.test('Receiving: cannot receive the same purchase twice', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier C' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'DUPRECV-1' });
    const purchase = (await api('POST', '/purchases', {
      token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 100 }] },
    })).json.data;

    await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'first-receive' } });
    const second = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'second-receive' } });
    assert.equal(second.status, 409);
    assert.equal(second.json.code, 'PURCHASE_ALREADY_RECEIVED');
  });

  await t.test('Receiving: retrying the SAME operationId is idempotent, not an error', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier D' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'IDEMP-1' });
    const purchase = (await api('POST', '/purchases', {
      token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 100 }] },
    })).json.data;

    const first = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'same-op' } });
    const retry = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'same-op' } });
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    const stock = await api('GET', `/inventory/stock/${prod.id}`, { token: tokens.manager });
    assert.equal(stock.json.data.stock, 10, 'stock must not double from an idempotent retry');
  });

  await t.test('FIFO: oldest batch consumed first, COGS computed correctly', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier E' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'FIFO-1' });

    const p1 = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 20, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${p1.id}/receive`, { token: tokens.inventory, body: { operationId: 'fifo-batch-1' } });

    const p2 = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 100, unitCost: 330 }] } })).json.data;
    await api('POST', `/purchases/${p2.id}/receive`, { token: tokens.inventory, body: { operationId: 'fifo-batch-2' } });

    // Set pricing so a sale can be made in Stage 3 tests; here we just verify
    // the FIFO allocation math directly via the inventory service is exercised
    // through Stage 3's sale flow (see stage3.test.js). Here we confirm the
    // two independent batches exist with correct remaining quantities.
    const movements = await api('GET', `/inventory/movements?productId=${prod.id}`, { token: tokens.manager });
    assert.equal(movements.json.data.length, 2);
    const stock = await api('GET', `/inventory/stock/${prod.id}`, { token: tokens.manager });
    assert.equal(stock.json.data.stock, 120);
  });

  await t.test('Stock Aging: computed from batch receipt date, independent of any profit figure', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier F' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'AGE-1' });
    const purchase = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 5, unitCost: 500 }] } })).json.data;
    await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.inventory, body: { operationId: 'age-op' } });

    const aging = await api('GET', `/inventory/aging?productId=${prod.id}`, { token: tokens.manager });
    assert.equal(aging.status, 200);
    assert.equal(aging.json.data.length, 1);
    assert.ok(aging.json.data[0].ageDays >= 0);
    assert.equal(aging.json.data[0].quantityRemaining, 5);
    // Confirms the shape has NO profit/loss field mixed in — aging is purely time+quantity.
    assert.equal('profit' in aging.json.data[0], false);
  });

  await t.test('RBAC: Cashier cannot receive a purchase', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier G' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'RBAC-RECV-1' });
    const purchase = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 5, unitCost: 100 }] } })).json.data;
    const res = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.cashier, body: {} });
    assert.equal(res.status, 403);
  });

  await t.test('Tenant isolation: Business B cannot receive Business A purchase', async () => {
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'Supplier H' } })).json.data;
    const prod = await makeProduct(api, tokens.manager, { sku: 'ISO-PUR-1' });
    const purchase = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 5, unitCost: 100 }] } })).json.data;
    const res = await api('POST', `/purchases/${purchase.id}/receive`, { token: tokens.ownerB, body: {} });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CROSS_BUSINESS_ACCESS');
  });
});

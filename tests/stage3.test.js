'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Creates a priced product with received stock in given batches [{qty, cost}].
async function stockedProduct(ctx, { sku, min = 300, rec = 400, max = 500, batches }) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: min, recommendedPrice: rec, maxPrice: max, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  let i = 0;
  for (const b of batches) {
    const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: b.qty, unitCost: b.cost }] } })).json.data;
    await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv-${i++}` } });
    // Ensure distinct received_at ordering between batches
    await new Promise((r) => setTimeout(r, 5));
  }
  return prod;
}

const stock = async (ctx, id) => (await ctx.api('GET', `/inventory/stock/${id}`, { token: ctx.tokens.manager })).json.data.stock;

test('Stage 3 — POS / Sales / FIFO / Payments', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('FIFO + COGS: B001=20@300, B002=100@330, sell 25 -> COGS 7650 (20 from B001, 5 from B002)', async () => {
    const prod = await stockedProduct(ctx, { sku: 'FIFO-SALE', min: 300, rec: 400, max: 500, batches: [{ qty: 20, cost: 300 }, { qty: 100, cost: 330 }] });
    const res = await api('POST', '/sales', {
      token: tokens.manager,
      body: { operationId: 'fifo-sale-1', items: [{ productId: prod.id, quantity: 25 }], paymentMethod: 'Cash', cashReceived: 10000 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.cogs, 7650);
    assert.equal(res.json.data.total, 10000); // 25 x 400 recommended
    assert.equal(res.json.data.grossProfit, 2350); // 10000 - 7650
    const allocs = res.json.data.items[0].batchAllocations;
    assert.equal(allocs.length, 2);
    assert.equal(allocs[0].quantity, 20);
    assert.equal(allocs[0].unitCost, 300);
    assert.equal(allocs[1].quantity, 5);
    assert.equal(allocs[1].unitCost, 330);
    assert.equal(await stock(ctx, prod.id), 95);
  });

  await t.test('Price validation: below minimum is BLOCKED by the server', async () => {
    const prod = await stockedProduct(ctx, { sku: 'PRICE-LOW', batches: [{ qty: 10, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'low-1', items: [{ productId: prod.id, quantity: 1, unitPrice: 100 }], paymentMethod: 'Cash', cashReceived: 1000 },
    });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'PRICE_BELOW_MINIMUM');
    assert.equal(await stock(ctx, prod.id), 10, 'rejected sale must not touch stock');
  });

  await t.test('Price validation: above maximum is BLOCKED by the server', async () => {
    const prod = await stockedProduct(ctx, { sku: 'PRICE-HIGH', batches: [{ qty: 10, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'high-1', items: [{ productId: prod.id, quantity: 1, unitPrice: 9999 }], paymentMethod: 'Cash', cashReceived: 99999 },
    });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'PRICE_ABOVE_MAXIMUM');
  });

  await t.test('Stock validation: selling more than available is rejected (INSUFFICIENT_STOCK)', async () => {
    const prod = await stockedProduct(ctx, { sku: 'STOCK-LOW', batches: [{ qty: 5, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'over-1', items: [{ productId: prod.id, quantity: 8 }], paymentMethod: 'Cash', cashReceived: 99999 },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'INSUFFICIENT_STOCK');
    assert.equal(await stock(ctx, prod.id), 5);
  });

  await t.test('Idempotency: retrying the same operationId returns the SAME sale, no double deduction', async () => {
    const prod = await stockedProduct(ctx, { sku: 'IDEMP-SALE', batches: [{ qty: 10, cost: 300 }] });
    const body = { operationId: 'idem-sale-1', items: [{ productId: prod.id, quantity: 3 }], paymentMethod: 'Cash', cashReceived: 5000 };
    const first = await api('POST', '/sales', { token: tokens.cashier, body });
    const retry = await api('POST', '/sales', { token: tokens.cashier, body });
    assert.equal(first.json.data.id, retry.json.data.id);
    assert.equal(await stock(ctx, prod.id), 7, 'stock deducted exactly once');
    const count = ctx.db.prepare(`SELECT COUNT(*) c FROM sales WHERE operation_id = 'idem-sale-1'`).get().c;
    assert.equal(count, 1);
  });

  await t.test('CONCURRENCY: stock=5, two simultaneous sales of 4 and 3 -> exactly one succeeds, final stock = 1', async () => {
    const prod = await stockedProduct(ctx, { sku: 'CONCURRENT', batches: [{ qty: 5, cost: 300 }] });
    const mk = (op, qty) => api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: op, items: [{ productId: prod.id, quantity: qty }], paymentMethod: 'Cash', cashReceived: 99999 },
    });
    const [a, b] = await Promise.all([mk('conc-A', 4), mk('conc-B', 3)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], 'exactly one sale must succeed and one must fail');
    const failed = a.status === 409 ? a : b;
    assert.equal(failed.json.code, 'INSUFFICIENT_STOCK');
    const finalStock = await stock(ctx, prod.id);
    assert.ok(finalStock === 1 || finalStock === 2, `final stock must be 1 (4 sold) or 2 (3 sold), got ${finalStock}`);
    assert.ok(finalStock >= 0, 'stock must never go negative');
  });

  await t.test('Atomic rollback: if the 2nd line item fails, the 1st item stock deduction is rolled back', async () => {
    const good = await stockedProduct(ctx, { sku: 'ROLL-GOOD', batches: [{ qty: 10, cost: 300 }] });
    const scarce = await stockedProduct(ctx, { sku: 'ROLL-SCARCE', batches: [{ qty: 1, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'roll-1', items: [{ productId: good.id, quantity: 5 }, { productId: scarce.id, quantity: 9 }], paymentMethod: 'Cash', cashReceived: 99999 },
    });
    assert.equal(res.status, 409);
    assert.equal(await stock(ctx, good.id), 10, 'first item deduction must be rolled back');
    const saleRows = ctx.db.prepare(`SELECT COUNT(*) c FROM sales WHERE operation_id = 'roll-1'`).get().c;
    assert.equal(saleRows, 0, 'no sale record may remain');
  });

  await t.test('Cash: change is computed by the server (due 12000, received 15000 -> change 3000)', async () => {
    const prod = await stockedProduct(ctx, { sku: 'CASH-1', min: 10000, rec: 12000, max: 15000, batches: [{ qty: 5, cost: 8000 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'cash-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 15000 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.total, 12000);
    assert.equal(res.json.data.changeDue, 3000);
    assert.equal(res.json.data.payment.status, 'SUCCESS');
  });

  await t.test('Cash: insufficient cash is rejected and stock untouched', async () => {
    const prod = await stockedProduct(ctx, { sku: 'CASH-2', batches: [{ qty: 5, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'cash-2', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 10 },
    });
    assert.equal(res.status, 422);
    assert.equal(res.json.code, 'CASH_RECEIVED_INSUFFICIENT');
    assert.equal(await stock(ctx, prod.id), 5);
  });

  await t.test('Non-cash payment is PENDING (never SUCCESS without a real provider confirmation)', async () => {
    const prod = await stockedProduct(ctx, { sku: 'MOMO-1', batches: [{ qty: 5, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'momo-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'MobileMoney' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.payment.status, 'PENDING');
  });

  await t.test('RBAC: InventoryStaff cannot create a sale', async () => {
    const prod = await stockedProduct(ctx, { sku: 'RBAC-SALE', batches: [{ qty: 5, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.inventory,
      body: { operationId: 'rbac-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 403);
  });

  await t.test('Tenant isolation: Business B cannot sell Business A product', async () => {
    const prod = await stockedProduct(ctx, { sku: 'ISO-SALE', batches: [{ qty: 5, cost: 300 }] });
    const res = await api('POST', '/sales', {
      token: tokens.ownerB,
      body: { operationId: 'iso-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CROSS_BUSINESS_ACCESS');
    assert.equal(await stock(ctx, prod.id), 5);
  });

  await t.test('Historical snapshot: a later price change does not alter a completed sale', async () => {
    const prod = await stockedProduct(ctx, { sku: 'SNAP-1', min: 300, rec: 400, max: 500, batches: [{ qty: 10, cost: 200 }] });
    const sale = (await api('POST', '/sales', {
      token: tokens.cashier,
      body: { operationId: 'snap-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 1000 },
    })).json.data;
    assert.equal(sale.items[0].unitPrice, 400);
    await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 400, recommendedPrice: 450, maxPrice: 600, reason: 'raise' } });
    const again = await api('GET', `/sales/${sale.id}`, { token: tokens.cashier });
    assert.equal(again.json.data.items[0].unitPrice, 400, 'historical sale must still show 400');
    assert.equal(again.json.data.total, 400);
  });

  await t.test('Audit: a completed sale writes an audit entry', async () => {
    const prod = await stockedProduct(ctx, { sku: 'AUD-SALE', batches: [{ qty: 5, cost: 300 }] });
    const before = ctx.db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE resource = 'sale'`).get().c;
    await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'aud-1', items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } });
    const after = ctx.db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE resource = 'sale'`).get().c;
    assert.equal(after, before + 1);
  });

  await t.test('Customers: create and attach a named customer to a sale', async () => {
    const cust = (await api('POST', '/customers', { token: tokens.cashier, body: { name: 'Jean Claude', phone: '0780000000', type: 'named' } })).json.data;
    const prod = await stockedProduct(ctx, { sku: 'CUST-SALE', batches: [{ qty: 5, cost: 300 }] });
    const sale = await api('POST', '/sales', { token: tokens.cashier, body: { operationId: 'cust-1', customerId: cust.id, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } });
    assert.equal(sale.status, 201);
    assert.equal(sale.json.data.customerId, cust.id);
  });
});

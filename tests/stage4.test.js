'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

async function sellOne(ctx, { sku, cost = 300, price = 500, qty = 5, sellQty = 1, opId }) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: cost, recommendedPrice: price, maxPrice: price * 2, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: qty, unitCost: cost }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  const sale = (await api('POST', '/sales', { token: tokens.manager, body: { operationId: opId, items: [{ productId: prod.id, quantity: sellQty }], paymentMethod: 'Cash', cashReceived: price * sellQty * 2 } })).json.data;
  return { prod, sale };
}

const stock = async (ctx, id) => (await ctx.api('GET', `/inventory/stock/${id}`, { token: ctx.tokens.manager })).json.data.stock;

test('Stage 4 — Returns / Refunds / Expenses / Finance', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('Return: full flow restocks inventory and computes correct line total', async () => {
    const { prod, sale } = await sellOne(ctx, { sku: 'RET-2', cost: 300, price: 500, qty: 10, sellQty: 4, opId: 'ret-sale-2' });
    const saleRow = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);
    const before = await stock(ctx, prod.id);

    const res = await api('POST', '/returns', {
      token: tokens.cashier,
      body: { saleId: sale.id, items: [{ saleItemId: saleRow.id, quantity: 2, reason: 'wrong size', condition: 'resellable' }] },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.total, 1000); // 2 x 500
    assert.equal(res.json.data.refundableRemaining, 1000);

    const after = await stock(ctx, prod.id);
    assert.equal(after, before + 2, 'returned quantity must be restocked');
  });

  await t.test('Return: cannot return more than sold minus already returned', async () => {
    const { sale } = await sellOne(ctx, { sku: 'RET-3', cost: 300, price: 500, qty: 10, sellQty: 3, opId: 'ret-sale-3' });
    const saleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);

    const first = await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 2 }] } });
    assert.equal(first.status, 201);

    const second = await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 2 }] } });
    assert.equal(second.status, 422);
    assert.equal(second.json.code, 'RETURN_EXCEEDS_SOLD'); // sold 3, already returned 2, requesting 2 more = 4 > 3
  });

  await t.test('Refund: can refund up to the full return amount', async () => {
    const { sale } = await sellOne(ctx, { sku: 'REF-1', cost: 300, price: 500, qty: 10, sellQty: 2, opId: 'ref-sale-1' });
    const saleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);
    const ret = (await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 2 }] } })).json.data;

    const refund = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: ret.id, amount: 1000, method: 'Cash' } });
    assert.equal(refund.status, 201);
    assert.equal(refund.json.data.status, 'COMPLETED');
  });

  await t.test('Refund: cannot exceed remaining refundable amount (incl. duplicate prevention)', async () => {
    const { sale } = await sellOne(ctx, { sku: 'REF-2', cost: 300, price: 500, qty: 10, sellQty: 2, opId: 'ref-sale-2' });
    const saleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);
    const ret = (await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 2 }] } })).json.data;

    const partial = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: ret.id, amount: 600 } });
    assert.equal(partial.status, 201);

    const tooMuch = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: ret.id, amount: 500 } }); // only 400 left
    assert.equal(tooMuch.status, 422);
    assert.equal(tooMuch.json.code, 'REFUND_EXCEEDS_REFUNDABLE');

    const exact = await api('POST', '/refunds', { token: tokens.manager, body: { returnId: ret.id, amount: 400 } });
    assert.equal(exact.status, 201);
  });

  await t.test('RBAC: Cashier cannot issue a refund (Manager/Owner only)', async () => {
    const { sale } = await sellOne(ctx, { sku: 'REF-3', cost: 300, price: 500, qty: 10, sellQty: 1, opId: 'ref-sale-3' });
    const saleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);
    const ret = (await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 1 }] } })).json.data;
    const res = await api('POST', '/refunds', { token: tokens.cashier, body: { returnId: ret.id, amount: 500 } });
    assert.equal(res.status, 403);
  });

  await t.test('Expenses: create with a new category, auto-created', async () => {
    const res = await api('POST', '/expenses', { token: tokens.owner, body: { category: 'Rent', description: 'Shop rent', amount: 50000, expenseDate: '2026-09-01' } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.category, 'Rent');
    const catCount = ctx.db.prepare(`SELECT COUNT(*) c FROM expense_categories WHERE business_id = ? AND name = 'Rent'`).get(ctx.business.id).c;
    assert.equal(catCount, 1);
  });

  await t.test('Expenses: RBAC blocks Cashier', async () => {
    const res = await api('POST', '/expenses', { token: tokens.cashier, body: { category: 'Transport', amount: 5000 } });
    assert.equal(res.status, 403);
  });

  await t.test('Finance: Gross Profit and Net Profit computed correctly, reduced by returns and expenses', async () => {
    // Isolated scenario with its own product to make the arithmetic exact.
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'FIN-1', name: 'Finance Test Item' } })).json.data;
    await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 300, recommendedPrice: 500, maxPrice: 600, reason: 'setup' } });
    const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: 'FIN Supplier' } })).json.data;
    const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: 'fin-recv' } });

    // Sell 5 units at 500 each -> revenue 2500, cogs 1500
    const sale = (await api('POST', '/sales', { token: tokens.manager, body: { operationId: 'fin-sale-1', items: [{ productId: prod.id, quantity: 5 }], paymentMethod: 'Cash', cashReceived: 5000 } })).json.data;
    assert.equal(sale.total, 2500);
    assert.equal(sale.cogs, 1500);

    // Return 1 unit -> returns revenue 500, returns cogs 300 (same batch cost)
    const saleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(sale.id);
    await api('POST', '/returns', { token: tokens.cashier, body: { saleId: sale.id, items: [{ saleItemId: saleItem.id, quantity: 1 }] } });

    // Expense of 200
    await api('POST', '/expenses', { token: tokens.owner, body: { category: 'Packaging', amount: 200, expenseDate: new Date().toISOString().slice(0, 10) } });

    const summary = (await api('GET', '/finance/summary', { token: tokens.owner })).json.data;
    // netRevenue = 2500 - 500 = 2000; netCogs = 1500 - 300 = 1200; grossProfit = 800; netProfit = 800 - 200(+other test expenses) 
    assert.ok(summary.netRevenue >= 2000, 'netRevenue should include this scenario (other tests may add more)');
    assert.ok(summary.grossProfit >= 800 - 0.01, 'grossProfit should reflect Revenue - COGS net of returns');

    // Build an isolated business to get an exact, uncontaminated number:
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser, login } = require('../src/modules/auth/auth.service');
    const freshBiz = createBusiness(ctx.db, { name: 'Fresh Finance Biz' });
    createUser(ctx.db, { businessId: freshBiz.id, email: 'fresh-owner@test.com', password: 'password123', role: 'Owner' });
    createUser(ctx.db, { businessId: freshBiz.id, email: 'fresh-cashier@test.com', password: 'password123', role: 'Cashier' });
    createUser(ctx.db, { businessId: freshBiz.id, email: 'fresh-manager@test.com', password: 'password123', role: 'Manager' });
    createUser(ctx.db, { businessId: freshBiz.id, email: 'fresh-inv@test.com', password: 'password123', role: 'InventoryStaff' });
    const freshOwner = login(ctx.db, { email: 'fresh-owner@test.com', password: 'password123' }).sessionId;
    const freshCashier = login(ctx.db, { email: 'fresh-cashier@test.com', password: 'password123' }).sessionId;
    const freshManager = login(ctx.db, { email: 'fresh-manager@test.com', password: 'password123' }).sessionId;
    const freshInv = login(ctx.db, { email: 'fresh-inv@test.com', password: 'password123' }).sessionId;

    const fProd = (await api('POST', '/products', { token: freshManager, body: { sku: 'FRESH-1', name: 'Fresh Item' } })).json.data;
    await api('POST', `/products/${fProd.id}/price`, { token: freshManager, body: { minPrice: 300, recommendedPrice: 500, maxPrice: 600, reason: 'setup' } });
    const fSup = (await api('POST', '/suppliers', { token: freshManager, body: { name: 'Fresh Supplier' } })).json.data;
    const fPur = (await api('POST', '/purchases', { token: freshManager, body: { supplierId: fSup.id, items: [{ productId: fProd.id, quantity: 10, unitCost: 300 }] } })).json.data;
    await api('POST', `/purchases/${fPur.id}/receive`, { token: freshInv, body: { operationId: 'fresh-recv' } });
    const fSale = (await api('POST', '/sales', { token: freshCashier, body: { operationId: 'fresh-sale', items: [{ productId: fProd.id, quantity: 5 }], paymentMethod: 'Cash', cashReceived: 5000 } })).json.data;
    const fSaleItem = ctx.db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(fSale.id);
    await api('POST', '/returns', { token: freshCashier, body: { saleId: fSale.id, items: [{ saleItemId: fSaleItem.id, quantity: 1 }] } });
    await api('POST', '/expenses', { token: freshOwner, body: { category: 'Packaging', amount: 200, expenseDate: new Date().toISOString().slice(0, 10) } });

    const fSummary = (await api('GET', '/finance/summary', { token: freshOwner })).json.data;
    assert.equal(fSummary.grossRevenue, 2500);
    assert.equal(fSummary.grossCogs, 1500);
    assert.equal(fSummary.returnsRevenue, 500);
    assert.equal(fSummary.returnsCogs, 300);
    assert.equal(fSummary.netRevenue, 2000);
    assert.equal(fSummary.netCogs, 1200);
    assert.equal(fSummary.grossProfit, 800);
    assert.equal(fSummary.operatingExpenses, 200);
    assert.equal(fSummary.netProfit, 600);
  });

  await t.test('Tenant isolation: Business B cannot see Business A returns/refunds/expenses/finance', async () => {
    const { sale } = await sellOne(ctx, { sku: 'ISO-FIN-1', cost: 300, price: 500, qty: 5, sellQty: 1, opId: 'iso-fin-sale' });
    const res = await api('POST', '/returns', { token: tokens.ownerB, body: { saleId: sale.id, items: [{ saleItemId: 'whatever', quantity: 1 }] } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CROSS_BUSINESS_ACCESS');

    const financeB = await api('GET', '/finance/summary', { token: tokens.ownerB });
    assert.equal(financeB.status, 200);
    assert.equal(financeB.json.data.grossRevenue, 0, "Business B's finance must not include Business A's sales");
  });
});

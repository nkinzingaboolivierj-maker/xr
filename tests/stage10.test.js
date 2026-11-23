'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const notificationService = require('../src/modules/notifications/notification.service');

async function completedSale(ctx, { sku = `NOTIF-${Date.now()}`, opId } = {}) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 300, recommendedPrice: 500, maxPrice: 800, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 300 }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: opId || `${sku}-sale`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'Cash', cashReceived: 9999 } })).json.data;
  return sale;
}

test('Stage 10 — Notifications / WhatsApp (Phase 8)', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('Queueing a receipt returns immediately with status QUEUED (never blocks)', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-1' });
    const start = Date.now();
    const res = await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788111111' } });
    const elapsed = Date.now() - start;
    assert.equal(res.status, 202);
    assert.equal(res.json.data.status, 'QUEUED');
    assert.ok(elapsed < 200, 'queueing must return immediately, not wait for delivery');
  });

  await t.test('Mock provider: a queued notification is eventually SENT with a provider message ID', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-2' });
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788222222' } })).json.data;

    // Deterministically drive delivery instead of racing setImmediate.
    await notificationService.attemptDelivery(ctx.db, queued.id);

    const after = await api('GET', `/notifications/${queued.id}`, { token: tokens.cashier });
    assert.equal(after.json.data.status, 'SENT');
    assert.ok(after.json.data.providerMessageId.startsWith('MOCK-'));
    assert.equal(after.json.data.attempts, 1);
  });

  await t.test('Mock provider: a simulated failure moves to RETRYING, then FAILED after max attempts', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-3' });
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788FAIL333' } })).json.data;

    await notificationService.attemptDelivery(ctx.db, queued.id);
    let row = await api('GET', `/notifications/${queued.id}`, { token: tokens.cashier });
    assert.equal(row.json.data.status, 'RETRYING');
    assert.equal(row.json.data.attempts, 1);
    assert.ok(row.json.data.failureReason);

    await notificationService.attemptDelivery(ctx.db, queued.id);
    await notificationService.attemptDelivery(ctx.db, queued.id);
    row = await api('GET', `/notifications/${queued.id}`, { token: tokens.cashier });
    assert.equal(row.json.data.status, 'FAILED');
    assert.equal(row.json.data.attempts, 3);
  });

  await t.test('A FAILED WhatsApp delivery never rolls back the underlying sale', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-4' });
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788FAIL444' } })).json.data;
    await notificationService.attemptDelivery(ctx.db, queued.id);

    const saleCheck = await api('GET', `/sales/${sale.id}`, { token: tokens.cashier });
    assert.equal(saleCheck.status, 200);
    assert.equal(saleCheck.json.data.status, 'completed', 'sale must remain completed regardless of notification outcome');
  });

  await t.test('Business settings: default provider is MOCK; switching to REAL is explicitly BLOCKED_PENDING_PROVIDER', async () => {
    const res = await api('PATCH', '/business/whatsapp-settings', { token: tokens.owner, body: { whatsappSenderNumber: '+250-PLACEHOLDER-0000', whatsappProvider: 'REAL' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.whatsappProvider, 'REAL');
    assert.ok(res.json.data.blocked && res.json.data.blocked.includes('BLOCKED_PENDING_PROVIDER'));

    // And actually attempting delivery under 'REAL' surfaces the block, not a fake success.
    const sale = await completedSale(ctx, { opId: 'notif-sale-5' });
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788555555' } })).json.data;
    await notificationService.attemptDelivery(ctx.db, queued.id);
    const after = await api('GET', `/notifications/${queued.id}`, { token: tokens.cashier });
    assert.equal(after.json.data.status, 'RETRYING');
    assert.ok(after.json.data.failureReason.includes('BLOCKED_PENDING_PROVIDER'));
  });

  await t.test('RBAC: Cashier cannot change WhatsApp business settings', async () => {
    const res = await api('PATCH', '/business/whatsapp-settings', { token: tokens.cashier, body: { whatsappSenderNumber: '+250-X' } });
    assert.equal(res.status, 403);
  });

  await t.test('List notifications filters by status and type', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-6' });
    await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788666666' } });
    const list = await api('GET', '/notifications?type=RECEIPT', { token: tokens.cashier });
    assert.ok(list.json.data.every((n) => n.type === 'RECEIPT'));
    assert.ok(list.json.data.length >= 1);
  });

  await t.test('Tenant isolation: Business B cannot read Business A notifications', async () => {
    const sale = await completedSale(ctx, { opId: 'notif-sale-7' });
    const queued = (await api('POST', `/sales/${sale.id}/send-receipt`, { token: tokens.cashier, body: { recipientPhone: '0788777777' } })).json.data;
    const res = await api('GET', `/notifications/${queued.id}`, { token: tokens.ownerB });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CROSS_BUSINESS_ACCESS');
  });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup } = require('./helpers');
const { MOCK_WEBHOOK_SECRET } = require('../src/modules/payments/payment.provider');

async function postWebhook(base, provider, payload, { signature } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signature !== undefined ? signature : crypto.createHmac('sha256', MOCK_WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await fetch(`${base}/payments/webhook/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig },
    body: raw,
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function simpleCashSale(ctx, { sku = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, paymentMethod = 'Cash' } = {}) {
  const { api, tokens } = ctx;
  const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku, name: `Product ${sku}` } })).json.data;
  await api('POST', `/products/${prod.id}/price`, { token: tokens.manager, body: { minPrice: 300, recommendedPrice: 500, maxPrice: 800, reason: 'setup' } });
  const sup = (await api('POST', '/suppliers', { token: tokens.manager, body: { name: `Sup ${sku}` } })).json.data;
  const pur = (await api('POST', '/purchases', { token: tokens.manager, body: { supplierId: sup.id, items: [{ productId: prod.id, quantity: 10, unitCost: 300 }] } })).json.data;
  await api('POST', `/purchases/${pur.id}/receive`, { token: tokens.inventory, body: { operationId: `${sku}-recv` } });
  const sale = (await api('POST', '/sales', { token: tokens.cashier, body: { operationId: `${sku}-sale`, items: [{ productId: prod.id, quantity: 1 }], paymentMethod, ...(paymentMethod === 'Cash' ? { cashReceived: 9999 } : {}) } })).json.data;
  return sale;
}

test('Stage 11 — Observability + Payment Adapter (Airtel Money / MTN MoMo / Card)', async (t) => {
  const ctx = await setup();
  const { api, base, tokens } = ctx;
  t.after(ctx.teardown);

  // ---------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------

  await t.test('GET /health is unauthenticated and reports ok', async () => {
    const res = await fetch(`${base}/health`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.status, 'ok');
  });

  await t.test('GET /ready is unauthenticated and reports ready (DB reachable)', async () => {
    const res = await fetch(`${base}/ready`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.status, 'ready');
  });

  await t.test('Every response carries an X-Request-Id header', async () => {
    const res = await fetch(`${base}/health`);
    assert.ok(res.headers.get('x-request-id'));
    assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{16}$/);
  });

  // ---------------------------------------------------------------------
  // Initiating a payment intent — validation
  // ---------------------------------------------------------------------

  await t.test('MobileMoney requires a valid network (Airtel Money or MTN MoMo)', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', amount: 1000, idempotencyKey: `pi-${Date.now()}-nonet` } });
    assert.equal(res.status, 400);
    assert.match(res.json.detail, /network/);
  });

  await t.test('MobileMoney rejects an unknown network value', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'ORANGE_MONEY', amount: 1000, idempotencyKey: `pi-${Date.now()}-badnet` } });
    assert.equal(res.status, 400);
  });

  await t.test('Card must NOT carry a network value', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', network: 'AIRTEL_MONEY', amount: 1000, idempotencyKey: `pi-${Date.now()}-cardnet` } });
    assert.equal(res.status, 400);
  });

  await t.test('Unknown payment method is rejected', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Crypto', amount: 1000, idempotencyKey: `pi-${Date.now()}-crypto` } });
    assert.equal(res.status, 400);
  });

  await t.test('amount must be > 0', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 0, idempotencyKey: `pi-${Date.now()}-zero` } });
    assert.equal(res.status, 400);
  });

  // ---------------------------------------------------------------------
  // Initiating — happy paths for all three rails
  // ---------------------------------------------------------------------

  await t.test('Airtel Money: initiate returns PENDING with a provider reference', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'AIRTEL_MONEY', amount: 5000, idempotencyKey: `pi-${Date.now()}-airtel` } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.method, 'MobileMoney');
    assert.equal(res.json.data.network, 'AIRTEL_MONEY');
    assert.equal(res.json.data.status, 'PENDING');
    assert.ok(res.json.data.providerReference.startsWith('MOCK-AIRTEL_MONEY-'));
  });

  await t.test('MTN Mobile Money: initiate returns PENDING with a provider reference', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'MTN_MOMO', amount: 5000, idempotencyKey: `pi-${Date.now()}-mtn` } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.network, 'MTN_MOMO');
    assert.ok(res.json.data.providerReference.startsWith('MOCK-MTN_MOMO-'));
  });

  await t.test('Card: initiate returns PENDING with a provider reference and no network', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 5000, idempotencyKey: `pi-${Date.now()}-card` } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.method, 'Card');
    assert.equal(res.json.data.network, null);
    assert.ok(res.json.data.providerReference.startsWith('MOCK-CARD-'));
  });

  await t.test('A simulated provider-side rejection (phone contains FAIL) comes back FAILED, not a fake success', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'AIRTEL_MONEY', amount: 2000, phone: '0788FAIL999', idempotencyKey: `pi-${Date.now()}-fail` } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.status, 'FAILED');
  });

  // ---------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------

  await t.test('Same idempotencyKey replayed returns the SAME intent, not a new one', async () => {
    const key = `pi-${Date.now()}-replay`;
    const first = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 1200, idempotencyKey: key } });
    const second = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 1200, idempotencyKey: key } });
    assert.equal(first.json.data.id, second.json.data.id);
  });

  await t.test('Concurrency: two simultaneous requests with the same idempotencyKey produce exactly one payment_intents row', async () => {
    const key = `pi-${Date.now()}-race`;
    const body = { method: 'MobileMoney', network: 'MTN_MOMO', amount: 3000, idempotencyKey: key };
    const [r1, r2] = await Promise.all([
      api('POST', '/payment-intents', { token: tokens.cashier, body }),
      api('POST', '/payment-intents', { token: tokens.cashier, body }),
    ]);
    assert.equal(r1.json.data.id, r2.json.data.id, 'both concurrent callers must see the same intent id');
    const rows = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payment_intents WHERE business_id = ? AND idempotency_key = ?`).get(ctx.business.id, key);
    assert.equal(rows.n, 1, 'exactly one row must exist for this idempotency key, even under a race');
  });

  // ---------------------------------------------------------------------
  // Webhook delivery — signature verification + idempotent event handling
  // ---------------------------------------------------------------------

  await t.test('Webhook with a valid signature moves a PENDING intent to SUCCESS', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 4000, idempotencyKey: `pi-${Date.now()}-wh1` } })).json.data;
    assert.equal(created.status, 'PENDING');

    const payload = { eventId: `evt-${Date.now()}-1`, providerReference: created.providerReference, status: 'SUCCESS' };
    const wh = await postWebhook(base, 'mock', payload);
    assert.equal(wh.status, 200);
    assert.equal(wh.json.data.status, 'SUCCESS');

    const after = await api('GET', `/payment-intents/${created.id}`, { token: tokens.cashier });
    assert.equal(after.json.data.status, 'SUCCESS');
  });

  await t.test('Webhook with an invalid signature is rejected and never changes state', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 4000, idempotencyKey: `pi-${Date.now()}-wh2` } })).json.data;
    const payload = { eventId: `evt-${Date.now()}-2`, providerReference: created.providerReference, status: 'SUCCESS' };
    const wh = await postWebhook(base, 'mock', payload, { signature: 'deadbeef'.repeat(8) });
    assert.equal(wh.status, 401);
    assert.equal(wh.json.code, 'INVALID_WEBHOOK_SIGNATURE');

    const after = await api('GET', `/payment-intents/${created.id}`, { token: tokens.cashier });
    assert.equal(after.json.data.status, 'PENDING', 'state must be untouched by a forged webhook');
  });

  await t.test('A replayed webhook event (same eventId) is an idempotent no-op, not a double-apply', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 4000, idempotencyKey: `pi-${Date.now()}-wh3` } })).json.data;
    const payload = { eventId: `evt-${Date.now()}-3`, providerReference: created.providerReference, status: 'SUCCESS' };

    const first = await postWebhook(base, 'mock', payload);
    assert.equal(first.json.data.status, 'SUCCESS');

    // Simulate the provider retrying delivery of the exact same event after
    // our 200 somehow didn't reach it (a routine real-world occurrence).
    const replay = await postWebhook(base, 'mock', payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.data.status, 'SUCCESS');

    const events = ctx.db.prepare(`SELECT COUNT(*) AS n FROM payment_webhook_events WHERE provider = 'mock' AND provider_event_id = ?`).get(payload.eventId);
    assert.equal(events.n, 1, 'the retry must not insert a second event row');
  });

  await t.test('Webhook for an unknown provider is explicitly BLOCKED_PENDING_PROVIDER, never silently accepted', async () => {
    const raw = JSON.stringify({ eventId: 'evt-x', providerReference: 'whatever', status: 'SUCCESS' });
    const res = await fetch(`${base}/payments/webhook/airtel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'irrelevant' },
      body: raw,
    });
    const json = await res.json();
    // Stage 12: a missing provider integration is a server-side configuration state (503), not a client validation error (400).
    assert.equal(res.status, 503);
    assert.equal(json.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(json.detail, /BLOCKED_PENDING_PROVIDER/);
  });

  await t.test('Webhook for an unknown provider reference returns NOT_FOUND', async () => {
    const payload = { eventId: `evt-${Date.now()}-unknown`, providerReference: 'MOCK-DOES-NOT-EXIST', status: 'SUCCESS' };
    const wh = await postWebhook(base, 'mock', payload);
    assert.equal(wh.status, 404);
  });

  // ---------------------------------------------------------------------
  // Reconciliation + attach-to-sale
  // ---------------------------------------------------------------------

  await t.test('listUnreconciled surfaces a SUCCESS payment with no sale attached', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'MobileMoney', network: 'AIRTEL_MONEY', amount: 1500, idempotencyKey: `pi-${Date.now()}-recon` } })).json.data;
    await postWebhook(base, 'mock', { eventId: `evt-${Date.now()}-recon`, providerReference: created.providerReference, status: 'SUCCESS' });

    const list = await api('GET', '/payments/unreconciled', { token: tokens.manager });
    assert.equal(list.status, 200);
    assert.ok(list.json.data.some((p) => p.id === created.id));
  });

  await t.test('Attaching a SUCCESS payment intent to a sale removes it from the unreconciled list', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: `pi-${Date.now()}-attach` } })).json.data;
    await postWebhook(base, 'mock', { eventId: `evt-${Date.now()}-attach`, providerReference: created.providerReference, status: 'SUCCESS' });
    // Stage 12: a provider payment may only settle a sale it actually matches (amount, currency, method),
    // so this now uses a Card sale of exactly 500 instead of an unrelated cash sale.
    const sale = await simpleCashSale(ctx, { paymentMethod: 'Card' });

    const attached = await api('POST', `/payment-intents/${created.id}/attach-sale`, { token: tokens.cashier, body: { saleId: sale.id } });
    assert.equal(attached.status, 200);
    assert.equal(attached.json.data.saleId, sale.id);

    const list = await api('GET', '/payments/unreconciled', { token: tokens.manager });
    assert.ok(!list.json.data.some((p) => p.id === created.id));
  });

  await t.test('Attaching the same payment intent twice is rejected', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: `pi-${Date.now()}-attach2` } })).json.data;
    await postWebhook(base, 'mock', { eventId: `evt-${Date.now()}-attach2`, providerReference: created.providerReference, status: 'SUCCESS' });
    const sale = await simpleCashSale(ctx, { paymentMethod: 'Card' });
    await api('POST', `/payment-intents/${created.id}/attach-sale`, { token: tokens.cashier, body: { saleId: sale.id } });

    const again = await api('POST', `/payment-intents/${created.id}/attach-sale`, { token: tokens.cashier, body: { saleId: sale.id } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'DUPLICATE_OPERATION');
  });

  await t.test('A PENDING (not yet SUCCESS) payment intent cannot be attached to a sale', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 500, idempotencyKey: `pi-${Date.now()}-pendattach` } })).json.data;
    const sale = await simpleCashSale(ctx);
    const res = await api('POST', `/payment-intents/${created.id}/attach-sale`, { token: tokens.cashier, body: { saleId: sale.id } });
    assert.equal(res.status, 400);
  });

  // ---------------------------------------------------------------------
  // RBAC + tenant isolation
  // ---------------------------------------------------------------------

  await t.test('RBAC: InventoryStaff cannot initiate a payment', async () => {
    const res = await api('POST', '/payment-intents', { token: tokens.inventory, body: { method: 'Card', amount: 100, idempotencyKey: `pi-${Date.now()}-inv` } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'PERMISSION_DENIED');
  });

  await t.test('RBAC: Cashier cannot view the unreconciled-payments list (financial oversight is Manager/Owner only)', async () => {
    const res = await api('GET', '/payments/unreconciled', { token: tokens.cashier });
    assert.equal(res.status, 403);
  });

  await t.test('RBAC: Owner (wildcard) can view the unreconciled-payments list', async () => {
    const res = await api('GET', '/payments/unreconciled', { token: tokens.owner });
    assert.equal(res.status, 200);
  });

  await t.test('Tenant isolation: Business B cannot read Business A\'s payment intent', async () => {
    const created = (await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 100, idempotencyKey: `pi-${Date.now()}-tenant` } })).json.data;
    const res = await api('GET', `/payment-intents/${created.id}`, { token: tokens.ownerB });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'CROSS_BUSINESS_ACCESS');
  });

  await t.test('List endpoint only returns the caller\'s own business\'s payment intents', async () => {
    await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 100, idempotencyKey: `pi-${Date.now()}-listA` } });
    const listA = await api('GET', '/payment-intents', { token: tokens.owner });
    const listB = await api('GET', '/payment-intents', { token: tokens.ownerB });
    assert.ok(listA.json.data.length > 0);
    assert.equal(listB.json.data.length, 0);
  });

  // ---------------------------------------------------------------------
  // REAL provider is explicitly blocked, never faked
  // ---------------------------------------------------------------------

  await t.test('Switching a business to the REAL payment provider surfaces BLOCKED_PENDING_PROVIDER on next use, not a fake success', async () => {
    ctx.db.prepare(`UPDATE businesses SET payment_provider = 'REAL' WHERE id = ?`).run(ctx.business.id);
    const res = await api('POST', '/payment-intents', { token: tokens.cashier, body: { method: 'Card', amount: 100, idempotencyKey: `pi-${Date.now()}-real` } });
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(res.json.detail, /BLOCKED_PENDING_PROVIDER/);
    // and the claimed intent row is marked FAILED, not left dangling as a fake PENDING
    const rows = ctx.db.prepare(`SELECT status FROM payment_intents WHERE business_id = ? ORDER BY created_at DESC LIMIT 1`).get(ctx.business.id);
    assert.equal(rows.status, 'FAILED');
    ctx.db.prepare(`UPDATE businesses SET payment_provider = 'MOCK' WHERE id = ?`).run(ctx.business.id);
  });
});

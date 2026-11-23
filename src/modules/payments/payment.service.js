'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const { getProvider, MOCK_WEBHOOK_SECRET } = require('./payment.provider');
const configLib = require('../../lib/config');

const VALID_METHODS = ['MobileMoney', 'Card'];
const VALID_NETWORKS = ['AIRTEL_MONEY', 'MTN_MOMO'];
const VALID_STATUSES = ['INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'];

// FR-PAY-003/004/005 (Phase 9 — Payment Adapter: Airtel Money, MTN Mobile
// Money, Card).
//
// Initiates a provider-side payment attempt BEFORE any sale exists. This
// is deliberately a two-phase write:
//   1) claim the idempotency key with an INITIATED row (so two concurrent
//      requests carrying the same idempotencyKey can never both reach the
//      provider — the loser re-reads the winner's row instead of calling
//      out a second time),
//   2) THEN call the provider and record what it returned.
// The provider call itself happens OUTSIDE any open database transaction
// — a SQLite write-lock (BEGIN IMMEDIATE) must never be held across an
// awaited external network call.
async function initiatePaymentIntent(db, session, { method, network, amount, currency, idempotencyKey, phone } = {}) {
  if (!VALID_METHODS.includes(method)) {
    throw new ApiError('VALIDATION_ERROR', `method must be one of ${VALID_METHODS.join(', ')}`);
  }
  if (method === 'MobileMoney') {
    if (!VALID_NETWORKS.includes(network)) {
      throw new ApiError('VALIDATION_ERROR', `network is required for MobileMoney and must be one of ${VALID_NETWORKS.join(', ')} (Airtel Money or MTN Mobile Money)`);
    }
  } else if (network) {
    throw new ApiError('VALIDATION_ERROR', "network only applies to method 'MobileMoney' (Card does not use a network)");
  }
  if (!(Number(amount) > 0)) throw new ApiError('VALIDATION_ERROR', 'amount must be > 0');
  if (!idempotencyKey) throw new ApiError('VALIDATION_ERROR', 'idempotencyKey is required');

  const existing = db.prepare(`SELECT id FROM payment_intents WHERE business_id = ? AND idempotency_key = ?`).get(session.businessId, idempotencyKey);
  if (existing) return getPaymentIntent(db, session, existing.id);

  const business = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(session.businessId);
  // Rule E: a simulated provider must never be reachable in a production path.
  if (business.payment_provider === 'MOCK' && !configLib.get().allowMockProviders) {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: no real payment provider is connected, and simulated payments are disabled in production. Confirm Mobile Money / Card sales manually at the POS until a provider is connected.');
  }
  // One currency per business (ISO 4217): never silently accept another.
  const curr = currency || business.currency;
  if (curr !== business.currency) {
    throw new ApiError('PAYMENT_AMOUNT_MISMATCH', `Payment currency ${curr} does not match the business currency ${business.currency}`);
  }
  const id = nextId('pint');

  try {
    withTransaction(db, () => {
      db.prepare(`
        INSERT INTO payment_intents
          (id, business_id, method, network, amount, currency, status, idempotency_key, provider, provider_reference, sale_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'INITIATED', ?, ?, NULL, NULL, ?, ?, ?)
      `).run(id, session.businessId, method, network || null, Number(amount), curr, idempotencyKey, business.payment_provider, session.userId, now(), now());
    });
  } catch (err) {
    // Lost the idempotency-key race — another request already claimed it.
    const winner = db.prepare(`SELECT id FROM payment_intents WHERE business_id = ? AND idempotency_key = ?`).get(session.businessId, idempotencyKey);
    if (winner) return getPaymentIntent(db, session, winner.id);
    throw err;
  }

  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'CREATE', resource: 'payment_intent', resourceId: id,
    newState: { method, network: network || null, amount: Number(amount), currency: curr, provider: business.payment_provider },
  });

  const provider = getProvider(business.payment_provider);
  let outcome;
  try {
    outcome = await provider.initiatePayment({ method, network, amount: Number(amount), currency: curr, phone });
  } catch (err) {
    db.prepare(`UPDATE payment_intents SET status = 'FAILED', updated_at = ? WHERE id = ?`).run(now(), id);
    if (err instanceof ApiError) throw err;
    throw new ApiError('VALIDATION_ERROR', err.message || 'Payment provider initiation failed');
  }

  db.prepare(`UPDATE payment_intents SET status = ?, provider_reference = ?, updated_at = ? WHERE id = ?`)
    .run(outcome.status, outcome.providerReference, now(), id);

  return getPaymentIntent(db, session, id);
}

function formatIntent(row) {
  if (!row) return null;
  return {
    id: row.id, method: row.method, network: row.network, amount: row.amount, currency: row.currency,
    status: row.status, provider: row.provider, providerReference: row.provider_reference,
    saleId: row.sale_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function getPaymentIntent(db, session, id) {
  const row = db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Payment intent');
  return formatIntent(row);
}

function listPaymentIntents(db, session, { status } = {}) {
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  if (status) { clauses.push('status = ?'); args.push(status); }
  return db.prepare(`SELECT * FROM payment_intents WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...args).map(formatIntent);
}

// FR-PAY-RECON-001 — payments whose provider confirmed SUCCESS but that
// never got attached to a sale (the client disconnected, the server
// crashed mid-request, etc.). These must surface explicitly rather than
// vanish; attachToSale() is how a human (or a later retry) reconciles one.
function listUnreconciled(db, session) {
  return db.prepare(`SELECT * FROM payment_intents WHERE business_id = ? AND status = 'SUCCESS' AND sale_id IS NULL ORDER BY created_at ASC`)
    .all(session.businessId).map(formatIntent);
}

function attachToSale(db, session, intentId, saleId) {
  if (!saleId) throw new ApiError('VALIDATION_ERROR', 'saleId is required');
  return withTransaction(db, () => {
    const intent = db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(intentId);
    assertOwnedByBusiness(intent, session, 'Payment intent');
    if (intent.status !== 'SUCCESS') {
      throw new ApiError('VALIDATION_ERROR', `Payment intent must be SUCCESS to attach to a sale (currently ${intent.status})`);
    }
    if (intent.sale_id) {
      throw new ApiError('DUPLICATE_OPERATION', 'Payment intent is already attached to a sale');
    }
    const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
    assertOwnedByBusiness(sale, session, 'Sale');
    settleSaleWithIntent(db, session, sale, intent);
    return getPaymentIntent(db, session, intentId);
  });
}

// Shared by POST /payment-intents/:id/attach-sale and by sale creation with a
// paymentIntentId. A provider-confirmed payment may only settle a sale whose
// amount, currency and method it actually matches -- previously ANY successful
// intent could be attached to ANY sale (even a cash sale of a different amount).
// Must run inside a transaction.
function settleSaleWithIntent(db, session, sale, intent) {
  const business = db.prepare(`SELECT currency FROM businesses WHERE id = ?`).get(session.businessId);
  if (intent.currency !== business.currency) {
    throw new ApiError('PAYMENT_AMOUNT_MISMATCH', `Payment currency ${intent.currency} does not match the business currency ${business.currency}`);
  }
  if (Math.abs(Number(intent.amount) - Number(sale.total)) > 0.005) {
    throw new ApiError('PAYMENT_AMOUNT_MISMATCH', `Payment amount ${intent.amount} does not equal the sale total ${sale.total}`);
  }
  if (sale.payment_method !== intent.method) {
    throw new ApiError('PAYMENT_AMOUNT_MISMATCH', `Sale payment method ${sale.payment_method} does not match the payment intent method ${intent.method}`);
  }
  if (intent.sale_id) throw new ApiError('DUPLICATE_OPERATION', 'Payment intent is already attached to a sale');
  const already = db.prepare(`SELECT id FROM payment_intents WHERE sale_id = ?`).get(sale.id);
  if (already) throw new ApiError('DUPLICATE_OPERATION', 'This sale already has a verified payment attached');
  db.prepare(`UPDATE payment_intents SET sale_id = ?, updated_at = ? WHERE id = ?`).run(sale.id, now(), intent.id);
  db.prepare(`UPDATE payments SET status = 'SUCCESS', confirmation = 'PROVIDER_VERIFIED', payment_intent_id = ?, reference = ?, confirmed_by = ?, confirmed_at = ? WHERE sale_id = ?`)
    .run(intent.id, intent.provider_reference, session.userId, now(), sale.id);
  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'UPDATE', resource: 'payment_intent', resourceId: intent.id, newState: { saleId: sale.id, confirmation: 'PROVIDER_VERIFIED' },
  });
}

// Allowed webhook transitions. A confirmed payment is final; a terminal
// failure can only be overturned by a late SUCCESS from EXPIRED (the customer
// paid after our timeout -- that money must surface for reconciliation, not
// vanish). Everything else is recorded in the audit log and ignored, so a
// replayed/forged/out-of-order event can't flip a settled payment.
const WEBHOOK_TRANSITIONS = {
  INITIATED: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  EXPIRED: ['SUCCESS'],
  SUCCESS: [], FAILED: [], CANCELLED: [],
};

// Handles an inbound webhook delivery from a payment provider. There is
// NO session here — providers call back directly, not as one of our
// users — so the business is resolved from the payment_intents row
// itself (via provider_reference), never trusted from the request body.
//
// Order of operations matters: the signature is verified BEFORE anything
// else runs, so a forged/unsigned request can never reach business logic
// even to produce a 404. Only 'mock' is a real target today — any other
// provider name is explicitly BLOCKED_PENDING_PROVIDER, the same honesty
// rule as everywhere else a real credential is still missing.
function handleWebhook(db, { providerName, rawBody, signature, body } = {}) {
  const cfg = configLib.get();
  if (providerName !== 'mock') {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', `BLOCKED_PENDING_PROVIDER: no real '${providerName}' webhook integration is configured yet.`);
  }
  // The 'mock' webhook exists for development/tests only. In production it is
  // closed: its public default secret would let anyone forge a payment.
  if (!cfg.allowMockProviders) {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: the mock payment webhook is disabled in production.');
  }
  if (cfg.isProduction && !cfg.paymentWebhookSecret) {
    throw new ApiError('PROVIDER_NOT_CONFIGURED', 'PAYMENT_WEBHOOK_SECRET (min 32 characters) must be set before any webhook is accepted in production.');
  }
  const secret = cfg.paymentWebhookSecret || MOCK_WEBHOOK_SECRET;

  const adapter = getProvider('MOCK');
  const validSig = adapter.verifyWebhookSignature({ rawBody, signature, secret });
  if (!validSig) throw new ApiError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature verification failed');

  const { eventId, providerReference, status } = body || {};
  if (!eventId) throw new ApiError('VALIDATION_ERROR', 'eventId is required');
  if (!providerReference) throw new ApiError('VALIDATION_ERROR', 'providerReference is required');
  if (!VALID_STATUSES.includes(status)) {
    throw new ApiError('VALIDATION_ERROR', `status must be one of ${VALID_STATUSES.join(', ')}`);
  }

  return withTransaction(db, () => {
    // Checked-then-insert, with the UNIQUE(provider, provider_event_id)
    // constraint as a backstop against a true concurrent-delivery race —
    // same defense-in-depth pattern used for sale/purchase idempotency.
    const already = db.prepare(`SELECT id FROM payment_webhook_events WHERE provider = ? AND provider_event_id = ?`).get(providerName, eventId);
    const intentRow = db.prepare(`SELECT * FROM payment_intents WHERE provider_reference = ?`).get(providerReference);
    if (!intentRow) throw new ApiError('NOT_FOUND', `No payment intent found for provider reference ${providerReference}`);

    if (already) {
      // Idempotent replay: a provider retry must NEVER re-apply a status
      // change. Return current truth, unchanged.
      return formatIntent(db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(intentRow.id));
    }

    db.prepare(`INSERT INTO payment_webhook_events (id, provider, provider_event_id, payload, received_at) VALUES (?, ?, ?, ?, ?)`)
      .run(nextId('whk'), providerName, eventId, JSON.stringify(body), now());

    if (intentRow.status !== status) {
      if (!(WEBHOOK_TRANSITIONS[intentRow.status] || []).includes(status)) {
        writeAudit(db, {
          businessId: intentRow.business_id, actorId: null,
          action: 'WEBHOOK_REJECTED_TRANSITION', resource: 'payment_intent', resourceId: intentRow.id,
          oldState: { status: intentRow.status }, newState: { attempted: status },
        });
        return formatIntent(db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(intentRow.id));
      }
      db.prepare(`UPDATE payment_intents SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), intentRow.id);
      writeAudit(db, {
        businessId: intentRow.business_id, actorId: null,
        action: 'WEBHOOK', resource: 'payment_intent', resourceId: intentRow.id,
        oldState: { status: intentRow.status }, newState: { status },
      });
    }

    return formatIntent(db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(intentRow.id));
  });
}

module.exports = {
  initiatePaymentIntent, getPaymentIntent, listPaymentIntents, listUnreconciled,
  attachToSale, settleSaleWithIntent, handleWebhook, formatIntent, VALID_METHODS, VALID_NETWORKS, VALID_STATUSES,
};

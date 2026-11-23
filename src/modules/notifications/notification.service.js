'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { assertOwnedByBusiness } = require('../business/tenant');
const { getProvider } = require('./whatsapp.provider');
const configLib = require('../../lib/config');

const MAX_ATTEMPTS = 3;

// FR-NOT-001 — queues a delivery and returns IMMEDIATELY; it does NOT send
// anything itself. A sale (or any caller) is never blocked or failed by
// what happens to this notification afterward.
//
// Actual sending happens only when something calls attemptDelivery() or
// processQueue() — in this codebase that is a worker loop started by
// server.js (see startNotificationWorker), not an inline setImmediate off
// the request path. This keeps delivery genuinely out-of-band AND keeps
// behavior deterministic for tests, which call attemptDelivery/processQueue
// explicitly instead of racing a fire-and-forget timer.
function queueNotification(db, session, { type, recipientPhone, recipientName, referenceType, referenceId, payload }) {
  if (!type) throw new ApiError('VALIDATION_ERROR', 'type is required');
  if (!recipientPhone) throw new ApiError('VALIDATION_ERROR', 'recipientPhone is required');

  const business = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(session.businessId);
  const id = nextId('notif');
  db.prepare(`
    INSERT INTO notification_deliveries
      (id, business_id, type, channel, recipient_phone, recipient_name, reference_type, reference_id, payload, provider, provider_message_id, status, attempts, created_at)
    VALUES (?, ?, ?, 'WHATSAPP', ?, ?, ?, ?, ?, ?, NULL, 'QUEUED', 0, ?)
  `).run(id, session.businessId, type, recipientPhone, recipientName || null, referenceType || null, referenceId || null, JSON.stringify(payload || {}), business.whatsapp_provider, now());

  return getNotification(db, session, id);
}

// One delivery attempt for one notification. Never reschedules itself —
// the caller (processQueue, or a test) decides when the next attempt
// happens, so retry timing is controlled in ONE place, not scattered
// across self-chaining timers.
async function attemptDelivery(db, notificationId) {
  const row = db.prepare(`SELECT * FROM notification_deliveries WHERE id = ?`).get(notificationId);
  if (!row || !['QUEUED', 'RETRYING'].includes(row.status)) return row;

  db.prepare(`UPDATE notification_deliveries SET status = 'SENDING', attempts = attempts + 1, last_attempt_at = ? WHERE id = ?`).run(now(), notificationId);

  const provider = getProvider(row.provider);
  const business = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(row.business_id);

  try {
    // Rule E: a simulated provider can never report "SENT" in production.
    if (row.provider === 'MOCK' && !configLib.get().allowMockProviders) {
      throw new ApiError('PROVIDER_NOT_CONFIGURED', 'BLOCKED_PENDING_PROVIDER: no real WhatsApp provider is connected and simulated delivery is disabled in production.');
    }
    const result = await provider.send({
      to: row.recipient_phone,
      from: business.whatsapp_sender_number || null,
      type: row.type,
      body: row.payload,
    });
    db.prepare(`UPDATE notification_deliveries SET status = 'SENT', provider_message_id = ?, sent_at = ?, failure_reason = NULL WHERE id = ?`)
      .run(result.providerMessageId, now(), notificationId);
  } catch (err) {
    const attempts = db.prepare(`SELECT attempts FROM notification_deliveries WHERE id = ?`).get(notificationId).attempts;
    const nextStatus = attempts < MAX_ATTEMPTS ? 'RETRYING' : 'FAILED';
    db.prepare(`UPDATE notification_deliveries SET status = ?, failure_reason = ? WHERE id = ?`).run(nextStatus, err.message || 'Unknown delivery error', notificationId);
  }

  return db.prepare(`SELECT * FROM notification_deliveries WHERE id = ?`).get(notificationId);
}

// A "worker tick": attempts every QUEUED/RETRYING row once. A real
// deployment calls this on an interval (see startNotificationWorker in
// server.js) — still no separate process/queue infra (Redis etc.) exists,
// so this polls the same SQLite table instead. Documented limitation, not
// hidden: see README "NOT built yet".
async function processQueue(db, { limit = 50 } = {}) {
  const rows = db.prepare(`SELECT id FROM notification_deliveries WHERE status IN ('QUEUED','RETRYING') ORDER BY created_at ASC LIMIT ?`).all(limit);
  const results = [];
  for (const r of rows) {
    results.push(await attemptDelivery(db, r.id));
  }
  return results;
}

function getNotification(db, session, id) {
  const row = db.prepare(`SELECT * FROM notification_deliveries WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Notification');
  return {
    id: row.id, type: row.type, channel: row.channel, recipientPhone: row.recipient_phone, recipientName: row.recipient_name,
    referenceType: row.reference_type, referenceId: row.reference_id, provider: row.provider, providerMessageId: row.provider_message_id,
    status: row.status, attempts: row.attempts, failureReason: row.failure_reason,
    createdAt: row.created_at, lastAttemptAt: row.last_attempt_at, sentAt: row.sent_at,
  };
}

function listNotifications(db, session, { status, type } = {}) {
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  if (status) { clauses.push('status = ?'); args.push(status); }
  if (type) { clauses.push('type = ?'); args.push(type); }
  return db.prepare(`SELECT * FROM notification_deliveries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...args)
    .map((row) => getNotification(db, session, row.id));
}

// Phase 46/Business settings — the ONLY thing that needs to change to go
// from simulated to real delivery: the sender number and provider flag.
function updateWhatsAppSettings(db, session, { whatsappSenderNumber, whatsappProvider }) {
  const business = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(session.businessId);
  if (!business) throw new ApiError('NOT_FOUND', 'Business not found');
  const provider = whatsappProvider === 'REAL' ? 'REAL' : 'MOCK';
  db.prepare(`UPDATE businesses SET whatsapp_sender_number = ?, whatsapp_provider = ? WHERE id = ?`)
    .run(whatsappSenderNumber || null, provider, session.businessId);
  writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'UPDATE', resource: 'business_whatsapp_settings', resourceId: session.businessId, newState: { whatsappSenderNumber, provider } });
  return { whatsappSenderNumber: whatsappSenderNumber || null, whatsappProvider: provider, blocked: provider === 'REAL' ? 'BLOCKED_PENDING_PROVIDER: real provider class not implemented yet — see whatsapp.provider.js RealWhatsAppProvider' : null };
}

// Convenience wrapper matching the spec's exact flow:
// Sale Completed -> Receipt Generated -> Delivery Queue -> WhatsApp Provider -> SENT/FAILED
function queueReceiptForSale(db, session, saleId, { recipientPhone, recipientName } = {}) {
  const documentService = require('../documents/document.service');
  const receipt = documentService.getReceipt(db, session, saleId); // tenant-checked inside
  const phone = recipientPhone; // customer phone isn't collected on the sale/customer record consistently yet — caller supplies it explicitly (see Stage 10 tests / OPEN_DECISIONS)
  return queueNotification(db, session, {
    type: 'RECEIPT', recipientPhone: phone, recipientName: recipientName || receipt.customer.name,
    referenceType: 'sale', referenceId: saleId, payload: { receiptNumber: receipt.receiptNumber, total: receipt.total, text: documentService.renderPlainText(receipt) },
  });
}

module.exports = { queueNotification, attemptDelivery, processQueue, getNotification, listNotifications, updateWhatsAppSettings, queueReceiptForSale };

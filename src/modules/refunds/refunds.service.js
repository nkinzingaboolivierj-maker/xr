'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const returnsService = require('../returns/returns.service');

// FR-REF-001 — a refund can never exceed the return's remaining refundable
// amount, and duplicate refunds are prevented the same way duplicate sales
// are: by recomputing the remaining amount from committed rows inside the
// transaction, never from a client-supplied "remaining" figure.
function createRefund(db, session, { returnId, amount, method }) {
  const returnRow = db.prepare(`SELECT * FROM returns WHERE id = ?`).get(returnId);
  assertOwnedByBusiness(returnRow, session, 'Return');

  const requested = Number(amount);
  if (!(requested > 0)) throw new ApiError('VALIDATION_ERROR', 'amount must be > 0');

  return withTransaction(db, () => {
    const current = returnsService.getReturn(db, session, returnId); // recomputed fresh, inside the transaction
    if (requested > current.refundableRemaining) {
      throw new ApiError('REFUND_EXCEEDS_REFUNDABLE', `Requested ${requested} exceeds remaining refundable amount ${current.refundableRemaining}`);
    }

    const id = nextId('rfd');
    db.prepare(`
      INSERT INTO refunds (id, business_id, return_id, amount, status, method, actor_id, created_at)
      VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
    `).run(id, session.businessId, returnId, requested, method || null, session.userId, now());

    writeAudit(db, {
      businessId: session.businessId, actorId: session.userId,
      action: 'CREATE', resource: 'refund', resourceId: id, newState: { returnId, amount: requested },
    });

    return getRefund(db, session, id);
  });
}

function getRefund(db, session, id) {
  const row = db.prepare(`SELECT * FROM refunds WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Refund');
  return { id: row.id, returnId: row.return_id, amount: row.amount, status: row.status, method: row.method, createdAt: row.created_at };
}

function listRefunds(db, session) {
  return db.prepare(`SELECT id FROM refunds WHERE business_id = ? ORDER BY created_at DESC`).all(session.businessId)
    .map((r) => getRefund(db, session, r.id));
}

module.exports = { createRefund, getRefund, listRefunds };

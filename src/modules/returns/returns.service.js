'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const inventory = require('../inventory/inventory.service');

function round2(n) { return Math.round(n * 100) / 100; }

function alreadyReturnedQty(db, saleItemId) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity), 0) q FROM return_items WHERE sale_item_id = ?`).get(saleItemId);
  return row.q;
}

// FR-RET-001 — return quantity can never exceed (sold - already returned).
// Restocking uses a NEW batch dated today, costed at the weighted-average
// unit cost of the original sale item (see sale_item_batches). This is a
// documented simplification versus restoring the exact original batch —
// it keeps COGS/Finance correct without needing partial-batch reversal.
function createReturn(db, session, { saleId, items }) {
  const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
  assertOwnedByBusiness(sale, session, 'Sale');
  if (sale.status !== 'completed') throw new ApiError('VALIDATION_ERROR', 'Only completed sales can be returned against');
  if (!Array.isArray(items) || items.length === 0) throw new ApiError('VALIDATION_ERROR', 'items must be a non-empty array');

  return withTransaction(db, () => {
    const returnId = nextId('ret');
    db.prepare(`INSERT INTO returns (id, business_id, sale_id, status, actor_id, created_at) VALUES (?, ?, ?, 'completed', ?, ?)`)
      .run(returnId, session.businessId, saleId, session.userId, now());

    const resultItems = [];
    // What the customer actually paid is sale.total (after line + sale-level
    // discounts, including tax). Each sale item's share of that is pro-rata to
    // its net line total. Refundable value is derived from THAT share, never
    // from the list price: the old unit_price x qty over-refunded discounted
    // sales and under-refunded taxed ones.
    const sumLine = db.prepare(`SELECT COALESCE(SUM(line_total), 0) AS s FROM sale_items WHERE sale_id = ?`).get(saleId).s;

    for (const it of items) {
      if (!it || typeof it.saleItemId !== 'string' || !it.saleItemId) throw new ApiError('VALIDATION_ERROR', 'Each return item needs a saleItemId');
      const saleItem = db.prepare(`SELECT * FROM sale_items WHERE id = ? AND sale_id = ?`).get(it.saleItemId, saleId);
      if (!saleItem) throw new ApiError('NOT_FOUND', `Sale item ${it.saleItemId} not found on this sale`);

      const already = alreadyReturnedQty(db, saleItem.id);
      const requested = Number(it.quantity);
      if (!(Number.isFinite(requested) && requested > 0)) throw new ApiError('VALIDATION_ERROR', 'Return quantity must be a finite number > 0');
      if (already + requested > saleItem.quantity) {
        throw new ApiError('RETURN_EXCEEDS_SOLD', `Sale item ${saleItem.id}: sold ${saleItem.quantity}, already returned ${already}, requested ${requested}`);
      }

      // Weighted-average unit cost this sale item was actually sold at.
      const batches = db.prepare(`SELECT * FROM sale_item_batches WHERE sale_item_id = ?`).all(saleItem.id);
      const totalCost = batches.reduce((s, b) => s + b.quantity * b.unit_cost, 0);
      const avgCost = round2(totalCost / saleItem.quantity);

      const restock = inventory.addStock(db, {
        businessId: session.businessId, productId: saleItem.product_id, quantity: requested, unitCost: avgCost,
        movementType: 'CUSTOMER_RETURN', referenceType: 'return', referenceId: returnId, actorId: session.userId,
      });

      const paidShare = sumLine > 0 ? (saleItem.line_total / sumLine) * sale.total : 0;
      const priorValue = db.prepare(`SELECT COALESCE(SUM(line_total), 0) AS v FROM return_items WHERE sale_item_id = ?`).get(saleItem.id).v;
      // The final unit of an item takes the remainder, so returning everything refunds exactly what was paid (no cent drift).
      const lineTotal = (already + requested === saleItem.quantity)
        ? round2(paidShare - priorValue)
        : round2((paidShare * requested) / saleItem.quantity);
      // Split the refunded amount into pre-tax revenue and tax so the finance
      // summary can reduce revenue (pre-tax) and tax held separately.
      const taxPart = sale.total > 0 ? round2((lineTotal * sale.tax_amount) / sale.total) : 0;
      const netPart = round2(lineTotal - taxPart);
      const returnItemId = nextId('rit');
      db.prepare(`
        INSERT INTO return_items (id, return_id, sale_item_id, quantity, unit_price, line_total, condition, reason, restocked_batch_id, net_amount, tax_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(returnItemId, returnId, saleItem.id, requested, saleItem.unit_price, lineTotal, it.condition || null, it.reason || null, restock.batchId, netPart, taxPart);

      resultItems.push({ saleItemId: saleItem.id, productId: saleItem.product_id, quantity: requested, lineTotal, restockedAtCost: avgCost });
    }

    writeAudit(db, {
      businessId: session.businessId, actorId: session.userId,
      action: 'CREATE', resource: 'return', resourceId: returnId, newState: { saleId, items: resultItems },
    });

    return getReturn(db, session, returnId);
  });
}

function getReturn(db, session, id) {
  const row = db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Return');
  const items = db.prepare(`SELECT ri.*, si.product_name AS product_name FROM return_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.return_id = ?`).all(id)
    .map((r) => ({ saleItemId: r.sale_item_id, productName: r.product_name, quantity: r.quantity, unitPrice: r.unit_price, lineTotal: r.line_total, condition: r.condition, reason: r.reason }));
  const total = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM refunds WHERE return_id = ? AND status = 'COMPLETED'`).get(id).a;
  return { id: row.id, saleId: row.sale_id, status: row.status, createdAt: row.created_at, items, total, refundedAmount: refunded, refundableRemaining: round2(total - refunded) };
}

function listReturns(db, session) {
  return db.prepare(`SELECT id FROM returns WHERE business_id = ? ORDER BY created_at DESC`).all(session.businessId)
    .map((r) => getReturn(db, session, r.id));
}

module.exports = { createReturn, getReturn, listReturns };

'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');

// Creates a batch from a received purchase and records the PURCHASE movement.
// FR-REC-001 / FR-INV-001
function createReceivingBatch(db, { businessId, productId, purchaseItemId, quantityReceived, unitCost, receivedAt, actorId }) {
  const batchId = nextId('bat');
  const batchNumber = batchId.toUpperCase();
  db.prepare(`
    INSERT INTO inventory_batches
      (id, business_id, product_id, purchase_item_id, batch_number, quantity_received, quantity_remaining, unit_cost, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, businessId, productId, purchaseItemId, batchNumber, quantityReceived, quantityReceived, unitCost, receivedAt);

  db.prepare(`
    INSERT INTO inventory_movements
      (id, business_id, product_id, batch_id, type, quantity, reference_type, reference_id, actor_id, created_at)
    VALUES (?, ?, ?, ?, 'PURCHASE', ?, 'purchase_item', ?, ?, ?)
  `).run(nextId('mov'), businessId, productId, batchId, quantityReceived, purchaseItemId, actorId || null, now());

  return { batchId, batchNumber, quantityReceived, unitCost };
}

// FR-INV-001 (source of truth), FR-INV-003 (no negative stock)
function getCurrentStock(db, businessId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity_remaining), 0) as stock
    FROM inventory_batches WHERE business_id = ? AND product_id = ?
  `).get(businessId, productId);
  return row.stock;
}

// FR-FIFO-001 — allocate `quantity` units from the oldest batches first.
// Used by Sales (consumption), Damage, Loss, and Adjustment-Out.
// Returns { allocations: [{batchId, quantity, unitCost}], totalCost }.
// Throws INSUFFICIENT_STOCK / NEGATIVE_STOCK_BLOCKED before mutating anything
// if the requested quantity exceeds what is actually available.
function consumeFifo(db, { businessId, productId, quantity, movementType, referenceType, referenceId, actorId }) {
  if (quantity <= 0) throw new ApiError('VALIDATION_ERROR', 'Quantity to consume must be positive');

  const available = getCurrentStock(db, businessId, productId);
  if (available < quantity) {
    const code = movementType === 'SALE' ? 'INSUFFICIENT_STOCK' : 'NEGATIVE_STOCK_BLOCKED';
    throw new ApiError(code, `Requested ${quantity} but only ${available} remaining for this product`);
  }

  const batches = db.prepare(`
    SELECT * FROM inventory_batches
    WHERE business_id = ? AND product_id = ? AND quantity_remaining > 0
    ORDER BY received_at ASC, id ASC
  `).all(businessId, productId);

  let remainingToAllocate = quantity;
  const allocations = [];
  let totalCost = 0;
  const ts = now();

  for (const batch of batches) {
    if (remainingToAllocate <= 0) break;
    const take = Math.min(batch.quantity_remaining, remainingToAllocate);
    if (take <= 0) continue;

    db.prepare(`UPDATE inventory_batches SET quantity_remaining = quantity_remaining - ? WHERE id = ?`)
      .run(take, batch.id);

    db.prepare(`
      INSERT INTO inventory_movements
        (id, business_id, product_id, batch_id, type, quantity, reference_type, reference_id, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nextId('mov'), businessId, productId, batch.id, movementType, take, referenceType || null, referenceId || null, actorId || null, ts);

    allocations.push({ batchId: batch.id, quantity: take, unitCost: batch.unit_cost });
    totalCost += take * batch.unit_cost;
    remainingToAllocate -= take;
  }

  if (remainingToAllocate > 0) {
    // Should be unreachable given the availability check above; guards against a race.
    throw new ApiError('INSUFFICIENT_STOCK', 'Stock changed during allocation — please retry');
  }

  return { allocations, totalCost };
}

// FR-INV-001 (ADJUSTMENT_IN / CUSTOMER_RETURN / SUPPLIER credit) — creates a
// new lot rather than editing an existing batch, preserving cost traceability.
function addStock(db, { businessId, productId, quantity, unitCost, movementType, referenceType, referenceId, actorId }) {
  if (quantity <= 0) throw new ApiError('VALIDATION_ERROR', 'Quantity to add must be positive');
  const batchId = nextId('bat');
  db.prepare(`
    INSERT INTO inventory_batches
      (id, business_id, product_id, purchase_item_id, batch_number, quantity_received, quantity_remaining, unit_cost, received_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(batchId, businessId, productId, batchId.toUpperCase(), quantity, quantity, unitCost || 0, now());

  db.prepare(`
    INSERT INTO inventory_movements
      (id, business_id, product_id, batch_id, type, quantity, reference_type, reference_id, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nextId('mov'), businessId, productId, batchId, movementType, quantity, referenceType || null, referenceId || null, actorId || null, now());

  return { batchId, quantity, unitCost: unitCost || 0 };
}

function listMovements(db, session, { productId, limit } = {}) {
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  if (productId) { clauses.push('product_id = ?'); args.push(productId); }
  // The ledger only grows: cap the read (default 500, max 2000, newest first).
  const cap = limit === undefined ? 500 : Number(limit);
  if (!Number.isInteger(cap) || cap < 1 || cap > 2000) throw new ApiError('VALIDATION_ERROR', 'limit must be an integer between 1 and 2000');
  return db.prepare(`SELECT * FROM inventory_movements WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${cap}`).all(...args)
    .map((r) => ({
      id: r.id, productId: r.product_id, batchId: r.batch_id, type: r.type,
      quantity: r.quantity, referenceType: r.reference_type, referenceId: r.reference_id,
      actorId: r.actor_id, createdAt: r.created_at,
    }));
}

// FR-INV-002 — stock age is purely a time-since-receipt metric. It is
// never combined with a profit/loss figure here (see Business Rule 7).
function computeAging(db, session, { productId } = {}) {
  const clauses = ['business_id = ?', 'quantity_remaining > 0'];
  const args = [session.businessId];
  if (productId) { clauses.push('product_id = ?'); args.push(productId); }
  const rows = db.prepare(`SELECT * FROM inventory_batches WHERE ${clauses.join(' AND ')} ORDER BY received_at ASC`).all(...args);
  const nowMs = Date.now();
  return rows.map((b) => {
    const item = {
      batchId: b.id, productId: b.product_id, receivedAt: b.received_at,
      quantityRemaining: b.quantity_remaining,
      ageDays: Math.floor((nowMs - new Date(b.received_at).getTime()) / 86400000),
    };
    if (session.role !== 'Cashier') item.unitCost = b.unit_cost;
    return item;
  });
}

// FR-SUPRET-001 — send stock back to a supplier. The original purchase row
// is left historically intact; this only adds a ledger movement + a
// dedicated record for traceability.
function createSupplierReturn(db, { businessId, purchaseId, productId, quantity, reason, actorId }) {
  const { nextId, now } = require('../../lib/ids');
  const result = consumeFifo(db, {
    businessId, productId, quantity, movementType: 'SUPPLIER_RETURN',
    referenceType: 'purchase', referenceId: purchaseId, actorId,
  });
  const id = nextId('spr');
  db.prepare(`
    INSERT INTO supplier_returns (id, business_id, purchase_id, product_id, quantity, reason, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, businessId, purchaseId, productId, quantity, reason || null, actorId || null, now());
  return { id, purchaseId, productId, quantity, totalCost: result.totalCost };
}

// FR-ADJ-001 — Damage and Loss reduce inventory and have a cost impact, but
// never create sales revenue. ADJUSTMENT_IN/OUT handle manual stock-count
// corrections. Every adjustment is reason + actor + timestamp, never silent.
function createStockAdjustment(db, { businessId, productId, type, quantity, unitCost, reason, actorId }) {
  const { nextId, now } = require('../../lib/ids');
  const id = nextId('adj');
  let costImpact = 0;

  if (type === 'ADJUSTMENT_IN') {
    const added = addStock(db, { businessId, productId, quantity, unitCost: unitCost || 0, movementType: 'ADJUSTMENT_IN', referenceType: 'adjustment', referenceId: id, actorId });
    costImpact = added.quantity * added.unitCost;
  } else {
    // DAMAGE, LOSS, ADJUSTMENT_OUT all consume stock FIFO-first, same as a sale would.
    const result = consumeFifo(db, { businessId, productId, quantity, movementType: type, referenceType: 'adjustment', referenceId: id, actorId });
    costImpact = result.totalCost;
  }

  db.prepare(`
    INSERT INTO stock_adjustments (id, business_id, product_id, type, quantity, reason, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, businessId, productId, type, quantity, reason || null, actorId || null, now());

  return { id, productId, type, quantity, costImpact };
}

module.exports = {
  createReceivingBatch, getCurrentStock, consumeFifo, addStock, listMovements, computeAging,
  createSupplierReturn, createStockAdjustment,
};

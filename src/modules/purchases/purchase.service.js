'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const inventory = require('../inventory/inventory.service');

// FR-PUR-001 — a draft purchase never touches inventory.
function createPurchase(db, session, { supplierId, items }) {
  const supplier = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplierId);
  assertOwnedByBusiness(supplier, session, 'Supplier');
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'items must be a non-empty array');
  }

  return withTransaction(db, () => {
    const purchaseId = nextId('pur');
    const purchaseNumber = purchaseId.toUpperCase();

    // Parent row first (purchase_items has a FK to purchases); totals are
    // filled in once the validated line items are known.
    db.prepare(`
      INSERT INTO purchases (id, business_id, supplier_id, purchase_number, status, subtotal, total, created_by, created_at)
      VALUES (?, ?, ?, ?, 'draft', 0, 0, ?, ?)
    `).run(purchaseId, session.businessId, supplierId, purchaseNumber, session.userId, now());

    let subtotal = 0;
    const itemRows = [];

    for (const it of items) {
      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(it.productId);
      assertOwnedByBusiness(product, session, 'Product');
      if (!(it.quantity > 0)) throw new ApiError('VALIDATION_ERROR', 'Each item quantity must be > 0');
      if (!(it.unitCost >= 0)) throw new ApiError('VALIDATION_ERROR', 'Each item unitCost must be >= 0');
      subtotal += it.quantity * it.unitCost;
      const itemId = nextId('pit');
      db.prepare(`
        INSERT INTO purchase_items (id, purchase_id, product_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?, ?)
      `).run(itemId, purchaseId, it.productId, it.quantity, it.unitCost);
      itemRows.push({ id: itemId, productId: it.productId, quantity: it.quantity, unitCost: it.unitCost });
    }

    db.prepare(`UPDATE purchases SET subtotal = ?, total = ? WHERE id = ?`).run(subtotal, subtotal, purchaseId);

    writeAudit(db, {
      businessId: session.businessId, actorId: session.userId,
      action: 'CREATE', resource: 'purchase', resourceId: purchaseId, newState: { supplierId, items: itemRows, subtotal },
    });

    return getPurchase(db, session, purchaseId);
  });
}

function getPurchase(db, session, id) {
  const row = db.prepare(`SELECT * FROM purchases WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Purchase');
  const items = db.prepare(`SELECT * FROM purchase_items WHERE purchase_id = ?`).all(id);
  return {
    id: row.id, supplierId: row.supplier_id, purchaseNumber: row.purchase_number,
    status: row.status, subtotal: row.subtotal, total: row.total,
    createdAt: row.created_at, receivedAt: row.received_at,
    items: items.map((it) => ({ id: it.id, productId: it.product_id, quantity: it.quantity, unitCost: it.unit_cost })),
  };
}

function listPurchases(db, session) {
  return db.prepare(`SELECT id FROM purchases WHERE business_id = ? ORDER BY created_at DESC`)
    .all(session.businessId)
    .map((r) => getPurchase(db, session, r.id));
}

// FR-REC-001 — atomic: validate -> create batches -> movements -> mark received -> audit -> commit.
// Any failure rolls back the entire operation. Idempotent via operationId.
function receivePurchase(db, session, purchaseId, { operationId } = {}) {
  return withTransaction(db, () => {
    const purchase = db.prepare(`SELECT * FROM purchases WHERE id = ?`).get(purchaseId);
    assertOwnedByBusiness(purchase, session, 'Purchase');

    if (purchase.status === 'received') {
      // Idempotent replay: if this exact operationId already did the receiving, return calmly.
      const already = operationId && db.prepare(`
        SELECT * FROM audit_logs WHERE resource_id = ? AND action = 'RECEIVE' AND new_state LIKE ?
      `).get(purchaseId, `%${operationId}%`);
      if (already) return getPurchase(db, session, purchaseId);
      throw new ApiError('PURCHASE_ALREADY_RECEIVED', `Purchase ${purchaseId} has already been received`);
    }

    const items = db.prepare(`SELECT * FROM purchase_items WHERE purchase_id = ?`).all(purchaseId);
    const batches = [];
    for (const item of items) {
      const batch = inventory.createReceivingBatch(db, {
        businessId: session.businessId,
        productId: item.product_id,
        purchaseItemId: item.id,
        quantityReceived: item.quantity,
        unitCost: item.unit_cost,
        receivedAt: now(),
        actorId: session.userId,
      });
      batches.push(batch);
    }

    db.prepare(`UPDATE purchases SET status = 'received', received_at = ? WHERE id = ?`).run(now(), purchaseId);

    writeAudit(db, {
      businessId: session.businessId, actorId: session.userId,
      action: 'RECEIVE', resource: 'purchase', resourceId: purchaseId,
      newState: { batches, operationId: operationId || null },
    });

    return getPurchase(db, session, purchaseId);
  });
}

module.exports = { createPurchase, getPurchase, listPurchases, receivePurchase };

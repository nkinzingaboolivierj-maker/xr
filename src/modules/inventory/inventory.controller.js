'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const inventoryService = require('./inventory.service');

function movements(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.read');
    return { status: 200, body: { success: true, data: inventoryService.listMovements(db, session, ctx.query) } };
  };
}

function aging(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.read');
    return { status: 200, body: { success: true, data: inventoryService.computeAging(db, session, ctx.query) } };
  };
}

function currentStock(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.read');
    const stock = inventoryService.getCurrentStock(db, session.businessId, ctx.params.productId);
    return { status: 200, body: { success: true, data: { productId: ctx.params.productId, stock } } };
  };
}

function supplierReturn(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.adjust');
    const { purchaseId, productId, quantity, reason } = ctx.body || {};
    if (!purchaseId || !productId || !(Number(quantity) > 0)) {
      throw new ApiError('VALIDATION_ERROR', 'purchaseId, productId, and a positive quantity are required');
    }
    const purchase = db.prepare(`SELECT * FROM purchases WHERE id = ?`).get(purchaseId);
    assertOwnedByBusiness(purchase, session, 'Purchase');
    const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
    assertOwnedByBusiness(product, session, 'Product');

    const result = withTransaction(db, () => {
      const r = inventoryService.createSupplierReturn(db, { businessId: session.businessId, purchaseId, productId, quantity: Number(quantity), reason, actorId: session.userId });
      writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'CREATE', resource: 'supplier_return', resourceId: r.id, newState: r });
      return r;
    });
    return { status: 201, body: { success: true, data: result } };
  };
}

function adjustment(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.adjust');
    const { productId, type, quantity, unitCost, reason } = ctx.body || {};
    const validTypes = ['DAMAGE', 'LOSS', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'];
    if (!productId || !validTypes.includes(type) || !(Number(quantity) > 0)) {
      throw new ApiError('VALIDATION_ERROR', `productId, a positive quantity, and type (one of ${validTypes.join(', ')}) are required`);
    }
    if (!reason) throw new ApiError('VALIDATION_ERROR', 'reason is required for any stock adjustment');
    const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
    assertOwnedByBusiness(product, session, 'Product');

    const result = withTransaction(db, () => {
      const r = inventoryService.createStockAdjustment(db, { businessId: session.businessId, productId, type, quantity: Number(quantity), unitCost, reason, actorId: session.userId });
      writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: type, resource: 'stock_adjustment', resourceId: r.id, newState: r });
      return r;
    });
    return { status: 201, body: { success: true, data: result } };
  };
}

module.exports = { movements, aging, currentStock, supplierReturn, adjustment };

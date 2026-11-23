'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const purchaseService = require('./purchase.service');

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'purchase.read');
    return { status: 200, body: { success: true, data: purchaseService.listPurchases(db, session) } };
  };
}

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'purchase.write');
    const purchase = purchaseService.createPurchase(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: purchase } };
  };
}

function receive(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'purchase.receive');
    const purchase = purchaseService.receivePurchase(db, session, ctx.params.id, ctx.body || {});
    return { status: 200, body: { success: true, data: purchase } };
  };
}

module.exports = { list, create, receive };

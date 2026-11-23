'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const refundsService = require('./refunds.service');

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'refund.write');
    const refund = refundsService.createRefund(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: refund } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'refund.read');
    return { status: 200, body: { success: true, data: refundsService.listRefunds(db, session) } };
  };
}

module.exports = { create, list };

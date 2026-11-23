'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const reportsService = require('./reports.service');

function sales(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'finance.read');
    return { status: 200, body: { success: true, ...reportsService.getSalesReport(db, session, ctx.query) } };
  };
}

function purchases(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'purchase.read');
    return { status: 200, body: { success: true, ...reportsService.getPurchasesReport(db, session, ctx.query) } };
  };
}

function inventory(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'inventory.read');
    return { status: 200, body: { success: true, ...reportsService.getInventoryReport(db, session) } };
  };
}

function returns(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'return.read');
    return { status: 200, body: { success: true, ...reportsService.getReturnsReport(db, session, ctx.query) } };
  };
}

module.exports = { sales, purchases, inventory, returns };

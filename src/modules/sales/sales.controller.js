'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const salesService = require('./sales.service');

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.write');
    const sale = salesService.createSale(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: sale } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    const result = salesService.listSales(db, session, ctx.query);
    return { status: 200, body: { success: true, data: result.data, meta: { page: result.page, pageSize: result.pageSize, total: result.total } } };
  };
}

function get(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    const sale = salesService.getSale(db, session, ctx.params.id);
    return { status: 200, body: { success: true, data: sale } };
  };
}

function confirmPayment(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.write');
    const sale = salesService.confirmPayment(db, session, ctx.params.id, ctx.body || {});
    return { status: 200, body: { success: true, data: sale } };
  };
}

module.exports = { create, list, get, confirmPayment };

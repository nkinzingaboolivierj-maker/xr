'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const customerService = require('./customer.service');

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'customer.read');
    return { status: 200, body: { success: true, data: customerService.listCustomers(db, session) } };
  };
}

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'customer.write');
    const customer = customerService.createCustomer(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: customer } };
  };
}

module.exports = { list, create };

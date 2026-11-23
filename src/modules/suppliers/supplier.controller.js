'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const supplierService = require('./supplier.service');

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'supplier.read');
    return { status: 200, body: { success: true, data: supplierService.listSuppliers(db, session) } };
  };
}

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'supplier.write');
    const supplier = supplierService.createSupplier(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: supplier } };
  };
}

module.exports = { list, create };

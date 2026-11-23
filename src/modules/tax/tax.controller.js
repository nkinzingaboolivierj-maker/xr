'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const taxService = require('./tax.service');

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'tax.write');
    const cfg = taxService.createTaxConfig(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: cfg } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'tax.read');
    return { status: 200, body: { success: true, data: taxService.listTaxConfigs(db, session) } };
  };
}

module.exports = { create, list };

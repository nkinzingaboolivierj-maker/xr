'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const returnsService = require('./returns.service');

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'return.write');
    const ret = returnsService.createReturn(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: ret } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'return.read');
    return { status: 200, body: { success: true, data: returnsService.listReturns(db, session) } };
  };
}

function get(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'return.read');
    return { status: 200, body: { success: true, data: returnsService.getReturn(db, session, ctx.params.id) } };
  };
}

module.exports = { create, list, get };

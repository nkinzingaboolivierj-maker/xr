'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const userService = require('./user.service');

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'user.read');
    return { status: 200, body: { success: true, data: userService.listUsers(db, session) } };
  };
}
function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'user.write');
    return { status: 201, body: { success: true, data: userService.createStaff(db, session, ctx.body || {}) } };
  };
}
function update(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'user.write');
    return { status: 200, body: { success: true, data: userService.updateStaff(db, session, ctx.params.id, ctx.body || {}) } };
  };
}
function resetPassword(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'user.write');
    return { status: 200, body: { success: true, data: userService.resetPassword(db, session, ctx.params.id, ctx.body || {}) } };
  };
}

module.exports = { list, create, update, resetPassword };

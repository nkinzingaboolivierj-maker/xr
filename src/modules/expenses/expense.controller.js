'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const expenseService = require('./expense.service');

function create(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'expense.write');
    const expense = expenseService.createExpense(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: expense } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'expense.read');
    return { status: 200, body: { success: true, data: expenseService.listExpenses(db, session, ctx.query) } };
  };
}

module.exports = { create, list };

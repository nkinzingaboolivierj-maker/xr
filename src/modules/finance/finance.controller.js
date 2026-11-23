'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const financeService = require('./finance.service');

function summary(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'finance.read');
    return { status: 200, body: { success: true, data: financeService.getSummary(db, session, ctx.query) } };
  };
}

module.exports = { summary };

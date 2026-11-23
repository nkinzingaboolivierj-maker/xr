'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const analyticsService = require('./analytics.service');

function velocity(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'finance.read');
    return { status: 200, body: { success: true, data: analyticsService.getVelocity(db, session, ctx.query) } };
  };
}

function demandTrend(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'finance.read');
    return { status: 200, body: { success: true, data: analyticsService.getDemandTrend(db, session, ctx.query) } };
  };
}

function productPerformance(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'finance.read');
    return { status: 200, body: { success: true, data: analyticsService.getProductPerformance(db, session, ctx.query) } };
  };
}

module.exports = { velocity, demandTrend, productPerformance };

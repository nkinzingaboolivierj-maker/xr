'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const paymentService = require('./payment.service');

function initiate(db) {
  return async (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.write');
    const intent = await paymentService.initiatePaymentIntent(db, session, ctx.body || {});
    return { status: 201, body: { success: true, data: intent } };
  };
}

function get(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.read');
    return { status: 200, body: { success: true, data: paymentService.getPaymentIntent(db, session, ctx.params.id) } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.read');
    return { status: 200, body: { success: true, data: paymentService.listPaymentIntents(db, session, ctx.query) } };
  };
}

function attachSale(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.write');
    const { saleId } = ctx.body || {};
    const result = paymentService.attachToSale(db, session, ctx.params.id, saleId);
    return { status: 200, body: { success: true, data: result } };
  };
}

function unreconciled(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'payment.reconcile');
    return { status: 200, body: { success: true, data: paymentService.listUnreconciled(db, session) } };
  };
}

// Deliberately unauthenticated — a real payment provider calls this
// directly, not as one of our logged-in users, and has no bearer token to
// present. Trust comes from the HMAC signature instead (verified first,
// inside handleWebhook, before any business logic runs).
function webhook(db) {
  return (ctx) => {
    const providerName = ctx.params.provider;
    const signature = ctx.req.headers['x-webhook-signature'] || '';
    const result = paymentService.handleWebhook(db, { providerName, rawBody: ctx.rawBody, signature, body: ctx.body });
    return { status: 200, body: { success: true, data: result } };
  };
}

module.exports = { initiate, get, list, attachSale, unreconciled, webhook };

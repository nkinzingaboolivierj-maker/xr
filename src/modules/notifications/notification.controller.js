'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const notificationService = require('./notification.service');

function sendReceipt(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    const notif = notificationService.queueReceiptForSale(db, session, ctx.params.saleId, ctx.body || {});
    return { status: 202, body: { success: true, data: notif } };
  };
}

function get(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    return { status: 200, body: { success: true, data: notificationService.getNotification(db, session, ctx.params.id) } };
  };
}

function list(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    return { status: 200, body: { success: true, data: notificationService.listNotifications(db, session, ctx.query) } };
  };
}

function updateSettings(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'business.settings.write');
    const result = notificationService.updateWhatsAppSettings(db, session, ctx.body || {});
    return { status: 200, body: { success: true, data: result } };
  };
}

module.exports = { sendReceipt, get, list, updateSettings };

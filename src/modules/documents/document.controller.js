'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const documentService = require('./document.service');
const { buildReceiptPdf } = require('./receipt.pdf');

function receipt(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    const receiptData = documentService.getReceipt(db, session, ctx.params.saleId);

    if (ctx.query.format === 'text') {
      const text = documentService.renderPlainText(receiptData);
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) });
      ctx.res.end(text);
      return { __handled: true };
    }

    return { status: 200, body: { success: true, data: receiptData } };
  };
}

function receiptPdf(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'sale.read');
    const data = documentService.getReceipt(db, session, ctx.params.saleId);
    const buffer = buildReceiptPdf(data);
    const safeName = String(data.receiptNumber).replace(/[^A-Za-z0-9_-]/g, '');
    return { binary: { contentType: 'application/pdf', buffer, headers: { 'Content-Disposition': `inline; filename="receipt-${safeName}.pdf"` } } };
  };
}

module.exports = { receipt, receiptPdf };

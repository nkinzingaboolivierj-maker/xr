'use strict';
const { ApiError } = require('../../lib/errors');
const { assertOwnedByBusiness } = require('../business/tenant');
const salesService = require('../sales/sales.service');

// FR-DOC-001 — the receipt is a REPRESENTATION of the transaction, built
// entirely from values already snapshotted on the sale (product_name,
// unit_price at time of sale). It never re-reads the current product/price
// tables for display — that would let a later price change silently rewrite
// a historical receipt (Business Rule #14).
//
// Renditions: structured JSON, plain text (receipt printer), and a real PDF
// (receipt.pdf.js -- a small dependency-free writer, verified by extracting
// its text back out with pdftotext in the test suite).

function getReceipt(db, session, saleId) {
  const sale = salesService.getSale(db, session, saleId); // already tenant-checked inside
  const business = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(session.businessId);
  const customer = sale.customerId ? db.prepare(`SELECT * FROM customers WHERE id = ?`).get(sale.customerId) : null;
  const servedBy = sale.createdBy ? null : null; // reserved: cashier display name is not modelled yet

  const receipt = {
    receiptNumber: sale.id,
    issuedAt: sale.createdAt,
    currency: business.currency,
    business: { name: business.name, phone: business.phone || null, address: business.address || null, taxId: business.tax_id || null },
    customer: customer ? { name: customer.name, phone: customer.phone } : { name: 'Walk-in Customer' },
    items: sale.items.map((it) => ({
      productName: it.productName, quantity: it.quantity, unitPrice: it.unitPrice,
      lineDiscountAmount: it.lineDiscountAmount, lineTotal: it.lineTotal,
    })),
    subtotal: sale.subtotal,
    discountAmount: sale.discountAmount,
    taxableAmount: sale.taxableAmount,
    taxRate: sale.taxRate,
    taxAmount: sale.taxAmount,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    cashReceived: sale.cashReceived,
    changeDue: sale.changeDue,
    paymentStatus: sale.payment ? sale.payment.status : null,
    paymentConfirmation: sale.payment ? sale.payment.confirmation : null,
    paymentReference: sale.payment ? sale.payment.reference : null,
    servedBy,
  };

  return receipt;
}

function money(n, currency) {
  const v = Number(n);
  const txt = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${txt} ${currency}` : txt;
}

function renderPlainText(receipt) {
  const line = (s = '') => s + '\n';
  const divider = '--------------------------------';
  const cur = receipt.currency;
  let out = '';
  out += line(receipt.business.name);
  if (receipt.business.address) out += line(receipt.business.address);
  if (receipt.business.phone) out += line(`Tel: ${receipt.business.phone}`);
  if (receipt.business.taxId) out += line(`TIN: ${receipt.business.taxId}`);
  out += line(divider);
  out += line(`Receipt: ${receipt.receiptNumber}`);
  out += line(`Date: ${receipt.issuedAt}`);
  out += line(`Customer: ${receipt.customer.name}`);
  out += line(divider);
  for (const it of receipt.items) {
    out += line(`${it.productName}`);
    out += line(`  ${it.quantity} x ${it.unitPrice} = ${it.lineTotal}`);
    if (it.lineDiscountAmount) out += line(`  discount -${it.lineDiscountAmount}`);
  }
  out += line(divider);
  out += line(`Subtotal: ${money(receipt.subtotal)}`);
  if (receipt.discountAmount) out += line(`Discount: -${money(receipt.discountAmount)}`);
  if (receipt.taxRate) out += line(`Tax ${receipt.taxRate}%: ${money(receipt.taxAmount)}`);
  out += line(`TOTAL: ${receipt.total}`);
  out += line(`Payment: ${receipt.paymentMethod}${receipt.paymentStatus ? ' (' + receipt.paymentStatus + ')' : ''}`);
  if (receipt.paymentReference) out += line(`Ref: ${receipt.paymentReference}`);
  if (receipt.paymentMethod === 'Cash') {
    out += line(`Cash received: ${receipt.cashReceived}`);
    out += line(`Change: ${receipt.changeDue}`);
  }
  out += line(divider);
  out += line('Thank you!');
  return out;
}

module.exports = { getReceipt, renderPlainText, money };

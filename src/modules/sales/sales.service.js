'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { assertOwnedByBusiness } = require('../business/tenant');
const { requirePermission } = require('../rbac/rbac');
const productService = require('../products/product.service');
const inventory = require('../inventory/inventory.service');
const taxService = require('../tax/tax.service');
const paymentService = require('../payments/payment.service');
const { parsePaging } = require('../../lib/paging');

function round2(n) { return Math.round(n * 100) / 100; }

function computeDiscountAmount(discount, base) {
  if (!discount) return 0;
  const value = Number(discount.value);
  if (Number.isNaN(value) || value < 0) throw new ApiError('VALIDATION_ERROR', 'Discount value must be a non-negative number');
  if (discount.type === 'percent') {
    if (value > 100) throw new ApiError('VALIDATION_ERROR', 'Percent discount cannot exceed 100');
    return round2(base * (value / 100));
  }
  if (discount.type === 'fixed') {
    return round2(value);
  }
  throw new ApiError('VALIDATION_ERROR', "Discount type must be 'percent' or 'fixed'");
}

function requestHasAnyDiscount(items, saleDiscount) {
  if (saleDiscount && Number(saleDiscount.value) > 0) return true;
  return items.some((it) => it.discount && Number(it.discount.value) > 0);
}

// FR-POS-001 / FR-POS-002 / FR-FIFO-001 / FR-PAY-001 / FR-PAY-002 / Tax /
// Discounts / Price Overrides (Phase 3)
//
// Pipeline: Subtotal -> line discounts -> sale discount -> Tax -> Total.
// Every monetary figure is computed here, server-side, from data just
// re-read from the database -- the client's unitPrice/discount are
// PROPOSALS, validated and recalculated, never trusted as final.
function createSale(db, session, { operationId, customerId, items, paymentMethod, cashReceived, discount: saleDiscount, paymentIntentId, paymentReference }) {
  if (!operationId) throw new ApiError('VALIDATION_ERROR', 'operationId is required (idempotency key)');
  if (!Array.isArray(items) || items.length === 0) throw new ApiError('VALIDATION_ERROR', 'items must be a non-empty array');
  const validMethods = ['Cash', 'MobileMoney', 'Bank', 'Card', 'Other'];
  if (!validMethods.includes(paymentMethod)) throw new ApiError('VALIDATION_ERROR', `paymentMethod must be one of ${validMethods.join(', ')}`);

  // Any non-zero discount anywhere in the request requires explicit
  // authority -- checked up front so an unauthorized Cashier request fails
  // fast, before any stock is touched.
  if (requestHasAnyDiscount(items, saleDiscount)) {
    requirePermission(session, 'sale.discount');
  }

  const existing = db.prepare(`SELECT id FROM sales WHERE business_id = ? AND operation_id = ?`).get(session.businessId, operationId);
  if (existing) return getSale(db, session, existing.id);

  if (customerId) {
    const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId);
    assertOwnedByBusiness(customer, session, 'Customer');
  }

  return withTransaction(db, () => {
    const existingInTx = db.prepare(`SELECT id FROM sales WHERE business_id = ? AND operation_id = ?`).get(session.businessId, operationId);
    if (existingInTx) return getSale(db, session, existingInTx.id);

    const saleId = nextId('sal');

    db.prepare(`
      INSERT INTO sales
        (id, business_id, customer_id, operation_id, status, subtotal, discount_amount, taxable_amount, tax_rate, tax_amount, total, cogs, payment_method, cash_received, change_due, created_by, created_at)
      VALUES (?, ?, ?, ?, 'completed', 0, 0, 0, 0, 0, 0, 0, ?, NULL, NULL, ?, ?)
    `).run(saleId, session.businessId, customerId || null, operationId, paymentMethod, session.userId, now());

    let grossSubtotal = 0;
    let lineDiscountTotal = 0;
    let cogs = 0;
    const itemRows = [];

    for (const it of items) {
      if (!it || typeof it.productId !== 'string' || !it.productId) throw new ApiError('VALIDATION_ERROR', 'Each item needs a productId');
      if (!(Number.isFinite(Number(it.quantity)) && Number(it.quantity) > 0)) throw new ApiError('VALIDATION_ERROR', 'Each item quantity must be a finite number > 0');
      if (it.unitPrice !== undefined && !(Number.isFinite(Number(it.unitPrice)) && Number(it.unitPrice) >= 0)) {
        throw new ApiError('VALIDATION_ERROR', 'unitPrice must be a finite number >= 0');
      }

      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(it.productId);
      assertOwnedByBusiness(product, session, 'Product');

      const pricing = db.prepare(`SELECT * FROM product_pricing WHERE product_id = ?`).get(it.productId);
      if (!pricing) throw new ApiError('VALIDATION_ERROR', `Product ${it.productId} has no pricing configured`);

      const proposedPrice = it.unitPrice !== undefined ? Number(it.unitPrice) : pricing.recommended_price;
      let finalPrice = proposedPrice;

      try {
        productService.validateSalePrice(db, session, it.productId, proposedPrice);
      } catch (err) {
        if (!(err instanceof ApiError) || !['PRICE_BELOW_MINIMUM', 'PRICE_ABOVE_MAXIMUM'].includes(err.code)) throw err;

        // Price Override path -- only taken if the request explicitly asked
        // for one AND the session holds the matching permission. Otherwise
        // the original PRICE_BELOW_MINIMUM/PRICE_ABOVE_MAXIMUM stands.
        if (!it.priceOverride || !it.priceOverride.reason) throw err;
        const isBelowMin = err.code === 'PRICE_BELOW_MINIMUM';
        const neededPermission = isBelowMin ? 'price.override.below_min' : 'price.override.above_max';
        const permissionUsedLabel = isBelowMin ? 'PRICE_OVERRIDE_BELOW_MIN' : 'PRICE_OVERRIDE_ABOVE_MAX';
        requirePermission(session, neededPermission); // throws PERMISSION_DENIED if the role lacks it -- override denied, not silently granted

        finalPrice = proposedPrice; // explicitly authorized outside the band
        db.prepare(`
          INSERT INTO price_overrides (id, business_id, sale_id, product_id, standard_price, min_price, max_price, requested_price, final_price, reason, permission_used, requested_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nextId('povr'), session.businessId, saleId, it.productId, pricing.recommended_price, pricing.min_price, pricing.max_price, proposedPrice, finalPrice, it.priceOverride.reason, permissionUsedLabel, session.userId, now());
      }

      const allocation = inventory.consumeFifo(db, {
        businessId: session.businessId, productId: it.productId, quantity: Number(it.quantity),
        movementType: 'SALE', referenceType: 'sale', referenceId: saleId, actorId: session.userId,
      });

      const lineGross = round2(finalPrice * Number(it.quantity));
      const lineDiscountAmount = computeDiscountAmount(it.discount, lineGross);
      if (lineDiscountAmount > lineGross) throw new ApiError('VALIDATION_ERROR', `Line discount (${lineDiscountAmount}) cannot exceed the line amount (${lineGross})`);
      const lineTotal = round2(lineGross - lineDiscountAmount);

      grossSubtotal = round2(grossSubtotal + lineGross);
      lineDiscountTotal = round2(lineDiscountTotal + lineDiscountAmount);
      cogs = round2(cogs + allocation.totalCost);

      const saleItemId = nextId('sit');
      db.prepare(`
        INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, line_discount_amount, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(saleItemId, saleId, it.productId, product.name, Number(it.quantity), finalPrice, lineDiscountAmount, lineTotal);

      for (const a of allocation.allocations) {
        db.prepare(`INSERT INTO sale_item_batches (id, sale_item_id, batch_id, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)`)
          .run(nextId('sib'), saleItemId, a.batchId, a.quantity, a.unitCost);
      }

      itemRows.push({ productId: it.productId, quantity: Number(it.quantity), unitPrice: finalPrice, lineDiscountAmount, lineTotal, cogs: allocation.totalCost });
    }

    const afterLineDiscounts = round2(grossSubtotal - lineDiscountTotal);
    const saleDiscountAmount = computeDiscountAmount(saleDiscount, afterLineDiscounts);
    if (saleDiscountAmount > afterLineDiscounts) throw new ApiError('VALIDATION_ERROR', `Sale discount (${saleDiscountAmount}) cannot exceed the amount remaining after line discounts (${afterLineDiscounts})`);
    const taxableAmount = round2(afterLineDiscounts - saleDiscountAmount);

    const taxRate = taxService.getActiveRate(db, session.businessId, now());
    const taxAmount = round2(taxableAmount * (taxRate / 100));
    const total = round2(taxableAmount + taxAmount);
    const totalDiscount = round2(lineDiscountTotal + saleDiscountAmount);

    let cashReceivedVal = null;
    let changeDue = null;
    let paymentStatus;
    let confirmation = null;
    let reference = null;
    let intent = null;

    if (paymentMethod === 'Cash') {
      cashReceivedVal = Number(cashReceived);
      if (Number.isNaN(cashReceivedVal) || cashReceivedVal < total) {
        throw new ApiError('CASH_RECEIVED_INSUFFICIENT', `Cash received (${cashReceivedVal}) is less than the amount due (${total})`);
      }
      changeDue = round2(cashReceivedVal - total);
      paymentStatus = 'SUCCESS';
      confirmation = 'CASH';
    } else {
      // Non-cash: payment status is NEVER taken from the client's say-so alone.
      //  - paymentIntentId -> settled below against a provider-confirmed intent
      //  - paymentReference -> a staff-recorded MANUAL confirmation (e.g. the
      //    Mobile Money transaction id read from the confirmation SMS), audited
      //  - neither -> stays PENDING until confirmed
      // A business may forbid the manual path (requireVerifiedPayments).
      const biz = db.prepare(`SELECT require_verified_payments FROM businesses WHERE id = ?`).get(session.businessId);
      if (paymentIntentId) {
        intent = db.prepare(`SELECT * FROM payment_intents WHERE id = ?`).get(paymentIntentId);
        assertOwnedByBusiness(intent, session, 'Payment intent');
        if (intent.status !== 'SUCCESS') throw new ApiError('PAYMENT_NOT_VERIFIED', `Payment intent is ${intent.status}, not SUCCESS: the provider has not confirmed this payment`);
        paymentStatus = 'PENDING'; // flipped to SUCCESS by settleSaleWithIntent after amount/currency/method checks
      } else if (biz.require_verified_payments) {
        throw new ApiError('PAYMENT_NOT_VERIFIED', 'This business requires a provider-verified payment (paymentIntentId) for non-cash sales');
      } else if (paymentReference && String(paymentReference).trim()) {
        reference = String(paymentReference).trim().slice(0, 120);
        paymentStatus = 'SUCCESS';
        confirmation = 'MANUAL';
      } else {
        paymentStatus = 'PENDING';
      }
    }

    db.prepare(`
      UPDATE sales SET subtotal = ?, discount_amount = ?, discount_reason = ?, taxable_amount = ?, tax_rate = ?, tax_amount = ?, total = ?, cogs = ?, cash_received = ?, change_due = ?
      WHERE id = ?
    `).run(grossSubtotal, totalDiscount, saleDiscount ? saleDiscount.reason || null : null, taxableAmount, taxRate, taxAmount, total, cogs, cashReceivedVal, changeDue, saleId);

    const ts = now();
    db.prepare(`
      INSERT INTO payments (id, business_id, sale_id, method, status, amount, created_at, confirmation, reference, confirmed_by, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nextId('pay'), session.businessId, saleId, paymentMethod, paymentStatus, total, ts, confirmation, reference,
      confirmation ? session.userId : null, confirmation ? ts : null);

    if (intent) {
      const saleRow = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
      paymentService.settleSaleWithIntent(db, session, saleRow, intent);
      paymentStatus = 'SUCCESS';
      confirmation = 'PROVIDER_VERIFIED';
    }

    writeAudit(db, {
      businessId: session.businessId, actorId: session.userId,
      action: 'CREATE', resource: 'sale', resourceId: saleId,
      newState: { operationId, items: itemRows, grossSubtotal, totalDiscount, taxRate, taxAmount, total, cogs, paymentMethod, paymentStatus, confirmation },
    });

    return getSale(db, session, saleId);
  });
}

function getSale(db, session, id) {
  const row = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Sale');

  const canSeeCost = session.role !== 'Cashier';
  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(id).map((it) => {
    const batches = db.prepare(`SELECT * FROM sale_item_batches WHERE sale_item_id = ?`).all(it.id);
    const item = {
      id: it.id, productId: it.product_id, productName: it.product_name, quantity: it.quantity, unitPrice: it.unit_price,
      lineDiscountAmount: it.line_discount_amount, lineTotal: it.line_total,
      batchAllocations: batches.map((b) => canSeeCost
        ? ({ batchId: b.batch_id, quantity: b.quantity, unitCost: b.unit_cost })
        : ({ batchId: b.batch_id, quantity: b.quantity })),
    };
    return item;
  });

  const payment = db.prepare(`SELECT * FROM payments WHERE sale_id = ? ORDER BY created_at DESC LIMIT 1`).get(id);
  const overrides = db.prepare(`SELECT * FROM price_overrides WHERE sale_id = ?`).all(id)
    .map((o) => ({ productId: o.product_id, standardPrice: o.standard_price, minPrice: o.min_price, maxPrice: o.max_price, finalPrice: o.final_price, reason: o.reason, permissionUsed: o.permission_used }));

  const result = {
    id: row.id, customerId: row.customer_id, operationId: row.operation_id, status: row.status,
    subtotal: row.subtotal, discountAmount: row.discount_amount, discountReason: row.discount_reason,
    taxableAmount: row.taxable_amount, taxRate: row.tax_rate, taxAmount: row.tax_amount,
    total: row.total,
    paymentMethod: row.payment_method, cashReceived: row.cash_received, changeDue: row.change_due,
    createdAt: row.created_at, items, priceOverrides: overrides,
    payment: payment ? {
      method: payment.method, status: payment.status, amount: payment.amount,
      confirmation: payment.confirmation || null, reference: payment.reference || null, confirmedAt: payment.confirmed_at || null,
    } : null,
    currency: (db.prepare(`SELECT currency FROM businesses WHERE id = ?`).get(row.business_id) || {}).currency || 'RWF',
  };
  // Cost of goods and margin are financial oversight data, not cashier data.
  // Enforce this at the API serializer; hiding a column in the browser is not security.
  if (canSeeCost) {
    result.cogs = row.cogs;
    result.grossProfit = round2(row.total - row.tax_amount - row.cogs); // collected tax is not revenue
  }
  return result;
}

function listSales(db, session, query = {}) {
  const { page, pageSize, offset } = parsePaging(query, { defaultSize: 50, maxSize: 200 });
  const rows = db.prepare(`SELECT id FROM sales WHERE business_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(session.businessId, pageSize, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM sales WHERE business_id = ?`).get(session.businessId).c;
  return { data: rows.map((r) => getSale(db, session, r.id)), page, pageSize, total };
}

// Settles a PENDING non-cash sale by a staff-recorded confirmation (e.g. the
// Mobile Money transaction id). Idempotent per reference; refused when the
// business requires provider-verified payments.
function confirmPayment(db, session, saleId, { reference } = {}) {
  const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
  assertOwnedByBusiness(sale, session, 'Sale');
  if (sale.payment_method === 'Cash') throw new ApiError('VALIDATION_ERROR', 'Cash sales are confirmed at the till and need no confirmation');
  if (!reference || !String(reference).trim()) throw new ApiError('VALIDATION_ERROR', 'reference (e.g. the Mobile Money transaction id) is required');
  const biz = db.prepare(`SELECT require_verified_payments FROM businesses WHERE id = ?`).get(session.businessId);
  if (biz.require_verified_payments) throw new ApiError('PAYMENT_NOT_VERIFIED', 'This business requires a provider-verified payment; manual confirmation is disabled');
  return withTransaction(db, () => {
    const pay = db.prepare(`SELECT * FROM payments WHERE sale_id = ? ORDER BY created_at DESC LIMIT 1`).get(saleId);
    if (!pay) throw new ApiError('NOT_FOUND', 'Payment record not found');
    if (pay.status === 'SUCCESS') return getSale(db, session, saleId); // idempotent
    const ref = String(reference).trim().slice(0, 120);
    db.prepare(`UPDATE payments SET status = 'SUCCESS', confirmation = 'MANUAL', reference = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?`)
      .run(ref, session.userId, now(), pay.id);
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'CONFIRM_PAYMENT', resource: 'sale', resourceId: saleId, oldState: { status: pay.status }, newState: { status: 'SUCCESS', confirmation: 'MANUAL', reference: ref } });
    return getSale(db, session, saleId);
  });
}

module.exports = { createSale, getSale, listSales, confirmPayment };

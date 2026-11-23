'use strict';
const { Router } = require('./lib/http');
const authController = require('./modules/auth/auth.controller');
const productController = require('./modules/products/product.controller');
const supplierController = require('./modules/suppliers/supplier.controller');
const purchaseController = require('./modules/purchases/purchase.controller');
const inventoryController = require('./modules/inventory/inventory.controller');
const customerController = require('./modules/customers/customer.controller');
const salesController = require('./modules/sales/sales.controller');
const returnsController = require('./modules/returns/returns.controller');
const refundsController = require('./modules/refunds/refunds.controller');
const expenseController = require('./modules/expenses/expense.controller');
const financeController = require('./modules/finance/finance.controller');
const documentController = require('./modules/documents/document.controller');
const analyticsController = require('./modules/analytics/analytics.controller');
const reportsController = require('./modules/reports/reports.controller');
const taxController = require('./modules/tax/tax.controller');
const gpcController = require('./modules/gpc/gpc.controller');
const notificationController = require('./modules/notifications/notification.controller');
const paymentController = require('./modules/payments/payment.controller');
const businessController = require('./modules/business/business.controller');
const userController = require('./modules/users/user.controller');
const receiptPdf = require('./modules/documents/receipt.pdf');
const pkg = require('../package.json');

function buildRouter(db) {
  const r = new Router();

  // Observability (Stage 11) — unauthenticated by design: a liveness/
  // readiness probe has no session to present, and must not need one.
  r.get('/health', () => ({ status: 200, body: { status: 'ok', version: pkg.version } }));
  r.get('/ready', () => {
    try {
      db.prepare('SELECT 1').get(); // readiness means "can actually reach the DB", not just "process is up"
      return { status: 200, body: { status: 'ready' } };
    } catch {
      // Never echo the raw driver error to an unauthenticated caller; it is logged by the probe's operator instead.
      return { status: 503, body: { status: 'not_ready' } };
    }
  });

  // Identity, business profile, user administration (Stage 12)
  r.get('/me', businessController.me(db));
  r.get('/business', businessController.getBusiness(db));
  r.patch('/business', businessController.updateBusiness(db));
  r.get('/users', userController.list(db));
  r.post('/users', userController.create(db));
  r.patch('/users/:id', userController.update(db));
  r.post('/users/:id/reset-password', userController.resetPassword(db));

  // Auth
  r.post('/auth/login', authController.login(db));
  r.post('/auth/logout', authController.logout(db));
  r.get('/auth/sessions', authController.listSessions(db));
  r.post('/auth/sessions/:id/revoke', authController.revokeSessionById(db));
  r.post('/auth/change-password', authController.changePassword(db));

  // Products & Pricing
  r.get('/products', productController.list(db));
  r.post('/products', productController.create(db));
  r.post('/products/:id/price', productController.setPrice(db));
  r.get('/products/:id/price-history', productController.priceHistory(db));
  r.post('/products/:id/classify', productController.classify(db));
  r.get('/products/lookup', productController.lookup(db));

  // Suppliers
  r.get('/suppliers', supplierController.list(db));
  r.post('/suppliers', supplierController.create(db));

  // Purchases
  r.get('/purchases', purchaseController.list(db));
  r.post('/purchases', purchaseController.create(db));
  r.post('/purchases/:id/receive', purchaseController.receive(db));

  // Inventory
  r.get('/inventory/movements', inventoryController.movements(db));
  r.get('/inventory/aging', inventoryController.aging(db));
  r.get('/inventory/stock/:productId', inventoryController.currentStock(db));
  r.post('/inventory/supplier-returns', inventoryController.supplierReturn(db));
  r.post('/inventory/adjustments', inventoryController.adjustment(db));

  // Customers (Stage 3)
  r.get('/customers', customerController.list(db));
  r.post('/customers', customerController.create(db));

  // Sales / POS (Stage 3)
  r.post('/sales', salesController.create(db));
  r.get('/sales', salesController.list(db));
  r.get('/sales/:id', salesController.get(db));
  r.post('/sales/:id/confirm-payment', salesController.confirmPayment(db));

  // Returns & Refunds (Stage 4)
  r.post('/returns', returnsController.create(db));
  r.get('/returns', returnsController.list(db));
  r.get('/returns/:id', returnsController.get(db));
  r.post('/refunds', refundsController.create(db));
  r.get('/refunds', refundsController.list(db));

  // Expenses & Finance (Stage 4)
  r.post('/expenses', expenseController.create(db));
  r.get('/expenses', expenseController.list(db));
  r.get('/finance/summary', financeController.summary(db));

  // Documents (Stage 5)
  r.get('/documents/receipt/:saleId', documentController.receipt(db));
  r.get('/documents/receipt/:saleId/pdf', documentController.receiptPdf(db));

  // Analytics (Stage 5)
  r.get('/analytics/velocity', analyticsController.velocity(db));
  r.get('/analytics/demand-trend', analyticsController.demandTrend(db));
  r.get('/analytics/product-performance', analyticsController.productPerformance(db));

  // Reports (Stage 6)
  r.get('/reports/sales', reportsController.sales(db));
  r.get('/reports/purchases', reportsController.purchases(db));
  r.get('/reports/inventory', reportsController.inventory(db));
  r.get('/reports/returns', reportsController.returns(db));

  // Tax (Stage 8)
  r.post('/tax-configurations', taxController.create(db));
  r.get('/tax-configurations', taxController.list(db));

  // GPC Taxonomy (Phase 4/5)
  r.post('/gpc/import', gpcController.importTaxonomy(db), { maxBodyBytes: 20 * 1024 * 1024 });
  r.get('/gpc/versions', gpcController.listVersions(db));
  r.get('/gpc/segments', gpcController.segments(db));
  r.get('/gpc/families', gpcController.families(db));
  r.get('/gpc/classes', gpcController.classes(db));
  r.get('/gpc/bricks', gpcController.bricks(db));
  r.get('/gpc/search', gpcController.search(db));

  // Notifications / WhatsApp (Phase 8)
  r.post('/sales/:saleId/send-receipt', notificationController.sendReceipt(db));
  r.get('/notifications/:id', notificationController.get(db));
  r.get('/notifications', notificationController.list(db));
  r.patch('/business/whatsapp-settings', notificationController.updateSettings(db));

  // Payments — Airtel Money, MTN Mobile Money, Card (Stage 11)
  r.post('/payment-intents', paymentController.initiate(db));
  r.get('/payment-intents', paymentController.list(db));
  r.get('/payment-intents/:id', paymentController.get(db));
  r.post('/payment-intents/:id/attach-sale', paymentController.attachSale(db));
  r.get('/payments/unreconciled', paymentController.unreconciled(db));
  r.post('/payments/webhook/:provider', paymentController.webhook(db)); // unauthenticated — verified via HMAC signature instead

  return r;
}

module.exports = { buildRouter };

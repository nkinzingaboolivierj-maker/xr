#!/usr/bin/env node
'use strict';
// Generates docs/contracts/openapi.json from the REAL router (router.describe()),
// so the contract cannot silently list routes that don't exist or omit ones
// that do. tests/stage12 regenerates it in memory and requires the committed
// file to be identical, and checks that every route has metadata here.
//
//   node scripts/generate-openapi.js          # rewrite docs/contracts/openapi.json
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const S = (type, extra = {}) => ({ type, ...extra });
const str = (extra) => S('string', extra);
const num = (extra) => S('number', extra);
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
const money = num({ minimum: 0, description: 'Amount in the business currency (ISO 4217).' });
const lineItem = obj({ productId: str(), quantity: num({ exclusiveMinimum: 0 }), unitPrice: num({ minimum: 0, description: 'Optional override; validated against the product price band (MIN..MAX) and audited.' }), discount: obj({ type: str({ enum: ['percent', 'amount'] }), value: num(), reason: str() }) }, ['productId', 'quantity']);
const Q = {
  page: { name: 'page', in: 'query', schema: S('integer', { minimum: 1, default: 1 }) },
  pageSize: { name: 'pageSize', in: 'query', schema: S('integer', { minimum: 1, maximum: 200, default: 50 }) },
  from: { name: 'from', in: 'query', description: 'ISO 8601 date/time (inclusive).', schema: str({ format: 'date-time' }) },
  to: { name: 'to', in: 'query', description: 'ISO 8601 date/time (inclusive).', schema: str({ format: 'date-time' }) },
  productId: { name: 'productId', in: 'query', schema: str() },
  q: { name: 'q', in: 'query', description: 'Search text.', schema: str({ maxLength: 80 }) },
  status: { name: 'status', in: 'query', schema: str() },
  days: { name: 'days', in: 'query', schema: S('integer', { minimum: 1 }) },
};

// [method, path, tag, summary, { public, body, query, response, binary }]
const ROUTES = [
  ['GET', '/health', 'Operations', 'Liveness probe (process is up)', { public: true }],
  ['GET', '/ready', 'Operations', 'Readiness probe (database reachable)', { public: true }],
  ['POST', '/auth/login', 'Auth', 'Authenticate and receive a bearer session token', { public: true, body: obj({ email: str({ format: 'email' }), password: str(), businessId: str({ description: 'Only needed when the same credentials exist in more than one business (409 BUSINESS_SELECTION_REQUIRED).' }) }, ['email', 'password']) }],
  ['POST', '/auth/logout', 'Auth', 'Revoke the current session', {}],
  ['GET', '/auth/sessions', 'Auth', 'List my sessions (device, IP, last seen)', {}],
  ['POST', '/auth/sessions/{id}/revoke', 'Auth', 'Revoke one of my sessions', {}],
  ['POST', '/auth/change-password', 'Auth', 'Change my password (re-verifies the current one)', { body: obj({ currentPassword: str(), newPassword: str({ minLength: 8 }), revokeOtherSessions: S('boolean') }, ['currentPassword', 'newPassword']) }],
  ['GET', '/me', 'Auth', 'Who am I: user, business profile, permission list', {}],
  ['GET', '/business', 'Business', 'Business profile (name, currency, country, timezone, receipt details)', {}],
  ['PATCH', '/business', 'Business', 'Update business profile (Owner only)', { body: obj({ name: str(), lowStockThreshold: S('integer'), currency: str({ pattern: '^[A-Z]{3}$' }), country: str({ pattern: '^[A-Z]{2}$' }), timezone: str(), phone: str(), address: str(), taxId: str(), requireVerifiedPayments: S('boolean') }) }],
  ['PATCH', '/business/whatsapp-settings', 'Business', 'Choose WhatsApp provider / enable receipts', { body: obj({ whatsappSenderNumber: str(), whatsappProvider: str({ enum: ['MOCK', 'REAL'] }) }) }],
  ['GET', '/users', 'Users', 'List users of my business', {}],
  ['POST', '/users', 'Users', 'Create a staff user with a temporary password (Owner only)', { body: obj({ email: str({ format: 'email' }), role: str({ enum: ['Owner', 'Manager', 'Cashier', 'InventoryStaff'] }), temporaryPassword: str({ minLength: 8 }) }, ['email', 'role', 'temporaryPassword']) }],
  ['PATCH', '/users/{id}', 'Users', 'Change a user\'s role or active status (Owner only)', { body: obj({ role: str({ enum: ['Owner', 'Manager', 'Cashier', 'InventoryStaff'] }), status: str({ enum: ['active', 'inactive'] }) }) }],
  ['POST', '/users/{id}/reset-password', 'Users', 'Set a new temporary password and end the user\'s sessions (Owner only)', { body: obj({ temporaryPassword: str({ minLength: 8 }) }, ['temporaryPassword']) }],
  ['GET', '/products', 'Products', 'List products (paged, searchable)', { query: ['page', 'pageSize', 'q'] }],
  ['POST', '/products', 'Products', 'Create a product', { body: obj({ sku: str(), name: str(), category: str(), unit: str(), barcode: str() }, ['sku', 'name']) }],
  ['GET', '/products/lookup', 'Products', 'Find a product by SKU or barcode', { query: [{ name: 'code', in: 'query', required: true, schema: str() }] }],
  ['POST', '/products/{id}/price', 'Pricing', 'Set MIN / RECOMMENDED / MAX price (MIN <= REC <= MAX), audited', { body: obj({ minPrice: money, recommendedPrice: money, maxPrice: money, reason: str() }, ['minPrice', 'recommendedPrice', 'maxPrice']) }],
  ['GET', '/products/{id}/price-history', 'Pricing', 'Price change history', {}],
  ['POST', '/products/{id}/classify', 'Classification', 'Map a product to an official GS1 GPC brick', { body: obj({ brickCode: str() }, ['brickCode']) }],
  ['GET', '/suppliers', 'Suppliers', 'List suppliers', {}],
  ['POST', '/suppliers', 'Suppliers', 'Create a supplier', { body: obj({ name: str(), phone: str(), email: str(), address: str(), taxNumber: str() }, ['name']) }],
  ['GET', '/purchases', 'Purchases', 'List purchase orders', {}],
  ['POST', '/purchases', 'Purchases', 'Create a DRAFT purchase (no stock effect until received)', { body: obj({ supplierId: str(), items: arr(obj({ productId: str(), quantity: num({ exclusiveMinimum: 0 }), unitCost: money }, ['productId', 'quantity', 'unitCost'])) }, ['supplierId', 'items']) }],
  ['POST', '/purchases/{id}/receive', 'Purchases', 'Receive a purchase: atomically creates batches + PURCHASE movements; idempotent', { body: obj({ operationId: str() }, ['operationId']) }],
  ['GET', '/inventory/movements', 'Inventory', 'Inventory ledger timeline (newest first, capped)', { query: ['productId', { name: 'limit', in: 'query', schema: S('integer', { minimum: 1, maximum: 2000, default: 500 }) }] }],
  ['GET', '/inventory/aging', 'Inventory', 'Stock aging buckets (an inventory metric, never a profit signal)', { query: ['productId'] }],
  ['GET', '/inventory/stock/{productId}', 'Inventory', 'Current stock (derived from batches, never set manually)', {}],
  ['POST', '/inventory/supplier-returns', 'Inventory', 'Return stock to a supplier (FIFO path)', { body: obj({ purchaseId: str(), productId: str(), quantity: num({ exclusiveMinimum: 0 }), reason: str() }, ['purchaseId', 'productId', 'quantity']) }],
  ['POST', '/inventory/adjustments', 'Inventory', 'Damage / loss / count adjustment (FIFO path, audited)', { body: obj({ productId: str(), type: str({ enum: ['DAMAGE', 'LOSS', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] }), quantity: num({ exclusiveMinimum: 0 }), unitCost: money, reason: str() }, ['productId', 'type', 'quantity', 'reason']) }],
  ['GET', '/customers', 'Customers', 'List customers', {}],
  ['POST', '/customers', 'Customers', 'Create a customer', { body: obj({ name: str(), phone: str(), email: str(), type: str() }, ['name']) }],
  ['POST', '/sales', 'Sales', 'Complete a sale. Idempotent on operationId; server computes price, discount, tax, FIFO COGS atomically. Non-cash payments settle only via paymentIntentId (provider-verified) or a staff paymentReference.', { body: obj({ operationId: str(), customerId: str(), items: arr(lineItem), paymentMethod: str({ enum: ['Cash', 'MobileMoney', 'Card'] }), cashReceived: money, discount: obj({ type: str({ enum: ['percent', 'amount'] }), value: num(), reason: str() }), paymentIntentId: str(), paymentReference: str() }, ['operationId', 'items', 'paymentMethod']) }],
  ['GET', '/sales', 'Sales', 'List sales (paged, newest first)', { query: ['page', 'pageSize'] }],
  ['GET', '/sales/{id}', 'Sales', 'Sale detail with immutable price/tax/discount snapshots, batches and payment', {}],
  ['POST', '/sales/{id}/confirm-payment', 'Sales', 'Staff-confirm a PENDING non-cash payment with a reference (audited)', { body: obj({ reference: str() }, ['reference']) }],
  ['POST', '/sales/{saleId}/send-receipt', 'Notifications', 'Queue a WhatsApp receipt (asynchronous; never blocks or fails the sale)', { body: obj({ recipientPhone: str(), recipientName: str() }, ['recipientPhone']) }],
  ['POST', '/returns', 'Returns', 'Create a customer return against a sale (stock disposition + refundable amount)', { body: obj({ saleId: str(), items: arr(obj({ saleItemId: str(), quantity: num({ exclusiveMinimum: 0 }), condition: str(), reason: str() }, ['saleItemId', 'quantity'])) }, ['saleId', 'items']) }],
  ['GET', '/returns', 'Returns', 'List returns', {}],
  ['GET', '/returns/{id}', 'Returns', 'Return detail', {}],
  ['POST', '/refunds', 'Refunds', 'Refund a return (cannot exceed the refundable amount)', { body: obj({ returnId: str(), amount: money, method: str({ enum: ['Cash', 'MobileMoney', 'Card'] }) }, ['returnId', 'amount', 'method']) }],
  ['GET', '/refunds', 'Refunds', 'List refunds', {}],
  ['POST', '/expenses', 'Expenses', 'Record an operating expense', { body: obj({ category: str(), description: str(), amount: money, expenseDate: str({ format: 'date' }), paymentMethod: str() }, ['category', 'amount']) }],
  ['GET', '/expenses', 'Expenses', 'List expenses', { query: ['from', 'to'] }],
  ['GET', '/finance/summary', 'Finance', 'Revenue, collected cash, COGS, gross profit, expenses, net profit', { query: ['from', 'to'] }],
  ['GET', '/documents/receipt/{saleId}', 'Documents', 'Receipt as JSON (or text with ?format=text)', { query: [{ name: 'format', in: 'query', schema: str({ enum: ['text'] }) }] }],
  ['GET', '/documents/receipt/{saleId}/pdf', 'Documents', 'Receipt as a PDF (80 mm)', { binary: 'application/pdf' }],
  ['GET', '/analytics/velocity', 'Analytics', 'Sales velocity per product', { query: ['productId', 'days'] }],
  ['GET', '/analytics/demand-trend', 'Analytics', 'Demand trend per product', { query: ['productId', 'days'] }],
  ['GET', '/analytics/product-performance', 'Analytics', 'Revenue / COGS / margin per product', { query: ['productId'] }],
  ['GET', '/reports/sales', 'Reports', 'Sales report', { query: ['from', 'to', { name: 'customerId', in: 'query', schema: str() }, { name: 'paymentMethod', in: 'query', schema: str() }, 'status'] }],
  ['GET', '/reports/purchases', 'Reports', 'Purchases report', { query: ['from', 'to', { name: 'supplierId', in: 'query', schema: str() }, 'status'] }],
  ['GET', '/reports/inventory', 'Reports', 'Inventory valuation report', {}],
  ['GET', '/reports/returns', 'Reports', 'Returns report', { query: ['from', 'to'] }],
  ['POST', '/tax-configurations', 'Tax', 'Add a tax rate (effective-dated)', { body: obj({ name: str(), ratePercent: num({ minimum: 0, maximum: 100 }), effectiveFrom: str({ format: 'date' }), effectiveTo: str({ format: 'date' }) }, ['name', 'ratePercent', 'effectiveFrom']) }],
  ['GET', '/tax-configurations', 'Tax', 'List tax rates', {}],
  ['POST', '/gpc/import', 'Classification', 'Import an official GS1 GPC dataset (Owner only; validated, all-or-nothing, dryRun supported)', { body: obj({ versionName: str(), source: str(), rows: arr(S('object')), dryRun: S('boolean') }, ['versionName', 'rows']) }],
  ['GET', '/gpc/versions', 'Classification', 'Imported GPC versions', {}],
  ['GET', '/gpc/segments', 'Classification', 'GPC segments', {}],
  ['GET', '/gpc/families', 'Classification', 'GPC families of a segment', { query: [{ name: 'segment', in: 'query', schema: str() }] }],
  ['GET', '/gpc/classes', 'Classification', 'GPC classes of a family', { query: [{ name: 'family', in: 'query', schema: str() }] }],
  ['GET', '/gpc/bricks', 'Classification', 'GPC bricks of a class', { query: [{ name: 'class', in: 'query', schema: str() }] }],
  ['GET', '/gpc/search', 'Classification', 'Search GPC bricks', { query: ['q'] }],
  ['GET', '/notifications', 'Notifications', 'List notification deliveries', { query: ['status', { name: 'type', in: 'query', schema: str() }] }],
  ['GET', '/notifications/{id}', 'Notifications', 'Notification delivery status', {}],
  ['POST', '/payment-intents', 'Payments', 'Initiate a provider payment (Airtel Money / MTN MoMo / Card). Idempotent on idempotencyKey. 503 PROVIDER_NOT_CONFIGURED until a real provider is connected.', { body: obj({ method: str({ enum: ['MobileMoney', 'Card'] }), network: str({ enum: ['AIRTEL_MONEY', 'MTN_MOMO'] }), amount: money, currency: str(), customerPhone: str(), idempotencyKey: str() }, ['method', 'amount', 'idempotencyKey']) }],
  ['GET', '/payment-intents', 'Payments', 'List payment intents', { query: ['status'] }],
  ['GET', '/payment-intents/{id}', 'Payments', 'Payment intent status', {}],
  ['POST', '/payment-intents/{id}/attach-sale', 'Payments', 'Attach a SUCCESS intent to the sale it matches (amount, currency, method)', { body: obj({ saleId: str() }, ['saleId']) }],
  ['GET', '/payments/unreconciled', 'Payments', 'Provider-confirmed payments not yet attached to a sale (Manager/Owner)', {}],
  ['POST', '/payments/webhook/{provider}', 'Payments', 'Provider webhook. HMAC-SHA256 over the raw body is verified BEFORE any processing; replays are no-ops; disabled in production until a real provider is wired.', { public: true, body: obj({ eventId: str(), providerReference: str(), status: str({ enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'] }) }, ['eventId', 'providerReference', 'status']) }],
];

function problemRef(desc) { return { description: desc, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } }; }

function build(routes) {
  const paths = {};
  const described = new Set(routes.map((r) => `${r[0]} ${r[1]}`));
  for (const [method, p, tag, summary, opts = {}] of routes) {
    const params = [...(p.match(/\{([A-Za-z0-9_]+)\}/g) || []).map((m) => ({ name: m.slice(1, -1), in: 'path', required: true, schema: str() }))];
    for (const q of opts.query || []) params.push(typeof q === 'string' ? Q[q] : q);
    const op = {
      tags: [tag], summary,
      operationId: `${method.toLowerCase()}${p.replace(/\{([A-Za-z0-9_]+)\}/g, 'By_$1').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))}`,
      ...(params.length ? { parameters: params } : {}),
      ...(opts.public ? { security: [] } : {}),
      ...(opts.body ? { requestBody: { required: true, content: { 'application/json': { schema: opts.body } } } } : {}),
      responses: {
        [method === 'POST' && ['/sales', '/products', '/suppliers', '/purchases', '/customers', '/returns', '/refunds', '/expenses', '/users', '/payment-intents', '/tax-configurations', '/inventory/supplier-returns', '/inventory/adjustments'].includes(p) ? '201' : (p === '/auth/logout' ? '204' : (p === '/sales/{saleId}/send-receipt' ? '202' : '200'))]: opts.binary
          ? { description: 'OK', content: { [opts.binary]: { schema: { type: 'string', format: 'binary' } } } }
          : { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
        ...(opts.public ? {} : { 401: problemRef('Missing, invalid, revoked or expired session (UNAUTHENTICATED / SESSION_EXPIRED)'), 403: problemRef('Permission denied, cross-business access, or PASSWORD_CHANGE_REQUIRED') }),
        ...(opts.body ? { 400: problemRef('Validation error (VALIDATION_ERROR)') } : {}),
        429: problemRef('Rate limited (login)'),
        500: problemRef('Unexpected server error (INTERNAL_ERROR); quote requestId'),
      },
    };
    if (p === '/auth/logout') delete op.responses[200];
    (paths[p] = paths[p] || {})[method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'XR Business Management & POS API',
      version: pkg.version,
      description: 'Generated from the running router by scripts/generate-openapi.js. Errors use RFC 9457 application/problem+json with a stable `code`. Request/response schemas for request bodies are documented; response payloads are described by the generic envelope {success, data} (see docs/contracts/FE_BE_CONTRACT.md for field-level shapes).',
    },
    servers: [{ url: '/', description: 'Same origin as the web app; no path prefix.' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Opaque session token from POST /auth/login' } },
      schemas: {
        Envelope: { type: 'object', properties: { success: { type: 'boolean' }, data: {} }, required: ['success'] },
        Problem: {
          type: 'object',
          description: 'RFC 9457 Problem Details',
          properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' }, instance: { type: 'string' }, code: { type: 'string' }, requestId: { type: 'string' } },
          required: ['title', 'status', 'code'],
        },
      },
    },
    __described: [...described],
  };
}

function generate() {
  const spec = build(ROUTES);
  delete spec.__described;
  return JSON.stringify(spec, null, 2) + '\n';
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'docs', 'contracts', 'openapi.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, generate());
  console.log(`Wrote ${out}`);
}
module.exports = { generate, ROUTES };

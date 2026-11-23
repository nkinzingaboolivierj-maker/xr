# C3 — Backend Components

**Status:** PARTIAL — Stage 1 + Stage 2 components are real and tested.
Everything from POS onward is TARGET (specified, not implemented).

## Container in view

**XR API Application** (Node.js modular monolith)

## Implemented Components (Stage 1 — Foundation)

| Component | Responsibility | Evidence |
|---|---|---|
| AuthComponent | Login, logout, scrypt password hashing, session issue/expiry | `tests/stage1.test.js` |
| RBACComponent | Owner / Manager / Cashier roles, permission checks | `tests/stage1.test.js` |
| BusinessTenantComponent | Business-scoped isolation on every record | `tests/stage1.test.js` |
| AuditComponent | Records actor/action/resource/timestamp for tracked changes | `tests/stage1.test.js` |
| ProductCatalogComponent | Product CRUD — **flat category field today, not GS1 GPC** | `tests/stage1.test.js` |
| PricingComponent | Min/Recommended/Max price, price history | `tests/stage1.test.js` |

## Implemented Components (Stage 2 — Procurement + Inventory)

| Component | Responsibility | Evidence |
|---|---|---|
| SupplierComponent | Supplier CRUD | `tests/stage2.test.js` |
| ProcurementComponent | Draft → Receive purchase workflow, atomic receiving | `tests/stage2.test.js` |
| InventoryLedgerComponent | Batch-tracked movement ledger (purchase, damage, loss, adjustment) | `tests/stage2.test.js` |
| FIFOCostingComponent | FIFO batch allocation and COGS calculation | `tests/stage2.test.js` |
| StockAgingComponent | Computes age from batch receipt date | `tests/stage2.test.js` |

## Target Components (specified, NOT implemented)

| Component | Responsibility | Blocking dependency |
|---|---|---|
| GPCClassificationComponent | Import/search/browse official GS1 GPC taxonomy | GPC dataset import — not started |
| QRBarcodeComponent | Generate/resolve QR & barcode identifiers | Depends on Product/GPC being final |
| POSComponent | Cart, checkout, server-side price/stock revalidation | Not started |
| SalesComponent | Sale creation, sale items, batch allocation, idempotency | Not started |
| PaymentComponent | Payment abstraction (Cash/Mobile Money/Bank/Card), webhook verification | No provider chosen yet |
| CustomerComponent | Walk-in / named customer records | Not started |
| ReturnsComponent | Return workflow linked to original sale/batch | Depends on SalesComponent |
| RefundsComponent | Refund state machine, duplicate-refund prevention | Depends on ReturnsComponent |
| ExpenseComponent | Expense categories, records | Not started |
| FinanceComponent | Single trusted Revenue/COGS/Gross Profit/Net Profit definition | Depends on SalesComponent + ExpenseComponent |
| AnalyticsComponent | Velocity, demand trend, stock-out risk — evidence-based only | Depends on FinanceComponent + InventoryLedgerComponent |
| DocumentComponent | Receipt/invoice generation, historical snapshotting | Depends on SalesComponent |
| NotificationComponent | WhatsApp/queue delivery, SENT/FAILED tracking | No provider chosen yet |
| IntegrationComponent | PaymentProvider / WhatsAppProvider adapters | No provider chosen yet |
| AuditComponent (expansion) | Extend to sales/payments/returns/refunds/expenses | Depends on each new component |
| AIBoundaryComponent | Orchestrator + permission-scoped tool access to authoritative services | Not started; no AI provider chosen |

## Component principle enforced here

Every component above sits behind:

`Controller → Service → Repository → Database`

FIFO logic, pricing rules, and inventory rules live in the
**Service/Domain layer only** — never in a controller and never
duplicated in the frontend or mobile client.

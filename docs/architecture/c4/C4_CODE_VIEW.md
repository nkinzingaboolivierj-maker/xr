# C4 — Code View (Level 4)

**Status:** PENDING_VERIFICATION — the relationships below reflect the
*reported/tested behavior* of Stage 1 and Stage 2 (per the integration test
suites), not a direct read of the source files in this conversation. Exact
file paths are left as `TBD — confirm against repository` rather than
invented. Upload the backend repository for a follow-up pass that fills in
real paths and confirms every edge.

## Purpose

Show the important service-to-service relationships inside the backend —
not every file, only the relationships that carry business meaning.

## Implemented relationships (evidence: Stage 1 + Stage 2 test suites)

| From | To | Why | Evidence |
|---|---|---|---|
| ProcurementComponent | InventoryLedgerComponent | On receive: creates batch + movement records atomically | `tests/stage2.test.js` |
| InventoryLedgerComponent | FIFOCostingComponent | Allocates cost from oldest batch first on consumption | `tests/stage2.test.js` |
| InventoryLedgerComponent | StockAgingComponent | Computes age from each batch's received-at timestamp | `tests/stage2.test.js` |
| ProductCatalogComponent | PricingComponent | Validates Min ≤ Recommended ≤ Max on save | `tests/stage1.test.js` |
| AuthComponent | RBACComponent | Resolves the authenticated user's role/permissions | `tests/stage1.test.js` |
| RBACComponent | BusinessTenantComponent | Every permission check is scoped to the caller's business | `tests/stage1.test.js` |
| ProcurementComponent, ProductCatalogComponent, PricingComponent | AuditComponent | Writes an audit entry on every tracked change | `tests/stage1.test.js`, `tests/stage2.test.js` |

## Target relationships (specified, not yet built)

| From | To | Why |
|---|---|---|
| POSComponent | SalesComponent | Submits a validated cart for sale creation |
| SalesComponent | PricingComponent | Revalidates price server-side at submission — never trusts the client |
| SalesComponent | InventoryLedgerComponent | Deducts stock via the ledger, never a direct field update |
| SalesComponent | FIFOCostingComponent | Allocates batches and computes COGS for the sale |
| SalesComponent | PaymentComponent | Records payment state, separate from the sale record itself |
| SalesComponent | FinanceComponent | Feeds Revenue and COGS into the one trusted financial definition |
| SalesComponent | DocumentComponent | Triggers receipt generation from the completed transaction |
| SalesComponent | AuditComponent | Writes audit entries for sale, payment, and inventory effects |
| ReturnsComponent | InventoryLedgerComponent | Reverses stock via `CUSTOMER_RETURN` movement type |
| ReturnsComponent | RefundsComponent | Triggers a refund record, capped at remaining refundable amount |
| ExpenseComponent | FinanceComponent | Feeds Operating Expenses into Net Profit |
| FinanceComponent | AnalyticsComponent | Sole authoritative source for Revenue/COGS/Profit metrics — Analytics never recomputes independently |
| ProductCatalogComponent | GPCClassificationComponent | Classifies each product against the versioned GS1 GPC taxonomy |
| DocumentComponent | NotificationComponent | Queues WhatsApp/receipt delivery asynchronously |

## Rule enforced at this level

No page or component may independently invent a stock, price, or profit
calculation. Every consumer above reads from exactly one authoritative
service for that concern — this is the same rule stated in the master
specification's "Database Source-of-Truth Principles."

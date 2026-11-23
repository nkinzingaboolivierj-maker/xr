# Target Domain Architecture

**Status:** TARGET — this is a possible future decomposition, not a
statement that these are (or will imminently be) separate deployed
services. The current implementation is one modular monolith
(the XR API Application).

## Why this document exists

The master specification asks for meaningful domain boundaries so that,
if/when the monolith is split, the seams are already understood. It does
not require microservices to exist now, and this document must not be read
that way.

## Candidate domains

| Domain | Would own | Maps to current component(s) |
|---|---|---|
| Identity | Auth, sessions, devices | AuthComponent (implemented) |
| Business | Tenant/business records, settings | BusinessTenantComponent (implemented) |
| Catalog | Products, GS1 GPC classification, pricing | ProductCatalogComponent + PricingComponent (implemented, minus GPC) |
| Procurement | Suppliers, purchases, receiving | SupplierComponent + ProcurementComponent (implemented) |
| Inventory | Ledger, batches, FIFO, stock aging | InventoryLedgerComponent + FIFOCostingComponent + StockAgingComponent (implemented) |
| Sales/POS | Cart, checkout, sale, idempotency | TARGET |
| Payments | Payment abstraction, provider webhooks | TARGET |
| Customers | Walk-in/named customer records | TARGET |
| Returns | Return workflow, links to sale/batch | TARGET |
| Finance | Revenue, COGS, Gross/Net Profit — single definition | TARGET |
| Analytics | Velocity, demand trend, product intelligence | TARGET |
| Documents | Receipts, invoices, historical snapshots | TARGET |
| Notifications | WhatsApp/email delivery, retry | TARGET |
| Integrations | Payment/WhatsApp provider adapters | TARGET |
| Audit/Security | Cross-cutting audit + security event log | AuditComponent (implemented, scope will expand) |
| Imports | Bulk import jobs (e.g. GPC taxonomy) | TARGET |
| AI Boundary | Orchestrator with permission-scoped tool access | TARGET |

## Decomposition principle

A domain here justifies a future service only when it has its own data
ownership and a clear reason to scale or deploy independently — not because
a screen exists for it. "One microservice per screen" is explicitly
rejected by the master specification.

## Current honest state

**Today: one API Application, one SQLite database, no service boundaries
beyond in-process component separation.** Every domain above is reachable
only inside that single deployable unit.

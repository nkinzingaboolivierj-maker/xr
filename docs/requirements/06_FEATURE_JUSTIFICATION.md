# 06 — Feature Justification

**Status:** Every major feature below is justified against the core
Business Requirement (`03_BUSINESS_REQUIREMENTS.md`) — nothing is included
because "software should have it."

| Feature | User Problem | Business Value | Risk if Absent | Priority | Depends On |
|---|---|---|---|---|---|
| **GS1 GPC Classification** | Owners invent inconsistent category names over time | World-standard, searchable taxonomy; enables accurate reporting by category | Category chaos; can't compare like-for-like products | P1 | GPC dataset import |
| **Min/Recommended/Max Pricing** | Staff sell below cost by mistake or under pressure | Protects margin automatically, still allows judgment within a safe band | Silent margin loss, undetected until reporting | P0 | Product Catalog |
| **Batch-tracked Inventory Ledger** | "Where did my stock go?" has no answer today | Every unit is traceable to a purchase, cost, and date | Can't explain shrinkage, can't compute accurate COGS | P0 | Procurement |
| **FIFO Costing** | Same product bought at different costs over time | Correct cost-of-goods-sold, correct gross profit | Wrong profit numbers — the core requirement fails | P0 | Inventory Ledger |
| **Stock Aging (separate from profit)** | Owners assume "old stock = loss," which is wrong | Surfaces slow movers without corrupting the profit calculation | Misleading business decisions based on a false signal | P0 | Inventory Ledger |
| **Server-Authoritative POS** | A compromised or buggy client could sell at any price or fake stock | Price and stock truth cannot be bypassed by any client | Fraud, stockouts, broken trust in the numbers | P0 | Pricing, Inventory |
| **Idempotent Sales (operation_id)** | A network retry during checkout must not double-charge or double-sell | Safe to retry — no duplicate financial effect | Double sales, double payments, inventory corruption | P0 | POS/Sales |
| **One Trusted Finance Definition** | Dashboard, Reports, and Analytics could each compute profit differently | One number, everywhere, always | Owner sees three different "profit" figures and trusts none | P0 | Sales, Expenses |
| **RBAC + Tenant Isolation** | Multiple staff, potentially multiple businesses, share one system | Right person sees right data, one business never sees another's | Data leakage, unauthorized price/inventory changes | P0 | Auth |
| **Audit Log** | "Who changed this price?" must be answerable | Accountability for every sensitive change | No accountability, no fraud detection trail | P0 | Auth, RBAC |

## Justification rule going forward

Any new feature proposed after this baseline must be added to this table
with the same five columns before it is built — this keeps the product
from growing "disconnected screens" the master specification explicitly
forbids.

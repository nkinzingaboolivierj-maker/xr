# 08 — Functional Requirements

**Status:** MIXED — each FR below states its own implementation status.
No FR is marked IMPLEMENTED without the corresponding test evidence cited
in the traceability workbook.

Every FR follows this shape: **Actor → Precondition → Behavior → Failure
handling.** IDs are stable and must not be renumbered once referenced
elsewhere (user stories, use cases, API docs, tests).

## Identity & Access

**FR-AUTH-001** — The system shall authenticate a user via password
(hashed, never stored/logged in plaintext), issue a session on success,
and reject invalid credentials without revealing which field was wrong.
*Status: IMPLEMENTED.*

**FR-AUTH-002** — The system shall expire and allow revocation of
sessions. *Status: IMPLEMENTED (expiry, revocation tested in Stage 1).*

**FR-SEC-001** — The system shall enforce role-based permissions
(Owner/Manager/Cashier/Inventory Staff) on every protected action,
server-side. *Status: IMPLEMENTED.*

**FR-BUS-001** — The system shall scope every business record to exactly
one business (`business_id`) and reject any request whose caller does not
belong to that business. *Status: IMPLEMENTED and tested (cross-business
access denial verified).*

**FR-AUD-001** — The system shall record actor, action, resource, and
timestamp for every tracked change (products, prices, purchases,
receiving). *Status: IMPLEMENTED for Stage 1+2 scope; must expand as new
domains (Sales, Finance, etc.) are built.*

## Product & Classification

**FR-PROD-001** — The system shall support create/view/edit/deactivate for
products, with a stable internal ID and unique SKU per business.
*Status: IMPLEMENTED (category is currently a flat field, not GPC).*

**FR-CLS-001** — The system shall classify products against the official
GS1 GPC taxonomy (Segment → Family → Class → Brick), store the taxonomy
version used, and never allow an invented category code.
*Status: TARGET — GPC dataset import not yet built.*

**FR-QR-001** — The system shall resolve a scanned QR/barcode to a product
via secure backend lookup, scoped to the caller's business, with manual
search as a fallback when camera access is unavailable.
*Status: TARGET (demo prototypes simulate scanning only).*

## Pricing

**FR-PRICE-001** — The system shall enforce MINIMUM ≤ RECOMMENDED ≤ MAXIMUM
on every product price, validated server-side, and reject a sale price
outside that band unless an explicit authorized override exists.
*Status: IMPLEMENTED (price bounds + history, Stage 1); override system is
TARGET.*

**FR-PRICE-002** — The system shall record every price change with old
value, new value, actor, timestamp, and reason.
*Status: IMPLEMENTED (price history, Stage 1).*

## Procurement & Inventory

**FR-SUP-001** — The system shall support supplier create/view/edit/
deactivate with business scoping. *Status: IMPLEMENTED.*

**FR-PUR-001** — The system shall support a draft purchase (supplier,
products, quantities, unit costs) that does not affect inventory until
received. *Status: IMPLEMENTED.*

**FR-REC-001** — The system shall receive a purchase atomically: validate
state, create a batch, create inventory movements, update stock, mark the
purchase received, write an audit entry — rolling back entirely on any
failure. *Status: IMPLEMENTED and tested.*

**FR-INV-001** — The system shall maintain inventory as an append-only
ledger of movements (PURCHASE, SALE, CUSTOMER_RETURN, SUPPLIER_RETURN,
DAMAGE, LOSS, ADJUSTMENT_IN, ADJUSTMENT_OUT) — never a silently-edited
stock number. *Status: IMPLEMENTED.*

**FR-FIFO-001** — The system shall allocate stock consumption to the
oldest remaining batch first (FIFO) and compute cost of goods sold from
the batches actually consumed. *Status: IMPLEMENTED and tested.*

**FR-INV-002** — The system shall compute stock age from each batch's
received-at date, independent of any profitability calculation.
*Status: IMPLEMENTED.*

**FR-INV-003** — The system shall block negative stock by default; any
stock reduction not tied to a sale/return/damage/loss/adjustment record is
disallowed. *Status: IMPLEMENTED.*

## Sales / POS / Payments (TARGET — none implemented yet)

**FR-POS-001** — The system shall let an authorized user build a cart,
revalidate price and stock server-side, and submit a sale using an
idempotency key so a retried request never duplicates the sale.

**FR-POS-002** — The system shall reject a sale if server-side stock is
insufficient at submission time, regardless of what the client cached.

**FR-PAY-001** — The system shall record payment as a state machine
(INITIATED/PENDING/SUCCESS/FAILED/CANCELLED/EXPIRED), separate from the
sale record, and never mark a payment SUCCESS based on frontend behavior
alone.

**FR-PAY-002** — For cash payments, the system shall compute change
automatically from amount due and amount received — never trusting
client-side arithmetic as the final figure.

## Customers, Returns, Refunds (TARGET)

**FR-CUS-001** — The system shall support Walk-in and Named customers,
with identity stable across contact-detail changes.

**FR-RET-001** — The system shall prevent a return quantity that exceeds
(original sold − already returned) for a given sale item.

**FR-REF-001** — The system shall prevent a refund from exceeding the
remaining refundable amount and prevent duplicate refunds for the same
return.

## Finance & Analytics (TARGET)

**FR-EXP-001** — The system shall record expenses with category, amount,
date, and actor, without assuming a final accounting policy.

**FR-FIN-001** — The system shall compute Gross Profit (Revenue − COGS)
and Net Profit (Gross Profit − Operating Expenses) from one authoritative
definition, used identically by Dashboard, Reports, and Analytics.

**FR-ANL-001** — The system shall compute sales velocity (units sold ÷
time period) and demand trend (period-over-period % change) from
authoritative transaction data only — never a fabricated or AI-invented
figure.

## Documents & Notifications (TARGET)

**FR-DOC-001** — The system shall generate receipts/invoices as
representations of a completed transaction, preserving a historical
snapshot of price, product name, and discount at time of sale.

**FR-NOT-001** — The system shall queue WhatsApp/notification delivery
asynchronously; a delivery failure shall never roll back the underlying
business transaction, and shall be retryable.

## Reports (TARGET)

**FR-REP-001** — The system shall provide filterable reports (date,
product, GPC classification, customer, supplier, payment, status) that
reconcile exactly with Dashboard and Analytics figures.

## Mobile (PARTIAL)

**FR-MOB-001** — The system shall expose a mobile API client covering
every implemented backend capability, without duplicating business logic
on the client. *Status: IMPLEMENTED for Stage 1+2 endpoints (11/11 tests);
sales/payments/customers endpoints do not exist yet for mobile to call.*

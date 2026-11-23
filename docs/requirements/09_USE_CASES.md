# 09 — Use Cases

**Status:** MIXED — each use case states its own status. Format:
**UC-ID → Name → Primary Actor → Preconditions → Main Flow → Alternative/
Error Flow → Related FR.**

## UC-AUTH-001 — Authenticate
**Actor:** Any user. **Precondition:** Account exists.
**Main flow:** Submit credentials → verify hash → issue session scoped to
business + role.
**Error flow:** Invalid credentials → generic rejection (no field-specific
hint) → optional rate-limit after repeated failures.
**Related FR:** FR-AUTH-001, FR-AUTH-002. **Status: IMPLEMENTED.**

## UC-PROD-001 — Manage Product
**Actor:** Manager. **Precondition:** Authenticated, permitted role.
**Main flow:** Create/edit product → assign SKU → set pricing band.
**Alternative flow:** Deactivate product (soft state, not delete).
**Error flow:** Duplicate SKU within business → rejected.
**Related FR:** FR-PROD-001, FR-PRICE-001. **Status: IMPLEMENTED**
(category is flat today; GPC classification step is TARGET).

## UC-PUR-001 — Create and Receive Purchase
**Actor:** Manager (create), Inventory Staff (receive).
**Precondition:** Supplier and products exist.
**Main flow:** Create draft purchase → review → receive → batch created →
inventory updated → audit written.
**Error flow:** Receiving an already-received purchase → rejected
(duplicate-receiving prevention).
**Related FR:** FR-PUR-001, FR-REC-001, FR-INV-001.
**Status: IMPLEMENTED and tested.**

## UC-INV-001 — Adjust / Count Inventory
**Actor:** Inventory Staff. **Precondition:** Product/batch exists.
**Main flow:** Record adjustment (damage/loss/count correction) with
reason, actor, timestamp → ledger movement created.
**Error flow:** Adjustment resulting in negative stock → rejected by
default.
**Related FR:** FR-INV-001, FR-INV-003. **Status: IMPLEMENTED.**

## UC-POS-001 — Complete a Sale
**Actor:** Cashier. **Precondition:** Product exists, stock available.
**Main flow:** Scan/search → add to cart → validate price/stock
server-side → select payment → complete sale → FIFO allocation → COGS
computed → receipt generated.
**Error flow:** Insufficient stock at submission → sale rejected;
duplicate submission (network retry) → idempotency key prevents a second
sale.
**Related FR:** FR-POS-001, FR-POS-002, FR-PAY-001, FR-FIFO-001,
FR-DOC-001. **Status: NOT YET BUILT.**

## UC-CUS-001 — Manage Customer
**Actor:** Cashier/Manager. **Precondition:** None (Walk-in always valid).
**Main flow:** Search or create customer → attach to sale.
**Related FR:** FR-CUS-001. **Status: NOT YET BUILT.**

## UC-RET-001 — Process Return and Refund
**Actor:** Cashier/Manager. **Precondition:** Original sale exists.
**Main flow:** Select sale item → return quantity/condition → review →
confirm → inventory reversed → refund issued.
**Error flow:** Return quantity exceeds sold-minus-already-returned →
rejected; refund exceeding remaining refundable amount → rejected.
**Related FR:** FR-RET-001, FR-REF-001. **Status: NOT YET BUILT.**

## UC-EXP-001 — Record Expense
**Actor:** Owner/Manager. **Precondition:** Expense category exists.
**Main flow:** Enter category/amount/date → save → feeds Finance.
**Related FR:** FR-EXP-001, FR-FIN-001. **Status: NOT YET BUILT.**

## UC-ANL-001 — View Analytics
**Actor:** Owner/Manager. **Precondition:** Sufficient transaction history
exists.
**Main flow:** Select period → view velocity, demand trend, product
profitability, computed from authoritative Finance/Inventory data.
**Error flow:** Insufficient data → system states so explicitly, never
fabricates a figure.
**Related FR:** FR-ANL-001. **Status: NOT YET BUILT.**

## UC-ADM-001 — Administer Roles and Permissions
**Actor:** Owner. **Precondition:** Owner role.
**Main flow:** Assign role to user → permission set applied immediately →
audit entry written.
**Related FR:** FR-SEC-001, FR-AUD-001. **Status: IMPLEMENTED.**

## UC-MOB-001 — Mobile Product/Stock Lookup
**Actor:** Any authenticated mobile user.
**Precondition:** Mobile API client configured with valid session.
**Main flow:** Query product/stock through the mobile API client → same
server-authoritative answer as web.
**Related FR:** FR-MOB-001. **Status: IMPLEMENTED for existing endpoints
(11/11 tests); no POS/sales use case exists for mobile yet.**

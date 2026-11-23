# 07 — User Stories + Acceptance Criteria

**Status:** Stories for IMPLEMENTED domains carry real acceptance criteria
already verified by tests. Stories for TARGET domains carry acceptance
criteria to be verified once built — none are marked passed yet.

Each story follows: **Story ID → Actor → Goal → Business Value →
Preconditions → Main Flow → Acceptance Criteria → Related FR.**

---

### US-AUTH-001 — Secure login
**Actor:** Any user. **Goal:** Log in to access my business.
**Business Value:** Only authorized people touch business data.
**Related FR:** FR-AUTH-001, FR-BUS-001.
**Acceptance Criteria:**
- Given valid credentials, when I log in, then I receive a session scoped
  to my business and role.
- Given invalid credentials, when I log in, then I am rejected without
  learning whether the email or the password was wrong.
- *Status: PASSING (Stage 1 tests).*

### US-REC-001 — Receive a purchase
**Actor:** Inventory Staff. **Goal:** Turn an ordered purchase into
available stock. **Business Value:** Stock becomes sellable and
traceable to its cost. **Related FR:** FR-REC-001, FR-INV-001, FR-FIFO-001.
**Acceptance Criteria:**
- Given a valid draft purchase, when I receive it, then a batch is
  created, inventory increases, the purchase is marked RECEIVED, and an
  audit entry is written.
- Given any step fails mid-receiving, when the transaction is rolled back,
  then no partial batch or movement is left behind.
- *Status: PASSING (Stage 2 tests).*

### US-PRICE-001 — Protect margin on every sale
**Actor:** Manager. **Goal:** Set a price band my staff cannot break.
**Business Value:** No accidental below-cost sale.
**Related FR:** FR-PRICE-001, FR-PRICE-002.
**Acceptance Criteria:**
- Given Min ≤ Recommended ≤ Max, when I try to save a price outside that
  order, then the system rejects it.
- Given a price change is saved, when I view price history, then I see
  old value, new value, actor, and timestamp.
- *Status: PASSING (Stage 1 tests).*

### US-POS-001 — Complete a sale at the counter
**Actor:** Cashier. **Goal:** Sell products quickly and correctly.
**Business Value:** Accurate revenue capture, no stale-price risk.
**Related FR:** FR-POS-001, FR-POS-002, FR-PAY-001.
**Acceptance Criteria:**
- Given items in a cart, when I submit the sale, then the backend
  revalidates price and stock before committing.
- Given the same submission is retried after a timeout, when I check the
  result, then exactly one sale exists, not two.
- Given stock is insufficient at submission, when I try to sell, then the
  sale is rejected with a clear reason.
- *Status: NOT YET BUILT — no acceptance evidence exists.*

### US-CASH-001 — Handle cash payment
**Actor:** Cashier. **Goal:** Take cash and give correct change.
**Business Value:** No manual arithmetic error at the till.
**Related FR:** FR-PAY-002.
**Acceptance Criteria:**
- Given amount due and amount received, when the sale completes, then
  change is computed by the server, not the client.
- *Status: NOT YET BUILT.*

### US-RET-001 — Process a customer return
**Actor:** Cashier/Manager. **Goal:** Accept a return without corrupting
sales history. **Business Value:** Customer trust, accurate stock and
refund records. **Related FR:** FR-RET-001, FR-REF-001.
**Acceptance Criteria:**
- Given a sale item already fully returned, when a second return is
  attempted, then it is rejected.
- Given a valid return, when a refund is issued, then it cannot exceed the
  remaining refundable amount.
- *Status: NOT YET BUILT.*

### US-FIN-001 — See real profit, not just cash
**Actor:** Owner. **Goal:** Know actual Gross and Net Profit.
**Business Value:** Decisions based on real margin, not till balance.
**Related FR:** FR-FIN-001.
**Acceptance Criteria:**
- Given completed sales and recorded expenses, when I view the finance
  summary, then Gross Profit = Revenue − COGS and Net Profit = Gross
  Profit − Expenses, matching Dashboard and Reports exactly.
- *Status: NOT YET BUILT.*

### US-INV-AGE-001 — See stock age without confusing it with loss
**Actor:** Owner/Manager. **Goal:** Spot slow-moving stock.
**Business Value:** Act on aging inventory before it becomes a write-off.
**Related FR:** FR-INV-002.
**Acceptance Criteria:**
- Given a batch received N days ago and still unsold, when I view
  inventory, then its age is shown as a separate figure from any profit
  metric.
- *Status: PASSING (Stage 2 — age calculation tested; UI/alerting is
  TARGET).*

### US-MOB-001 — Look up a product from my phone
**Actor:** Any mobile user. **Goal:** Check product/stock on the move.
**Business Value:** Doesn't need a desktop to answer a stock question.
**Related FR:** FR-MOB-001.
**Acceptance Criteria:**
- Given valid credentials, when I query a product through the mobile API
  client, then I get the same data the backend would give the web client.
- *Status: PASSING for implemented endpoints (11/11 mobile client tests).*

---

## Rule enforced

Stories never replace Functional Requirements — every story above cites
the FR(s) it satisfies, and no story is marked PASSING without a named
test source.

# 01 — Prototype Reconciliation

**Status:** PARTIAL — only one prototype (`xr-pos-demo__2_.html`) has been
supplied in this conversation. A true reconciliation needs a second
prototype to compare against. This document records everything confirmed
about the one prototype available, structured so a second can be merged
in later without rework.

## What "reconciliation" means here

Per the master specification: two prototypes must become **one canonical
product** — no duplicate inventory engines, pricing engines, POS flows, or
product models. With only one prototype in hand, there is nothing to
reconcile yet, but the canonical feature list below is the baseline the
second prototype will be compared against.

## Confirmed feature inventory — Prototype (`xr-pos-demo__2_.html`)

| Feature | Confirmed detail | Matches specification? |
|---|---|---|
| Navigation | Sidebar with collapse toggle, 11 sections | Yes — matches approved UX reference |
| Dashboard | Overview rendering (`renderDashboard`) | Reference only, no live data |
| POS | Cart, quantity, payment method incl. Cash with change calculation (client-side) | Simulated — must move server-side per FR-POS-001/FR-PAY-002 |
| Products | 10-item demo catalog, flat `category` string | **Conflicts with target** — GS1 GPC required (FR-CLS-001); flat category is a known gap, not a second-source conflict |
| Purchases | Draft → receive flow present in UI | UI mirrors the real backend's implemented flow (Stage 2) — good alignment signal |
| Inventory | Batch/stock display | UI-only; real ledger already exists in backend (Stage 2) |
| Sales | History view | UI-only; no backend Sales domain exists yet |
| Customers | Add + view, order history from local sales | UI-only; backend Customer domain is TARGET |
| Expenses | Add expense, freeform category string, net profit calc | UI-only; conflicts with FR-EXP-001's category-table intent — needs alignment when Finance is built |
| Analytics | Velocity/stock-coverage/reorder flags | Illustrative example data — cannot be treated as evidence of real analytics behavior |
| Documents | Receipt list | UI-only; no backend Document domain exists yet |
| Settings | Business name, low-stock threshold (wired live into the rest of the demo) | UI-only pattern; a real Settings domain is not yet specified in the FR catalog — logged as an open decision |

## No conflicts found (single-source, so nothing to arbitrate yet)

Because only one prototype exists, there are no `KEEP_A` / `KEEP_B` /
`MERGE` decisions to make yet. Every row above is provisionally
`KEEP_A` (the only source) until a second prototype introduces a
genuine alternative or conflict.

## Reconciliation matrix (ready to fill in once Prototype B arrives)

| Feature | Prototype A (this one) | Prototype B | Current Backend Code | Duplicate? | Conflict? | Final Status | Reason |
|---|---|---|---|---|---|---|---|
| Navigation shape | Sidebar + top bar, 11 tabs | *pending* | N/A (frontend not built) | — | — | PENDING_CONFIGURATION | Awaiting Prototype B |
| POS flow | Scan/search → cart → payment (simulated) | *pending* | N/A | — | — | PENDING_CONFIGURATION | Awaiting Prototype B |
| Product categories | Flat 6-group Electronics taxonomy | *pending* | Flat category field | — | — | PENDING_CONFIGURATION | Target is GS1 GPC regardless of what Prototype B shows — see FR-CLS-001 |
| Expense categories | Freeform string | *pending* | Not built | — | — | PENDING_CONFIGURATION | Awaiting Prototype B |
| Settings model | Business name + low-stock threshold | *pending* | Not specified in FR catalog | — | — | OPEN_DECISION | Needs its own FR once scope is confirmed |

## What happens once the second prototype is supplied

1. Extract and inventory it the same way this document does.
2. Fill in every `*pending*` cell above.
3. Resolve each row to `KEEP_A` / `KEEP_B` / `MERGE` / `REWORK` /
   `DEPRECATE` — with a stated reason, per the master specification.
4. Any business policy neither prototype nor the specification defines
   gets an ADR (`docs/product/architectural-decisions/`), not a silent
   guess.
5. Update `PROTOTYPE_RECONCILIATION` sheet in the traceability workbook
   with the finalized matrix.

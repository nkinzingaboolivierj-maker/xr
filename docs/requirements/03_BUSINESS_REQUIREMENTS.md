# 03 — Business Requirements (User Requirement)

**Status:** STRONG — this is the foundation and has not changed through any
revision of the master specification.

## The core requirement

The system must let a business owner always know, for any product:

1. What was purchased, when, and at what quantity and cost.
2. How long the remaining stock has stayed in inventory (age).
3. How much has been sold, and how much remains.
4. Which products are fast-moving and which are slow-moving.
5. How demand is changing over time (growth or decline).
6. The business's actual gross profit and net profit — not cash on hand.
7. Its operating expenses, and how they affect net profit.
8. What needs attention today (low stock, aging stock, stalled demand).

## Why this is the anchor requirement

Every other requirement in this package exists to make one of these eight
points true and provable. If a proposed feature does not serve one of
them, it needs its own justification (see `06_FEATURE_JUSTIFICATION.md`)
before it is accepted.

## Business-level constraints

- The system must work for **one business at a time per session**, with
  hard isolation between businesses (a business must never see another
  business's data).
- Historical transactions must never change meaning because current data
  (price, product name, cost) changed later.
- No business policy (accounting method, discount policy, credit policy,
  tax policy) may be invented by the system — these remain
  business-configurable or explicitly marked as a development placeholder.

## Current implementation status against this requirement

| Capability | Status |
|---|---|
| Purchase → cost → date recorded | IMPLEMENTED (Stage 2) |
| Batch-level stock age | IMPLEMENTED (Stage 2) |
| Sold vs remaining stock | IMPLEMENTED (Stage 2, ledger-based) |
| Fast/slow movement (velocity) | TARGET — requires Sales/POS first |
| Demand trend | TARGET — requires Sales history |
| Gross/Net profit | TARGET — requires Sales + Expenses (Finance domain) |
| Attention items (low stock, aging alerts) | PARTIAL — data exists (Stage 2 ledger + aging); alerting/dashboard not built |

# 02 — Product Vision

## Problem Statement

A small or growing business loses money in ways it cannot see: stock that
sits too long, prices set without a floor, sales that don't reconcile with
what was actually bought, and profit numbers that mix up "money in the
till" with "money actually earned." The owner is usually the last to find
out — often only at year-end, or never.

## Vision

**XR gives a business owner a single, trustworthy view of their business —
from the moment stock is purchased to the moment profit is counted —
without requiring them to trust anyone's memory, a notebook, or a
disconnected spreadsheet.**

## What XR is

A business management and point-of-sale platform that connects:

`Product Classification → Pricing → Suppliers → Procurement → Receiving →
Batches → Inventory → QR/Barcode → POS → Sales → Payments → Documents →
Customers → FIFO/COGS → Gross Profit → Expenses → Net Profit → Analytics →
Reports`

with Auth, RBAC, Tenant Isolation, Audit, Security, Notifications,
Backup/Recovery, Mobile, and an AI boundary as cross-cutting concerns.

## What XR is explicitly NOT

- Not an MVP.
- Not another prototype.
- Not a static UI exercise.
- Not a collection of disconnected screens that each invent their own
  numbers.
- Not a system where the frontend or mobile app is trusted with financial
  truth — the backend is always authoritative.

## Scope boundary for this baseline

This vision, and the requirements documents built on it, describe **one
canonical product** — not two parallel prototypes. Where the approved UX
prototype and the master specification differ, the specification wins
unless a documented decision (ADR) says otherwise.

## Success looks like

The owner can answer, at any time, without asking anyone:

- What did I buy, when, and at what cost?
- How long has this batch been sitting unsold?
- How much have I sold, and how much is left?
- Which products are moving fast, which are stalling?
- What is my actual gross profit and net profit — not just cash in hand?
- What needs my attention today?

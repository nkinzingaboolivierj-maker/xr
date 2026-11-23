# C1 — System Context

**Status:** PARTIAL (actors are real/confirmed; every external system below is TARGET — none is connected yet)

## Purpose

Show XR as one software system and who/what it talks to. No internals here —
only "who uses XR" and "what does XR need from the outside world."

## The System

**XR Business Management & POS Platform**
A single business-management and point-of-sale system covering product
classification, procurement, inventory, sales, finance, analytics, and
reporting for one or more independently-isolated businesses (tenants).

## People (Actors)

| Actor | Uses XR for | Status |
|---|---|---|
| Business Owner | Full visibility: profit, risk, all reports | RBAC role exists (Stage 1) |
| Manager | Approves purchases, pricing, receiving | RBAC role exists (Stage 1) |
| Cashier | Runs POS, takes payment, issues receipt | RBAC role exists; **POS itself not built yet** |
| Inventory Staff | Receives stock, counts, adjusts, tracks batches | RBAC role exists; procurement/inventory built (Stage 2) |

## External Systems

All of the following are **TARGET** — referenced by the specification, not
yet integrated by any implemented code:

| External System | Relationship to XR | Status |
|---|---|---|
| Payment Provider | XR initiates payments, verifies webhooks | TARGET — no provider adapter implemented |
| WhatsApp Provider | XR queues receipt/notification delivery | TARGET — no provider adapter implemented |
| Object/File Storage | XR stores documents, receipts, exports | TARGET — not implemented |
| GS1 GPC Data Source | XR imports canonical product taxonomy | TARGET — GPC import not implemented; products currently use a flat category field |
| Mobile Device (as physical endpoint) | Runs the XR mobile client | Mobile API client exists and is tested; no production mobile app built |

## Relationships

- Owner / Manager / Cashier / Inventory Staff → **authenticate and act
  through XR**, scoped to their business and role (Stage 1: implemented,
  tested).
- XR → **Payment Provider**: initiate payment, receive webhook confirmation
  — TARGET.
- XR → **WhatsApp Provider**: deliver receipts/alerts — TARGET.
- XR → **Object Storage**: persist generated documents — TARGET.
- XR → **GS1 GPC Source**: import/version canonical product taxonomy —
  TARGET.

## Explicitly not shown

No AI provider, no external identity provider (SSO/OAuth), and no
monitoring platform are shown — none are part of the current or
near-term specification with a confirmed provider choice. They would be
added here only once an explicit provider decision exists (see ADR
process in the standards block).

# 10 — Software Requirements Specification (SRS)

This is the umbrella SRS. It does not repeat the detail already captured
in the dedicated documents — it defines scope, structure, and how the
pieces fit, per a standard SRS shape (introduction → overall description
→ specific requirements → appendices).

## 1. Introduction

### 1.1 Purpose
Define, unambiguously and testably, what XR Business Management & POS must
do, so that engineering, QA, and business stakeholders share one source of
truth — replacing scattered conversation history with a versioned
document set.

### 1.2 Scope
One canonical product covering Product Classification, Pricing,
Procurement, Inventory (ledger + FIFO + aging), POS, Sales, Payments,
Customers, Returns, Refunds, Finance, Analytics, Documents, Notifications,
Reports, plus cross-cutting Auth/RBAC/Tenant Isolation/Audit/Security.
See `02_PRODUCT_VISION.md` for the full boundary statement.

### 1.3 Definitions
See `docs/product/46_GLOSSARY.md` (not yet produced — logged as pending in
the traceability workbook's `OPEN_DECISIONS` sheet).

### 1.4 References
- `docs/c4/*` — architecture (already delivered)
- Standards: GS1 GPC, GS1 General Specifications, UNECE Rec. 20,
  ISO 4217/3166/8601, OpenAPI 3.2, OWASP ASVS 5.0.0, WCAG 2.2, RFC 9457

## 2. Overall Description

### 2.1 Product Perspective
XR is a modular-monolith backend today (Node.js, SQLite, no external
dependencies), with an approved UX prototype as a design reference and a
tested mobile API client as its mobile-facing contract. See
`docs/c4/C2_CONTAINER_DIAGRAM.md`.

### 2.2 Product Functions (summary — detail in `08_FUNCTIONAL_REQUIREMENTS.md`)
Identity & Access · Product & Classification · Pricing · Procurement &
Inventory · Sales/POS/Payments (target) · Customers/Returns/Refunds
(target) · Finance/Analytics (target) · Documents/Notifications (target) ·
Reports (target) · Mobile (partial).

### 2.3 User Classes
See `05_USER_CLASSES.md` — Owner, Manager, Cashier, Inventory Staff.

### 2.4 Operating Environment
Development: Node.js (v22+), SQLite, no network access, no external
dependencies. Target production: PostgreSQL, HTTPS, object storage, queue
— see `docs/c4/DEPLOYMENT_RELATIONSHIP.md`. No hosting platform is
selected yet (candidates: Railway, Render, Fly.io).

### 2.5 Design and Implementation Constraints
- No invented product taxonomy — GS1 GPC only.
- No invented units, currency, or country codes — UNECE Rec. 20 / ISO
  4217 / ISO 3166 only.
- Backend is always authoritative; frontend/mobile validation is UX-only.
- No microservice-per-screen; domain boundaries per
  `docs/c4/TARGET_DOMAIN_ARCHITECTURE.md`.

### 2.6 Assumptions and Dependencies
- A second prototype ZIP will be supplied for reconciliation before the
  UX/architecture baseline is frozen.
- A payment provider, WhatsApp provider, and hosting platform remain
  unselected — tracked in `OPEN_DECISIONS`.

## 3. Specific Requirements

- **Functional Requirements:** `08_FUNCTIONAL_REQUIREMENTS.md` (FR-IDs)
- **Non-Functional Requirements:** `11_NFR.md` (NFR-IDs)
- **Business Rules:** `12_BUSINESS_RULES.md`
- **Use Cases:** `09_USE_CASES.md` (UC-IDs)
- **User Stories & Acceptance Criteria:** `07_USER_STORIES.md` (US-IDs)
- **External Interface Requirements:** to be detailed in
  `docs/contracts/openapi.yaml` and `docs/contracts/FE_BE_CONTRACT.md`
  (pending — next in the delivery order).

## 4. Verification

Every FR/NFR above is either:
- **IMPLEMENTED** with a cited test (`tests/stage1.test.js`,
  `tests/stage2.test.js`, or the mobile client's 11/11 suite), or
- **TARGET**, with no verification claimed.

No requirement in this SRS is marked complete without that evidence — this
mirrors the master specification's own "no PASS without evidence" rule.

## 5. Change Control

Any change to an FR/NFR ID's meaning after this baseline requires a note
in `docs/product/47_OPEN_DECISIONS.md` (or an ADR under
`docs/product/architectural-decisions/`) — IDs are never silently
redefined.

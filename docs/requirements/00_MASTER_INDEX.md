# XR — Master Index (Requirements Documentation Package)

This package is the **Software Requirements Specification baseline** for
XR Business Management & POS. It is written against what is actually known
today — the approved UX prototype, the tested Stage 1 (Foundation) and
Stage 2 (Procurement + Inventory) backend, the C4 architecture package, and
the master specification you provided across multiple prompts.

## Evidence basis (same as the C4 package)

- **IMPLEMENTED** claims are backed by 52/52 integration checks
  (`tests/stage1.test.js`, `tests/stage2.test.js`) against a real running
  server and real SQLite database.
- **TARGET** items are specified but not built — labelled honestly, never
  presented as done.
- Product classification is specified against **GS1 GPC** (no invented
  categories); units against **UNECE Rec. 20**; currency/country/date
  against **ISO 4217 / 3166 / 8601**; security verification against
  **OWASP ASVS 5.0.0**.

## Documents in this package

| # | Document | Covers |
|---|---|---|
| 02 | `02_PRODUCT_VISION.md` | Problem statement, product vision, scope boundaries |
| 03 | `03_BUSINESS_REQUIREMENTS.md` | The core user requirement — what the owner needs to know |
| 04 | `04_WHO_WHAT_WHY.md` | Actor → action → motivation matrix |
| 05 | `05_USER_CLASSES.md` | Roles, responsibilities, permission scope |
| 06 | `06_FEATURE_JUSTIFICATION.md` | Why each major feature exists — value and risk if absent |
| 07 | `07_USER_STORIES.md` | User stories with acceptance criteria, mapped to FRs |
| 08 | `08_FUNCTIONAL_REQUIREMENTS.md` | Full FR-ID catalog by domain |
| 09 | `09_USE_CASES.md` | Use case catalog with actors and flows |
| 10 | `10_SRS.md` | The umbrella Software Requirements Specification |
| 11 | `11_NFR.md` | Non-functional requirements with measurable targets |
| 12 | `12_BUSINESS_RULES.md` | Non-negotiable system rules |

## Companion deliverable

`docs/traceability/XR_REQUIREMENTS_TRACEABILITY.xlsx` — the same
requirements, use cases, stories, features, APIs, DB entities, tests, and
security controls in one filterable workbook, so any requirement here can
be traced end to end.

## What is intentionally NOT in this package yet

Architecture (`docs/c4/`) was delivered separately and already exists.
Still pending, per your master prompt's own ordering, and requiring the
second prototype ZIP first: **Project Discovery**, **Prototype
Reconciliation**, full **API/FE-BE Contracts**, **Security Baseline /
Threat Model**, **Test Case Catalog**, **Production Deployment**, and the
**Standards Compliance Matrix**. These come next, in that order, once the
second prototype is supplied.

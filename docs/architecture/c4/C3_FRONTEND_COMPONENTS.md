# C3 — Frontend Components (Web)

**Status:** N/A as production architecture — the current web artifact is a
single-file static prototype with no component architecture, no API client,
and no state layer. This document records what exists honestly and defines
the target shape.

## Container in view

**Desktop Web Prototype** (`xr-pos-demo.html`) → target: **Production Web
Application**

## Current state

`xr-pos-demo.html` is one static HTML file:

- All 11 tabs (Dashboard, POS, Products, Purchases, Inventory, Sales,
  Customers, Expenses, Analytics, Documents, Settings) render from
  **in-memory JavaScript state**, seeded with development example data.
- There is **no API client** — nothing in the file calls the XR API
  Application.
- There is **no build system, no framework, no component boundary** —
  it is one script driving direct DOM updates.
- Its purpose has always been explicit: a UX/interaction reference
  (navigation shape, POS flow, receipt layout, dashboard layout), not a
  codebase to extend into production.

Because of this, a component diagram in the C4 sense (UI → Feature Modules
→ API Client → State Layer → Backend API) **does not exist yet** for the
web frontend. Documenting invented components here would violate the
"no fictional components" rule.

## Target component shape

| Layer | Responsibility |
|---|---|
| UI Components | Presentation only — buttons, tables, forms, cards |
| Feature Modules | One per domain: POS, Products, Purchases, Inventory, Sales, Customers, Expenses, Analytics, Documents, Settings |
| API Client | Centralized HTTP client — auth, base URL, error normalization, retries |
| State/Data Layer | Server-driven state (queries/cache), never a second source of truth |
| Backend API | The real XR API Application |

## Non-negotiable target rule

The frontend **must not** independently compute:

- stock levels
- final prices
- financial totals
- payment state
- permissions

All of the above are server-authoritative. The prototype currently violates
this by necessity (it has no backend to call) — this is acceptable for a UX
reference and unacceptable for the production target.

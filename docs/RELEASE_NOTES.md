# Release notes

## 1.0.0 — Stage 12 "production readiness" (this release)

First release that includes a **real web app** and **deployment packaging**, plus fixes for defects found
by auditing the 152-test baseline. Full list with evidence: `docs/audit/AUDIT_REPORT.md`.

### Added
* **Web app** (`public/`, served by the API): sign-in, dashboard, POS (barcode/keyboard scan, cart, cash / manual
  Mobile Money / provider payment, receipt), sales & receipts (screen, print, PDF), returns & refunds, customers,
  products & pricing, inventory (stock, aging, ledger, adjustments, supplier returns), purchasing with a printable PO document,
  expenses, finance & reports (+CSV), payments & reconciliation, team management, business profile, tax, account/sessions.
* **API:** `GET /me`, `GET/PATCH /business`, `/users` (list/create/update/reset-password), `POST /sales/{id}/confirm-payment`,
  `GET /documents/receipt/{id}/pdf`, `paymentIntentId`/`paymentReference` on `POST /sales`, `q` search on `/products`,
  `collectedCash` / `pendingPayments` / `refundsPaid` / `taxReturned` in the finance summary.
* **Operations:** versioned migrations, 40 indexes, WAL mode, append-only audit/ledger tables, graceful shutdown,
  `scripts/bootstrap.js`, `backup.js`, `restore.js`, `reset-password.js`, `healthcheck.js`, `generate-openapi.js`.
* **Packaging:** `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, deployment/backup/runbook docs.
* **Docs:** generated OpenAPI 3.1 (72 operations) with drift test; updated ASVS matrix, C4, traceability workbook, limitations.

### Fixed (highlights)
Unauthenticated crash on malformed URLs • forgeable payment webhook / reachable mock providers in production •
second business could not log in with a shared email • over-refund on discounted sales (and finance consistency) •
any payment attachable to any sale • no indexes • no first-user bootstrap • non-cash sales stuck PENDING •
500s reported as 400 • unbounded request bodies/paging • plaintext session tokens, no idle timeout • schema without versioning.

### Changed (behaviour)
* Provider-not-connected is now `503 PROVIDER_NOT_CONFIGURED` (was `400`).
* Session tokens are stored hashed; **everyone signs in again after upgrading**.
* `GET /sales/{id}` items now include `id`. `GET /products` is bounded (`pageSize` ≤ 200).
* A returned item's value is the amount actually paid (after discount, with tax), not list price × quantity.
* `NODE_ENV=production` disables simulated payments/WhatsApp; `ALLOW_MOCK_PROVIDERS` re-enables them explicitly.
* Node ≥ 22.13 required (unflagged `node:sqlite`).
* The old `openapi.yaml` (30 operations, wrong `/api/v1` prefix, endpoints that never existed) is replaced by generated `openapi.json`.

### Upgrade
`npm run backup` → deploy → start (migrations 002–007 apply automatically) → users sign in again.

### Blocked / open
See `docs/KNOWN_LIMITATIONS.md` (hosting choice, payment/WhatsApp credentials, official GPC dataset, standards files).


## 1.1.0 — UI refresh

Visual redesign of the web app (and, automatically, the mobile WebView
wrapper that loads it), guided by a set of reference POS/SaaS dashboard
designs. No backend, API, or business-logic changes — re-verified with the
full 243-test backend suite and the 27-step real-browser end-to-end test
(both unchanged in count, both still passing).

* Refreshed color tokens, card/button radius and shadow for a cleaner,
  cooler-neutral dashboard look (light and dark).
* Stat cards now show a small colored icon chip per metric (decorative only
  — never a stand-in for data the server doesn't compute; no fabricated
  trend arrows were added).
* A working Auto/Light/Dark theme toggle in the sidebar, persisted locally.
* Customers and Team tables show a colored initials avatar next to each
  name.
* Sidebar and navigation spacing/active-state polish.

All changes are CSS classes and small DOM additions — the strict CSP
(`style-src 'self'`, no inline styles) was re-verified to still hold with
zero violations.


## 1.1.1 — Mobile bottom navigation

Added a fixed bottom tab bar for phone-width screens (Dashboard, Point of
sale, Sales, Returns & refunds, and a More tab that opens the full sidebar
drawer), matching the bottom-bar pattern common to POS mobile apps. The
existing "☰ Menu" hamburger/drawer is unchanged and still has every
destination. Re-verified: 243/243 backend tests, 27/27 browser end-to-end
steps (including the dedicated mobile-viewport step), zero CSP violations.


## 1.2.0 — Dashboard sales trend chart

Added a "Sales — last 7 days" bar chart to the Dashboard, under the profit
stat cards, matching the trend-chart pattern common to the POS/SaaS
dashboard references. Built with a small dependency-free inline SVG
component (`barChart()` in `public/js/dom.js`) rather than a charting
library, keeping the project's zero-npm-dependency frontend. Every bar is a
real sum of that day's completed sales for the signed-in business (fetched
from `/reports/sales`), grouped by the business's own local calendar day —
never estimated or fabricated. Verified against real transaction data
(a two-sale day totalling exactly 3,000 RWF rendered correctly) and in both
light and dark themes. Re-confirmed: 243/243 backend tests, 27/27 browser
end-to-end steps (three consecutive clean runs), zero CSP violations.


## 1.2.1 — Fixed: mobile horizontal overflow on every screen using period tabs

**Defect found during manual verification** (not caught by the existing
mobile E2E check, which only exercised the POS screen): on phone-width
viewports, any screen with the Today/Last 7 days/Last 30 days/etc. period
tabs (Dashboard, Finance & reports, Expenses) forced the ENTIRE page —
sidebar alignment, top bar, bottom nav — about 100px wider than the actual
screen, causing the whole app to scroll sideways. Root cause: `.main-col`,
the direct CSS Grid item holding the page content, had no `min-width: 0`,
so its default `min-width: auto` let the horizontally-scrollable tab strip's
un-shrinkable content silently force the whole shell wider than the
viewport — a pre-existing layout gap, not something introduced by the
recent chart or bottom-nav additions (both were investigated and ruled out
first). Fixed with one CSS rule (`public/styles.css`); the tab strip itself
still scrolls horizontally exactly as intended, now correctly contained
within the screen.

Verified: swept all 14 screens at a 390px phone viewport after the fix —
zero horizontal overflow on every one (previously untested this
thoroughly). Re-confirmed 243/243 backend tests and 27/27 end-to-end
browser steps, three consecutive clean runs.


## 1.2.2 — Render Blueprint

Added `render.yaml` at the project root so Render's "New Blueprint" flow
can pre-fill the web service, environment variables and the persistent
disk at `/data` automatically, instead of configuring each by hand in the
dashboard. `docs/operations/DEPLOYMENT.md` has a new "Render, specifically"
section with the exact steps and the two things that still need a manual
check (plan tier for the disk; Render's own dashboard as the source of
truth if its Blueprint field names have changed). No application code
changed; re-confirmed 243/243 backend tests and 27/27 browser end-to-end
steps.


## 1.2.3 — render.yaml: more conservative field names

Render reported "A Blueprint file was found, but there was an issue" on
`render.yaml`. Without network access to test against Render's live
validator, the two fields least certain to be current (`runtime: docker`
and `autoDeployTrigger: commit`) were replaced with the longer-established
`env: docker`, and `autoDeployTrigger` was dropped (Render's default
auto-deploy behavior applies without it). If Render still rejects the file,
its own dashboard error detail is the thing to go by — the comment at the
top of `render.yaml` says this directly. No application code changed.

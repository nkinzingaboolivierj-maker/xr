# XR — Production-readiness audit (Stage 12)

Evidence-based. Every "VERIFIED" below names the test that proves it. Nothing here claims zero defects, absolute
security, standards certification, or a live deployment.

## 1. What was supplied — and what was not

| Supplied | Not supplied |
|---|---|
| Backend ZIP (11 stages, 152 tests), C4 docs, API contracts, requirements docs, traceability workbook, 2 demo HTML prototypes + overview pages, 7 UI reference images | **The official standards files** (GS1 GPC dataset, GS1 General Specs, OWASP ASVS, UN/CEFACT, ISO, WCAG…); any **frontend/mobile source beyond the demos**; PostgreSQL / package-registry access; provider credentials; a hosting target |

Consequence: standards were **not** re-verified (see `docs/standards/STANDARDS_INVENTORY.md`), and the earlier "mobile
client library" mentioned in prior sessions is **not in this project** — only an HTML prototype exists.

## 2. Inventory (before → after)

| | Baseline | Now |
|---|---|---|
| API routes | 72 implemented, **30 documented** (wrong `/api/v1` prefix, phantom endpoints) | 72 implemented, 72 documented (generated) |
| Backend source | 19 modules (line count not recorded) | 4.6k lines in 59 files, 21 modules (+users, business profile; PDF, migrations) |
| Frontend | HTML demos with **0 `fetch()` calls** (in-memory data) | Real web app, 22 files / 1.4k lines, all screens on the real API |
| DB | `schema.sql` applied wholesale, **0 secondary indexes** | 7 forward-only migrations, 40 indexes, WAL, append-only ledgers |
| Tests | 152 (SQLite, in-process) | **243** backend + **27-step real-browser E2E** |
| Deployment | none (bound to 127.0.0.1, no Dockerfile) | Dockerfile, Compose, Caddy, env template, runbooks |

Stack: Node ≥ 22.13, built-in `node:http` / `node:sqlite` / `node:crypto`, **no npm dependencies**; vanilla ES-module frontend, no build step.

## 3. Baseline

`npm test` → 152/152 passed (before any change). The suite proves the SQLite prototype's logic; it did not exercise
hostile input, multi-tenant login, forged webhooks, discounted returns, or any browser.

## 4. Defects found, reproduced and fixed

Each was reproduced against the baseline before fixing, then pinned by a test.

| ID | Sev | Defect | Fix → evidence |
|---|---|---|---|
| D1 | **Critical** | `GET /sales/%E0%A4%A` (unauthenticated) threw an uncaught `URIError` → unhandled rejection → **Node process exit** | Safe decoding → 400. `stage12` "HTTP robustness" |
| D2 | **Critical** | Webhook "secret" was a constant **published in source**; mock payment/WhatsApp providers were reachable in production → **anyone could forge a payment success** | Mock closed in production; `PAYMENT_WEBHOOK_SECRET` (≥32) required; mock WhatsApp can't report SENT in production. `stage12` payments |
| D3 | High | Login looked up users **by email alone** — the second business using an email could never sign in | All matches checked; `BUSINESS_SELECTION_REQUIRED`; `businessId`. `stage12` auth |
| D4 | High | Returns refunded **list price × qty**, ignoring discounts and tax → **over-refund on discounted sales**; finance returns inconsistent | Pro-rata share of amount actually paid; net/tax split (migration 007); full return nets finance to exactly 0. `stage12` returns/finance |
| D5 | High | Any SUCCESS payment intent attachable to **any sale** (no amount/currency/method check); a settled payment could be flipped by a later webhook; intents reusable | Match checks, one sale per intent, terminal-state machine, late-SUCCESS surfaces for reconciliation. `stage12` payments |
| D6 | High | **No indexes** beyond keys: every tenant list, FIFO pick, ledger view and report was a table scan | 40 indexes; `EXPLAIN QUERY PLAN` assertions. `stage12` database |
| D7 | High | No way to create the **first business/Owner** or manage users in a deployed system | `scripts/bootstrap.js`, `/users`, `reset-password` CLI. `stage12` users/ops |
| D8 | High | Non-cash sales stayed **PENDING forever** | Provider-verified settlement, audited manual confirmation, `requireVerifiedPayments`. `stage12`, E2E 13 |
| D9 | High | Frontend not integrated; server bound only to `127.0.0.1`; no static hosting, CORS, security headers, graceful shutdown | Web app + headers/CSP/CORS/HOST/SIGTERM. `e2e`, `stage12` |
| D10 | Med | Unexpected faults reported as **HTTP 400** | 500 `INTERNAL_ERROR` + `requestId`. `stage12` |
| D11 | Med | Unbounded request body | 1 MiB cap (413); 20 MiB only for authenticated GPC import. `stage12` |
| D12 | Med | Session tokens stored **plaintext**; no idle timeout; unknown-email login faster than wrong-password | SHA-256 at rest, idle timeout, dummy-hash verify. `stage12` |
| D13 | Med | Paging unvalidated (`NaN`→500, negative offset, whole-table reads); ledger read unbounded | `parsePaging`, caps. `stage12` |
| D14 | Med | Missing/NaN/negative inputs on sales & returns reached SQLite (500) | Up-front validation. `stage12` |
| D15 | Med | `GET /sales/:id` hid item ids → **returns impossible through the API** | `id` exposed. `stage12` |
| D16 | Med | No schema versioning | `schema_migrations` + upgrade-in-place test. `stage12` |
| D17 | Low | Audit/ledger rows editable by SQL | DB triggers. `stage12` |
| D18 | Low | OpenAPI and error docs drifted from code | Generated spec + two drift tests. `stage12` |
| D19 | Low | No collected-cash vs revenue separation | `collectedCash`, `refundsPaid`, `pendingPayments`. `stage12`, E2E 15 |
| D20 | Low | Receipt lacked tax/discount/currency/TIN; no PDF | Enriched receipt + dependency-free PDF writer verified with `pdftotext`/`pdfinfo`. `stage12` |
| F1–F3 | — | Found *by the browser test* in the new UI (never shipped): confirm dialogs always resolved false; retry after a failed module import; settings not refreshing | Fixed in `public/js`. `e2e` |

Tests whose expectations encoded the old behaviour were changed **deliberately**, with the reason recorded in the test:
two `stage11` assertions (400 → 503 for a missing provider; a provider payment may only settle a matching sale).

## 5. Status by area (labels per the audit brief)

| Area | Label | Basis |
|---|---|---|
| Auth, sessions, RBAC, tenant isolation, audit | **VERIFIED** | `stage1/6/7/12`, E2E 20–23 |
| Inventory ledger, FIFO/COGS, purchasing, receiving | **VERIFIED** | `stage2/3/6/12`, E2E 7–8 |
| POS, pricing band, discounts, tax, idempotency, concurrency | **VERIFIED** | `stage1/3/8/12`, E2E 9–13 |
| Returns, refunds, finance, reports | **VERIFIED** | `stage4/5/6/12`, E2E 14–17 |
| Receipts (JSON/text/PDF) | **VERIFIED** | `stage5/12` (PDF parsed by poppler) |
| Cash + manual-confirm Mobile Money/card | **VERIFIED** | `stage12`, E2E 13 |
| Provider payments (Airtel/MTN/card) | **BLOCKED** (credentials) — adapter/state machine **VERIFIED against MOCK only** | `stage3/11/12` |
| WhatsApp delivery | **BLOCKED** (credentials) — queue/retry **VERIFIED against MOCK only** | `stage10/12` |
| GS1 GPC | **BLOCKED** (dataset) — importer **VERIFIED on synthetic rows only** | `stage9/12` |
| Web app ↔ backend integration | **VERIFIED** | `e2e/e2e.js` 27/27, Chromium |
| Mobile (native) | **NOT IMPLEMENTED** — responsive web app verified at 390 px (E2E 26) | — |
| Offline mode | **NOT IMPLEMENTED** (idempotent retry makes dropped connections safe) | `stage3`, E2E 24 |
| Database | **SQLite WAL, VERIFIED**; **PostgreSQL NOT IMPLEMENTED** (see KNOWN_LIMITATIONS) | `stage12` |
| Migrations | **VERIFIED** incl. in-place upgrade of a pre-Stage-12 DB | `stage12` |
| Backup / restore | **VERIFIED locally**; schedule + off-site + host drill = operator tasks | `stage12` |
| OpenAPI | **VERIFIED** route parity + no drift (response bodies documented generically) | `stage12` |
| Security headers/CSP/CORS | **VERIFIED** | `stage12`, E2E 27 |
| ASVS | **Self-assessment only**; PDF not supplied | `docs/security/` |
| Accessibility (WCAG) | **IMPLEMENTED, NOT VERIFIED** (no automated audit; contrast not measured) | manual measures |
| Docker image / Compose | **IMPLEMENTED, NOT VERIFIED** (no Docker here); same start path executed as a real process | `stage12` |
| Live deployment | **NOT DONE** (no host/domain/credentials) | — |
| Load / performance | **NOT MEASURED** | — |

## 6. Commands executed and results

| Command | Result |
|---|---|
| `npm test` (baseline, before changes) | 152 / 152 pass |
| `npm test` (final) | **243 / 243 pass**, repeated runs stable, ~16 s |
| `node e2e/e2e.js` (headless Chromium via Playwright 1.56, real backend) | **27 / 27 steps pass**, zero console errors / CSP violations |
| `node scripts/generate-openapi.js` + parity test | 72 routes ↔ 72 operations, no drift |
| `mmdc` render of the C2 diagram | OK (`docs/architecture/C2_container_current.svg`) |
| Final clean-room check | the delivered ZIP was extracted into an empty directory and `npm test` was run from there (see §8) |

## 7. Remaining blockers and decisions

See `docs/KNOWN_LIMITATIONS.md` (B1–B6). In one line: **choose a host/domain; supply Airtel/MTN/card and WhatsApp credentials;
supply the official GS1 GPC dataset and standards files.**

## 8. Launch / test / deploy

Local: `XR_BOOTSTRAP_PASSWORD=… node scripts/bootstrap.js --business "…" --email …` then `npm start`.
Tests: `npm test`; browser: `npm run e2e`. Deploy: `docs/operations/DEPLOYMENT.md`.

## 9. Things this audit did *not* do (so you don't assume it did)

No live deployment · no PostgreSQL migration · no real provider integration · no penetration test · no load test · no WCAG tool
run · no re-reading of any standard · no native mobile app · Docker image never built.

## Stage 13 — v1.2.4 follow-up verification

- Added server-side least-privilege masking for Cashier responses: sale COGS/gross profit and batch unit costs, inventory aging unit costs, and inventory report stock valuation are omitted. Manager retains the corresponding financial fields.
- Added regression coverage in `tests/stage13.test.js` and adjusted financial-calculation fixtures to use Manager credentials where the test explicitly inspects confidential COGS.
- Updated the primary UI accent to the agreed deep navy `#06152A` with white contrast in dark mode; status colors remain semantic indicators.
- `npm test`: **247/247 passed** on Node 22.16.0.
- `npm run e2e`: **not run successfully in this environment** because the ZIP does not include Playwright and the package has no dependencies. Install Playwright + Chromium in a network-enabled environment before release.
- No Docker build or live deployment was performed. External provider integrations, official GS1 data, PostgreSQL, native mobile/offline, and production host/domain remain blocked or unimplemented as detailed in `KNOWN_LIMITATIONS.md`.

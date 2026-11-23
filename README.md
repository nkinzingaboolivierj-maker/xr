# XR — Business Management & POS

A ledger-based, FIFO-batch inventory + point-of-sale + purchasing + returns + finance system for small
businesses, built to run as **one Node.js process with zero npm dependencies**: the same process serves
the REST API and the web app, and stores data in a single SQLite (WAL) file.

> **Honest status (v1.2.4):** the backend (247 automated tests) is verified locally. The browser E2E suite is included but
> requires Playwright + Chromium to be installed separately; it was not runnable in this verification environment.
> are verified together. **Not yet live:** nothing has been deployed, and Airtel/MTN/card payments, WhatsApp
> delivery and official GS1 GPC classification are **blocked on credentials/data you must supply**. Cash and
> manually-confirmed Mobile Money/card sales, returns, refunds, stock, purchasing, finance and reporting are ready.
> Read `docs/KNOWN_LIMITATIONS.md` before relying on it.

## Run it locally (2 minutes)

Requires **Node ≥ 22.13**.

```bash
# 1. create the first business + Owner (no default accounts exist anywhere)
XR_BOOTSTRAP_PASSWORD='a-long-passphrase' node scripts/bootstrap.js --business "My Shop" --email me@myshop.rw
# 2. start (uses ./data/xr.db by default)
npm start            # -> http://127.0.0.1:3000
```

Open http://127.0.0.1:3000, sign in, then: **Business** (profile, TIN, tax rate) → **Products** (add + set prices) →
**Purchases** (supplier → PO → receive) → **Point of sale**. Add staff under **Team**.

## Tests

```bash
npm test             # 247 backend tests (real HTTP server + real SQLite; no network needed)
npm i --no-save playwright && npx playwright install chromium
npm run e2e          # 27-step real-browser test of the web app against the real backend
npm run openapi      # regenerate docs/contracts/openapi.json (a test fails if it drifts)
```

## Deploy

`docs/operations/DEPLOYMENT.md` — Docker Compose + Caddy on any VPS, or any platform that gives the container a
persistent volume at `/data`. **Run one instance only.** The single decision still needed: *where*.

## What is where

| Path | Contents |
|---|---|
| `src/` | API: `lib/` (http, config, errors, crypto…), `modules/` (auth, rbac, users, business, products, gpc, suppliers, purchases, inventory/FIFO, customers, sales, tax, returns, refunds, expenses, finance, analytics, reports, documents/PDF, notifications, payments), `migrate.js`, `schema.sql` |
| `public/` | Web app (vanilla JS, no build step, strict CSP, no `innerHTML`) |
| `scripts/` | `bootstrap`, `backup`, `restore`, `reset-password`, `healthcheck`, `generate-openapi` |
| `tests/` | `stage1`–`stage12` backend suites; `e2e/` browser test + screenshots |
| `docs/audit/` | **Start here:** `AUDIT_REPORT.md` — inventory, defects found/fixed, evidence, status |
| `docs/operations/` | Deployment, backup/restore, runbook, GPC import |
| `docs/contracts/` | Generated `openapi.json`, error model, FE↔BE contract |
| `docs/security/` | OWASP ASVS self-assessment matrix |
| `docs/architecture/` | C4 (original + Stage 12 update, current vs target) |
| `docs/requirements/` | SRS, user stories, use cases, rules |
| `docs/traceability/` | `XR_Requirements_Traceability.xlsx` (requirements → endpoints → screens → tests → status) |
| `docs/standards/` | Standards inventory + applicability (note: standards files were not in the audit upload) |
| `prototypes/` | Original HTML prototypes — **superseded**, reference only |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example` | Packaging |

## Roles

Owner (everything incl. users/settings) · Manager (prices, purchasing, discounts, reports) · Cashier (POS, payments, returns) ·
Inventory Staff (receiving, adjustments). Enforced server-side; the UI only hides controls.

## Design rules that the code enforces

Stock is derived from batches and an append-only ledger, never typed in • the server computes price, discount, tax, FIFO COGS
and totals atomically and idempotently • payment status is never taken from the client • every change is audited and
history rows are tamper-resistant • business data is isolated per tenant • profit = revenue − COGS − expenses (stock age is
an inventory metric, never a profit signal).

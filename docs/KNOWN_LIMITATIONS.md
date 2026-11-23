# Known limitations and external blockers

Status labels: **BLOCKED** (needs something only you can supply), **NOT IMPLEMENTED**, **LIMITATION** (works, with a stated boundary), **UNVERIFIED** (exists, not proven here).

## External blockers (exact dependency → how to resolve)

| # | Item | Needed from you | Resolution |
|---|---|---|---|
| B1 | **Live deployment** | A hosting choice, a domain, deployment credentials | Follow `operations/DEPLOYMENT.md`. Nothing was deployed; the Docker image and compose file were **not built or run** (no Docker in the audit environment). The identical start path (`NODE_ENV=production node src/server.js`, bootstrap, healthcheck, SIGTERM) *was* executed as a real child process in `tests/stage12`. |
| B2 | **Airtel Money / MTN MoMo / card payments** | Provider merchant accounts, API docs, sandbox credentials, webhook signing scheme | Implement `RealPaymentProvider` (`src/modules/payments/payment.provider.js`), set `PAYMENT_WEBHOOK_SECRET`, switch the business to `REAL`. Until then provider endpoints return `503 PROVIDER_NOT_CONFIGURED`; Mobile Money/card sales work with **manual confirmation** (audited). |
| B3 | **WhatsApp receipts** | WhatsApp Business API credentials + approved templates | Implement `RealWhatsAppProvider`. Until then deliveries stay queued/failed and are **never** reported as sent. |
| B4 | **Official GS1 GPC classification** | The official GS1 GPC dataset (and the converter for its file layout) | `operations/GPC_IMPORT.md`. Until then products are "Not classified". |
| B5 | **Standards re-verification** | The official standards files (ASVS PDF, GS1, UN/CEFACT, ISO extracts, WCAG) | They were not in the Stage 12 upload. Re-run the standards audit when supplied. |
| B6 | **TLS** | Domain + host | Caddy config provided; unverified without a real host. |

## Not implemented

| Item | Note |
|---|---|
| PostgreSQL | **Decision, not an oversight.** The audit environment had no PostgreSQL server and no package registry; moving the synchronous data layer to an async driver is a rewrite whose result could not be verified here, so it was not attempted. SQLite in WAL mode is a real transactional database and suits a single-shop, single-instance deployment. Move to PostgreSQL when you need several app instances or much higher write volume (ADR-0005). |
| Native mobile app / offline mode | No Expo/React-Native source exists in the supplied project (only an HTML prototype). The responsive web app works on phones (verified at 390 px). The web app needs a connection; because sales carry an `operationId`, retrying after a dropped connection can never create a second sale. |
| GTIN check-digit validation; QR/label generation | Barcodes are stored and looked up only. |
| UN/CEFACT unit codes | Units are free text. |
| Stock-coverage / reorder-point analytics; reorder alerts | Low-stock indicator only. |
| In-app audit-log viewer / read API | Audit rows are written and tamper-resistant; read them in the database. |
| Server-side invoice / purchase-order PDF | Receipts have a server PDF; the PO prints from the browser (print → Save as PDF). |
| Sale void / cancel | Reverse a sale with a return + refund. |
| Error-reporting / alerting integration | `/health`, `/ready`, JSON logs only. |

## Limitations (works, with boundaries)

* **Single instance only.** Rate limiter and notification worker are in-process; SQLite has one writer. Do not run replicas.
* **No retry back-off** for notification delivery (3 quick attempts, then FAILED).
* **Money is stored as REAL** with 2-decimal rounding at calculation boundaries. Safe for RWF (integral); move to integer minor units before supporting fractional currencies at scale.
* **Cashier financial-data masking (v1.2.4):** sale COGS/gross profit, batch unit costs, inventory-aging unit costs and inventory valuation are now omitted server-side from Cashier API responses. Manager/Owner retain those fields. Other role/data combinations should still be reviewed against the final business policy.
* **Login lock-out can be abused**: 5 failed attempts lock an *email* for 15 minutes (standard trade-off); the per-IP ceiling is 60.
* **Date-range filters** use the browser's local day boundaries against UTC timestamps (up to a 2-hour skew in Kigali near midnight).
* **Print/PDF**: purchase orders rely on the browser's "Save as PDF".
* **Node's `node:sqlite` is marked experimental/active-development** by Node. The Dockerfile pins Node 22; re-test before changing the Node major version.

## Not verified in this audit

Load/performance; a restore drill on your own host; TLS and proxy headers on a real domain; camera barcode scanning (needs a real camera/browser support — keyboard scanners are verified); WCAG automated audit and colour-contrast measurement; browsers other than Chromium; a penetration test.

## External services discussed but NOT integrated (Postgres/Supabase/S3/Resend)

A request was made to migrate this project onto Neon PostgreSQL, Neon Object
Storage (S3-compatible), Neon Auth or Supabase Auth, and Resend email, with
real connection strings and keys supplied directly in chat. This was
**not implemented**, for two separate reasons, both worth recording:

1. **No network access in the environment that built this project.** Every
   piece of that stack (installing `@aws-sdk/client-s3`, `@supabase/supabase-js`,
   `resend`, a Postgres driver; connecting to Neon/Supabase; sending a real
   email) requires internet access the build environment does not have. Claiming
   any of it was done without being able to run and verify it would violate the
   basic rule this project holds itself to: nothing is marked working without a
   passing test.
2. **It would mean replacing a real, tested system with an unverified one.**
   The current stack (SQLite WAL, session-based auth with scrypt hashing and
   audit logging) is covered by 243 automated tests and a 27-step real-browser
   test. Swapping to Postgres + Supabase/Neon Auth + S3 + Resend is a
   legitimate future direction (see ADR-0005 for the Postgres question
   specifically) but is a separately-scoped migration that needs an
   environment with real network access to build and verify end to end — not
   something to do blind.

**Action required regardless of the above:** connection strings and API keys
for Neon Postgres, Neon Object Storage, and Resend were pasted in plain text
in a chat conversation at some point. Treat all of them as compromised and
rotate every one — the Postgres role password, the S3-compatible access
key/secret pair, and the Resend API key — from each service's own dashboard
before using them anywhere, independent of whether or when this migration
happens. The Supabase publishable key is lower-risk by design (it's meant for
client-side use) but its project should still be reviewed if it was ever
intended to carry real auth.

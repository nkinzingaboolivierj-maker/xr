# Deployment guide

XR is a **single-instance** Node.js service with **zero npm dependencies**: one process serves the
API *and* the web app (`public/`), stores data in one SQLite file (WAL mode), and runs the
WhatsApp/notification worker in-process. Everything below is platform-neutral. **No live deployment
was performed during the Stage 12 audit** (no host, domain or deployment credentials were available);
what *was* executed and verified is listed in `docs/audit/AUDIT_REPORT.md`.

## The one decision still needed

Pick **where it runs**. Any of these works with the files provided:

| Option | Fit | Notes |
|---|---|---|
| **A VPS / any Linux host + Docker Compose** (`docker-compose.yml` + `Caddyfile`) | Simplest, cheapest, full control, automatic HTTPS | Recommended default. Needs a domain pointing at the host. |
| **Fly.io / Railway / Render** (use the `Dockerfile`) | Managed | Attach a **persistent volume at `/data`**. Run exactly **one** instance. Their router terminates TLS → keep `TRUST_PROXY=true`. |

### Render, specifically

A `render.yaml` Blueprint is included at the project root. Push this repository to GitHub, then in the Render
dashboard: **New +** → **Blueprint** → select the repo. Render reads `render.yaml` and pre-fills the service,
environment variables and the persistent disk at `/data` for you — review and click **Apply**.

Two things to check yourself, since they can't be baked into the file:
* **A persistent disk needs a paid Render plan** — the free web service tier has no attached-disk option. Check
  Render's current pricing and pick a plan in the dashboard; `render.yaml`'s `plan: starter` is a placeholder.
* Render's Blueprint field names can change over time; if the dashboard rejects or renames something, follow what
  the dashboard shows — that's always the current source of truth over this file.

After the first deploy succeeds, open the service's **Shell** tab (in the Render dashboard) and run the bootstrap
step from the previous section (`node scripts/bootstrap.js ...`) to create the first Owner.
| **Bare metal / systemd** | Fine | `node src/server.js` with the env vars below; put nginx/Caddy in front for TLS. |

Do **not** deploy to a platform without persistent disk (SQLite would lose data on every restart) and
do **not** run more than one replica (rate limiter, notification worker and SQLite writer are
per-process — see `KNOWN_LIMITATIONS.md`).

## Requirements

* Node.js **>= 22.13** (uses the built-in `node:sqlite`; the Dockerfile pins `node:22-alpine`).
* A persistent directory for the database (`XR_DB_FILE`) and backups (`XR_BACKUP_DIR`).
* HTTPS in front of it (Caddy config provided).

## Steps (VPS + Docker Compose)

```bash
git clone <your repo> xr && cd xr          # or unzip the project
cp .env.example .env                        # edit: PAYMENT_WEBHOOK_SECRET (only if you will use a real provider), etc.
# edit Caddyfile: replace shop.example.com with your domain (DNS A record -> this host)
docker compose up -d --build
docker compose run --rm -e XR_BOOTSTRAP_PASSWORD='choose-a-long-passphrase' xr \
  node scripts/bootstrap.js --business "My Shop" --email owner@myshop.rw
# open https://your-domain and sign in; then Team -> add staff; Business -> fill profile/TIN/tax rate
```

After first sign-in: change nothing about the Owner account until you have **created a second Owner**
(Team → Add team member → role Owner) so the business is never locked out.

## Steps (no Docker)

```bash
export NODE_ENV=production HOST=0.0.0.0 PORT=3000 XR_DB_FILE=/var/lib/xr/xr.db XR_BACKUP_DIR=/var/lib/xr/backups TRUST_PROXY=true HSTS=true
XR_BOOTSTRAP_PASSWORD='…' node scripts/bootstrap.js --business "My Shop" --email owner@myshop.rw
node src/server.js          # run under systemd/pm2 with Restart=always
```

## Configuration reference

See `.env.example`. Secrets are never defaulted: an unset secret means *that feature is disabled*.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` disables mock providers and binds `0.0.0.0` |
| `HOST` / `PORT` | `127.0.0.1` (dev) / `3000` | Listen address |
| `XR_DB_FILE` | `./data/xr.db` | SQLite file — **must be on persistent storage** |
| `XR_BACKUP_DIR` / `XR_BACKUP_RETAIN` | `./backups` / `14` | Backup location / how many to keep |
| `TRUST_PROXY` | off | Trust `X-Forwarded-For` (only behind your own proxy) |
| `HSTS` | off | Send `Strict-Transport-Security` (turn on once HTTPS-only) |
| `CORS_ORIGINS` | empty | Allow-list for a *separate* web origin; empty = same-origin only |
| `MAX_BODY_BYTES` | 1 MiB | Request size cap |
| `SESSION_TTL_HOURS` / `SESSION_IDLE_MINUTES` | 24 / 60 | Absolute / idle session limits |
| `ALLOW_MOCK_PROVIDERS` | off in production | Simulated payments/WhatsApp. **Leave unset in production** |
| `PAYMENT_WEBHOOK_SECRET` | none | ≥ 32 chars; required before any payment webhook is accepted |

## What works in production *today* and what does not

| Capability | Production state |
|---|---|
| Cash sales, receipts (screen / text / **PDF**), returns, refunds, stock, purchasing, expenses, finance, reports, users/roles | **Ready** |
| Mobile Money / card sales with **manual confirmation** (staff enters the transaction ID; audited) | **Ready** |
| Airtel Money / MTN MoMo / card **provider** payments | **BLOCKED** — needs provider credentials + API docs; endpoints return `503 PROVIDER_NOT_CONFIGURED` |
| WhatsApp receipt delivery | **BLOCKED** — needs WhatsApp Business credentials; messages are queued but never reported as sent |
| Official GS1 GPC classification | **BLOCKED** — needs the official GS1 dataset (see `GPC_IMPORT.md`) |

## Health, logs, monitoring

* `GET /health` (liveness) and `GET /ready` (database reachable) — unauthenticated, no secrets.
  The container `HEALTHCHECK` uses `/ready`.
* Logs are **JSON lines on stdout** with `requestId`, method, path, status, duration; secrets are redacted.
  Every response carries `X-Request-Id`; error bodies include `requestId` so a user report can be matched to a log line.
* Alert on: `/ready` != 200, `unhandled_error` log events, `mock_providers_enabled_in_production`.
* Error reporting service integration (Sentry etc.) is **not** included.

## Upgrades and rollback

* Migrations run automatically at startup, each in a transaction, forward-only and non-destructive.
* **Before every upgrade run `npm run backup`** (or `docker compose exec xr node scripts/backup.js`).
* Rollback = stop the service, deploy the previous version, then `node scripts/restore.js <the backup taken before the upgrade>`.
  Always restore the pre-upgrade backup when rolling back: migrations are forward-only, so older code is not guaranteed
  to run against a database that newer code has already migrated.

## Sizing

One small instance (0.5 vCPU / 512 MB) comfortably serves a single shop; the database indexes match the query
patterns (migration 002). Load testing has **not** been performed — treat any throughput claim as unverified.

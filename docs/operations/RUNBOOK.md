# Operations runbook

| Situation | What to do |
|---|---|
| App unreachable | `docker compose ps`; `docker compose logs --tail=200 xr`; check `/ready`. Restart: `docker compose restart xr`. Data is on the `xr-data` volume and survives restarts. |
| `/ready` = 503 | The database file is unreadable/locked. Check disk space and the volume mount; if corrupt, restore the latest backup (`BACKUP_RESTORE.md`). |
| A user reports an error | Ask for the **reference** shown in the message (`requestId`), then `docker compose logs xr \| grep <id>`. |
| User locked out | Owner: Team → Reset password (sets a temporary password, ends their sessions). Locked by rate limit: wait 15 min or restart the process (limiter is in memory). |
| Last Owner locked out | On the host: `XR_RESET_PASSWORD='temporary-passphrase' node scripts/reset-password.js --email owner@shop.rw` (add `--business <id>` if the email exists in several businesses). Sets a temporary password, re-activates the user, ends their sessions, forces a change at sign-in and audits it. Prevent this by always keeping two Owners. |
| Non-cash sale stuck PENDING | Sales → open sale → **Confirm payment** with the transaction ID (Cashier/Manager/Owner). |
| Provider payment confirmed but not on a sale | Payments → *Unreconciled* → Attach to sale (amount, currency and method must match). |
| WhatsApp receipts stay QUEUED/FAILED | Expected until a real provider is connected (`BLOCKED_PENDING_PROVIDER`). Sales are unaffected. |
| Disk filling | `XR_BACKUP_RETAIN`, rotate container logs (`docker compose` log driver limits), copy backups off-host. |
| Suspected data tampering | `audit_logs` and `inventory_movements` are append-only (DB triggers); inspect them. |
| Upgrade | Backup → deploy new version → watch `/ready` → smoke test (sign in, make a test sale, void by return). |

## Audit trail

Every price change, sale, override, return, refund, stock adjustment, payment confirmation, user change,
password reset, business-profile change and sign-in (success and failure) writes an `audit_logs` row with
actor, resource, old/new state. There is **no in-app audit viewer yet** — query the table directly
(`sqlite3 /data/xr.db "select * from audit_logs order by created_at desc limit 50"`).

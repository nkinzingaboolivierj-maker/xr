# Backup and restore

## What is backed up

The whole system is one SQLite file (plus its `-wal`/`-shm` side files while running). `scripts/backup.js`
produces a **transactionally consistent snapshot while the server keeps running** (`VACUUM INTO`), runs
`PRAGMA integrity_check` on the copy, sets mode `0600`, and prunes beyond `XR_BACKUP_RETAIN`.

```bash
npm run backup                                  # -> $XR_BACKUP_DIR/xr-<timestamp>.db
docker compose exec xr node scripts/backup.js   # inside the container
```

## Schedule (operator task)

Backups are **not scheduled by the application**. Add a cron job / platform scheduler, e.g. nightly:

```cron
15 2 * * *  cd /opt/xr && docker compose exec -T xr node scripts/backup.js >> /var/log/xr-backup.log 2>&1
```

**Copy the backup files off the machine** (object storage, another host). A backup on the same disk
does not protect against disk loss. The files are not encrypted by XR — encrypt in transit/at rest at your
storage layer.

## Restore

1. **Stop XR** (`docker compose stop xr`) — the live file is replaced.
2. `node scripts/restore.js /path/to/xr-<timestamp>.db`
   * refuses a corrupt file or a database that is not an XR database,
   * keeps the current database as `<db>.pre-restore-<timestamp>` so a wrong restore is reversible,
   * removes stale `-wal`/`-shm` files.
3. Start XR. Migrations bring an older backup up to the current schema automatically.
4. Sessions: all users sign in again if the backup predates their session; this is expected.

## Evidence

`tests/stage12.test.js` ("operations") proves: backup → mutate → restore returns the exact earlier state;
restore refuses junk and non-XR files; retention prunes; backups are `0600`. A restore drill on **your**
host with **your** data has not been run — do one before relying on it (restore to a scratch path and open it).

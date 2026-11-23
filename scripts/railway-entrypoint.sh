#!/bin/sh
# Railway mounts volumes as root. Fix the writable paths, then drop
# privileges before running the Node.js application.
set -eu

mkdir -p /data/backups
chown xr:xr /data /data/backups

# One-time bootstrap is enabled only for the first empty database.
# The guard makes this safe across future container restarts/deployments.
if [ "${XR_BOOTSTRAP_ON_START:-false}" = "true" ]; then
  : "${XR_BOOTSTRAP_BUSINESS:?XR_BOOTSTRAP_BUSINESS is required}"
  : "${XR_BOOTSTRAP_EMAIL:?XR_BOOTSTRAP_EMAIL is required}"
  : "${XR_BOOTSTRAP_PASSWORD:?XR_BOOTSTRAP_PASSWORD is required}"

  business_count="$(su-exec xr node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.env.XR_DB_FILE || "/data/xr.db"); const row = db.prepare("SELECT COUNT(*) AS n FROM businesses").get(); db.close(); process.stdout.write(String(row.n));')"

  if [ "$business_count" = "0" ]; then
    echo "XR first-owner bootstrap starting."
    su-exec xr node scripts/bootstrap.js \
      --business "$XR_BOOTSTRAP_BUSINESS" \
      --email "$XR_BOOTSTRAP_EMAIL" \
      --currency "${XR_BOOTSTRAP_CURRENCY:-RWF}" \
      --country "${XR_BOOTSTRAP_COUNTRY:-RW}" \
      --timezone "${XR_BOOTSTRAP_TIMEZONE:-Africa/Kigali}"
  else
    echo "XR bootstrap skipped: a business already exists."
  fi
fi

exec su-exec xr "$@"

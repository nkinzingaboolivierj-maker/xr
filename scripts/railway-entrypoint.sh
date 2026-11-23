#!/bin/sh
# Railway mounts volumes as root. Fix only the top-level mount and backup
# directory, then drop privileges before starting the Node.js application.
set -eu

mkdir -p /data/backups
chown xr:xr /data /data/backups

exec su-exec xr "$@"

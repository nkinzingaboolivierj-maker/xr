#!/usr/bin/env node
'use strict';
// Restores a backup produced by scripts/backup.js. STOP THE SERVER FIRST: the
// live database file is replaced. The current database is preserved as
// <db>.pre-restore-<timestamp> so a mistaken restore is itself reversible.
//
//   node scripts/restore.js ./backups/xr-2026-10-12T....db
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const configLib = require('../src/lib/config');

function restore({ backupFile, dbFile }) {
  if (!fs.existsSync(backupFile)) throw new Error(`Backup not found: ${backupFile}`);
  const probe = new DatabaseSync(backupFile, { readOnly: true });
  let verdict; let migrations;
  try {
    verdict = probe.prepare('PRAGMA integrity_check').get().integrity_check;
    migrations = probe.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
  } finally { probe.close(); }
  if (verdict !== 'ok') throw new Error(`Refusing to restore: integrity check says "${verdict}"`);
  if (!migrations) throw new Error('Refusing to restore: not an XR database (no schema_migrations rows)');

  let preserved = null;
  if (fs.existsSync(dbFile)) {
    preserved = `${dbFile}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(dbFile, preserved);
  }
  fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
  // Stale WAL/SHM files from the old database must not be replayed onto the restored one.
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  fs.copyFileSync(backupFile, dbFile);
  return { restoredFrom: backupFile, preservedPrevious: preserved };
}

if (require.main === module) {
  const cfg = configLib.get();
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/restore.js <backup-file>'); process.exit(2); }
  try {
    const r = restore({ backupFile: file, dbFile: cfg.dbFile });
    console.log(`Restored ${r.restoredFrom} -> ${cfg.dbFile}${r.preservedPrevious ? ` (previous kept at ${r.preservedPrevious})` : ''}`);
  } catch (err) { console.error(`Restore failed: ${err.message}`); process.exit(1); }
}
module.exports = { restore };

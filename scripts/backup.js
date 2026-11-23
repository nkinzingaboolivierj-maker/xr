#!/usr/bin/env node
'use strict';
// Consistent online backup using SQLite's VACUUM INTO (safe while the server
// is running -- it reads a transactionally consistent snapshot, WAL included).
// The copy is integrity-checked before being kept, and old backups beyond
// XR_BACKUP_RETAIN are pruned.
//
//   node scripts/backup.js [--out ./backups]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const configLib = require('../src/lib/config');

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function backup({ dbFile, outDir, retain }) {
  if (!fs.existsSync(dbFile)) throw new Error(`Database file not found: ${dbFile}`);
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.resolve(outDir, `xr-${stamp()}.db`);
  const src = new DatabaseSync(dbFile);
  try {
    src.exec('PRAGMA busy_timeout = 10000;');
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally { src.close(); }
  const copy = new DatabaseSync(target);
  let verdict;
  try { verdict = copy.prepare('PRAGMA integrity_check').get().integrity_check; } finally { copy.close(); }
  if (verdict !== 'ok') { fs.rmSync(target, { force: true }); throw new Error(`Backup failed integrity check: ${verdict}`); }
  fs.chmodSync(target, 0o600);
  const all = fs.readdirSync(outDir).filter((f) => /^xr-.*\.db$/.test(f)).sort();
  const stale = all.slice(0, Math.max(0, all.length - retain));
  stale.forEach((f) => fs.rmSync(path.join(outDir, f), { force: true }));
  return { file: target, pruned: stale.length };
}

if (require.main === module) {
  const cfg = configLib.get();
  const i = process.argv.indexOf('--out');
  try {
    const r = backup({ dbFile: cfg.dbFile, outDir: i > -1 ? process.argv[i + 1] : cfg.backupDir, retain: cfg.backupRetain });
    console.log(`Backup written: ${r.file} (pruned ${r.pruned} old)`);
  } catch (err) { console.error(`Backup failed: ${err.message}`); process.exit(1); }
}
module.exports = { backup };

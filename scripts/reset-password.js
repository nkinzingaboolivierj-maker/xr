#!/usr/bin/env node
'use strict';
// Operator-only recovery tool (needs shell access to the host = trusted): sets a
// TEMPORARY password for an existing user, ends all of that user's sessions and
// forces a change at next sign-in. Used when the last Owner is locked out.
//
//   XR_RESET_PASSWORD='temporary-passphrase' node scripts/reset-password.js --email owner@shop.rw [--business biz_xxx]
const configLib = require('../src/lib/config');
const { openDb } = require('../src/db');
const { hashPassword } = require('../src/lib/crypto');
const { assertPasswordPolicy, normalizeEmail, revokeAllSessions } = require('../src/modules/auth/auth.service');
const { writeAudit } = require('../src/lib/audit');

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }

const email = arg('email'); const businessId = arg('business'); const password = process.env.XR_RESET_PASSWORD;
if (!email || !password) { console.error('Usage: XR_RESET_PASSWORD=<temporary> node scripts/reset-password.js --email <email> [--business <id>]'); process.exit(2); }
const db = openDb(configLib.get().dbFile);
try {
  assertPasswordPolicy(password);
  const users = db.prepare(`SELECT * FROM users WHERE lower(email) = ?${businessId ? ' AND business_id = ?' : ''}`).all(...[normalizeEmail(email), ...(businessId ? [businessId] : [])]);
  if (users.length === 0) throw new Error('No such user');
  if (users.length > 1) throw new Error(`Email exists in ${users.length} businesses; pass --business <id>: ${users.map((u) => u.business_id).join(', ')}`);
  const u = users[0];
  db.exec('BEGIN IMMEDIATE');
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, status = 'active' WHERE id = ?`).run(hashPassword(password), u.id);
  revokeAllSessions(db, u.id);
  writeAudit(db, { businessId: u.business_id, actorId: null, action: 'PASSWORD_RESET', resource: 'user', resourceId: u.id, newState: { by: 'operator-cli' } });
  db.exec('COMMIT');
  console.log(`Temporary password set for ${u.email} (${u.business_id}). They must change it at next sign-in.`);
} catch (err) {
  try { db.exec('ROLLBACK'); } catch { /* none open */ }
  console.error(`Reset failed: ${err.message}`); process.exit(1);
} finally { db.close(); }

#!/usr/bin/env node
'use strict';
// Creates the FIRST business and its Owner on a fresh (or existing) database.
// There are no default accounts anywhere in XR: this is the only way the first
// credentials come into existence, and the password is never printed or logged.
//
//   XR_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap.js \
//       --business "My Shop" --email owner@example.com [--currency RWF] [--country RW]
//
// If XR_BOOTSTRAP_PASSWORD is not set and a TTY is attached, the password is
// prompted for without echo.
const readline = require('node:readline');
const configLib = require('../src/lib/config');
const { openDb } = require('../src/db');
const { createBusiness } = require('../src/modules/business/business.service');
const { createUser } = require('../src/modules/auth/auth.service');
const { writeAudit } = require('../src/lib/audit');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.output.write('\n'); rl.close(); resolve(answer); });
  });
}

async function main() {
  const cfg = configLib.get();
  const businessName = arg('business');
  const email = arg('email');
  if (!businessName || !email) {
    console.error('Usage: node scripts/bootstrap.js --business "<name>" --email <owner email> [--currency RWF] [--country RW] [--timezone Africa/Kigali]');
    process.exit(2);
  }
  let password = process.env.XR_BOOTSTRAP_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) { console.error('Set XR_BOOTSTRAP_PASSWORD or run from an interactive terminal.'); process.exit(2); }
    password = await promptHidden('Owner password (min 8 chars, not echoed): ');
  }
  const db = openDb(cfg.dbFile);
  try {
    db.exec('BEGIN IMMEDIATE');
    const business = createBusiness(db, {
      name: businessName, currency: arg('currency') || 'RWF', country: arg('country') || 'RW', timezone: arg('timezone') || 'Africa/Kigali',
    });
    const owner = createUser(db, { businessId: business.id, email, password, role: 'Owner' });
    writeAudit(db, { businessId: business.id, actorId: owner.id, action: 'BOOTSTRAP', resource: 'business', resourceId: business.id, newState: { owner: owner.email } });
    db.exec('COMMIT');
    console.log(`Created business "${business.name}" (${business.id}) with Owner ${owner.email}. Sign in at the app and change nothing else on this account until you have created a second Owner.`);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* none open */ }
    console.error(`Bootstrap failed: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
main();

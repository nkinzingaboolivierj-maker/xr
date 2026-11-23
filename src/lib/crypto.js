'use strict';
const crypto = require('node:crypto');

const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, derivedHex] = parts;
  const derived = Buffer.from(derivedHex, 'hex');
  const check = crypto.scryptSync(password, salt, KEY_LEN);
  if (derived.length !== check.length) return false;
  return crypto.timingSafeEqual(derived, check);
}

// A real hash of a random password, computed once. Login verifies against
// this when the email is unknown so "no such user" costs the same time as
// "wrong password" (no user enumeration through response timing).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Session tokens are stored only as SHA-256 digests. The token is 192+ bits
// of CSPRNG output, so a fast unsalted hash is appropriate here (unlike
// passwords) and lets us look a session up by hash directly.
function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { hashPassword, verifyPassword, randomToken, sha256Hex, DUMMY_HASH };

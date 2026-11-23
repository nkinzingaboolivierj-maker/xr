'use strict';
const { nextId, now } = require('../../lib/ids');
const { hashPassword, verifyPassword, randomToken, sha256Hex, DUMMY_HASH } = require('../../lib/crypto');
const { ApiError } = require('../../lib/errors');
const configLib = require('../../lib/config');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // legacy export; the live value comes from config (SESSION_TTL_HOURS)

// ASVS 6.2.1 — minimum 8 characters (15+ recommended, not enforced as a hard
// requirement here since ASVS itself only requires the minimum at Level 1).
const MIN_PASSWORD_LENGTH = 8;
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000; // don't write on every request
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set(['/auth/change-password', '/auth/logout', '/me']);

function assertPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  // ASVS 6.2.5 — deliberately NO composition rules (no required uppercase/
  // digit/symbol). ASVS 6.2.9 — no maximum length is imposed either.
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function assertEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError('VALIDATION_ERROR', 'A valid email address is required');
  }
}

function createUser(db, { businessId, email, password, role, mustChangePassword = false }) {
  const normalized = normalizeEmail(email);
  assertEmail(normalized);
  const existing = db.prepare(`SELECT id FROM users WHERE business_id = ? AND lower(email) = ?`).get(businessId, normalized);
  if (existing) throw new ApiError('VALIDATION_ERROR', `A user with email ${normalized} already exists in this business`);
  assertPasswordPolicy(password);
  const id = nextId('usr');
  db.prepare(`
    INSERT INTO users (id, business_id, email, password_hash, role, status, created_at, must_change_password)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, businessId, normalized, hashPassword(password), role, now(), mustChangePassword ? 1 : 0);
  return { id, businessId, email: normalized, role };
}

// Login. Defects fixed in Stage 12:
//  * the user used to be looked up by email ALONE across all businesses, but
//    uniqueness is per business -- so the second business to use an email
//    could never log in. Every matching account is now checked; if the same
//    credentials match more than one business the caller must say which.
//  * "unknown email" used to return faster than "wrong password"
//    (user enumeration through timing); a dummy hash is now verified.
//  * session tokens are stored hashed (SHA-256) so a leaked DB can't be
//    replayed as bearer tokens.
function login(db, { email, password, businessId, ip, userAgent }) {
  const cfg = configLib.get();
  const normalized = normalizeEmail(email);
  const candidates = businessId
    ? db.prepare(`SELECT * FROM users WHERE lower(email) = ? AND status = 'active' AND business_id = ?`).all(normalized, businessId)
    : db.prepare(`SELECT * FROM users WHERE lower(email) = ? AND status = 'active'`).all(normalized);

  let matches;
  if (candidates.length === 0) {
    verifyPassword(String(password), DUMMY_HASH);
    matches = [];
  } else {
    matches = candidates.filter((u) => verifyPassword(String(password), u.password_hash));
  }
  // Generic failure message regardless of which check fails (FR-AUTH-001)
  if (matches.length === 0) throw new ApiError('INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (matches.length > 1) {
    const businesses = matches.map((u) => {
      const b = db.prepare(`SELECT id, name FROM businesses WHERE id = ?`).get(u.business_id);
      return { id: b.id, name: b.name };
    });
    throw new ApiError('BUSINESS_SELECTION_REQUIRED', 'These credentials match more than one business. Choose which business to sign in to.', undefined, { businesses });
  }
  const user = matches[0];

  const token = randomToken(24);
  const id = sha256Hex(token);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + cfg.sessionTtlMs).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, business_id, created_at, expires_at, revoked_at, last_seen_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(id, user.id, user.business_id, createdAt, expiresAt, createdAt, userAgent ? String(userAgent).slice(0, 200) : null, ip || null);
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(createdAt, user.id);
  return {
    sessionId: token, // the bearer token; only its hash is stored
    userId: user.id,
    businessId: user.business_id,
    role: user.role,
    expiresAt,
    mustChangePassword: !!user.must_change_password,
  };
}

// Revoke by stored session id (the SHA-256 digest shown by listSessions).
function revokeSession(db, sessionId) {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(now(), sessionId);
}

function revokeSessionByToken(db, token) {
  revokeSession(db, sha256Hex(token));
}

// ASVS 7.4.3 — option to terminate all OTHER sessions after a credential
// change. Keeps the session that made the request alive.
function revokeOtherSessions(db, userId, keepSessionId) {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL`)
    .run(now(), userId, keepSessionId);
}

function revokeAllSessions(db, userId) {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now(), userId);
}

// ASVS 6.2.2 / 6.2.3 — users can change their password; doing so requires
// both the current password (re-verified, not just "trust the session")
// and the new one, which still passes the same policy as account creation.
function changePassword(db, session, { currentPassword, newPassword, revokeOtherSessions: shouldRevokeOthers }) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(session.userId);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    throw new ApiError('INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  assertPasswordPolicy(newPassword);
  if (newPassword === currentPassword) throw new ApiError('VALIDATION_ERROR', 'The new password must be different from the current one');
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`).run(hashPassword(newPassword), user.id);
  // A forced change (temporary/reset password) always ends other sessions.
  const revokeOthers = shouldRevokeOthers || !!user.must_change_password;
  if (revokeOthers) revokeOtherSessions(db, user.id, session.sessionId);
  return { changed: true, otherSessionsRevoked: !!revokeOthers };
}

// Resolves a bearer token to a live session. Enforces: exists, not revoked,
// within the absolute lifetime, and within the idle timeout (ASVS 7.3.x —
// previously only the 24h absolute lifetime existed).
function resolveSession(db, token) {
  if (!token) throw new ApiError('UNAUTHENTICATED', 'Missing session token');
  const cfg = configLib.get();
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sha256Hex(token));
  if (!s) throw new ApiError('UNAUTHENTICATED', 'Invalid session token');
  if (s.revoked_at) throw new ApiError('SESSION_EXPIRED', 'Session has been revoked');
  const nowMs = Date.now();
  if (new Date(s.expires_at).getTime() < nowMs) throw new ApiError('SESSION_EXPIRED', 'Session has expired');
  const lastSeen = new Date(s.last_seen_at || s.created_at).getTime();
  if (nowMs - lastSeen > cfg.sessionIdleMs) {
    revokeSession(db, s.id);
    throw new ApiError('SESSION_EXPIRED', 'Session timed out due to inactivity');
  }
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(s.user_id);
  if (!user || user.status !== 'active') throw new ApiError('UNAUTHENTICATED', 'User is no longer active');
  if (nowMs - lastSeen > LAST_SEEN_WRITE_INTERVAL_MS) {
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(new Date(nowMs).toISOString(), s.id);
  }
  return {
    sessionId: s.id, userId: user.id, businessId: user.business_id, role: user.role,
    email: user.email, mustChangePassword: !!user.must_change_password,
  };
}

// Reads `Authorization: Bearer <token>` — chosen over a cookie so the same
// auth mechanism works identically for web and mobile clients (and so there
// is no ambient-credential CSRF surface).
function authenticate(ctx, db) {
  const header = ctx.req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new ApiError('UNAUTHENTICATED', 'Missing or malformed Authorization header');
  const session = resolveSession(db, token);
  if (session.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.has(ctx.path)) {
    throw new ApiError('PASSWORD_CHANGE_REQUIRED', 'You must change your temporary password before continuing');
  }
  return session;
}

// FR-AUTH-002 (device/session visibility + revocation)
function listSessions(db, session) {
  const now_ = Date.now();
  return db.prepare(`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(session.userId)
    .map((s) => ({
      id: s.id, createdAt: s.created_at, expiresAt: s.expires_at, lastSeenAt: s.last_seen_at || s.created_at,
      userAgent: s.user_agent || null, ipAddress: s.ip_address || null,
      revoked: !!s.revoked_at,
      expired: new Date(s.expires_at).getTime() < now_,
      current: s.id === session.sessionId,
    }));
}

function revokeSessionById(db, session, targetSessionId) {
  // Accepts the stored id (as listed) or a raw token the caller already holds.
  const target = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id = ?`).get(targetSessionId, sha256Hex(targetSessionId));
  if (!target || target.user_id !== session.userId) {
    throw new ApiError('NOT_FOUND', 'Session not found');
  }
  revokeSession(db, target.id);
  return { id: target.id, revoked: true };
}

module.exports = {
  createUser, login, revokeSession, revokeSessionByToken, resolveSession, authenticate, SESSION_TTL_MS,
  listSessions, revokeSessionById, changePassword, revokeOtherSessions, revokeAllSessions,
  assertPasswordPolicy, assertEmail, normalizeEmail, MIN_PASSWORD_LENGTH,
};

'use strict';
const authService = require('./auth.service');
const { ApiError } = require('../../lib/errors');
const { createRateLimiter } = require('../../lib/rateLimiter');
const { writeAudit } = require('../../lib/audit');

// FR-SEC-001 / NFR-SEC-001 — brute-force protection on login.
// 5 attempts per email per 15 minutes, plus a coarser per-IP ceiling so one
// address can't spray many accounts. Then a 429 with a clear retry time.
const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000 });
const ipLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 15 * 60 * 1000 });

function login(db) {
  return (ctx) => {
    const { email, password, businessId } = ctx.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new ApiError('VALIDATION_ERROR', 'email and password are required');
    }
    const key = String(email).toLowerCase();
    ipLimiter.check(ctx.ip || 'unknown');
    loginLimiter.check(key);
    let session;
    try {
      session = authService.login(db, { email, password, businessId, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
        writeAudit(db, { businessId: null, actorId: null, action: 'LOGIN_FAILED', resource: 'session', newState: { email: key, ip: ctx.ip || null } });
      }
      throw err;
    }
    loginLimiter.reset(key); // successful login clears the counter
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'LOGIN', resource: 'session', newState: { ip: ctx.ip || null } });
    return { status: 200, body: { success: true, data: session } };
  };
}

function listSessions(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    return { status: 200, body: { success: true, data: authService.listSessions(db, session) } };
  };
}

function revokeSessionById(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    const result = authService.revokeSessionById(db, session, ctx.params.id);
    return { status: 200, body: { success: true, data: result } };
  };
}

function logout(db) {
  return (ctx) => {
    const header = ctx.req.headers['authorization'] || '';
    const [, token] = header.split(' ');
    if (token) authService.revokeSessionByToken(db, token);
    return { status: 204, body: null };
  };
}

function changePassword(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    const { currentPassword, newPassword, revokeOtherSessions } = ctx.body || {};
    if (!currentPassword || !newPassword) {
      throw new ApiError('VALIDATION_ERROR', 'currentPassword and newPassword are required');
    }
    const result = authService.changePassword(db, session, { currentPassword, newPassword, revokeOtherSessions: !!revokeOtherSessions });
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'PASSWORD_CHANGE', resource: 'user', resourceId: session.userId });
    return { status: 200, body: { success: true, data: result } };
  };
}

module.exports = { login, logout, listSessions, revokeSessionById, changePassword };

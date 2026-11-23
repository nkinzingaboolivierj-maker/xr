'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { withTransaction } = require('../../lib/tx');
const { hashPassword } = require('../../lib/crypto');
const { assertOwnedByBusiness } = require('../business/tenant');
const authService = require('../auth/auth.service');

const ROLES = ['Owner', 'Manager', 'Cashier', 'InventoryStaff'];

function format(u) {
  return {
    id: u.id, email: u.email, role: u.role, status: u.status,
    createdAt: u.created_at, lastLoginAt: u.last_login_at || null, mustChangePassword: !!u.must_change_password,
  };
}

function listUsers(db, session) {
  return db.prepare(`SELECT * FROM users WHERE business_id = ? ORDER BY created_at ASC`).all(session.businessId).map(format);
}

// Owner creates staff with a TEMPORARY password; the user is forced to
// change it at first login (must_change_password).
function createStaff(db, session, { email, role, temporaryPassword }) {
  if (!ROLES.includes(role)) throw new ApiError('VALIDATION_ERROR', `role must be one of ${ROLES.join(', ')}`);
  return withTransaction(db, () => {
    const created = authService.createUser(db, { businessId: session.businessId, email, password: temporaryPassword, role, mustChangePassword: true });
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'CREATE', resource: 'user', resourceId: created.id, newState: { email: created.email, role } });
    return format(db.prepare(`SELECT * FROM users WHERE id = ?`).get(created.id));
  });
}

function activeOwnerCount(db, businessId) {
  return db.prepare(`SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND role = 'Owner' AND status = 'active'`).get(businessId).c;
}

function updateStaff(db, session, id, { role, status }) {
  const user = assertOwnedByBusiness(db.prepare(`SELECT * FROM users WHERE id = ?`).get(id), session, 'User');
  if (role === undefined && status === undefined) throw new ApiError('VALIDATION_ERROR', 'role or status is required');
  if (role !== undefined && !ROLES.includes(role)) throw new ApiError('VALIDATION_ERROR', `role must be one of ${ROLES.join(', ')}`);
  if (status !== undefined && !['active', 'inactive'].includes(status)) throw new ApiError('VALIDATION_ERROR', "status must be 'active' or 'inactive'");
  if (user.id === session.userId) throw new ApiError('VALIDATION_ERROR', 'You cannot change your own role or status');
  const newRole = role !== undefined ? role : user.role;
  const newStatus = status !== undefined ? status : user.status;
  return withTransaction(db, () => {
    // Never allow the business to be left without an active Owner.
    const losesOwner = user.role === 'Owner' && user.status === 'active' && (newRole !== 'Owner' || newStatus !== 'active');
    if (losesOwner && activeOwnerCount(db, session.businessId) <= 1) {
      throw new ApiError('VALIDATION_ERROR', 'The business must keep at least one active Owner');
    }
    db.prepare(`UPDATE users SET role = ?, status = ? WHERE id = ?`).run(newRole, newStatus, user.id);
    // Role/status changes take effect immediately: existing sessions end.
    authService.revokeAllSessions(db, user.id);
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'UPDATE', resource: 'user', resourceId: user.id, oldState: { role: user.role, status: user.status }, newState: { role: newRole, status: newStatus } });
    return format(db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id));
  });
}

function resetPassword(db, session, id, { temporaryPassword }) {
  const user = assertOwnedByBusiness(db.prepare(`SELECT * FROM users WHERE id = ?`).get(id), session, 'User');
  authService.assertPasswordPolicy(temporaryPassword);
  return withTransaction(db, () => {
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`).run(hashPassword(temporaryPassword), user.id);
    authService.revokeAllSessions(db, user.id);
    writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'PASSWORD_RESET', resource: 'user', resourceId: user.id });
    return format(db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id));
  });
}

module.exports = { listUsers, createStaff, updateStaff, resetPassword, ROLES };

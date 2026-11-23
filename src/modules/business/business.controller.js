'use strict';
const authService = require('../auth/auth.service');
const { requirePermission, permissionsFor } = require('../rbac/rbac');
const businessService = require('./business.service');

// GET /me — who am I, which business, and what may I do. The permission list
// only drives which controls the UI shows; the server re-checks every action.
function me(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    return {
      status: 200,
      body: {
        success: true,
        data: {
          user: { id: session.userId, email: session.email, role: session.role },
          business: businessService.getProfile(db, session),
          permissions: permissionsFor(session.role),
          mustChangePassword: session.mustChangePassword,
        },
      },
    };
  };
}

function getBusiness(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    return { status: 200, body: { success: true, data: businessService.getProfile(db, session) } };
  };
}

function updateBusiness(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'business.profile.write');
    return { status: 200, body: { success: true, data: businessService.updateProfile(db, session, ctx.body || {}) } };
  };
}

module.exports = { me, getBusiness, updateBusiness };

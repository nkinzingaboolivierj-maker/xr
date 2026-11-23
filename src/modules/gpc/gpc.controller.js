'use strict';
const authService = require('../auth/auth.service');
const { requirePermission } = require('../rbac/rbac');
const gpcService = require('./gpc.service');

function importTaxonomy(db) {
  return (ctx) => {
    const session = authService.authenticate(ctx, db);
    requirePermission(session, 'gpc.import');
    const result = gpcService.importTaxonomy(db, session, ctx.body || {});
    return { status: result.dryRun ? 200 : 201, body: { success: true, data: result } };
  };
}

function listVersions(db) {
  return (ctx) => {
    authService.authenticate(ctx, db); // any authenticated user may see taxonomy versions — it's global reference data
    return { status: 200, body: { success: true, data: gpcService.listVersions(db) } };
  };
}

function segments(db) {
  return (ctx) => { authService.authenticate(ctx, db); return { status: 200, body: { success: true, ...gpcService.browseSegments(db) } }; };
}
function families(db) {
  return (ctx) => { authService.authenticate(ctx, db); return { status: 200, body: { success: true, ...gpcService.browseFamilies(db, ctx.query.segmentCode) } }; };
}
function classes(db) {
  return (ctx) => { authService.authenticate(ctx, db); return { status: 200, body: { success: true, ...gpcService.browseClasses(db, ctx.query.familyCode) } }; };
}
function bricks(db) {
  return (ctx) => { authService.authenticate(ctx, db); return { status: 200, body: { success: true, ...gpcService.browseBricks(db, ctx.query.classCode) } }; };
}
function search(db) {
  return (ctx) => { authService.authenticate(ctx, db); return { status: 200, body: { success: true, ...gpcService.searchBricks(db, ctx.query.q) } }; };
}

module.exports = { importTaxonomy, listVersions, segments, families, classes, bricks, search };

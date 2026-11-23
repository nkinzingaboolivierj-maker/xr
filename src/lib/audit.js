'use strict';
const { nextId, now } = require('./ids');

function writeAudit(db, { businessId, actorId, action, resource, resourceId, oldState, newState }) {
  db.prepare(`
    INSERT INTO audit_logs (id, business_id, actor_id, action, resource, resource_id, old_state, new_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nextId('aud'),
    businessId,
    actorId || null,
    action,
    resource,
    resourceId || null,
    oldState !== undefined ? JSON.stringify(oldState) : null,
    newState !== undefined ? JSON.stringify(newState) : null,
    now()
  );
}

module.exports = { writeAudit };

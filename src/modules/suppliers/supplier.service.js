'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { assertOwnedByBusiness } = require('../business/tenant');

function createSupplier(db, session, { name, phone, email, address, taxNumber }) {
  if (!name) throw new ApiError('VALIDATION_ERROR', 'name is required');
  const id = nextId('sup');
  db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, address, tax_number, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, session.businessId, name, phone || null, email || null, address || null, taxNumber || null, now());

  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'CREATE', resource: 'supplier', resourceId: id, newState: { name },
  });

  return getSupplier(db, session, id);
}

function getSupplier(db, session, id) {
  const row = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Supplier');
  return {
    id: row.id, name: row.name, phone: row.phone, email: row.email,
    address: row.address, taxNumber: row.tax_number, status: row.status,
  };
}

function listSuppliers(db, session) {
  return db.prepare(`SELECT * FROM suppliers WHERE business_id = ? ORDER BY created_at DESC`)
    .all(session.businessId)
    .map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, status: r.status }));
}

module.exports = { createSupplier, getSupplier, listSuppliers };

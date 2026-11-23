'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { assertOwnedByBusiness } = require('../business/tenant');

function createCustomer(db, session, { name, phone, email, type }) {
  if (!name) throw new ApiError('VALIDATION_ERROR', 'name is required');
  const id = nextId('cus');
  db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, session.businessId, name, phone || null, email || null, type === 'named' ? 'named' : 'walk-in', now());
  return getCustomer(db, session, id);
}

function getCustomer(db, session, id) {
  const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Customer');
  return { id: row.id, name: row.name, phone: row.phone, email: row.email, type: row.type };
}

function listCustomers(db, session) {
  return db.prepare(`SELECT * FROM customers WHERE business_id = ? ORDER BY created_at DESC`)
    .all(session.businessId)
    .map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, type: r.type }));
}

module.exports = { createCustomer, getCustomer, listCustomers };

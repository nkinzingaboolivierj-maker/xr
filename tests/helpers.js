'use strict';
const { startServer } = require('../src/server');
const { createBusiness } = require('../src/modules/business/business.service');
const { createUser, login } = require('../src/modules/auth/auth.service');

async function setup() {
  const { server, db, router, port } = await startServer({ dbFile: ':memory:', port: 0 });
  const base = `http://127.0.0.1:${port}`;

  const business = createBusiness(db, { name: 'Test Business' });
  const businessB = createBusiness(db, { name: 'Other Business' });

  createUser(db, { businessId: business.id, email: 'owner@test.com', password: 'password123', role: 'Owner' });
  createUser(db, { businessId: business.id, email: 'manager@test.com', password: 'password123', role: 'Manager' });
  createUser(db, { businessId: business.id, email: 'cashier@test.com', password: 'password123', role: 'Cashier' });
  createUser(db, { businessId: business.id, email: 'inventory@test.com', password: 'password123', role: 'InventoryStaff' });
  createUser(db, { businessId: businessB.id, email: 'owner-b@test.com', password: 'password123', role: 'Owner' });

  const tokens = {
    owner: login(db, { email: 'owner@test.com', password: 'password123' }).sessionId,
    manager: login(db, { email: 'manager@test.com', password: 'password123' }).sessionId,
    cashier: login(db, { email: 'cashier@test.com', password: 'password123' }).sessionId,
    inventory: login(db, { email: 'inventory@test.com', password: 'password123' }).sessionId,
    ownerB: login(db, { email: 'owner-b@test.com', password: 'password123' }).sessionId,
  };

  async function api(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* e.g. 204 No Content */ }
    return { status: res.status, json };
  }

  function teardown() { server.close(); }

  return { db, base, router, server, business, businessB, tokens, api, teardown };
}

module.exports = { setup };

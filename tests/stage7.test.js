'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('Stage 7 — ASVS fixes: password policy, password change, session revocation', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('ASVS 6.2.1: account creation rejects passwords under 8 characters', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Short Pw Biz' });
    assert.throws(() => createUser(ctx.db, { businessId: biz.id, email: 'short@test.com', password: 'abc123', role: 'Owner' }), /8 characters/);
  });

  await t.test('ASVS 6.2.9: a 64+ character password is accepted and usable for login', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'Long Pw Biz' });
    const longPw = 'x'.repeat(80);
    createUser(ctx.db, { businessId: biz.id, email: 'long@test.com', password: longPw, role: 'Owner' });
    const res = await api('POST', '/auth/login', { body: { email: 'long@test.com', password: longPw } });
    assert.equal(res.status, 200);
  });

  await t.test('ASVS 6.2.2/6.2.3: password change requires the correct current password', async () => {
    const login = await api('POST', '/auth/login', { body: { email: 'manager@test.com', password: 'password123' } });
    const token = login.json.data.sessionId;
    const wrong = await api('POST', '/auth/change-password', { token, body: { currentPassword: 'not-it', newPassword: 'new-password-1' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, 'INVALID_CREDENTIALS');
  });

  await t.test('ASVS 6.2.2/6.2.3: successful password change, new password works, old one does not', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'ChangePw Biz' });
    createUser(ctx.db, { businessId: biz.id, email: 'changer@test.com', password: 'original-pass', role: 'Owner' });
    const login = await api('POST', '/auth/login', { body: { email: 'changer@test.com', password: 'original-pass' } });
    const token = login.json.data.sessionId;

    const change = await api('POST', '/auth/change-password', { token, body: { currentPassword: 'original-pass', newPassword: 'brand-new-pass' } });
    assert.equal(change.status, 200);

    const oldLogin = await api('POST', '/auth/login', { body: { email: 'changer@test.com', password: 'original-pass' } });
    assert.equal(oldLogin.status, 401);

    const newLogin = await api('POST', '/auth/login', { body: { email: 'changer@test.com', password: 'brand-new-pass' } });
    assert.equal(newLogin.status, 200);
  });

  await t.test('ASVS 6.2.1 also applies to password change: new password under 8 chars is rejected', async () => {
    const login = await api('POST', '/auth/login', { body: { email: 'cashier@test.com', password: 'password123' } });
    const token = login.json.data.sessionId;
    const res = await api('POST', '/auth/change-password', { token, body: { currentPassword: 'password123', newPassword: 'short' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, 'VALIDATION_ERROR');
  });

  await t.test('ASVS 7.4.3: revokeOtherSessions=true logs out every other session for the same user', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'RevokeOthers Biz' });
    createUser(ctx.db, { businessId: biz.id, email: 'multi@test.com', password: 'first-password', role: 'Owner' });

    const sessionA = (await api('POST', '/auth/login', { body: { email: 'multi@test.com', password: 'first-password' } })).json.data.sessionId;
    const sessionB = (await api('POST', '/auth/login', { body: { email: 'multi@test.com', password: 'first-password' } })).json.data.sessionId;

    const change = await api('POST', '/auth/change-password', { token: sessionA, body: { currentPassword: 'first-password', newPassword: 'second-password', revokeOtherSessions: true } });
    assert.equal(change.status, 200);
    assert.equal(change.json.data.otherSessionsRevoked, true);

    // Session A (the one that made the request) must still work.
    const stillA = await api('GET', '/products', { token: sessionA });
    assert.equal(stillA.status, 200);

    // Session B must now be revoked.
    const nowB = await api('GET', '/products', { token: sessionB });
    assert.equal(nowB.status, 401);
    assert.equal(nowB.json.code, 'SESSION_EXPIRED');
  });

  await t.test('ASVS 7.4.3: revokeOtherSessions is OPTIONAL — omitting it leaves other sessions alive', async () => {
    const { createBusiness } = require('../src/modules/business/business.service');
    const { createUser } = require('../src/modules/auth/auth.service');
    const biz = createBusiness(ctx.db, { name: 'KeepOthers Biz' });
    createUser(ctx.db, { businessId: biz.id, email: 'keep@test.com', password: 'first-password', role: 'Owner' });

    const sessionA = (await api('POST', '/auth/login', { body: { email: 'keep@test.com', password: 'first-password' } })).json.data.sessionId;
    const sessionB = (await api('POST', '/auth/login', { body: { email: 'keep@test.com', password: 'first-password' } })).json.data.sessionId;

    await api('POST', '/auth/change-password', { token: sessionA, body: { currentPassword: 'first-password', newPassword: 'second-password' } });

    const stillB = await api('GET', '/products', { token: sessionB });
    assert.equal(stillB.status, 200, 'without the flag, other sessions must remain valid');
  });

  await t.test('ASVS 8.2.1/8.2.2 sanity re-check: cross-business + RBAC still hold after auth changes', async () => {
    const res1 = await api('GET', '/products', { token: tokens.ownerB });
    assert.equal(res1.status, 200); // Business B can read its OWN (empty) product list
    const prod = await api('POST', '/products', { token: tokens.manager, body: { sku: 'S7-ISO', name: 'Isolation Check' } });
    const cross = await api('POST', `/products/${prod.json.data.id}/price`, { token: tokens.ownerB, body: { minPrice: 1, recommendedPrice: 2, maxPrice: 3, reason: 'x' } });
    assert.equal(cross.status, 403);
    assert.equal(cross.json.code, 'CROSS_BUSINESS_ACCESS');
  });
});

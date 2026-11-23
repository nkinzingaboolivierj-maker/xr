'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Explicitly-labeled TEST FIXTURE rows — NOT real GS1 GPC data. Codes are
// prefixed TEST- so nobody could mistake this for an official import.
const FIXTURE_ROWS = [
  { segmentCode: 'TEST-SEG-50', segmentTitle: 'Test Food/Beverage', familyCode: 'TEST-FAM-5010', familyTitle: 'Test Beverages', classCode: 'TEST-CLS-501015', classTitle: 'Test Water', brickCode: 'TEST-BRK-10000419', brickTitle: 'Test Bottled Water' },
  { segmentCode: 'TEST-SEG-50', segmentTitle: 'Test Food/Beverage', familyCode: 'TEST-FAM-5010', familyTitle: 'Test Beverages', classCode: 'TEST-CLS-501015', classTitle: 'Test Water', brickCode: 'TEST-BRK-10000420', brickTitle: 'Test Sparkling Water' },
  { segmentCode: 'TEST-SEG-50', segmentTitle: 'Test Food/Beverage', familyCode: 'TEST-FAM-5011', familyTitle: 'Test Snacks', classCode: 'TEST-CLS-501115', classTitle: 'Test Chips', brickCode: 'TEST-BRK-10000500', brickTitle: 'Test Potato Chips' },
];

test('Stage 9 — GPC Import Engine + QR/Barcode Lookup', async (t) => {
  const ctx = await setup();
  const { api, tokens } = ctx;
  t.after(ctx.teardown);

  await t.test('GPC: dry-run validates without writing anything', async () => {
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-2026-DRY', source: 'fixture', rows: FIXTURE_ROWS, dryRun: true } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.valid, true);
    assert.equal(res.json.data.stats.bricks, 3);
    const versions = await api('GET', '/gpc/versions', { token: tokens.owner });
    assert.ok(!versions.json.data.some((v) => v.versionName === 'TEST-2026-DRY'), 'dry-run must not create a version row');
  });

  await t.test('GPC: missing required column is rejected with a clear error', async () => {
    const badRows = [{ segmentCode: 'X', segmentTitle: 'X', familyCode: 'X', familyTitle: 'X', classCode: 'X', classTitle: 'X', brickCode: 'X' /* missing brickTitle */ }];
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-BAD-1', rows: badRows, dryRun: true } });
    assert.equal(res.json.data.valid, false);
    assert.ok(res.json.data.errors[0].includes('brickTitle'));
  });

  await t.test('GPC: inconsistent hierarchy (same Class under two different Families) is rejected', async () => {
    const badRows = [
      { segmentCode: 'S1', segmentTitle: 'S1', familyCode: 'F1', familyTitle: 'F1', classCode: 'C1', classTitle: 'C1', brickCode: 'B1', brickTitle: 'B1' },
      { segmentCode: 'S1', segmentTitle: 'S1', familyCode: 'F2', familyTitle: 'F2', classCode: 'C1', classTitle: 'C1', brickCode: 'B2', brickTitle: 'B2' },
    ];
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-BAD-2', rows: badRows, dryRun: true } });
    assert.equal(res.json.data.valid, false);
    assert.ok(res.json.data.errors.some((e) => e.includes('C1')));
  });

  await t.test('GPC: duplicate Brick code within the same import is rejected', async () => {
    const badRows = [
      { segmentCode: 'S1', segmentTitle: 'S1', familyCode: 'F1', familyTitle: 'F1', classCode: 'C1', classTitle: 'C1', brickCode: 'DUP', brickTitle: 'B1' },
      { segmentCode: 'S1', segmentTitle: 'S1', familyCode: 'F1', familyTitle: 'F1', classCode: 'C1', classTitle: 'C1', brickCode: 'DUP', brickTitle: 'B2' },
    ];
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-BAD-3', rows: badRows, dryRun: true } });
    assert.equal(res.json.data.valid, false);
    assert.ok(res.json.data.errors.some((e) => e.includes('duplicate Brick')));
  });

  await t.test('GPC: RBAC — Manager cannot import (global/platform-level action)', async () => {
    const res = await api('POST', '/gpc/import', { token: tokens.manager, body: { versionName: 'TEST-RBAC', rows: FIXTURE_ROWS, dryRun: true } });
    assert.equal(res.status, 403);
  });

  await t.test('GPC: a real (non-dry-run) import activates the version and is browsable', async () => {
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-2026-REAL', source: 'fixture', rows: FIXTURE_ROWS, dryRun: false } });
    assert.equal(res.status, 201);
    assert.equal(res.json.data.status, 'ACTIVE');

    const segments = await api('GET', '/gpc/segments', { token: tokens.owner });
    assert.equal(segments.json.active, 'TEST-2026-REAL');
    assert.ok(segments.json.data.some((s) => s.code === 'TEST-SEG-50'));

    const families = await api('GET', '/gpc/families?segmentCode=TEST-SEG-50', { token: tokens.owner });
    assert.equal(families.json.data.length, 2);

    const bricks = await api('GET', '/gpc/bricks?classCode=TEST-CLS-501015', { token: tokens.owner });
    assert.equal(bricks.json.data.length, 2);

    const search = await api('GET', '/gpc/search?q=Chips', { token: tokens.owner });
    assert.equal(search.json.data.length, 1);
    assert.equal(search.json.data[0].code, 'TEST-BRK-10000500');
  });

  await t.test('GPC: re-importing the SAME version name is rejected (idempotency guard)', async () => {
    const res = await api('POST', '/gpc/import', { token: tokens.owner, body: { versionName: 'TEST-2026-REAL', rows: FIXTURE_ROWS, dryRun: false } });
    assert.equal(res.status, 400);
    assert.ok(res.json.detail.includes('already imported'));
  });

  await t.test('GPC: new product defaults to UNMAPPED, never a guessed code', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'GPC-1', name: 'Unclassified Item' } })).json.data;
    assert.equal(prod.gpc.status, 'UNMAPPED');
    assert.equal(prod.gpc.brickCode, null);
  });

  await t.test('GPC: classifying with a valid Brick code from the active version succeeds', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'GPC-2', name: 'Bottled Water Item' } })).json.data;
    const res = await api('POST', `/products/${prod.id}/classify`, { token: tokens.manager, body: { brickCode: 'TEST-BRK-10000419' } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.gpc.status, 'MAPPED');
    assert.equal(res.json.data.gpc.brickTitle, 'Test Bottled Water');
    assert.equal(res.json.data.gpc.versionName, 'TEST-2026-REAL');
  });

  await t.test('GPC: classifying with an unknown Brick code is rejected, never guessed', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'GPC-3', name: 'X' } })).json.data;
    const res = await api('POST', `/products/${prod.id}/classify`, { token: tokens.manager, body: { brickCode: 'TOTALLY-MADE-UP' } });
    assert.equal(res.status, 400);
    assert.ok(res.json.detail.includes('not found'));
  });

  await t.test('QR/Barcode: lookup by SKU resolves the product', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'LOOKUP-SKU-1', name: 'Lookup Item' } })).json.data;
    const res = await api('GET', `/products/lookup?code=LOOKUP-SKU-1`, { token: tokens.cashier });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, prod.id);
  });

  await t.test('QR/Barcode: lookup by real barcode resolves the product', async () => {
    const prod = (await api('POST', '/products', { token: tokens.manager, body: { sku: 'LOOKUP-BC-1', name: 'Barcoded Item', barcode: '6009876543210' } })).json.data;
    const res = await api('GET', `/products/lookup?code=6009876543210`, { token: tokens.cashier });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, prod.id);
  });

  await t.test('QR/Barcode: unknown code returns a clear NOT_FOUND, not a leak', async () => {
    const res = await api('GET', `/products/lookup?code=DOES-NOT-EXIST`, { token: tokens.cashier });
    assert.equal(res.status, 404);
    assert.equal(res.json.code, 'NOT_FOUND');
  });

  await t.test('QR/Barcode: tenant isolation — Business B cannot resolve Business A\'s SKU', async () => {
    await api('POST', '/products', { token: tokens.manager, body: { sku: 'ISO-LOOKUP-1', name: 'Iso Item' } });
    const res = await api('GET', `/products/lookup?code=ISO-LOOKUP-1`, { token: tokens.ownerB });
    assert.equal(res.status, 404, 'must not reveal that the code exists in a different business');
  });
});

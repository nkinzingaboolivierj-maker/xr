'use strict';
const { parsePaging } = require('../../lib/paging');
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { assertOwnedByBusiness } = require('../business/tenant');

function createProduct(db, session, { sku, name, category, unit, barcode }) {
  if (!sku || !name) throw new ApiError('VALIDATION_ERROR', 'sku and name are required');
  const dup = db.prepare(`SELECT id FROM products WHERE business_id = ? AND sku = ?`).get(session.businessId, sku);
  if (dup) throw new ApiError('DUPLICATE_SKU', `SKU '${sku}' already exists in this business`);

  const id = nextId('prd');
  db.prepare(`
    INSERT INTO products (id, business_id, sku, name, category, unit, barcode, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, session.businessId, sku, name, category || null, unit || 'Piece', barcode || null, now());

  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'CREATE', resource: 'product', resourceId: id, newState: { sku, name, category, unit },
  });

  return getProduct(db, session, id);
}

function getProduct(db, session, id) {
  const row = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Product');
  const pricing = db.prepare(`SELECT * FROM product_pricing WHERE product_id = ?`).get(id);
  let gpc = { status: 'UNMAPPED', brickCode: null, brickTitle: null, versionName: null };
  if (row.gpc_brick_code && row.gpc_version_id) {
    const brick = db.prepare(`SELECT * FROM gpc_bricks WHERE version_id = ? AND code = ?`).get(row.gpc_version_id, row.gpc_brick_code);
    const version = db.prepare(`SELECT version_name FROM gpc_taxonomy_versions WHERE id = ?`).get(row.gpc_version_id);
    gpc = { status: 'MAPPED', brickCode: row.gpc_brick_code, brickTitle: brick ? brick.title : null, versionName: version ? version.version_name : null };
  }
  return {
    id: row.id, sku: row.sku, name: row.name, category: row.category,
    unit: row.unit, barcode: row.barcode || null, status: row.status, gpc,
    pricing: pricing ? {
      minPrice: pricing.min_price, recommendedPrice: pricing.recommended_price, maxPrice: pricing.max_price,
    } : null,
  };
}

function listProducts(db, session, query = {}) {
  const { page, pageSize, offset } = parsePaging(query, { defaultSize: 50, maxSize: 200 });
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  if (query.q && String(query.q).trim()) {
    // Escape LIKE wildcards so a search for "50%" matches literally.
    const like = `%${String(query.q).trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(`(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR IFNULL(barcode, '') LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  const where = clauses.join(' AND ');
  const rows = db.prepare(`SELECT id FROM products WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM products WHERE ${where}`).get(...args).c;
  return { data: rows.map((r) => getProduct(db, session, r.id)), page, pageSize, total };
}

// FR-PRICE-001: MIN <= RECOMMENDED <= MAX, enforced server-side, audited (FR-PRICE-002)
function setPricing(db, session, productId, { minPrice, recommendedPrice, maxPrice, reason }) {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
  assertOwnedByBusiness(product, session, 'Product');

  minPrice = Number(minPrice); recommendedPrice = Number(recommendedPrice); maxPrice = Number(maxPrice);
  if ([minPrice, recommendedPrice, maxPrice].some((v) => Number.isNaN(v) || v < 0)) {
    throw new ApiError('VALIDATION_ERROR', 'minPrice, recommendedPrice, and maxPrice must be non-negative numbers');
  }
  if (!(minPrice <= recommendedPrice && recommendedPrice <= maxPrice)) {
    throw new ApiError('INVALID_PRICE_BAND', 'Requires MIN <= RECOMMENDED <= MAX');
  }

  const existing = db.prepare(`SELECT * FROM product_pricing WHERE product_id = ?`).get(productId);
  const ts = now();

  if (existing) {
    for (const [type, oldV, newV] of [
      ['min', existing.min_price, minPrice],
      ['recommended', existing.recommended_price, recommendedPrice],
      ['max', existing.max_price, maxPrice],
    ]) {
      if (oldV !== newV) {
        db.prepare(`
          INSERT INTO product_price_history (id, product_id, price_type, old_value, new_value, actor_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nextId('prh'), productId, type, oldV, newV, session.userId, reason || null, ts);
      }
    }
    db.prepare(`
      UPDATE product_pricing SET min_price = ?, recommended_price = ?, max_price = ?, updated_at = ?
      WHERE product_id = ?
    `).run(minPrice, recommendedPrice, maxPrice, ts, productId);
  } else {
    db.prepare(`
      INSERT INTO product_pricing (product_id, min_price, recommended_price, max_price, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(productId, minPrice, recommendedPrice, maxPrice, ts);
    for (const [type, newV] of [['min', minPrice], ['recommended', recommendedPrice], ['max', maxPrice]]) {
      db.prepare(`
        INSERT INTO product_price_history (id, product_id, price_type, old_value, new_value, actor_id, reason, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(nextId('prh'), productId, type, newV, session.userId, reason || 'initial pricing', ts);
    }
  }

  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'PRICE_UPDATE', resource: 'product', resourceId: productId,
    oldState: existing, newState: { minPrice, recommendedPrice, maxPrice },
  });

  return getProduct(db, session, productId);
}

function getPriceHistory(db, session, productId) {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
  assertOwnedByBusiness(product, session, 'Product');
  return db.prepare(`SELECT * FROM product_price_history WHERE product_id = ? ORDER BY created_at ASC`).all(productId)
    .map((r) => ({
      priceType: r.price_type, oldValue: r.old_value, newValue: r.new_value,
      actorId: r.actor_id, reason: r.reason, createdAt: r.created_at,
    }));
}

// Server-side validation used by POS/Sales (Stage 3) — never trust a client price.
function validateSalePrice(db, session, productId, proposedPrice) {
  const pricing = db.prepare(`SELECT * FROM product_pricing WHERE product_id = ?`).get(productId);
  if (!pricing) throw new ApiError('VALIDATION_ERROR', 'Product has no pricing configured');
  if (proposedPrice < pricing.min_price) throw new ApiError('PRICE_BELOW_MINIMUM', `Price ${proposedPrice} is below minimum ${pricing.min_price}`);
  if (proposedPrice > pricing.max_price) throw new ApiError('PRICE_ABOVE_MAXIMUM', `Price ${proposedPrice} is above maximum ${pricing.max_price}`);
  return pricing;
}

// FR-CLS-001 — classify a product against the ACTIVE GPC version's bricks.
// Never guesses: an unrecognized brick code is rejected outright, and a
// product with no classification yet is reported UNMAPPED (never invented).
function classifyProduct(db, session, productId, { brickCode }) {
  const gpc = require('../gpc/gpc.service');
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
  assertOwnedByBusiness(product, session, 'Product');
  if (!brickCode) throw new ApiError('VALIDATION_ERROR', 'brickCode is required');

  const active = gpc.getActiveVersion(db);
  if (!active) throw new ApiError('VALIDATION_ERROR', 'No GPC taxonomy version is active yet — import one first (GPC_IMPORT_BLOCKED)');

  const brick = db.prepare(`SELECT * FROM gpc_bricks WHERE version_id = ? AND code = ?`).get(active.id, brickCode);
  if (!brick) throw new ApiError('VALIDATION_ERROR', `Brick code '${brickCode}' not found in active GPC version '${active.versionName}' — not guessing; use GPC_CLASSIFICATION_REVIEW_REQUIRED instead of an invalid code`);

  db.prepare(`UPDATE products SET gpc_brick_code = ?, gpc_version_id = ? WHERE id = ?`).run(brickCode, active.id, productId);
  writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'CLASSIFY', resource: 'product', resourceId: productId, newState: { brickCode, gpcVersion: active.versionName } });
  return getProduct(db, session, productId);
}

// FR-QR-001 — server-authoritative lookup by SKU (today's only real
// identifier — see docs/standards/GS1_IDENTIFIER_POLICY note below).
// Tenant-scoped: a code only resolves within the caller's own business,
// and a miss returns a clear NOT_FOUND rather than leaking whether the
// code exists in some OTHER business.
function lookupByCode(db, session, code) {
  if (!code) throw new ApiError('VALIDATION_ERROR', 'code is required');
  // Checks barcode first (real GTIN, when supplied), then SKU, then the
  // internal product ID itself (covers a QR that simply encodes the ID).
  const row = db.prepare(`
    SELECT id FROM products WHERE business_id = ? AND (barcode = ? OR sku = ? OR id = ?)
  `).get(session.businessId, code, code, code);
  if (!row) throw new ApiError('NOT_FOUND', `No product found for code '${code}' in this business`);
  return getProduct(db, session, row.id);
}

module.exports = { createProduct, getProduct, listProducts, setPricing, getPriceHistory, validateSalePrice, classifyProduct, lookupByCode };

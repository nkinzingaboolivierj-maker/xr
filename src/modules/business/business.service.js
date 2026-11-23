'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');

function createBusiness(db, { name, lowStockThreshold = 5, currency = 'RWF', country = 'RW', timezone = 'Africa/Kigali' }) {
  const id = nextId('biz');
  db.prepare(`INSERT INTO businesses (id, name, low_stock_threshold, currency, country, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, lowStockThreshold, currency, country, timezone, now());
  return { id, name, lowStockThreshold, currency, country, timezone };
}

function getBusiness(db, id) {
  const row = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(id);
  return row || null;
}

function format(row) {
  return {
    id: row.id, name: row.name, lowStockThreshold: row.low_stock_threshold,
    currency: row.currency, country: row.country, timezone: row.timezone,
    phone: row.phone || null, address: row.address || null, taxId: row.tax_id || null,
    requireVerifiedPayments: !!row.require_verified_payments,
    whatsappProvider: row.whatsapp_provider, paymentProvider: row.payment_provider,
    createdAt: row.created_at,
  };
}

function getProfile(db, session) {
  return format(getBusiness(db, session.businessId));
}

function isIsoTimezone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

// Owner-only. Currency is an ISO 4217 alphabetic code and country an ISO 3166-1
// alpha-2 code (shape-validated; the code lists themselves are not bundled).
// Changing currency does NOT convert any historical amounts -- every stored
// transaction keeps the currency it was made in, so the endpoint refuses a
// currency change once the business has recorded any sale or purchase.
function updateProfile(db, session, body) {
  const row = getBusiness(db, session.businessId);
  const next = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) throw new ApiError('VALIDATION_ERROR', 'name must be 1-120 characters');
    next.name = body.name.trim();
  }
  if (body.lowStockThreshold !== undefined) {
    const n = Number(body.lowStockThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new ApiError('VALIDATION_ERROR', 'lowStockThreshold must be a non-negative integer');
    next.low_stock_threshold = n;
  }
  if (body.currency !== undefined) {
    if (!/^[A-Z]{3}$/.test(String(body.currency))) throw new ApiError('VALIDATION_ERROR', 'currency must be a 3-letter ISO 4217 code, e.g. RWF');
    if (body.currency !== row.currency) {
      const used = db.prepare(`SELECT (SELECT COUNT(*) FROM sales WHERE business_id = ?) + (SELECT COUNT(*) FROM purchases WHERE business_id = ?) AS c`).get(row.id, row.id).c;
      if (used > 0) throw new ApiError('VALIDATION_ERROR', 'Currency cannot be changed after sales or purchases exist: historical amounts are not converted');
    }
    next.currency = body.currency;
  }
  if (body.country !== undefined) {
    if (!/^[A-Z]{2}$/.test(String(body.country))) throw new ApiError('VALIDATION_ERROR', 'country must be a 2-letter ISO 3166-1 code, e.g. RW');
    next.country = body.country;
  }
  if (body.timezone !== undefined) {
    if (!isIsoTimezone(body.timezone)) throw new ApiError('VALIDATION_ERROR', 'timezone must be a valid IANA timezone, e.g. Africa/Kigali');
    next.timezone = body.timezone;
  }
  for (const [key, col, max] of [['phone', 'phone', 40], ['address', 'address', 300], ['taxId', 'tax_id', 60]]) {
    if (body[key] !== undefined) {
      if (body[key] !== null && (typeof body[key] !== 'string' || body[key].length > max)) throw new ApiError('VALIDATION_ERROR', `${key} must be text up to ${max} characters`);
      next[col] = body[key] ? body[key].trim() : null;
    }
  }
  if (body.requireVerifiedPayments !== undefined) {
    if (typeof body.requireVerifiedPayments !== 'boolean') throw new ApiError('VALIDATION_ERROR', 'requireVerifiedPayments must be true or false');
    next.require_verified_payments = body.requireVerifiedPayments ? 1 : 0;
  }
  const cols = Object.keys(next);
  if (cols.length === 0) throw new ApiError('VALIDATION_ERROR', 'No updatable fields supplied');
  db.prepare(`UPDATE businesses SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => next[c]), row.id);
  const updated = getBusiness(db, row.id);
  writeAudit(db, { businessId: row.id, actorId: session.userId, action: 'UPDATE', resource: 'business_profile', resourceId: row.id, oldState: format(row), newState: format(updated) });
  return format(updated);
}

module.exports = { createBusiness, getBusiness, getProfile, updateProfile, format };

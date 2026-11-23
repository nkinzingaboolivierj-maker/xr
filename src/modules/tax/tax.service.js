'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { assertOwnedByBusiness } = require('../business/tenant');

// Tax is business-configurable and effective-dated. If a business has never
// configured a tax rate, NO tax is applied — we never invent a rate.
// A sale always snapshots the rate it actually used (tax_rate/tax_amount on
// the sales row), so a later config change never rewrites a past sale.
function createTaxConfig(db, session, { name, ratePercent, effectiveFrom, effectiveTo }) {
  if (!name) throw new ApiError('VALIDATION_ERROR', 'name is required');
  const rate = Number(ratePercent);
  if (Number.isNaN(rate) || rate < 0) throw new ApiError('VALIDATION_ERROR', 'ratePercent must be a non-negative number');
  const from = effectiveFrom || now();

  const id = nextId('tax');
  db.prepare(`
    INSERT INTO tax_configurations (id, business_id, name, rate_percent, effective_from, effective_to, is_active, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, session.businessId, name, rate, from, effectiveTo || null, session.userId, now());

  writeAudit(db, { businessId: session.businessId, actorId: session.userId, action: 'CREATE', resource: 'tax_configuration', resourceId: id, newState: { name, ratePercent: rate } });
  return getTaxConfig(db, session, id);
}

function getTaxConfig(db, session, id) {
  const row = db.prepare(`SELECT * FROM tax_configurations WHERE id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Tax configuration');
  return { id: row.id, name: row.name, ratePercent: row.rate_percent, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, isActive: !!row.is_active };
}

function listTaxConfigs(db, session) {
  return db.prepare(`SELECT * FROM tax_configurations WHERE business_id = ? ORDER BY effective_from DESC`).all(session.businessId)
    .map((r) => ({ id: r.id, name: r.name, ratePercent: r.rate_percent, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, isActive: !!r.is_active }));
}

// The ONE place that decides "what tax rate applies right now" — sales.service
// calls this rather than querying tax_configurations directly.
function getActiveRate(db, businessId, atIso) {
  const at = atIso || now();
  const row = db.prepare(`
    SELECT * FROM tax_configurations
    WHERE business_id = ? AND is_active = 1 AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC LIMIT 1
  `).get(businessId, at, at);
  return row ? row.rate_percent : 0; // no configured tax = 0, never fabricated
}

module.exports = { createTaxConfig, getTaxConfig, listTaxConfigs, getActiveRate };

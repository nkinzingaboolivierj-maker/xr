'use strict';
const { ApiError } = require('../../lib/errors');
const inventory = require('../inventory/inventory.service');

function round2(n) { return Math.round(n * 100) / 100; }
const DAY_MS = 86400000;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// FR-ANL-001 — Sales velocity = units sold / selected time period.
// Reads sale_items directly (completed sales only); never recomputed from
// a cached or client-supplied figure.
function getVelocity(db, session, { productId, days = 7 } = {}) {
  if (!productId) throw new ApiError('VALIDATION_ERROR', 'productId is required');
  const since = isoDaysAgo(Number(days));
  const row = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) as units
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND si.product_id = ? AND s.created_at >= ?
  `).get(session.businessId, productId, since);

  return {
    productId, periodDays: Number(days), unitsSold: row.units,
    velocityPerDay: round2(row.units / Number(days)),
  };
}

// FR-ANL-001 — Demand trend compares two EQUAL, back-to-back periods.
// If the earlier period has zero sales, growth% is mathematically undefined
// — we say so explicitly rather than returning Infinity or inventing 0%.
function getDemandTrend(db, session, { productId, days = 7 } = {}) {
  if (!productId) throw new ApiError('VALIDATION_ERROR', 'productId is required');
  const n = Number(days);
  const nowIso = new Date().toISOString();
  const periodStart = isoDaysAgo(n);
  const prevPeriodStart = isoDaysAgo(n * 2);

  const current = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) as units FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND si.product_id = ? AND s.created_at >= ? AND s.created_at < ?
  `).get(session.businessId, productId, periodStart, nowIso).units;

  const previous = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) as units FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND si.product_id = ? AND s.created_at >= ? AND s.created_at < ?
  `).get(session.businessId, productId, prevPeriodStart, periodStart).units;

  let growthPercent = null;
  let insufficientData = false;
  if (previous === 0 && current === 0) {
    insufficientData = true; // system states this explicitly — never fabricates a trend from zero data
  } else if (previous === 0) {
    insufficientData = true; // cannot compute a meaningful % growth from a zero base
  } else {
    growthPercent = round2(((current - previous) / previous) * 100);
  }

  return { productId, periodDays: n, currentPeriodUnits: current, previousPeriodUnits: previous, growthPercent, insufficientData };
}

// Per-product performance — reuses Finance's exact Revenue/COGS logic
// (sum over sale_items, not a separately invented calculation) and
// Inventory's exact stock/aging logic. Analytics never recomputes these
// independently (42_DATABASE_SOURCE_OF_TRUTH principle).
function getProductPerformance(db, session, { productId } = {}) {
  if (!productId) throw new ApiError('VALIDATION_ERROR', 'productId is required');

  const sold = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) as units, COALESCE(SUM(si.line_total), 0) as revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND si.product_id = ?
  `).get(session.businessId, productId);

  const cogsRow = db.prepare(`
    SELECT COALESCE(SUM(sib.quantity * sib.unit_cost), 0) as cogs
    FROM sale_item_batches sib
    JOIN sale_items si ON si.id = sib.sale_item_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND si.product_id = ?
  `).get(session.businessId, productId);

  const currentStock = inventory.getCurrentStock(db, session.businessId, productId);
  const aging = inventory.computeAging(db, session, { productId });
  const stockValue = round2(aging.reduce((sum, b) => sum + b.quantityRemaining * b.unitCost, 0));
  const oldestAgeDays = aging.length ? Math.max(...aging.map((b) => b.ageDays)) : null;

  const grossProfit = round2(sold.revenue - cogsRow.cogs);
  const grossMarginPercent = sold.revenue > 0 ? round2((grossProfit / sold.revenue) * 100) : null;
  const velocity = getVelocity(db, session, { productId, days: 7 });

  return {
    productId,
    unitsSold: sold.units,
    revenue: round2(sold.revenue),
    cogs: round2(cogsRow.cogs),
    grossProfit,
    grossMarginPercent,
    currentStock,
    stockValue,
    oldestBatchAgeDays: oldestAgeDays,
    salesVelocityPerDay: velocity.velocityPerDay,
  };
}

module.exports = { getVelocity, getDemandTrend, getProductPerformance };

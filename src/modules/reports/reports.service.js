'use strict';

function round2(n) { return Math.round(n * 100) / 100; }

function dateFilter(col, from, to) {
  const clauses = [];
  const args = [];
  if (from) { clauses.push(`${col} >= ?`); args.push(from); }
  if (to) { clauses.push(`${col} <= ?`); args.push(to); }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args };
}

// FR-REP-001 — every row links back to its source transaction ID (saleId,
// purchaseId, etc.) so a report is never a disconnected summary; it must
// reconcile with the Dashboard/Analytics/Finance figures built from the
// same underlying tables.
function getSalesReport(db, session, { from, to, customerId, paymentMethod, status } = {}) {
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  const d = dateFilter('created_at', from, to);
  clauses.push('1=1' + d.sql); args.push(...d.args);
  if (customerId) { clauses.push('customer_id = ?'); args.push(customerId); }
  if (paymentMethod) { clauses.push('payment_method = ?'); args.push(paymentMethod); }
  if (status) { clauses.push('status = ?'); args.push(status); }

  const rows = db.prepare(`SELECT * FROM sales WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...args);
  const data = rows.map((r) => ({
    saleId: r.id, date: r.created_at, customerId: r.customer_id, total: r.total, cogs: r.cogs,
    grossProfit: round2(r.total - r.cogs), paymentMethod: r.payment_method, status: r.status,
  }));
  return { data, summary: { count: data.length, totalRevenue: round2(data.reduce((s, r) => s + r.total, 0)) } };
}

function getPurchasesReport(db, session, { from, to, supplierId, status } = {}) {
  const clauses = ['business_id = ?'];
  const args = [session.businessId];
  const d = dateFilter('created_at', from, to);
  clauses.push('1=1' + d.sql); args.push(...d.args);
  if (supplierId) { clauses.push('supplier_id = ?'); args.push(supplierId); }
  if (status) { clauses.push('status = ?'); args.push(status); }

  const rows = db.prepare(`SELECT * FROM purchases WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`).all(...args);
  const data = rows.map((r) => ({
    purchaseId: r.id, date: r.created_at, supplierId: r.supplier_id, status: r.status, total: r.total, receivedAt: r.received_at,
  }));
  return { data, summary: { count: data.length, totalSpend: round2(data.reduce((s, r) => s + r.total, 0)) } };
}

function getInventoryReport(db, session) {
  const products = db.prepare(`SELECT * FROM products WHERE business_id = ? AND status = 'active'`).all(session.businessId);
  const canSeeCost = session.role !== 'Cashier';
  const data = products.map((p) => {
    const stockRow = db.prepare(`SELECT COALESCE(SUM(quantity_remaining),0) as stock, COALESCE(SUM(quantity_remaining * unit_cost),0) as value FROM inventory_batches WHERE business_id = ? AND product_id = ?`).get(session.businessId, p.id);
    const oldest = db.prepare(`SELECT MIN(received_at) as received_at FROM inventory_batches WHERE business_id = ? AND product_id = ? AND quantity_remaining > 0`).get(session.businessId, p.id);
    const ageDays = oldest.received_at ? Math.floor((Date.now() - new Date(oldest.received_at).getTime()) / 86400000) : null;
    const item = { productId: p.id, sku: p.sku, name: p.name, currentStock: stockRow.stock, oldestBatchAgeDays: ageDays };
    if (canSeeCost) item.stockValue = round2(stockRow.value);
    return item;
  });
  const summary = { productCount: data.length };
  if (canSeeCost) summary.totalStockValue = round2(data.reduce((s, r) => s + r.stockValue, 0));
  return { data, summary };
}

function getReturnsReport(db, session, { from, to } = {}) {
  const d = dateFilter('r.created_at', from, to);
  const rows = db.prepare(`
    SELECT r.id as return_id, r.sale_id, r.created_at, COALESCE(SUM(ri.line_total),0) as total
    FROM returns r LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE r.business_id = ? ${d.sql}
    GROUP BY r.id ORDER BY r.created_at DESC
  `).all(session.businessId, ...d.args);
  const data = rows.map((r) => ({ returnId: r.return_id, saleId: r.sale_id, date: r.created_at, total: round2(r.total) }));
  return { data, summary: { count: data.length, totalReturned: round2(data.reduce((s, r) => s + r.total, 0)) } };
}

module.exports = { getSalesReport, getPurchasesReport, getInventoryReport, getReturnsReport };

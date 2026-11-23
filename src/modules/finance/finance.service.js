'use strict';

function round2(n) { return Math.round(n * 100) / 100; }

// FR-FIN-001 — This is the ONLY place Gross Profit / Net Profit are
// computed. Dashboard, Reports, and Analytics must all call this function
// rather than recomputing the formula themselves (12_BUSINESS_RULES.md #12,
// 42_DATABASE_SOURCE_OF_TRUTH principle).
//
// Revenue and COGS are both reduced by returns, so a returned item does not
// silently keep inflating profit — see returns.service.js for how the
// returned COGS is derived (weighted-average cost of the original sale).
//
// Returned revenue is likewise the PRE-tax part of what was refunded
// (return_items.net_amount); the tax part is tracked as taxReturned.
//
// Revenue uses sales.taxable_amount (post-discount, PRE-tax), not
// sales.total — collected sales tax is money held for the tax authority,
// never the business's own revenue (master spec: "Do not equate revenue
// with cash"; the same principle applies to tax collected on its behalf).
function getSummary(db, session, { from, to } = {}) {
  const dateClause = (col) => {
    const clauses = [];
    const args = [];
    if (from) { clauses.push(`${col} >= ?`); args.push(from); }
    if (to) { clauses.push(`${col} <= ?`); args.push(to); }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args };
  };

  const salesDate = dateClause('s.created_at');
  const salesRow = db.prepare(`
    SELECT COALESCE(SUM(s.taxable_amount), 0) as revenue, COALESCE(SUM(s.cogs), 0) as cogs,
           COALESCE(SUM(s.tax_amount), 0) as taxCollected, COALESCE(SUM(s.discount_amount), 0) as discountsGiven,
           COUNT(*) as count
    FROM sales s WHERE s.business_id = ? AND s.status = 'completed' ${salesDate.sql}
  `).get(session.businessId, ...salesDate.args);

  const retDate = dateClause('r.created_at');
  const returnsRow = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(ri.net_amount, ri.line_total)), 0) as returnsRevenue,
           COALESCE(SUM(COALESCE(ri.tax_amount, 0)), 0) as taxReturned,
           COALESCE(SUM(ri.quantity * ib.unit_cost), 0) as returnsCogs
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    LEFT JOIN inventory_batches ib ON ib.id = ri.restocked_batch_id
    WHERE r.business_id = ? AND r.status = 'completed' ${retDate.sql}
  `).get(session.businessId, ...retDate.args);

  const expDate = dateClause('expense_date');
  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses WHERE business_id = ? ${expDate.sql}
  `).get(session.businessId, ...expDate.args);

  // Cash basis, deliberately separate from revenue: money actually confirmed
  // (cash at the till, a verified/confirmed non-cash payment) minus refunds
  // paid out. A PENDING non-cash sale is revenue but NOT collected cash.
  const payDate = dateClause('COALESCE(p.confirmed_at, p.created_at)');
  const collectedRow = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) as collected
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.business_id = ? AND p.status = 'SUCCESS' AND s.status = 'completed' ${payDate.sql}
  `).get(session.businessId, ...payDate.args);
  const pendingRow = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) as pending
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE p.business_id = ? AND p.status = 'PENDING' AND s.status = 'completed' ${salesDate.sql}
  `).get(session.businessId, ...salesDate.args);
  const refDate = dateClause('created_at');
  const refundsRow = db.prepare(`SELECT COALESCE(SUM(amount), 0) as paid FROM refunds WHERE business_id = ? ${refDate.sql}`).get(session.businessId, ...refDate.args);

  const netRevenue = round2(salesRow.revenue - returnsRow.returnsRevenue);
  const netCogs = round2(salesRow.cogs - returnsRow.returnsCogs);
  const grossProfit = round2(netRevenue - netCogs);
  const operatingExpenses = round2(expensesRow.total);
  const netProfit = round2(grossProfit - operatingExpenses);

  return {
    period: { from: from || null, to: to || null },
    salesCount: salesRow.count,
    grossRevenue: round2(salesRow.revenue),
    grossCogs: round2(salesRow.cogs),
    returnsRevenue: round2(returnsRow.returnsRevenue),
    returnsCogs: round2(returnsRow.returnsCogs),
    taxCollected: round2(salesRow.taxCollected), // held for the tax authority, not business revenue
    taxReturned: round2(returnsRow.taxReturned), // tax handed back to customers on returns
    netTaxHeld: round2(salesRow.taxCollected - returnsRow.taxReturned),
    collectedCash: round2(collectedRow.collected - refundsRow.paid), // confirmed receipts minus refunds paid (cash basis)
    refundsPaid: round2(refundsRow.paid),
    pendingPayments: round2(pendingRow.pending),     // sold but money not yet confirmed
    discountsGiven: round2(salesRow.discountsGiven),
    netRevenue,
    netCogs,
    grossProfit,
    operatingExpenses,
    netProfit,
  };
}

module.exports = { getSummary };

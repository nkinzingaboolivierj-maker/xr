'use strict';
const { nextId, now } = require('../../lib/ids');
const { ApiError } = require('../../lib/errors');
const { writeAudit } = require('../../lib/audit');
const { assertOwnedByBusiness } = require('../business/tenant');

// Categories remain business-configurable — never a hard-coded final list
// (see 12_BUSINESS_RULES.md #17). Creating an expense with a new category
// name creates that category on first use.
function ensureCategory(db, businessId, name) {
  const existing = db.prepare(`SELECT * FROM expense_categories WHERE business_id = ? AND name = ?`).get(businessId, name);
  if (existing) return existing;
  const id = nextId('ecat');
  db.prepare(`INSERT INTO expense_categories (id, business_id, name) VALUES (?, ?, ?)`).run(id, businessId, name);
  return { id, business_id: businessId, name };
}

function createExpense(db, session, { category, description, amount, expenseDate, paymentMethod }) {
  if (!category) throw new ApiError('VALIDATION_ERROR', 'category is required');
  const amt = Number(amount);
  if (!(amt > 0)) throw new ApiError('VALIDATION_ERROR', 'amount must be > 0');

  const cat = ensureCategory(db, session.businessId, category);
  const id = nextId('exp');
  const ts = now();
  db.prepare(`
    INSERT INTO expenses (id, business_id, category_id, description, amount, expense_date, payment_method, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, session.businessId, cat.id, description || null, amt, expenseDate || ts, paymentMethod || null, session.userId, ts);

  writeAudit(db, {
    businessId: session.businessId, actorId: session.userId,
    action: 'CREATE', resource: 'expense', resourceId: id, newState: { category, amount: amt },
  });

  return getExpense(db, session, id);
}

function getExpense(db, session, id) {
  const row = db.prepare(`SELECT e.*, c.name as category_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?`).get(id);
  assertOwnedByBusiness(row, session, 'Expense');
  return {
    id: row.id, category: row.category_name, description: row.description, amount: row.amount,
    expenseDate: row.expense_date, paymentMethod: row.payment_method, createdAt: row.created_at,
  };
}

function listExpenses(db, session, { from, to } = {}) {
  const clauses = ['e.business_id = ?'];
  const args = [session.businessId];
  if (from) { clauses.push('e.expense_date >= ?'); args.push(from); }
  if (to) { clauses.push('e.expense_date <= ?'); args.push(to); }
  return db.prepare(`
    SELECT e.*, c.name as category_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id
    WHERE ${clauses.join(' AND ')} ORDER BY e.expense_date DESC
  `).all(...args).map((row) => ({
    id: row.id, category: row.category_name, description: row.description, amount: row.amount,
    expenseDate: row.expense_date, paymentMethod: row.payment_method, createdAt: row.created_at,
  }));
}

module.exports = { createExpense, getExpense, listExpenses, ensureCategory };

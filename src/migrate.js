'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Versioned, forward-only migrations. Each runs exactly once inside its own
// transaction and is recorded in schema_migrations. 001 is the original
// schema.sql (all CREATE ... IF NOT EXISTS), so a database created by an
// earlier release upgrades in place WITHOUT data loss; everything after it
// only adds (columns, indexes, triggers). No migration drops or rewrites
// business data.
//
// NOTE: SQLite has no "ADD COLUMN IF NOT EXISTS", so addColumn() checks
// PRAGMA table_info first, making each migration safe to re-run.

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
function addColumn(db, table, column, ddl) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

const MIGRATIONS = [
  {
    id: '001_baseline_schema',
    up(db) {
      db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    },
  },
  {
    id: '002_indexes',
    // The baseline schema had NO secondary indexes: every tenant-scoped
    // list, FIFO batch pick, ledger timeline and report was a full table
    // scan. These match the actual WHERE / ORDER BY patterns in the services.
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_business_time ON audit_logs(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource, resource_id);
        CREATE INDEX IF NOT EXISTS idx_products_business_name ON products(business_id, name);
        CREATE INDEX IF NOT EXISTS idx_products_business_barcode ON products(business_id, barcode);
        CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(product_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id, name);
        CREATE INDEX IF NOT EXISTS idx_purchases_business_time ON purchases(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
        CREATE INDEX IF NOT EXISTS idx_batches_fifo ON inventory_batches(business_id, product_id, received_at);
        CREATE INDEX IF NOT EXISTS idx_batches_open ON inventory_batches(business_id, product_id) WHERE quantity_remaining > 0;
        CREATE INDEX IF NOT EXISTS idx_movements_product_time ON inventory_movements(business_id, product_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_movements_ref ON inventory_movements(reference_type, reference_id);
        CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id, name);
        CREATE INDEX IF NOT EXISTS idx_sales_business_time ON sales(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_item_batches_item ON sale_item_batches(sale_item_id);
        CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON sale_item_batches(batch_id);
        CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
        CREATE INDEX IF NOT EXISTS idx_price_overrides_sale ON price_overrides(sale_id);
        CREATE INDEX IF NOT EXISTS idx_returns_business_time ON returns(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
        CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
        CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);
        CREATE INDEX IF NOT EXISTS idx_refunds_return ON refunds(return_id);
        CREATE INDEX IF NOT EXISTS idx_refunds_business_time ON refunds(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_id, expense_date);
        CREATE INDEX IF NOT EXISTS idx_supplier_returns_purchase ON supplier_returns(business_id, purchase_id);
        CREATE INDEX IF NOT EXISTS idx_adjustments_product ON stock_adjustments(business_id, product_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notification_deliveries(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_business ON notification_deliveries(business_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_intents_business_status ON payment_intents(business_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_intents_sale ON payment_intents(sale_id);
        CREATE INDEX IF NOT EXISTS idx_tax_business ON tax_configurations(business_id, effective_from);
        CREATE INDEX IF NOT EXISTS idx_gpc_families_parent ON gpc_families(version_id, segment_code);
        CREATE INDEX IF NOT EXISTS idx_gpc_classes_parent ON gpc_classes(version_id, family_code);
        CREATE INDEX IF NOT EXISTS idx_gpc_bricks_parent ON gpc_bricks(version_id, class_code);
      `);
    },
  },
  {
    id: '003_business_profile_currency',
    // ISO 4217 currency / ISO 3166 country per business instead of an
    // implicit RWF everywhere, plus the profile fields a receipt needs.
    up(db) {
      addColumn(db, 'businesses', 'currency', "TEXT NOT NULL DEFAULT 'RWF'");
      addColumn(db, 'businesses', 'country', "TEXT NOT NULL DEFAULT 'RW'");
      addColumn(db, 'businesses', 'timezone', "TEXT NOT NULL DEFAULT 'Africa/Kigali'");
      addColumn(db, 'businesses', 'phone', 'TEXT');
      addColumn(db, 'businesses', 'address', 'TEXT');
      addColumn(db, 'businesses', 'tax_id', 'TEXT');
      addColumn(db, 'businesses', 'require_verified_payments', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    id: '004_session_and_user_hardening',
    up(db) {
      // Session ids are now SHA-256(token) at rest, so a leaked database
      // does not hand out usable bearer tokens (ASVS 7.2.x). Sessions that
      // were stored in the old plaintext form can no longer be matched, so
      // they are explicitly revoked: everyone logs in once after upgrading.
      addColumn(db, 'sessions', 'last_seen_at', 'TEXT');
      addColumn(db, 'sessions', 'user_agent', 'TEXT');
      addColumn(db, 'sessions', 'ip_address', 'TEXT');
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL`).run(new Date().toISOString());
      addColumn(db, 'users', 'last_login_at', 'TEXT');
      addColumn(db, 'users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    id: '005_payment_confirmation',
    // Who/what confirmed a non-cash payment. Previously a MobileMoney/Card
    // sale stayed PENDING forever with no way to settle it.
    up(db) {
      addColumn(db, 'payments', 'confirmation', 'TEXT');
      addColumn(db, 'payments', 'payment_intent_id', 'TEXT');
      addColumn(db, 'payments', 'confirmed_by', 'TEXT');
      addColumn(db, 'payments', 'confirmed_at', 'TEXT');
      addColumn(db, 'payments', 'reference', 'TEXT');
      db.exec(`UPDATE payments SET confirmation = 'CASH', confirmed_at = created_at WHERE method = 'Cash' AND confirmation IS NULL`);
    },
  },
  {
    id: '006_append_only_ledgers',
    // Audit records and the inventory ledger are append-only. Enforced in
    // the database so no code path (or stray SQL) can rewrite history.
    up(db) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_logs
          BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_logs
          BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_movements_no_update BEFORE UPDATE ON inventory_movements
          BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_movements_no_delete BEFORE DELETE ON inventory_movements
          BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;
      `);
    },
  },
  {
    id: '007_return_item_net_and_tax',
    // return_items.line_total is now the tax-inclusive amount the customer
    // paid for the returned units (the refundable value). Finance needs the
    // pre-tax revenue part and the tax part separately. Legacy rows were
    // list-price x qty (pre-tax), so they backfill as net = line_total, tax = 0.
    up(db) {
      addColumn(db, 'return_items', 'net_amount', 'REAL');
      addColumn(db, 'return_items', 'tax_amount', 'REAL');
      db.exec(`UPDATE return_items SET net_amount = line_total, tax_amount = 0 WHERE net_amount IS NULL`);
    },
  },
];

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare(`SELECT id FROM schema_migrations`).all().map((r) => r.id));
  const ran = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(m.id, new Date().toISOString());
      db.exec('COMMIT');
      ran.push(m.id);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
      throw new Error(`Migration ${m.id} failed and was rolled back: ${err.message}`);
    }
  }
  return ran;
}

module.exports = { migrate, MIGRATIONS };

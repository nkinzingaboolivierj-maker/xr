-- XR System — Database Schema
-- SQLite (development). Production target: PostgreSQL (see docs/c4/DEPLOYMENT_RELATIONSHIP.md).
-- FR references noted per table so this schema stays traceable to 08_FUNCTIONAL_REQUIREMENTS.md

PRAGMA foreign_keys = ON;

-- ===================== IDENTITY / BUSINESS (Stage 1) =====================

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  -- WhatsApp sender config is a PLACEHOLDER until a real provider/number is
  -- supplied (Phase 8 / BLOCKED_PENDING_PROVIDER). whatsapp_provider stays
  -- 'MOCK' until swapped — swapping it is the ONLY change needed to go live,
  -- nothing else in the notification pipeline changes.
  whatsapp_sender_number TEXT,
  whatsapp_provider TEXT NOT NULL DEFAULT 'MOCK' CHECK (whatsapp_provider IN ('MOCK','REAL')),
  -- Payment rails: Airtel Money, MTN Mobile Money, and Card (Stage 11).
  -- Same MOCK/REAL adapter pattern as WhatsApp above -- see
  -- payment.provider.js. Real provider credentials for any of these three
  -- are not yet supplied (BLOCKED_PENDING_PROVIDER).
  payment_provider TEXT NOT NULL DEFAULT 'MOCK' CHECK (payment_provider IN ('MOCK','REAL')),
  created_at TEXT NOT NULL
);

-- FR-AUTH-001, FR-SEC-001
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner','Manager','Cashier','InventoryStaff')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  UNIQUE(business_id, email)
);

-- FR-AUTH-002
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  business_id TEXT NOT NULL REFERENCES businesses(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- FR-AUD-001
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id), -- NULL only for genuinely global/platform-level actions (e.g. GPC import)
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  old_state TEXT,
  new_state TEXT,
  created_at TEXT NOT NULL
);

-- ===================== CATALOG & PRICING (Stage 1) =====================

-- FR-PROD-001 (category is a flat field today — FR-CLS-001 / GS1 GPC is TARGET)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'Piece',
  barcode TEXT,             -- real GTIN/barcode when known; NULL until supplied (never fabricated)
  gpc_brick_code TEXT,      -- NULL = UNMAPPED (never guessed, see FR-CLS-001)
  gpc_version_id TEXT REFERENCES gpc_taxonomy_versions(id), -- freezes WHICH version classified this product
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  UNIQUE(business_id, sku)
);

-- FR-PRICE-001
CREATE TABLE IF NOT EXISTS product_pricing (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  min_price REAL NOT NULL,
  recommended_price REAL NOT NULL,
  max_price REAL NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (min_price <= recommended_price AND recommended_price <= max_price)
);

-- FR-PRICE-002
CREATE TABLE IF NOT EXISTS product_price_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  price_type TEXT NOT NULL CHECK (price_type IN ('min','recommended','max')),
  old_value REAL,
  new_value REAL NOT NULL,
  actor_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

-- ===================== PROCUREMENT (Stage 2) =====================

-- FR-SUP-001
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL
);

-- FR-PUR-001, FR-REC-001
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received')),
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  received_at TEXT,
  UNIQUE(business_id, purchase_number)
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0)
);

-- ===================== INVENTORY (Stage 2) =====================

-- FR-INV-001, FR-FIFO-001
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  purchase_item_id TEXT REFERENCES purchase_items(id),
  batch_number TEXT NOT NULL,
  quantity_received REAL NOT NULL CHECK (quantity_received > 0),
  quantity_remaining REAL NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  received_at TEXT NOT NULL
);

-- FR-INV-001, FR-INV-003
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  type TEXT NOT NULL CHECK (type IN (
    'PURCHASE','SALE','CUSTOMER_RETURN','SUPPLIER_RETURN',
    'DAMAGE','LOSS','ADJUSTMENT_IN','ADJUSTMENT_OUT'
  )),
  quantity REAL NOT NULL CHECK (quantity > 0),
  reference_type TEXT,
  reference_id TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

-- ===================== CUSTOMERS, SALES, PAYMENTS (Stage 3) =====================

-- FR-CUS-001
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  type TEXT NOT NULL DEFAULT 'walk-in' CHECK (type IN ('walk-in','named')),
  created_at TEXT NOT NULL
);

-- FR-POS-001, FR-POS-002
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  customer_id TEXT REFERENCES customers(id),
  operation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  subtotal REAL NOT NULL,            -- sum of line totals BEFORE any discount
  discount_amount REAL NOT NULL DEFAULT 0, -- sale-level discount only (line discounts are already baked into subtotal's line totals below)
  discount_reason TEXT,
  taxable_amount REAL NOT NULL DEFAULT 0,  -- subtotal - discount_amount, the base tax was computed on
  tax_rate REAL NOT NULL DEFAULT 0,        -- historical snapshot of the rate actually applied (FR: tax must survive later config changes)
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,                -- taxable_amount + tax_amount = what the customer actually owed
  cogs REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash','MobileMoney','Bank','Card','Other')),
  cash_received REAL,
  change_due REAL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(business_id, operation_id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL, -- historical snapshot (Business Rule #14) - survives later product renames
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,     -- the standard/approved price used (post price-override if any)
  line_discount_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL      -- (unit_price * quantity) - line_discount_amount
);

-- Tax configuration. A business may have zero active configs (no tax
-- applied - never fabricated) or one effective at any given date.
CREATE TABLE IF NOT EXISTS tax_configurations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  rate_percent REAL NOT NULL CHECK (rate_percent >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- Price override audit trail - every sale of a product outside its
-- Min/Max band must have a row here, independent of the sale/audit log,
-- so "how often do we override, and who approves it" is a direct query.
CREATE TABLE IF NOT EXISTS price_overrides (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sale_id TEXT REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  standard_price REAL NOT NULL,
  min_price REAL NOT NULL,
  max_price REAL NOT NULL,
  requested_price REAL NOT NULL,
  final_price REAL NOT NULL,
  reason TEXT NOT NULL,
  permission_used TEXT NOT NULL CHECK (permission_used IN ('PRICE_OVERRIDE_BELOW_MIN','PRICE_OVERRIDE_ABOVE_MAX')),
  requested_by TEXT,
  created_at TEXT NOT NULL
);

-- FR-FIFO-001 — records exactly which batches funded a sale item, for full traceability
CREATE TABLE IF NOT EXISTS sale_item_batches (
  id TEXT PRIMARY KEY,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL
);

-- FR-PAY-001, FR-PAY-002
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INITIATED','PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED')),
  amount REAL NOT NULL,
  created_at TEXT NOT NULL
);

-- ===================== GS1 GPC TAXONOMY (Phase 4) =====================
-- GLOBAL reference data (no business_id): GPC is one shared worldwide
-- standard, not something each business defines for itself. Old versions
-- are NEVER deleted or overwritten — only one is_active=1 at a time, and
-- a product's gpc_version_id freezes which version it was classified
-- under, so a later import never silently rewrites past classification.

CREATE TABLE IF NOT EXISTS gpc_taxonomy_versions (
  id TEXT PRIMARY KEY,
  version_name TEXT NOT NULL UNIQUE,  -- e.g. "2026-05" per GS1's own publication naming
  source TEXT,                        -- filename/provenance of what was imported
  status TEXT NOT NULL CHECK (status IN ('VALIDATING','ACTIVE','REJECTED','SUPERSEDED')),
  is_active INTEGER NOT NULL DEFAULT 0,
  row_counts TEXT,                    -- JSON: {segments,families,classes,bricks,errors}
  validation_report TEXT,             -- JSON: list of validation errors, if any
  imported_by TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gpc_segments (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES gpc_taxonomy_versions(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(version_id, code)
);

CREATE TABLE IF NOT EXISTS gpc_families (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES gpc_taxonomy_versions(id),
  segment_code TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(version_id, code)
);

CREATE TABLE IF NOT EXISTS gpc_classes (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES gpc_taxonomy_versions(id),
  family_code TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(version_id, code)
);

CREATE TABLE IF NOT EXISTS gpc_bricks (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES gpc_taxonomy_versions(id),
  class_code TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(version_id, code)
);

-- ===================== RETURNS, REFUNDS, EXPENSES, FINANCE (Stage 4) =====================

-- FR-RET-001
CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  condition TEXT,
  reason TEXT,
  restocked_batch_id TEXT REFERENCES inventory_batches(id)
);

-- FR-REF-001
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  return_id TEXT NOT NULL REFERENCES returns(id),
  amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  method TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

-- FR-EXP-001
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  UNIQUE(business_id, name)
);

-- FR-SUPRET-001 — sending stock back to a supplier. The original purchase
-- row is never modified; this is a separate, additive record.
CREATE TABLE IF NOT EXISTS supplier_returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  reason TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

-- FR-ADJ-001 — damage, loss, and manual stock-count corrections.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('DAMAGE','LOSS','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  reason TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

-- FR-NOT-001 (Phase 8) — asynchronous, provider-independent notification
-- queue. A delivery failure here NEVER rolls back the business transaction
-- that triggered it (e.g. a sale stays completed even if the receipt
-- WhatsApp message fails).
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  type TEXT NOT NULL CHECK (type IN ('RECEIPT','INVOICE','PAYMENT_CONFIRMATION','REFUND_NOTIFICATION','ALERT','OPERATIONAL')),
  channel TEXT NOT NULL DEFAULT 'WHATSAPP' CHECK (channel IN ('WHATSAPP')),
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  reference_type TEXT,         -- e.g. 'sale'
  reference_id TEXT,           -- e.g. the sale id
  payload TEXT,                 -- JSON snapshot of what was sent (e.g. receipt text)
  provider TEXT NOT NULL,       -- 'MOCK' or 'REAL' at time of send (snapshotted, like tax/price)
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENDING','SENT','FAILED','RETRYING')),
  attempts INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  last_attempt_at TEXT,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  description TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL,
  payment_method TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

-- ===================== PAYMENT ADAPTER (Stage 11) =====================
-- Rails: Airtel Money and MTN Mobile Money (method='MobileMoney',
-- distinguished by network -- they are different networks with separate
-- real APIs, never treated as interchangeable), and Card (method='Card').
-- Same MOCK/REAL adapter pattern as WhatsApp notifications -- see
-- payment.provider.js. Real credentials for any of the three are not yet
-- supplied (BLOCKED_PENDING_PROVIDER); businesses.payment_provider is the
-- one flag that switches a business from MOCK to REAL once they are.

-- A PRE-SALE record of a provider interaction -- deliberately separate
-- from `payments` (written only once a sale exists). This means a
-- provider-confirmed SUCCESS is never lost even if sale creation fails
-- afterward: payment.service.js#listUnreconciled finds exactly these rows
-- (status='SUCCESS' AND sale_id IS NULL) so they can be matched to a sale
-- by hand instead of silently disappearing.
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  method TEXT NOT NULL CHECK (method IN ('MobileMoney','Card')),
  network TEXT CHECK (network IN ('AIRTEL_MONEY','MTN_MOMO') OR network IS NULL),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'RWF',
  status TEXT NOT NULL CHECK (status IN ('INITIATED','PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED')),
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('MOCK','REAL')),
  provider_reference TEXT UNIQUE,
  sale_id TEXT REFERENCES sales(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id, idempotency_key)
);

-- A real provider retries a webhook delivery until it gets back a 2xx, so
-- the SAME event can legitimately arrive more than once. This table is
-- what makes a replay a no-op instead of double-applying a status change
-- (see payment.service.js#handleWebhook).
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload TEXT,
  received_at TEXT NOT NULL,
  UNIQUE(provider, provider_event_id)
);

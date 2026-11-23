'use strict';
const { ApiError } = require('../../lib/errors');

// Every action a role may perform. UI visibility is never the enforcement
// point — every controller calls requirePermission() before acting.
// Note: 'gpc.import' is deliberately only granted via Owner's '*' wildcard,
// not listed for Manager. GPC is a GLOBAL shared taxonomy (not scoped to
// one business), so importing it is treated as a platform-level action
// until a dedicated platform-admin role exists — see docs/product/OPEN_DECISIONS.
const MATRIX = {
  Owner:          ['*'],
  Manager: [
    'product.read', 'product.write', 'price.write', 'price.read',
    'supplier.read', 'supplier.write',
    'purchase.read', 'purchase.write', 'purchase.receive',
    'inventory.read', 'inventory.adjust',
    'customer.read', 'customer.write',
    'sale.read', 'sale.write', // a Manager can also run POS / process an authorized discount or price override themselves
    'return.read', 'return.write',
    'refund.read', 'refund.write',
    'expense.read', 'expense.write',
    'finance.read',
    'user.read',
    'tax.read', 'tax.write',
    'sale.discount', 'business.settings.write',
    'price.override.below_min', 'price.override.above_max',
    'payment.read', 'payment.write', 'payment.reconcile',
  ],
  Cashier: [
    'product.read', 'price.read',
    'customer.read', 'customer.write',
    'sale.read', 'sale.write',
    'inventory.read',
    'return.read', 'return.write',
    'refund.read',
    'tax.read',
    'payment.read', 'payment.write', // a Cashier runs POS and must be able to initiate a Mobile Money / Card payment themselves
    // Deliberately NO 'payment.reconcile' -- matching unreconciled
    // (provider-confirmed-but-unattached) payments is a financial
    // oversight action, reserved for Manager/Owner.
    // Deliberately NO 'sale.discount' or 'price.override.*' — a Cashier
    // cannot authorize their own discount or price override. A Manager/
    // Owner must process that sale (ASVS-style least-privilege; mirrors
    // the master spec's "Cashiers must not automatically receive override
    // authority").
  ],
  InventoryStaff: [
    'product.read',
    'supplier.read',
    'purchase.read', 'purchase.receive',
    'inventory.read', 'inventory.adjust',
  ],
};

// Every permission string the system knows, so the Owner wildcard can be
// expanded for /me. Informational for the UI only: enforcement is ALWAYS the
// server-side requirePermission() call in each controller.
const ALL_ACTIONS = Array.from(new Set([
  ...Object.values(MATRIX).flat().filter((a) => a !== '*'),
  'gpc.import', 'user.write', 'business.profile.write',
])).sort();

function permissionsFor(role) {
  const perms = MATRIX[role];
  if (!perms) return [];
  return perms.includes('*') ? ALL_ACTIONS.slice() : perms.slice().sort();
}

function can(role, action) {
  const perms = MATRIX[role];
  if (!perms) return false;
  return perms.includes('*') || perms.includes(action);
}

function requirePermission(session, action) {
  if (!can(session.role, action)) {
    throw new ApiError('PERMISSION_DENIED', `Role '${session.role}' cannot perform '${action}'`);
  }
}

module.exports = { can, requirePermission, permissionsFor, ALL_ACTIONS, MATRIX };

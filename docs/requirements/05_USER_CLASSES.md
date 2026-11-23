# 05 — User Classes

**Status:** IMPLEMENTED (RBAC roles exist and are tested) — permission
granularity beyond POS is TARGET since POS itself is not built.

## Roles

### Owner
- **Responsibilities:** overall business oversight, financial visibility,
  configuration.
- **Permissions:** full read access to all modules; write access to
  business settings; typically also has Manager-level write access.
- **Data access:** unrestricted within their own business (never across
  businesses).
- **Status:** RBAC role implemented and tested (Stage 1).

### Manager
- **Responsibilities:** approve purchases, set/edit pricing within policy,
  receive stock, manage suppliers.
- **Permissions:** write on Products, Pricing, Suppliers, Purchases,
  Inventory; cannot alter security/RBAC configuration.
- **Data access:** business-scoped, no cross-business visibility.
- **Status:** RBAC role implemented and tested (Stage 1).

### Cashier
- **Responsibilities:** run POS, take payment, issue receipts, look up
  products/customers.
- **Permissions:** create Sales/Payments; **cannot** override price below
  minimum or above maximum; cannot edit inventory directly.
- **Data access:** business-scoped; typically no visibility into cost
  price or supplier terms.
- **Status:** RBAC role implemented (Stage 1); the workflows the role acts
  on (POS/Sales) are TARGET, not yet built.

### Inventory Staff
- **Responsibilities:** receive purchases, create/adjust batches, run
  stock counts, record damage/loss.
- **Permissions:** write on Purchases (receive step), Inventory,
  Adjustments; typically read-only on Pricing.
- **Data access:** business-scoped.
- **Status:** IMPLEMENTED and tested (Stage 2).

## Design principle enforced across every role

**UI visibility is not security.** Hiding a button from a Cashier is a
convenience, not a control. Every permission above is (or will be, for
TARGET workflows) enforced server-side — a Cashier calling the API
directly must be rejected exactly as if they had tried through the UI.

## Not yet modeled (open for a future revision)

An **Accountant** or **Admin** role was mentioned in earlier discussion but
is not yet formalized with its own permission set. This is logged as an
open decision in the traceability workbook (`OPEN_DECISIONS` sheet) rather
than invented here.

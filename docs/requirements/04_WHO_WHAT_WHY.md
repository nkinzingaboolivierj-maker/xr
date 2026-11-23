# 04 — WHO / WHAT / WHY

**Status:** Formalized here for the first time — the master specification
implied these relationships but never tabulated them explicitly.

| WHO | WHAT they do in XR | WHY it matters | Data they touch |
|---|---|---|---|
| **Business Owner** | Views reports, profit, risk indicators; configures business settings | Needs the truth about the business without asking staff | All modules, read-heavy; full financial visibility |
| **Manager** | Approves purchases, sets/edits pricing, receives stock, manages suppliers | Bridges procurement decisions and floor operations | Products, Pricing, Suppliers, Purchases, Inventory |
| **Cashier** | Runs POS, takes payment, issues receipts | Front-line revenue capture — must be fast and cannot be trusted with price overrides | POS, Sales, Payments, Customers (read/create) |
| **Inventory Staff** | Receives purchases, creates batches, performs stock counts and adjustments | Keeps the ledger honest — the source of every downstream number | Purchases (receive), Inventory, Batches |
| **Customer** (external) | Receives receipts, may have purchase history | Not a system user, but a stakeholder in Documents/Notifications | Documents, Customer records (limited exposure) |
| **Supplier** (external) | Source of purchased goods | Referenced by procurement, not a system user | Suppliers, Purchases |

## Why this matters for design

- No screen should let a Cashier do what only a Manager should (e.g.
  override a price below minimum). This is enforced in RBAC
  (`FR-AUTH-001`, `FR-SEC-001`) — **on the backend**, never only hidden in
  the UI.
- Every WHAT above must map to a Functional Requirement (see
  `08_FUNCTIONAL_REQUIREMENTS.md`) and every WHY must be traceable back to
  the core Business Requirement (see `03_BUSINESS_REQUIREMENTS.md`) — no
  feature exists "because it seemed useful."

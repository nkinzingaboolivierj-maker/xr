# 12 — Business Rules

**Status:** These are non-negotiable, cross-cutting rules — every FR, use
case, and future screen must comply. A feature that breaks one of these
is a defect, not a design choice.

## Pricing

1. **MINIMUM ≤ RECOMMENDED ≤ MAXIMUM**, enforced server-side on save and
   on sale. *IMPLEMENTED (save-time); sale-time enforcement is TARGET
   pending POS.*
2. A sale price outside the band is **blocked**, not warned-and-allowed,
   unless an explicit authorized override exists. *Override system:
   TARGET, not yet specified in detail — logged as an open decision.*
3. Every price change is audited: old value, new value, actor, timestamp,
   reason. *IMPLEMENTED.*

## Inventory

4. Inventory is a **ledger**, never a directly-edited number. Every change
   is a movement record (`PURCHASE`, `SALE`, `CUSTOMER_RETURN`,
   `SUPPLIER_RETURN`, `DAMAGE`, `LOSS`, `ADJUSTMENT_IN`,
   `ADJUSTMENT_OUT`). *IMPLEMENTED.*
5. Negative stock is **blocked by default**. *IMPLEMENTED.*
6. Costing uses **FIFO** — oldest batch consumed first — never silently
   averaged. *IMPLEMENTED.*
7. **Stock age is an inventory metric. It is never treated as a profit or
   loss signal on its own.** Profit is computed only from Revenue, COGS,
   and Expenses. *IMPLEMENTED (age calculation); rule enforced by keeping
   Finance and Inventory as separate authoritative sources.*
8. A draft purchase never affects inventory — only receiving does.
   *IMPLEMENTED.*

## Sales & Finance (TARGET — rules to hold once built)

9. The backend revalidates stock, price, and totals at sale submission —
   client-cached values are never trusted.
10. Sale completion is atomic and idempotent — a retried request must
    never create a duplicate sale, payment, or inventory deduction.
11. **Sale Total ≠ Cash Received.** Change is computed server-side.
12. Gross Profit = Revenue − COGS. Net Profit = Gross Profit − Operating
    Expenses. This is the **only** definition used by Dashboard, Reports,
    and Analytics.
13. A return quantity may never exceed (original sold − already
    returned). A refund may never exceed the remaining refundable amount.

## Historical Integrity

14. Completed transactions retain their original snapshot (price, product
    name, discount) even after master data changes later. A price change
    tomorrow does not rewrite what a customer was charged today.

## Security & Tenancy

15. Every business record is scoped by `business_id`. A request without
    proven access to that business is rejected — the business ID a client
    supplies is never trusted on its own. *IMPLEMENTED.*
16. UI visibility is not authorization. Every permission is enforced on
    the backend regardless of what the frontend/mobile client shows.
    *IMPLEMENTED for Stage 1+2 scope.*

## Data Provenance

17. No real client data (suppliers, customers, prices, tax numbers) may be
    invented. Unknowns are marked `CONFIGURABLE_PLACEHOLDER` or
    `DEVELOPMENT_EXAMPLE` and documented as such. *IMPLEMENTED as a
    working convention in the current demo data.*
18. No product category, GPC code, or classification may be invented — if
    the taxonomy cannot classify a product confidently, it is marked
    `GPC_CLASSIFICATION_REVIEW_REQUIRED`, never guessed. *Rule stands;
    GPC import itself is TARGET.*

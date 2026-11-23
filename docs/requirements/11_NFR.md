# 11 — Non-Functional Requirements (NFR)

**Status:** Targets below are the specification's stated intent. None are
verified against production load yet — there is no staging/production
environment (see `docs/c4/DEPLOYMENT_RELATIONSHIP.md`).

## NFR-PERF-001 — Performance
Product search, QR lookup, POS submission, dashboard load, and report
generation should meet p50/p95/p99 targets once defined against real
workload data. *No numeric target is invented here until representative
load is measured — see Open Decisions.*

## NFR-SEC-001 — Security
All authentication, RBAC, and tenant-isolation behavior must be verified
against OWASP ASVS 5.0.0 controls, with evidence (see
`docs/security/OWASP_ASVS_MAPPING.md`, to be produced next).
*Status: Auth/RBAC/tenant isolation IMPLEMENTED and tested; full ASVS
mapping not yet produced.*

## NFR-REL-001 — Reliability
Every multi-step business operation (receiving, sale completion, refund)
must be atomic — full commit or full rollback, no partial state.
*Status: IMPLEMENTED for receiving (Stage 2, tested); sale/refund
atomicity is TARGET pending those features.*

## NFR-SCALE-001 — Scalability
The system should handle at least 10,000+ products, 100,000+ sales,
50,000+ customers, and 500,000+ inventory movements as engineering
targets for schema and query design. *Status: schema designed with this
in mind (indexed batch/ledger tables); not load-tested.*

## NFR-MAINT-001 — Maintainability
Business logic (FIFO, pricing, financial calculations) must live in the
Service/Domain layer only — never duplicated in frontend, mobile, or
controller code. *Status: enforced in Stage 1+2 code structure; must hold
for every future domain.*

## NFR-OBS-001 — Observability
The system must expose health/readiness/liveness signals and structured
logs once deployed, and must never log secrets. *Status: TARGET — no
deployment exists yet to observe.*

## NFR-A11Y-001 — Accessibility
Web UI must meet WCAG 2.2 baseline: keyboard navigation, labels, contrast,
non-color-only status communication. *Status: TARGET — not yet audited
against the approved prototype.*

## NFR-AUDIT-001 — Auditability
Every sensitive change (price, stock, purchase, sale, refund, permission)
must produce an audit record with actor, action, resource, and timestamp.
*Status: IMPLEMENTED for Stage 1+2 scope; must expand as new domains ship.*

## NFR-REC-001 — Recoverability
A backup is not considered valid until a restore has actually been tested.
*Status: TARGET — no backup/restore process exists yet (dev SQLite only).*

## NFR-PRIV-001 — Data Integrity / Historical Accuracy
Completed transactions must retain their original price/product-name
snapshot even after master data changes later. *Status: TARGET — depends
on Sales/Documents existing; principle already enforced in price history
design (Stage 1).*

## Explicitly avoided

No NFR here states a numeric guarantee (uptime %, exact latency ms) that
has not been measured or explicitly agreed with you. Inventing such a
number would violate the master specification's own instruction: "Do not
invent unrealistic guarantees."

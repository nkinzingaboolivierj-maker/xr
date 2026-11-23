# 00 — Project Discovery

**Status:** PARTIAL — this discovery is grounded in direct inspection of
what is actually present in this conversation (one prototype file + four
standards references), plus the previously reported Stage 1/Stage 2
backend status. The backend repository itself has not been uploaded here,
so backend claims below are carried forward as **reported**, not
freshly verified.

## What was actually inspected in this session

| File | Size | What it is | Finding |
|---|---|---|---|
| `xr-pos-demo__2_.html` | 88 KB, 1469 lines | Desktop UX prototype | Confirmed: single static file, pure client-side JavaScript, **zero network calls** (`fetch`/`XMLHttpRequest` count = 0), **no `localStorage`** (state resets on reload). Matches its documented purpose exactly: a UX reference, not a connected app. |
| `OWASP_Application_Security_Verification_Standard_3_1__1_.xlsx` | 124 KB | Filename claims OWASP ASVS | **MISMATCH FOUND** — see below |
| `OpenAPI-Specification-3_2_1.zip` | 660 KB | OpenAPI spec source | Confirmed genuine: contains the official `OpenAPI-Specification-3.2.1` repository structure |
| `rec20_0.zip` | 5.0 MB | UNECE Rec. 20 archive | Confirmed genuine: contains historical revisions through `rec20_Rev17e-2021` |
| `rec20_Rev17e-2021_0.xlsx` | 300 KB | UNECE Rec. 20 code table | Confirmed genuine: sheet reads "CODES FOR UNITS OF MEASURE USED IN INTERNATIONAL TRADE Revision 17 (UNECE/CEFACT Trade Facilitation Recommendation No. 20)" |
| `visualising-software-architecture-with-the-c4-model.pdf` | 87 MB, 184 pages | C4 Model reference | Confirmed genuine reference material (Keynote-exported, matches the C4 model's own visual style) |

## Finding requiring your decision: the "OWASP ASVS" file is not ASVS

The uploaded file's sheets are `Stats`, `Threat Data`, `Vuln Data`,
`Lookup Tables`, `Safe Guards`, `Where is...`, with formulas computing a
**Safe Guard Index** (`Total CR / Potential CR`) and percentage-of-risk
breakdowns by area (Authentication, Session Management, Access Control,
etc.).

This is the structure of a **generic threat/vulnerability risk-assessment
workbook** — not the OWASP Application Security Verification Standard,
which is structured as numbered chapters (V1–V14), assurance Levels 1–3,
and individually numbered requirements (e.g. "2.1.1"). No ASVS chapter/
level/requirement structure appears anywhere in this file.

**Per the standards-ingestion rule you set (never silently assume, never
invent), this file cannot be used as the ASVS control-mapping source.**
Earlier in this conversation, before this file was actually opened, some
documents referenced "OWASP ASVS 5.0.0" as if this upload confirmed it —
that was an unverified assumption on my part and is corrected here.

**Your options:**
1. Supply the actual OWASP ASVS spreadsheet/PDF (available from
   owasp.org) so `docs/security/OWASP_ASVS_MAPPING.md` can be built
   against the real control list.
2. Keep this file for what it actually is — a threat/vulnerability risk
   register — and use it later for `docs/security/THREAT_MODEL.md`
   instead of ASVS control mapping.
3. Proceed with ASVS references at a general-knowledge level only
   (chapter names, not verified line-by-line controls) until the real
   document is supplied.

No security document in this package claims ASVS control-by-control
compliance until one of the above is resolved.

## Prototype technology inventory (from direct inspection)

- **Frontend framework:** none — vanilla JavaScript, direct DOM string
  rendering (`render()` function rebuilds the `#app` HTML on every state
  change).
- **State:** a single in-memory `state` object; no persistence layer.
- **Sections implemented:** Dashboard, POS, Products, Purchases,
  Inventory, Sales, Customers, Expenses, Analytics, Documents, Settings —
  11 sections, each with its own `render<Section>()` function.
- **Demo catalog:** 10 products (Wireless Mouse, USB-C Hub, Screen
  Protector, iPhone 14, Samsung Galaxy A25, Power Bank, USB-C Cable,
  Bluetooth Earbuds, Laptop Charger, Laptop Stand), flat `category` string
  field (e.g. "Computer Accessories", "Phones") — **not** GS1 GPC.
  Currency is `RWF` throughout.
- **POS/payment:** cash-received validation happens client-side
  (`cashNum < total` check in-browser) — confirms payment logic here is
  illustrative only, consistent with "simulated" status.
- **Expenses:** freeform category strings (Rent, Packaging, Transport,
  Utilities, Marketing), not a configurable category table.

## Backend status (reported, not re-verified in this session)

No backend repository was uploaded to this conversation. The following is
carried forward from prior reporting and treated as **reported evidence**,
not freshly confirmed:

- Node.js (v22+) modular monolith, built-in modules only
  (`node:sqlite`, `node:crypto`, `node:http`), no external dependencies.
- Stage 1 (Foundation): auth, RBAC, business isolation, products/pricing,
  audit — reported 23 passing checks.
- Stage 2 (Procurement + Inventory): suppliers, purchases, ledger
  inventory, FIFO, stock aging — reported additional checks, 52 total
  across both stages.
- A tested mobile API client wrapping the above endpoints (11/11 tests
  reported).

**To move this from "reported" to "confirmed," upload the backend
repository (`xr-system.zip` or equivalent) in a future turn.**

## What is still missing for a complete Project Discovery

- **A second prototype ZIP** — only one prototype has been supplied in
  this conversation. Prototype Reconciliation (`01_PROTOTYPE_RECONCILIATION.md`)
  is therefore PARTIAL, not complete.
- **The actual backend repository** — needed to move C4 Level 4 and the
  Functional Requirements' IMPLEMENTED claims from "reported" to
  "confirmed by direct read."
- **The real OWASP ASVS document** — see the finding above.

## Production blockers already visible from this discovery alone

- The prototype has zero backend connectivity — it cannot be "launched"
  as a product; it is reference material only.
- No product category in the prototype is GPC-compliant — a full
  reclassification pass is required before or during the Catalog domain
  build.
- The security reference material supplied does not yet support a real
  ASVS compliance claim.

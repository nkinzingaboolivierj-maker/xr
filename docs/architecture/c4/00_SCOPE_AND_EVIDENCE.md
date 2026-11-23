# C4 Documentation — Scope & Evidence Note

**Read this first.**

This C4 package documents the XR Business Management & POS platform as it is
**currently known and reported**, not from a fresh inspection of the backend
source repository — the backend codebase (`xr-system.zip`) has not been
uploaded into this conversation. Everything here is built from:

1. The reported implementation status of **Stage 1 (Foundation)** and
   **Stage 2 (Procurement + Inventory)** — a Node.js (v22+) modular-monolith
   backend using only built-in modules (`node:sqlite`, `node:crypto`,
   `node:http`), verified by 52 automated integration checks
   (`tests/stage1.test.js`, `tests/stage2.test.js`) against a real running
   server and real SQLite database.
2. The two approved UX prototypes — `xr-pos-demo.html` (desktop) and
   `xr-mobile-demo.html` (mobile) — both explicitly **UI/UX reference only**,
   with in-memory state, **not wired to the real backend**.
3. The tested mobile API client foundation (`mobile/api-client/`), which
   **is** wired to the real backend for the endpoints that exist today
   (auth, products, suppliers, purchases, inventory, categories, users,
   audit) — 11/11 integration tests passing.
4. The approved Master Prompt specification (target domain model, standards,
   full feature list) for everything not yet built.

## What this means for evidence

- Where a component is marked **IMPLEMENTED**, the evidence is the reported
  test suite above, not a line-by-line code read in this session.
- **C4 Level 4 (Code View)** cannot cite exact file paths with certainty
  without the actual repository. Relationships shown there are the
  *intended* / *reported* architecture. They are marked
  `PENDING_VERIFICATION` where a direct source read would be needed to
  confirm the exact module/file.
- Nothing here claims a component is production-deployed. Deployment is
  `TARGET` throughout — the current environment is local/sandboxed SQLite
  only.

## To close the verification gap

Upload the actual backend repository (`xr-system.zip` or equivalent) in a
future turn and ask for a **C4 code-level verification pass** — at that
point every `PENDING_VERIFICATION` entry below can be confirmed or
corrected against real file paths, and this note can be removed.

## Files in this package

| File | Purpose |
|---|---|
| `C1_SYSTEM_CONTEXT.md` / `.mmd` | Who uses XR, what external systems it talks to |
| `C2_CONTAINER_DIAGRAM.md` / `.mmd` | Deployable applications/data stores, current vs target |
| `C3_BACKEND_COMPONENTS.md` / `.mmd` | Backend domain components, implemented vs target |
| `C3_FRONTEND_COMPONENTS.md` / `.mmd` | Web prototype status and target frontend shape |
| `C3_MOBILE_COMPONENTS.md` / `.mmd` | Mobile prototype + API client status and target app shape |
| `C4_CODE_VIEW.md` | Critical service-to-service relationships |
| `DEPLOYMENT_RELATIONSHIP.md` | How the logical architecture maps to dev/staging/production |
| `TARGET_DOMAIN_ARCHITECTURE.md` | Future domain decomposition (explicitly labelled target) |
| `C4_ARCHITECTURE_REVIEW.md` | Final gate: PASS/PARTIAL/FAIL/N/A per C4 level, with gaps |

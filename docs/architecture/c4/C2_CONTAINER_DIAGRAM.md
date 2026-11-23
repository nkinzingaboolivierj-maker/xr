# C2 — Container Diagram

**Status:** PARTIAL — one real, tested backend container exists; every client
container is either a disconnected UX prototype or a tested-but-partial API
client. No production database, queue, storage, or worker exists yet.

## Current Containers (implemented today)

| Container | Type | Description | Status |
|---|---|---|---|
| **XR API Application** | Backend runtime | Node.js (v22+) modular monolith. Built-in modules only: `node:sqlite`, `node:crypto`, `node:http`. No external dependencies, no network access in current sandbox. | IMPLEMENTED — Stage 1 (auth, RBAC, business isolation, products/pricing, audit) + Stage 2 (suppliers, procurement, ledger inventory, FIFO, stock aging). 52/52 integration checks passing. |
| **SQLite Database** | Data store | Real transactional SQLite with foreign keys, unique constraints, rollback. Development-grade, not production-grade. | IMPLEMENTED (dev only) |
| **Mobile API Client (foundation)** | Client library | Framework-agnostic client wrapping every endpoint that currently exists (auth, products, suppliers, purchases, inventory, categories, users, audit). | IMPLEMENTED — 11/11 integration tests against the live backend |
| **Desktop Web Prototype** (`xr-pos-demo.html`) | Static UI reference | Single-file HTML/JS, in-memory state only. Sidebar/top-bar nav, all 11 tabs functional in isolation. | UX REFERENCE ONLY — **not connected to the API Application** |
| **Mobile Prototype** (`xr-mobile-demo.html`) | Static UI reference | Phone-frame HTML/JS, in-memory state only, same catalog/logic as desktop prototype for consistency. | UX REFERENCE ONLY — **not connected to the API Application** |

## Target Containers (specified, not yet built)

| Container | Type | Purpose |
|---|---|---|
| **Production Web Application** | Frontend | Real frontend wired to the API Application — replaces the static prototype's in-memory logic with live calls |
| **Production Mobile Application** | Mobile client | Expo/React Native app built on the existing Mobile API Client — full POS, scanning, offline queue, device management |
| **PostgreSQL Database** | Data store | Production relational database, replacing SQLite once ready for staging/production |
| **Background Worker** | Async processing | Handles WhatsApp delivery, document generation, notification retries |
| **Job Queue** | Messaging | Decouples the API from slow/unreliable async work (WhatsApp, webhooks) |
| **Object Storage** | Storage | Receipts, invoices, exports, backups |
| **Notification Worker** | Async processing | WhatsApp / email delivery with retry and FAILED-state tracking |

## Important distinction

A **UI screen is not a container.** The Dashboard, POS, Products, Inventory
etc. tabs inside `xr-pos-demo.html` are views within one static-HTML
container — they are documented as components in C3, not as separate C2
containers.

## Honest architecture statement

The current backend is a **modular monolith**, not a set of deployed
microservices. Section 44 of the master specification permits this as the
current state provided it is documented honestly — it is. The target domain
decomposition is shown separately in `TARGET_DOMAIN_ARCHITECTURE.md` and
must not be read as already deployed.

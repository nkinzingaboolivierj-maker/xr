# C3 — Mobile Components

**Status:** PARTIAL — one real component (the API client) is implemented and
tested; the UI prototype is a disconnected reference; the full mobile
application is entirely TARGET.

## Container in view

**Mobile API Client** (implemented) + **Mobile Prototype** (UX reference) →
target: **Production Mobile Application**

## Current state

There are two *separate, unconnected* mobile artifacts today:

| Artifact | What it is | Status |
|---|---|---|
| `mobile/api-client/` | Framework-agnostic client wrapping every endpoint that currently exists: auth, products, suppliers, purchases, inventory, categories, users, audit | IMPLEMENTED — 11/11 integration tests against the live backend |
| `xr-mobile-demo.html` | Phone-frame HTML/JS UX prototype: Login → Business select → Home → Scan (simulated) → Product detail → Cart/Checkout → Receipt, plus a More menu | UX REFERENCE ONLY — in-memory state, not wired to the API client or backend |

These two have **not been merged**. The API client is real but has no UI on
top of it; the UI prototype is polished but has no real data underneath it.

## Confirmed blockers for the target mobile app

1. **No mobile framework/build environment available in this sandbox** — no
   npm registry access, no Expo/React Native/Android SDK cached. Real
   scaffolding, building, and emulator testing cannot happen here.
2. **Backend gaps** — the following have no tables or endpoints yet, so
   mobile cannot call them even once a real app is scaffolded:
   sales/POS, payments, customers, returns, refunds, expenses,
   notifications, device/session management.
3. **No idempotency layer yet** — no mutating endpoint currently accepts an
   `operation_id`, which the mobile offline/retry design requires.

## Target component shape

| Layer | Responsibility |
|---|---|
| Mobile UI | Screens per the approved UX prototype (Home, Scan, Sales, Inventory, More) |
| Feature Modules | POS, Inventory, Customers, Expenses, Analytics, Documents, Notifications, Settings, Devices |
| API Client | **Reuse the existing tested `mobile/api-client/`**, extended as new backend endpoints ship |
| Secure Storage | Session tokens, minimal cached data — never the source of truth |
| Sync/Offline Layer | Queued operations keyed by `operation_id`, explicit ONLINE/OFFLINE/SYNCING/CONFLICT states |
| Backend API | The real XR API Application (extended with sales/payments/etc.) |

## Non-negotiable target rule

Mobile is a client, not a second source of truth. No pricing, inventory,
or finance logic may be duplicated inside the mobile app — every rule stays
server-side, exactly as for the web frontend.

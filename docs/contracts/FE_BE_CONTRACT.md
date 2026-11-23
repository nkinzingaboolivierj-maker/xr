# FE ↔ BE Contract

**Status (Stage 12):** IMPLEMENTED for the bundled web app (`public/`), which
is the only first-party client and was verified end-to-end in a real browser
(`e2e/e2e.js`). Sections that describe mobile/offline behaviour remain TARGET and
are marked as such. The machine-readable route contract is
`docs/contracts/openapi.json`, generated from the live router and checked for
drift by `tests/stage12.test.js`.

## 1. Response envelope

Every response follows a consistent shape:

```json
{ "success": true, "data": { }, "meta": { } }
```

`meta` carries pagination (`page`, `pageSize`, `total`) when present.
Errors use RFC 9457 Problem Details instead of this envelope — see
`API_ERROR_MODEL.md`.

## 2. Authentication

- **Bearer token** (`Authorization: Bearer <token>`), issued by `POST /auth/login`.
  (Earlier drafts said a cookie; a header was chosen so web and mobile behave
  identically and there is no ambient-credential CSRF surface.) The web app keeps
  the token in `sessionStorage`. The server stores only its SHA-256 digest.
- Sessions end at an absolute lifetime (`SESSION_TTL_HOURS`, 24) or after
  inactivity (`SESSION_IDLE_MINUTES`, 60). A 401 returns the web app to sign-in.
- `GET /me` returns the user, business profile and permission list; the UI uses
  it only to decide which controls to show — the server re-authorises everything.
- Every request implicitly carries `businessId` from the session — a
  client-supplied `businessId` in a request body or query string is
  **never trusted** and is ignored/rejected if it conflicts with the
  session's actual business.

## 3. Server-authoritative fields

The client must never treat the following as something it can compute or
override — it must always take the server's returned value as final:

| Field | Why |
|---|---|
| `price` at sale time | FR-PRICE-001 — server revalidates Min/Max |
| `stock` / availability | FR-POS-002 — server revalidates at submission |
| `total`, `change` | FR-PAY-002 — server computes, client never trusted |
| `permissions` / visible actions | RBAC is enforced server-side regardless of UI state |
| `businessId` scope | FR-BUS-001 |

## 4. Pagination & filtering

- `page` (default 1), `pageSize` (default 50, max 200).
- List endpoints accept relevant filters (e.g. `productId`, date ranges)
  as query parameters — see `openapi.json` per endpoint.

## 5. Idempotency

Every mutating endpoint that has a financial or inventory effect (purchase
receiving, sale submission, payment, refund) requires an `operationId` in
the request body. A retried request with the same `operationId` must
return the original result, not create a second effect. This is
**IMPLEMENTED** for purchase receiving (Stage 2) and **TARGET** for
sales/payments/refunds.

## 6. Error model

See `API_ERROR_MODEL.md`. In short: RFC 9457 `application/problem+json`,
never a raw stack trace, never a SQL error string.

## 7. Loading / empty / error states

Every list or detail view the frontend renders must define, at minimum:

| State | Rule |
|---|---|
| Loading | Skeleton, not a blank screen |
| Empty | A specific message (e.g. "No sales yet"), not a blank table |
| Error | A retry-capable message, never a raw error dump |
| Permission denied | A clear message, distinct from "not found" |
| Conflict (409) | Explain what conflicted (e.g. "Already received") |

## 8. Caching & invalidation

No client-side cache may be treated as authoritative for price, stock, or
finance figures. A cache may be used for perceived speed (e.g. showing the
last-known product list while refetching), but any action that depends on
current truth (adding to cart, submitting a sale) must hit the server
fresh or accept the server's authoritative correction at submission.

## 9. Optimistic updates

Optimistic UI updates are allowed only for low-stakes, easily-reversible
actions (e.g. expanding a row). They are **not allowed** for stock, price,
or financial state — those wait for the server's confirmed response.

## 10. File/document handling

Receipts/invoices/reports are generated server-side. The frontend/mobile
client requests a document by ID and renders/downloads what the server
returns — it never assembles a financial document from local state.

## 11. Offline/sync behavior (mobile — TARGET)

States: `ONLINE → OFFLINE → QUEUED → SYNCING → SYNCED` or `FAILED` /
`CONFLICT`. Only explicitly whitelisted operations may queue offline (see
`docs/c4/C3_MOBILE_COMPONENTS.md`). A conflict is never silently
overwritten — the server's state wins, and the client surfaces the
conflict to the user.

## 12. Versioning

All endpoints are under `/api/v1`. A breaking change requires a new
version prefix, not an in-place change to `/v1` behavior once any client
depends on it.

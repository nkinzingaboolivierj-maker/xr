# API Error Model

**Status:** TARGET — Stage 1/Stage 2 endpoints have not been confirmed to
already emit this exact shape (no source code inspected in this session).
This document defines the contract every endpoint must converge to.

## Format: RFC 9457 Problem Details

Every error response uses `Content-Type: application/problem+json`:

```json
{
  "type": "https://xr.app/errors/price-below-minimum",
  "title": "Price below minimum",
  "status": 422,
  "detail": "Recommended price 4000 is below the minimum price 4500 for product PRD-000001.",
  "instance": "/api/v1/products/PRD-000001/price",
  "code": "PRICE_BELOW_MINIMUM"
}
```

| Field | Meaning |
|---|---|
| `type` | A stable URI identifying the error class (does not need to resolve to a live page) |
| `title` | Short, human-readable summary, constant per `type` |
| `status` | HTTP status code, matching the response |
| `detail` | Specific, human-readable explanation for this occurrence |
| `instance` | The request path that produced the error |
| `code` | Application-specific machine-readable code, stable across releases |

## Rules

1. **Never expose:** stack traces, SQL statements, internal file paths,
   infrastructure details, or secrets — in `detail` or anywhere else.
2. **`code` is the contract**, not `detail`. Clients should branch on
   `code`, never on parsing `detail`'s text.
3. **One `code` per distinct business rule violation.** Do not reuse a
   generic `VALIDATION_ERROR` for everything — see the catalog below.
4. Every error `code` referenced by a Functional Requirement must appear
   in this catalog before that FR is considered implemented.

## Error code catalog

> Stage 12: this table is enforced by `tests/stage12.test.js` — every code in
> `src/lib/errors.js` must appear here, and every code here must either exist in
> code or be marked *(not emitted)*. Problem responses also carry a `requestId`
> extension member (RFC 9457 allows extensions) that matches the `X-Request-Id`
> response header and the server log line.

| Code | HTTP Status | Meaning | Related FR |
|---|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Login failed (generic, no field hint) | FR-AUTH-001 |
| `SESSION_EXPIRED` | 401 | Session no longer valid | FR-AUTH-002 |
| `PERMISSION_DENIED` | 403 | Role lacks permission for this action | FR-SEC-001 |
| `CROSS_BUSINESS_ACCESS` | 403 | Resource belongs to a different business | FR-BUS-001 |
| `DUPLICATE_SKU` | 409 | SKU already exists in this business | FR-PROD-001 |
| `PRICE_BELOW_MINIMUM` | 422 | Sale/save price under the minimum band | FR-PRICE-001 |
| `PRICE_ABOVE_MAXIMUM` | 422 | Sale/save price over the maximum band | FR-PRICE-001 |
| `PURCHASE_ALREADY_RECEIVED` | 409 | Duplicate receiving attempt | FR-REC-001 |
| `NEGATIVE_STOCK_BLOCKED` | 422 | Adjustment would take stock below zero | FR-INV-003 |
| `INSUFFICIENT_STOCK` | 409 | Sale requested more than available at submission | FR-POS-002 |
| `DUPLICATE_OPERATION` | 409 | `operationId` already processed — idempotent replay | FR-POS-001, FR-REC-001 |
| `RETURN_EXCEEDS_SOLD` | 422 | Return quantity exceeds sold-minus-returned | FR-RET-001 |
| `REFUND_EXCEEDS_REFUNDABLE` | 422 | Refund exceeds remaining refundable amount | FR-REF-001 |
| `GPC_IMPORT_BLOCKED` | 503 | *(not emitted)* GPC taxonomy not yet loaded — today the API returns `active: false` from `/gpc/search` instead | FR-CLS-001 |
| `GPC_CLASSIFICATION_REVIEW_REQUIRED` | 200 (flag, not error) | *(not emitted)* Product could not be confidently classified — never guessed | FR-CLS-001 |
| `UNAUTHENTICATED` | 401 | Missing, malformed or unknown bearer token | FR-AUTH-001 |
| `NOT_FOUND` | 404 | Unknown route or resource | — |
| `VALIDATION_ERROR` | 400 | Malformed or invalid input (bad JSON, bad paging, malformed percent-encoding, non-finite numbers, weak password…) | all |
| `INVALID_PRICE_BAND` | 422 | MIN ≤ RECOMMENDED ≤ MAX violated when saving a price | FR-PRICE-002 |
| `CASH_RECEIVED_INSUFFICIENT` | 422 | Cash tendered is less than the amount due | FR-POS-001 |
| `RATE_LIMITED` | 429 | Too many login attempts (per email or per IP) | FR-SEC-001 |
| `INVALID_WEBHOOK_SIGNATURE` | 401 | Webhook HMAC did not verify; nothing was processed | FR-PAY-001 |
| `PAYLOAD_TOO_LARGE` | 413 | Request body above `MAX_BODY_BYTES` (1 MiB default; 20 MiB for an authenticated `/gpc/import`) | NFR-SEC-001 |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Temporary/reset password must be changed first; only change-password, logout and `/me` are allowed | FR-AUTH-002 |
| `BUSINESS_SELECTION_REQUIRED` | 409 | The same credentials exist in more than one business; response includes `businesses: [{id,name}]`; retry with `businessId` | FR-AUTH-001 |
| `PAYMENT_NOT_VERIFIED` | 422 | A provider-verified payment is required (or the supplied intent is not SUCCESS) | FR-PAY-001 |
| `PAYMENT_AMOUNT_MISMATCH` | 422 | Payment amount, currency or method does not match the sale | FR-PAY-001 |
| `PROVIDER_NOT_CONFIGURED` | 503 | No real payment/WhatsApp provider is connected (`BLOCKED_PENDING_PROVIDER`), or mock providers are disabled in production | FR-PAY-001, FR-NOT-001 |
| `INTERNAL_ERROR` | 500 | Unexpected server fault. Detail is generic; quote `requestId` | NFR-OBS-001 |

This catalog grows as each TARGET domain is built — never invent a new
code inline without adding it here.

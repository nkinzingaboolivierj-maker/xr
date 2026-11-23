# OWASP ASVS 5.0.0 — Security Traceability Matrix

**Source:** `OWASP_Application_Security_Verification_Standard_5_0_0_en.pdf`
(verified genuine — May 2025, 120 pages, full 17-chapter structure).

> **Provenance caveat (Stage 12).** The ASVS PDF itself was **not** among the
> files supplied for the Stage 12 audit, so requirement IDs for rows carried
> over from earlier stages are *not re-verified against the PDF in this
> session*. Rows added in Stage 12 for chapters other than V6/V7/V8 are keyed
> by **chapter and control name only** (no requirement number), precisely so
> no number is invented. This is a self-assessment against the standard, not
> a certification.

**Rule followed:** no requirement below is marked IMPLEMENTED without a
cited test. Requirements the current scope doesn't reach are marked
N/A_YET with the reason, not silently skipped.

Chapters covered in detail: V6 (Authentication), V7 (Session Management),
V8 (Authorization). Stage 12 adds a chapter-level table (below) for the
bundled web app, transport headers, logging and configuration. Chapters V5
(File Handling), V10 (OAuth/OIDC) and V17 (WebRTC) do not apply: no file
upload, OAuth/OIDC flow or WebRTC exists.

## V6 — Authentication

| Req ID | Requirement (paraphrased) | Level | Status | Evidence |
|---|---|---|---|---|
| 6.2.1 | Minimum password length of 8 chars (15+ recommended) | 1 | **FIXED THIS SESSION** | `auth.service.js` now rejects < 8 chars; `tests/stage7.test.js` |
| 6.2.2 | Users can change their password | 1 | **FIXED THIS SESSION** | New `POST /auth/change-password`; `tests/stage7.test.js` |
| 6.2.3 | Password change requires current + new password | 1 | **FIXED THIS SESSION** | Same endpoint verifies current hash first; `tests/stage7.test.js` |
| 6.2.5 | No composition rules restricting character types | 1 | IMPLEMENTED | No character-class checks exist anywhere in `auth.service.js` (true by omission) |
| 6.2.6 | Password fields masked (`type=password`) | 1 | IMPLEMENTED | Login, change-password and forced-change forms use `type=password` (`public/js/app.js`, `pages/account.js`); E2E steps 1, 20 |
| 6.2.8 | Password verified exactly as received, no truncation/case changes | 1 | IMPLEMENTED | `crypto.js` passes the raw string straight to `scryptSync`; no substring/`.toLowerCase()` anywhere |
| 6.2.9 | Passwords of 64+ chars permitted | 2 | IMPLEMENTED | No max-length check exists; `scrypt` has no practical input cap |
| 6.2.12 | Passwords hashed with an approved algorithm | 2 | IMPLEMENTED | `scrypt` via Node's `node:crypto`, 16-byte random salt, 64-byte key (`crypto.js`); `tests/stage1.test.js` |
| 6.3.1 | Brute-force / credential-stuffing controls | 1 | IMPLEMENTED | 5 attempts / 15 min per email **plus** 60 / 15 min per client IP, 429 RATE_LIMITED (`rateLimiter.js`, expired windows purged); `tests/stage6.test.js`, `tests/stage12.test.js`. Limitation: in-memory, single instance |
| 6.3.2 | No default/enabled accounts (root/admin/sa) | 1 | IMPLEMENTED | Fresh DB has zero users (`tests/stage12` bootstrap test); the first Owner is created only by `scripts/bootstrap.js` with a caller-supplied password |
| (V6 auth) | Generic failure message; no user enumeration by timing | 1 | **FIXED (Stage 12)** | Unknown email verifies a dummy scrypt hash so both failures cost the same and return the same message (`auth.service.js`, `crypto.js DUMMY_HASH`) — timing equality is by construction, not measured |

## V7 — Session Management

| Req ID | Requirement (paraphrased) | Level | Status | Evidence |
|---|---|---|---|---|
| 7.2.1 | Session verification happens via a trusted backend service | 1 | IMPLEMENTED | `resolveSession` always re-queries the `sessions` table server-side; no client-trusted claim |
| (V7 storage) | Session tokens not stored in recoverable form | 1 | **FIXED (Stage 12)** | Only SHA-256(token) is stored; raw tokens were previously the DB primary key (`tests/stage12`: "session tokens are stored only as SHA-256 digests"); legacy sessions revoked by migration 004 |
| 7.2.2 | Dynamically generated tokens, not static secrets | 1 | IMPLEMENTED | `randomToken()` via `crypto.randomBytes` per login |
| 7.2.3 | CSPRNG tokens with ≥128 bits entropy | 1 | IMPLEMENTED | `randomBytes(24)` = 192 bits (exceeds 128); `crypto.js` |
| 7.2.4 | New session token issued on (re-)authentication | 1 | IMPLEMENTED | Every `login()` call inserts a fresh session row; `tests/stage1.test.js` |
| 7.3.1 / 7.3.2 | Inactivity timeout AND absolute max lifetime, per documented risk decision | 2 | **FIXED (Stage 12)** | Absolute lifetime `SESSION_TTL_HOURS` (default 24) **and** idle timeout `SESSION_IDLE_MINUTES` (default 60) enforced in `resolveSession`; `tests/stage12.test.js` (idle rejected, configurable) |
| 7.4.1 | Session termination (logout/expiry) fully invalidates further use | 1 | IMPLEMENTED | `revokeSession` sets `revoked_at`; `resolveSession` rejects revoked/expired sessions; `tests/stage1.test.js` |
| 7.4.2 | All sessions terminated when an account is disabled/deleted | 1 | **FIXED (Stage 12)** | `PATCH /users/:id` (inactive / role change) and `reset-password` revoke every session of that user; `tests/stage12.test.js` |
| 7.4.3 | Option to terminate all other sessions after a credential change | 2 | **FIXED THIS SESSION** | Password change now offers `revokeOtherSessions: true`; `tests/stage7.test.js` |
| 7.4.4 | Logout easily accessible from every authenticated page | 2 | IMPLEMENTED | "Sign out" in the persistent sidebar (`public/js/app.js`); E2E steps 20, 23 |

## V8 — Authorization

| Req ID | Requirement (paraphrased) | Level | Status | Evidence |
|---|---|---|---|---|
| 8.2.1 | Function-level access restricted to explicit permissions | 1 | IMPLEMENTED | `rbac.js` MATRIX + `requirePermission()` gate on every controller action; `tests/stage1-6.test.js` RBAC cases |
| 8.2.2 | Data-specific access restricted (anti-IDOR/BOLA) | 1 | IMPLEMENTED | `assertOwnedByBusiness()` called before returning/mutating every fetched resource; explicit cross-business tests in every stage's test file |

## Stage 12 additions (chapter-level; requirement numbers intentionally not asserted)

| Chapter / control | Threat | Implementation | Verification | Status |
|---|---|---|---|---|
| V8 data-specific access — user admin | Cross-tenant user takeover | `assertOwnedByBusiness` on every `/users/:id` action | `tests/stage12`: business B Owner gets 403 CROSS_BUSINESS_ACCESS on update + reset | VERIFIED |
| V8 function-level — new endpoints | Privilege escalation | `user.write`, `business.profile.write` Owner-only; `/me` permissions are UI hints only | `tests/stage12` (Manager/Cashier 403); E2E 21 (server 403 despite hidden UI) | VERIFIED |
| V6/V7 credential lifecycle | Long-lived temporary passwords | `must_change_password`: every route except change-password/logout/me returns 403 PASSWORD_CHANGE_REQUIRED | `tests/stage12`, E2E 20 | VERIFIED |
| V4 API — input validation | Crash / DoS via malformed input | Safe URI decoding (400), body cap (413), JSON-object-only bodies, bounded paging, finite-number checks | `tests/stage12` "HTTP robustness", "sale input validation" | VERIFIED |
| V4 API — error handling | Internal detail leakage; faults masquerading as 400 | `INTERNAL_ERROR` 500 with `requestId` only; `/ready` returns no driver text | `tests/stage12` | VERIFIED |
| V3 Web frontend — XSS | Injected markup from stored data | UI built only with `createElement`/`textContent`; no `innerHTML` anywhere in `public/js` | Source audit (a code search finds no use of `innerHTML`, `insertAdjacentHTML`, `document.write` or `eval` in `public/js`) + E2E 18 (a stored `<img onerror>`/`<script>` product name renders as inert text and does not execute) | VERIFIED (for the tested payload class) |
| V3 Web frontend — CSP & headers | Clickjacking, MIME sniffing, injected scripts | `Content-Security-Policy` (`default-src 'self'`, no inline/eval, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options`, `Referrer-Policy`, COOP/CORP, optional HSTS | `tests/stage12` (headers, CSP content); E2E 27 (no CSP violations) | VERIFIED (headers) |
| V3/V13 CORS | Cross-origin API use | Default: no CORS headers. Allow-list only via `CORS_ORIGINS`; preflight refused otherwise | `tests/stage12` "CORS allow-list" | VERIFIED |
| V13 Configuration — secrets | Hard-coded / published secrets | No secret defaults. The mock-webhook constant is refused in production; `PAYMENT_WEBHOOK_SECRET` (>= 32 chars) required | `tests/stage12` payment suite | VERIFIED |
| Webhook integrity | Forged payment success; replay; out-of-order flip | HMAC-SHA256 over raw body verified before any logic; replay no-op; terminal-state machine; amount/currency/method match on attach | `tests/stage11`, `tests/stage12` | VERIFIED against the MOCK adapter only — no real provider exists yet |
| V16 Logging & audit integrity | Tampering with history | DB triggers make `audit_logs` and `inventory_movements` append-only; login success/failure audited; secrets redacted in logs | `tests/stage12` "append-only", `tests/stage11` redaction | VERIFIED |
| V14 Data protection | Backup exposure | Backups written mode 0600; integrity-checked; never include secrets (none stored) | `tests/stage12` ops suite | VERIFIED (file mode); encryption at rest is the host's responsibility |
| V12 Transport | Cleartext traffic | TLS is terminated by the reverse proxy (Caddy config provided); `HSTS=true` once HTTPS-only | Not executed here (no proxy/domain) | BLOCKED on a domain + host |
| Dependency vulnerabilities | Vulnerable packages | Zero npm dependencies; runtime is Node 22 LTS | `package.json` | N/A (re-check Node security releases) |
| Rate limiting (distributed) | Brute force across instances | In-memory limiter | — | KNOWN LIMITATION: single instance only |

## Honest summary (Stage 12)

* V6/V7/V8 rows: see statuses above; every IMPLEMENTED / FIXED row cites a test or E2E step.
* **Not claimed:** ASVS Level 1/2 certification, complete coverage of any chapter, or absence of vulnerabilities.
* **Not yet done:** broader XSS fuzzing of every field; penetration test; TLS verification on a real host; ASVS PDF re-verification of carried-over requirement numbers.

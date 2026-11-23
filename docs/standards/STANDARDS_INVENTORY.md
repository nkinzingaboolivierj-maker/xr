# Standards inventory

> ## Stage 12 audit note (read first)
> The Stage 12 audit was given the project ZIPs, the traceability workbook and prototypes, but
> **none of the official standards files** (GS1 GPC dataset, GS1 General Specifications, OWASP ASVS PDF,
> UN/CEFACT Recommendations 16/20/21, ISO 4217/3166/8601 extracts, WCAG, OpenAPI/RFC texts) were present.
> Consequently, **in this session no standard could be re-read or re-verified**; the per-file title/version/date
> records below are **carried forward from earlier sessions** and are *unverified here*. Implementation status
> against each standard is recorded in the `STANDARDS_AND_ENUMS` sheet of the traceability workbook and in
> `security/OWASP_ASVS_MAPPING.md`. Nothing here is a compliance or certification claim.
>
> | Standard | Applicability | Stage 12 status |
> |---|---|---|
> | GS1 GPC | Mandatory for product classification (project decision) | **BLOCKED** — dataset not supplied; importer tested on synthetic rows |
> | GS1 General Specifications (GTIN) | Conditional (barcodes) | Partial — stored/looked up; check-digit validation not implemented |
> | UN/CEFACT Rec. 20 / 21 / 16 | Conditional (units, packaging, locations) | Not implemented — units are free text |
> | ISO 4217 / 3166 / 8601 | Recommended | Implemented (shape-validated per-business currency/country; UTC ISO timestamps; IANA timezone) |
> | OWASP ASVS | Verification baseline | Self-assessment only (see mapping) |
> | OpenAPI 3.1 | Contract | Generated from the live router + drift test |
> | RFC 9457 | Error format | Implemented (`application/problem+json` + `code` + `requestId`) |
> | WCAG | Applies to the web UI | Partial, manual measures only; no automated audit |
> | OAuth/OIDC (RFC 9700) | Only if used | **Not applicable** — opaque bearer sessions, no OAuth/OIDC |
> | PCI DSS | Only if card data touched | XR never receives card data; no PCI claim |

# Standards Inventory (Updated)

Every entry below was opened and verified in this session — PDF metadata
and/or extracted text, not assumed from filenames.

| # | Standard | Verified Identity | Issuer | Version | Local File | Status |
|---|---|---|---|---|---|---|
| 1 | **OWASP ASVS** | **CONFIRMED REAL** — "Application Security Verification Standard", full 17-chapter structure (V1 Encoding/Sanitization … V17 WebRTC), numbered requirements with Level column | OWASP | **5.0.0, May 2025** | `OWASP_Application_Security_Verification_Standard_5_0_0_en.pdf` | **APPLICABLE** — previous upload was a mismatch (generic risk workbook); this one is genuine |
| 2 | GS1 General Specifications | Confirmed: "GS1 General Specifications Standard" — identification keys, data attributes, barcodes | GS1 | **Release 26.0, Ratified, Jan 2026** | `download.pdf` (579 pages) | APPLICABLE — reference for GTIN/barcode rules |
| 3 | GS1 GPC Release Notes | Confirmed: "GPC May 2026 Publication Release Notes" — lists changes vs. Nov 2025 publication (bricks/attributes added/updated/removed) | GS1 | **May 2026 publication** | `Release_notes_May_2026__Publication__1_.pdf` | REFERENCE_ONLY — this is a changelog, **not the taxonomy dataset itself**. GPC import remains `GPC_IMPORT_BLOCKED` until the actual Segment/Family/Class/Brick data file is supplied |
| 4 | OpenID Connect Core 1.0 | Confirmed: "Final: OpenID Connect Core 1.0 incorporating errata set 2" | OpenID Foundation | 1.0 + errata set 2 | `dhtfnxg.pdf` | REFERENCE_ONLY — not applicable yet (no OIDC/SSO in the current auth design); kept on file for if/when an identity provider is added |
| 5 | RFC 9457 (Problem Details for HTTP APIs) | Confirmed via PDF metadata + content match to the JSON Schema and Appendix B already reviewed | IETF | RFC 9457 | `rwseg.pdf` | APPLICABLE — already implemented (`src/lib/errors.js`) |
| 6 | OpenAPI Specification | Confirmed: official `OpenAPI-Specification-3.2.1` repo (duplicate of a prior upload) | OpenAPI Initiative | 3.2.1 | `OpenAPI-Specification-3_2_1__1_.zip` | APPLICABLE — unchanged from prior inventory |
| 7 | UNECE Recommendation 16 (UN/LOCODE) | Confirmed: "Codes for Ports and Other Locations", 3rd edition | UNECE | 3rd ed., 1998 | `rec16.zip` | REFERENCE_ONLY — standardized location codes; not yet used (we currently store free-text addresses). Could inform a future `location_code` field on suppliers/customers |
| 8 | UNECE Recommendation 21 | Confirmed: "Codes for Passengers, Types of Cargo, Packages and Packaging Materials", Rev 8 (2010) present (plus full revision history back to 1994) | UNECE | Rev 8, 2010 (latest in archive) | `rec21.zip` | REFERENCE_ONLY — packaging-type codes; not yet modeled (products have a `unit` field but no packaging-type code). Candidate for a future enhancement, not blocking current scope |
| 9 | UNECE Recommendation 20 | Unchanged — confirmed genuine, Revision 17 (2021) | UNECE | Rev 17, 2021 | `rec20_0__1_.zip`, `rec20_Rev17e-2021_0__1_.xlsx` | APPLICABLE — duplicate of prior upload |
| 10 | C4 Model reference | Unchanged from prior inventory | — | — | `visualising-software-architecture-with-the-c4-model.pdf` | REFERENCE_ONLY |

## What changed since the last inventory

- **OWASP ASVS is now real and usable.** The Security Traceability Matrix
  (`docs/security/OWASP_ASVS_MAPPING.md`) is now built from this document's
  actual requirement text, not general knowledge.
- **GS1 General Specifications is now available** (full 579-page standard) —
  useful for GTIN check-digit and barcode-format rules if/when real GTINs
  are introduced.
- **GPC is still blocked for import.** The May 2026 release notes confirm
  *which version* is current, but contain only a change summary (counts of
  bricks/attributes added/removed) — not the Segment → Family → Class →
  Brick dataset itself. Importing still requires the actual GPC data
  file (Excel/XML) from GS1's GPC Browser/download tool.
- **OpenID Connect and UNECE Rec 16/21 are filed as reference-only** — none
  of the three are used by the current implementation and none are
  blocking anything. They are not acted on further unless a future
  requirement needs them (SSO for OIDC; location/packaging codes for
  16/21).

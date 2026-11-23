# Deployment Relationship

**Status:** FAIL as a production claim — nothing below "Development" is
built. This document exists to show the *intended* mapping, clearly
separated from what is real today.

## Terminology note

A **C4 Container** (logical/architectural) is not the same thing as a
**Docker container** (deployment/runtime packaging). Where "container" is
used below without qualification, it means the C4 sense.

## Development (current, real)

| Concern | Current reality |
|---|---|
| Runtime | Node.js (v22+), built-in modules only, no external dependencies |
| Database | SQLite, file-based, transactional (FKs, unique constraints, rollback) |
| Networking | No outbound network access in this sandbox; `node:http` only |
| Frontend | Static HTML/JS prototypes, not served by or connected to the API |
| Testing | 52 integration checks (Stage 1 + Stage 2) against a real running server + real SQLite DB |
| Secrets | None in use yet — no external providers connected |

## Staging (TARGET — not built)

| Concern | Target |
|---|---|
| Database | PostgreSQL, migrated from SQLite schema |
| Hosting | Candidate platforms: Railway, Render, or Fly.io (per stated long-term plan) — no platform selected/provisioned yet |
| Frontend | Production Web Application build, served over HTTPS |
| Mobile | Internal test build of the Expo/React Native app |
| Monitoring | Health/readiness/liveness endpoints, structured logs |
| Secrets | Environment-separated, `.env.example` committed, real secrets never committed |

## Production (TARGET — not built)

| Concern | Target |
|---|---|
| Database | PostgreSQL, with backup schedule, encryption, tested restore |
| API | HTTPS-only, behind the chosen hosting platform's load balancing |
| Object Storage | Receipts, invoices, exports, backups |
| Queue / Worker | Background delivery for WhatsApp/notifications, with FAILED-state retry |
| Observability | API/DB error monitoring, slow-query tracking, payment/WhatsApp/backup failure alerts |
| Release gate | No P0/P1 blocker (financial discrepancy, duplicate payment, cross-business leak, broken rollback, etc.) may be open at release |

## What must NOT be claimed yet

- "Deployed to production" — false today; there is no production
  environment.
- "Microservices in production" — false; the current and near-term
  architecture is a single API Application (modular monolith).
- "PostgreSQL in use" — false; SQLite is the only database that exists
  today, and it is development-only.

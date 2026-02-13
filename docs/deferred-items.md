# AQUORIX Scheduler App v1 — Deferred Items

## Public Endpoint Rate Limiting (Deferred to M8)

**Requirement (brief):** 100 req/hr/IP on public endpoints  
**Status:** DEFERRED TO M8  
**Authority:** Larry McLean (Founder)  
**Date:** 2026-02-13  
**Rationale:** Correctness + parity (M3) is critical path. Hardening is M8.

**Implementation plan (M8):**
1) Add middleware (express-rate-limit or equivalent)
2) Apply to `/api/v1/public/*`
3) Configure 100 req/hr/IP
4) Prove 429 via curl loop test
5) Document behavior + headers

**Monitoring trigger:**
If public widget requests exceed 50/hour/IP in staging/prod logs → revisit before M8.

## Legacy Jest Endpoint Tests (DB Harness Required)

**Status:** DEFERRED (test harness required)  
**Authority:** Larry McLean (Founder)  
**Date:** 2026-02-13  
**Rationale:** Current tests hit DB directly and are failing due to SSL/env mismatch. We will implement a dedicated test DB + seed scripts, then re-enable tests.

**Plan (post-M3):**
1) Define TEST_DATABASE_URL (separate from dev/prod)
2) Add seed SQL for users/sensors/alerts tables
3) Enforce explicit SSL policy per environment
4) Re-enable endpoint tests and prove clean pass


# AQUORIX Scheduler App v1 — PHASE 4 EXECUTION PLAN (VIKING M4)
Product: AQUORIX Scheduler App v1
Doc: PHASE_4_EXECUTION_PLAN.md
Path: /Users/larrymclean/CascadeProjects/aquorix-backend/docs/PHASE_4_EXECUTION_PLAN.md

Owner: Larry McLean
Lead (Author + Execution Lead): ChatGPT (Lead Architect)
Advisors (Review Only): Windsurf, Claude, Grok

Date: 2026-02-13
Status: READY FOR EXECUTION

---

## Phase 4 Goal
Ship M4: Operator scheduling page (mobile-first) + scoped session management (create/edit/cancel)
without breaking public widget contract.

---

## Step 0 — Repo sanity (5 minutes)
Terminal:
cd /Users/larrymclean/CascadeProjects/aquorix-backend
git status
npm test

Stop-line:
- scheduler-transform-parity test passes

---

## Step 1 — Add cancellation field to DB (cancelled_at)
Because aquorix.dive_sessions has no session_status/cancel fields, we add cancelled_at.

### 1A) Create migration file (local, for IP + audit trail)
Create:
db/migrations/2026-02-13_add_cancelled_at_to_dive_sessions.sql

SQL:
ALTER TABLE aquorix.dive_sessions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

-- Optional (ONLY AFTER we confirm users PK type and how auth maps):
-- ALTER TABLE aquorix.dive_sessions
--   ADD COLUMN IF NOT EXISTS cancelled_by_user_id bigint NULL;

CREATE INDEX IF NOT EXISTS idx_dive_sessions_operator_week_active
  ON aquorix.dive_sessions (operator_id, dive_datetime)
  WHERE cancelled_at IS NULL;

### 1B) Apply migration
Option A (psql):
psql "$DATABASE_URL" -f db/migrations/2026-02-13_add_cancelled_at_to_dive_sessions.sql

Option B (Supabase SQL Editor):
Paste the SQL from the migration file and run it.

### 1C) Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='aquorix'
  AND table_name='dive_sessions'
  AND column_name IN ('cancelled_at');

Stop-line:
- cancelled_at exists

---

## Step 2 — Update public scheduler query to exclude cancelled sessions
Wherever the DB query is that feeds the public schedule widget:
Add:
AND ds.cancelled_at IS NULL

Stop-line:
- Parity test still passes:
npm test __tests__/scheduler-transform-parity.test.js

Note:
The oracle fixture should not need changes because filtering cancelled rows should not affect it (fixture has no cancelled rows).

---

## Step 3 — Define operator scope derivation (server-side)
We must NOT guess. We will request and capture table definitions first.

Required table definitions (Larry provides via psql):
\d aquorix.user_operator_affiliations
\d aquorix.users
\d aquorix.diveoperators

Then implement Rule A:
- Authenticated user → resolve exactly one operator_id on server
- Store req.operator_id for all dashboard routes

Stop-line:
- Middleware produces operator_id for authenticated requests
- Middleware rejects user with 0 or >1 operators (Phase 4 assumption)

---

## Step 4 — Implement dashboard endpoints (parameterized SQL only)
Routes (Master-Brief aligned):
- GET  /api/v1/dashboard/schedule?view=week&week_start=YYYY-MM-DD
- POST /api/v1/dashboard/schedule/sessions
- PATCH /api/v1/dashboard/schedule/sessions/:session_id
- POST /api/v1/dashboard/schedule/sessions/:session_id/cancel

Rules:
- Do not accept operator_id from request body
- Every query uses placeholders ($1, $2...)
- Every write verifies ownership via operator_id scoping
- Cancel sets cancelled_at = NOW()

Stop-lines:
- P4-S1: cross-operator mutation attempts return 404 (no existence leak)
- P4-S8: no string-concat SQL

---

## Step 5 — Tests (ship-blocking)
Create:
__tests__/dashboard-sessions-scoping.test.js
__tests__/dashboard-cancel-semantic.test.js

Minimum cases:
- Operator A cannot cancel Operator B’s session (404)
- Cancel sets cancelled_at
- Public widget excludes cancelled session
- Parity test remains passing

Stop-line:
npm test

---

## Step 6 — UI wiring (list-first, 375px)
(Frontend repo work; backend just needs stable endpoints first.)

Stop-line:
- create/edit/cancel usable at 375px
- no transform duplication (dashboard may show extra internal fields, but public output stays governed by transform + parity)

---

## Step 7 — Tagging discipline (NO premature tags)
We will NOT create any “m4-complete” tags until:
- endpoints implemented
- tests pass
- UI flow confirmed at 375px
- parity test passes

When complete:
git tag -a m4-dashboard-scheduling-complete -m "M4: scheduling UI + scoped CRUD + cancel"
git push origin m4-dashboard-scheduling-complete

# AQUORIX Scheduler App v1 — PHASE 4 SCOPE (VIKING M4)
Product: AQUORIX Scheduler App v1
Doc: PHASE_4_SCOPE.md
Path: /Users/larrymclean/CascadeProjects/aquorix-backend/docs/PHASE_4_SCOPE.md

Owner: Larry McLean
Lead (Author + Execution Lead): ChatGPT (Lead Architect)
Advisors (Review Only): Windsurf (implementation + drift checks), Claude (sequencing + docs discipline), Grok (risk spotting + verification)

Date: 2026-02-13
Status: READY → EXECUTION PLAN NEXT

---

## 0) Current Truth (Schema Reality)
Table: aquorix.dive_sessions
Confirmed columns include:
- session_id (bigint), operator_id (bigint), dive_datetime (timestamptz), meet_time (timestamptz), dive_site_id (bigint), notes (text), etc.
Confirmed NOT present:
- session_status, cancelled_at, is_cancelled, deleted_at

Therefore cancellation requires a minimal schema addition (cancelled_at).

---

## 1) Phase 4 Mission (M4-aligned)
Deliver the Operator Scheduling Page (mobile-first) with scoped/authenticated session management:
Create / Edit / Cancel
while protecting:
- public widget contract
- single-source transform logic (transformScheduleRows.js)
- multi-tenant operator isolation

---

## 2) IN SCOPE
### 2.1 Dashboard API (Authenticated, Master-Brief aligned paths)
Public widget remains read-only.

Routes:
- GET  /api/v1/dashboard/schedule?view=week&week_start=YYYY-MM-DD
- POST /api/v1/dashboard/schedule/sessions
- PATCH /api/v1/dashboard/schedule/sessions/:session_id
- POST /api/v1/dashboard/schedule/sessions/:session_id/cancel

### 2.2 Operator Scoping (Server-side)
- Never trust operator_id from request body/query.
- Server derives operator scope from auth context.

Phase 4 Operator Context Rule (LOCKED):
Rule A (fast + safe): User is affiliated with exactly one operator; server uses that operator_id.
(Multi-operator switching is M5.)

### 2.3 UI (List-first, Mobile enforced)
- List-first scheduling page (no calendar in Phase 4)
- Create modal/sheet
- Edit modal/sheet (time + site + notes only)
- Cancel action
- Must work at 375px

---

## 3) Decisions (LOCKED)
### D1 — Endpoint Strategy
Use Master-Brief-aligned dashboard schedule paths defined above.

### D2 — Cancel Representation (LOCKED to schema reality)
Add to aquorix.dive_sessions:
- cancelled_at timestamptz NULL
Optional (if user table key type is known):
- cancelled_by_user_id bigint NULL (or uuid)

Cancel behavior:
- cancel endpoint sets cancelled_at = now()
- public widget excludes rows where cancelled_at IS NOT NULL

We will NOT implement soft delete in Phase 4.

### D3 — Capacity Editing (LOCKED)
Phase 4 edits: time + site + notes only.
Capacity editing deferred to M6 (atomic enforcement).
Capacity may be set only at create time.

### D4 — UI Scope (LOCKED)
List-first only. No calendar view, drag-drop, bulk edit.

---

## 4) OUT OF SCOPE (Explicit Non-Goals)
- Calendar UI / drag-drop / bulk edit (PATHFINDER)
- Multi-operator context switching (M5)
- Booking loop / capacity enforcement (M6)
- Event/audit capture system (M7)
- Rate limiting / load testing (M8)

---

## 5) Stop-Lines (Ship-blocking)
P4-S1 Auth + Operator scoping enforced server-side (403/404 on cross-operator)
P4-S2 Cancel semantics: cancelled sessions never appear in public widget output
P4-S3 No duplicate transform logic; public output remains transform-governed + parity-tested
P4-S4 Mobile-safe at 375px
P4-S5 Conflict behavior documented (last-write-wins OK for v1)
P4-S6 No new deferrals without docs/deferred-items.md update
P4-S7 Public widget non-regression: scheduler parity test must PASS after changes
P4-S8 Parameterized SQL only ($1, $2...) — no string concatenation

---

## 6) Preconditions
Phase 3 closure evidence committed: docs/m3-query-plan.md ✅ DONE (commit 8dd51f2)
Before Phase 4 coding:
- add cancelled_at column (migration)
- define operator scope derivation implementation (requires table definitions)

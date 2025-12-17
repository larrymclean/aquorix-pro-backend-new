# AQUORIX Scheduler API — Milestone 1 (M1) Contract

## Contract file
- `openapi-scheduler-m1.yaml` (repo root)

## Base URLs
- Production: `https://api.aquorix.pro`
- Local dev: `http://localhost:3001`

## Authentication
All operator-scoped endpoints require **Bearer JWT** unless explicitly marked public.

Header:
- `Authorization: Bearer <JWT>`

Public endpoint (no auth):
- `POST /api/v1/public/booking-requests`

## Operator isolation (critical rule)
For all routes under:
- `/api/v1/operators/{operator_id}/...`

The server MUST enforce that the authenticated user is authorized for that `operator_id`.
No cross-operator access is allowed.

## Capacity policy (dual interpretation)
API returns confirmed vs pending headcounts plus dual availability calculations:
- `confirmed_headcount`
- `pending_headcount`
- `available_if_confirmed_only`
- `available_if_pending_reserved`
- `is_over_capacity_confirmed_only`
- `is_over_capacity_with_pending`

UI chooses which availability to emphasize.

## Public intake behavior (MVP frictionless)
`POST /api/v1/public/booking-requests`:
- Requires `operator_id`, `session_id`, and guest basics
- Server derives `itinerary_id` from the session
- Server auto-creates a guest diver if `diver_id` is not provided

## v1.0.1 hardening (non-breaking)
- Pagination: `limit`, `offset` on list endpoints
- Public intake: documented rate limit + `429` response shape

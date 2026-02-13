/*
  File: 2026-02-13_add_cancelled_at_to_dive_sessions.sql
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/
  Purpose: Phase 4 (M4) — add cancellation support to aquorix.dive_sessions
  Created: 2026-02-13
*/

ALTER TABLE aquorix.dive_sessions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

ALTER TABLE aquorix.dive_sessions
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id bigint NULL;

-- Helpful index for dashboard queries that exclude cancelled sessions
CREATE INDEX IF NOT EXISTS idx_dive_sessions_operator_datetime_not_cancelled
  ON aquorix.dive_sessions (operator_id, dive_datetime)
  WHERE cancelled_at IS NULL;

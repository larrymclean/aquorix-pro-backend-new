-- ============================================================================
-- AQUORIX Migration
-- File: 20260224_phase83_manual_review.sql
-- Path: db/migrations/20260224_phase83_manual_review.sql
-- Description: Add booking-level manual review flags for exception handling (operator clarity)
--
-- Created: 2026-02-24
-- Version: v8.3.0
--
-- Change Log (append-only):
--   - 2026-02-24 - v8.3.0:
--     - Add manual_review_required, manual_review_reason, manual_review_flagged_at
--     - Add index for dashboard queries (manual review true only)
-- ============================================================================
BEGIN;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS manual_review_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_review_reason   TEXT,
  ADD COLUMN IF NOT EXISTS manual_review_flagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dive_bookings_manual_review
  ON aquorix.dive_bookings (operator_id, manual_review_flagged_at DESC)
  WHERE manual_review_required = true;

COMMENT ON COLUMN aquorix.dive_bookings.manual_review_required IS
  'Phase 8.3: Exception safety valve. True when booking requires human review (hold expired, cert mismatch, special accommodation, etc).';

COMMENT ON COLUMN aquorix.dive_bookings.manual_review_reason IS
  'Phase 8.3: Human-readable reason code/message for manual review requirement.';

COMMENT ON COLUMN aquorix.dive_bookings.manual_review_flagged_at IS
  'Phase 8.3: Timestamp when manual review was triggered.';

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- DROP INDEX IF EXISTS aquorix.idx_dive_bookings_manual_review;
-- ALTER TABLE aquorix.dive_bookings
--   DROP COLUMN IF EXISTS manual_review_required,
--   DROP COLUMN IF EXISTS manual_review_reason,
--   DROP COLUMN IF EXISTS manual_review_flagged_at;
-- COMMIT;

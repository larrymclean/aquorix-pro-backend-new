-- ============================================================================
-- AQUORIX Migration
-- File: 20260223_phase83_session_currency_not_null.sql
-- Path: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/20260223_phase83_session_currency_not_null.sql
--
-- Description:
--   Phase 8.3 Guardrail: enforce dive_sessions.session_currency is ALWAYS set.
--   - Backfill any NULL/blank currencies from operator default_currency
--   - Enforce NOT NULL
--   - Enforce 3-letter uppercase ISO-style format
--
-- Author: AQUORIX Team
-- Created: 2026-02-23
-- Version: 1.0.0
--
-- Change Log:
--   - 2026-02-23 - v1.0.0 (AQUORIX Team):
--     - Backfill NULL/blank session_currency from diveoperators.default_currency
--     - Set NOT NULL on session_currency
--     - Add CHECK constraint for AAA format
-- ============================================================================

BEGIN;

-- 1) Backfill any lingering NULL/blank session_currency values
UPDATE aquorix.dive_sessions s
SET session_currency = o.default_currency
FROM aquorix.diveoperators o
WHERE s.operator_id = o.operator_id
  AND (s.session_currency IS NULL OR btrim(s.session_currency) = '');

-- 2) Enforce NOT NULL
ALTER TABLE aquorix.dive_sessions
  ALTER COLUMN session_currency SET NOT NULL;

-- 3) Enforce uppercase 3-letter format (ISO-style currency code)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dive_sessions_session_currency_format_chk'
  ) THEN
    ALTER TABLE aquorix.dive_sessions
      ADD CONSTRAINT dive_sessions_session_currency_format_chk
      CHECK (session_currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

COMMIT;

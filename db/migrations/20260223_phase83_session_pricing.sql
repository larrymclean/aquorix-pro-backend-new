-- ============================================================================
-- AQUORIX Migration
-- File: 20260223_phase83_session_pricing.sql
-- Path: /db/migrations/20260223_phase83_session_pricing.sql
-- Description: Add session-level pricing (Option B) to aquorix.dive_sessions
--
-- Created: 2026-02-23
-- Version: v8.3.0
--
-- Change Log:
--   - 2026-02-23 - v8.3.0:
--     - Add price_per_diver (ledger currency) and session_currency (ledger)
--     - Backfill session_currency from diveoperators.default_currency
-- ============================================================================

BEGIN;

ALTER TABLE aquorix.dive_sessions
  ADD COLUMN IF NOT EXISTS price_per_diver NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS session_currency CHAR(3);

-- Backfill currency from operator default currency
UPDATE aquorix.dive_sessions s
SET session_currency = o.default_currency
FROM aquorix.diveoperators o
WHERE s.operator_id = o.operator_id
  AND s.session_currency IS NULL;

-- Default session_currency to operator currency for new rows (application also enforces)
ALTER TABLE aquorix.dive_sessions
  ALTER COLUMN session_currency SET DEFAULT 'USD';

COMMIT;
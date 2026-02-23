-- ============================================================================
-- AQUORIX Migration (Hotfix)
-- File: 20260223_phase83_session_pricing_fix_currency_default.sql
-- Path: /db/migrations/20260223_phase83_session_pricing_fix_currency_default.sql
-- Description: Remove incorrect DEFAULT 'USD' from dive_sessions.session_currency
--              and repair any rows that inherited it.
--
-- Created: 2026-02-23
-- Version: v8.3.1
--
-- Change Log (append-only):
--   - 2026-02-23 - v8.3.1:
--     - DROP DEFAULT from session_currency (ledger currency must come from operator)
--     - Backfill any 'USD' session_currency rows to operator default_currency
-- ============================================================================

BEGIN;

ALTER TABLE aquorix.dive_sessions
  ALTER COLUMN session_currency DROP DEFAULT;

UPDATE aquorix.dive_sessions s
SET session_currency = o.default_currency
FROM aquorix.diveoperators o
WHERE s.operator_id = o.operator_id
  AND s.session_currency = 'USD';

COMMIT;

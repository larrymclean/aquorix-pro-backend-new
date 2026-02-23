-- ============================================================================
-- AQUORIX Migration
-- File: 20260223_phase83_session_currency_repair.sql
-- Path: /db/migrations/20260223_phase83_session_currency_repair.sql
-- Description: Repair any dive_sessions rows that incorrectly retained 'USD' as
--              ledger currency due to earlier DEFAULT bug (Phase 8.3).
--
-- Created: 2026-02-23
-- Version: v8.3.1
--
-- Change Log:
--   - 2026-02-23 - v8.3.1:
--     - Force session_currency to operator default for rows that are still 'USD'
--       but operator default is NOT 'USD' (Jordan = JOD).
-- ============================================================================

BEGIN;

UPDATE aquorix.dive_sessions s
SET session_currency = o.default_currency
FROM aquorix.diveoperators o
WHERE s.operator_id = o.operator_id
  AND s.session_currency = 'USD'
  AND o.default_currency IS NOT NULL
  AND o.default_currency <> 'USD';

COMMIT;

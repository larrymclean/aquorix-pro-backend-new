-- ============================================================================
-- AQUORIX Migration
-- File: 20260224_phase83_guest_identities.sql
-- Path: db/migrations/20260224_phase83_guest_identities.sql
-- Description: Create guest identity table for Expedia/airline-grade purchaser identity
--
-- Created: 2026-02-24
-- Version: v8.3.0
--
-- Change Log (append-only):
--   - 2026-02-24 - v8.3.0:
--     - Add aquorix.guest_identities table (unique email; optional unique phone)
--     - Add indexes for email/phone lookups
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS aquorix.guest_identities (
  guest_id           BIGSERIAL PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  phone              TEXT UNIQUE,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_identities_email
  ON aquorix.guest_identities (email);

CREATE INDEX IF NOT EXISTS idx_guest_identities_phone
  ON aquorix.guest_identities (phone);

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- DROP INDEX IF EXISTS aquorix.idx_guest_identities_phone;
-- DROP INDEX IF EXISTS aquorix.idx_guest_identities_email;
-- DROP TABLE IF EXISTS aquorix.guest_identities;
-- COMMIT;

-- AQUORIX VIKING — Phase 8.3 (v4.3)
-- File: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/20260225_viking83_phone_uniqueness_toggle.sql
-- Purpose: Enable toggleable phone uniqueness for guest identities.
-- Owner: Larry McLean
-- Created: 2026-02-25
-- Change Log:
--   v1.0 2026-02-25 LM - Drop DB unique constraint on phone to allow dev/test reuse; app enforces uniqueness when enabled.

BEGIN;

-- Drop UNIQUE constraint that currently makes "toggle" impossible in dev/test.
ALTER TABLE aquorix.guest_identities
  DROP CONSTRAINT IF EXISTS guest_identities_phone_key;

COMMIT;

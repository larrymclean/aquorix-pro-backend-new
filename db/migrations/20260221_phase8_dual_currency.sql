/*
  Product: AQUORIX
  File: 20260221_phase8_dual_currency.sql
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/20260221_phase8_dual_currency.sql
  Title: Phase 8.1 - Dual Currency Storage (Ledger JOD vs Stripe Charge USD)
  Author: Larry McLean + ChatGPT
  Created: 2026-02-21
  Version: v1.0.0

  Change Log:
    - 2026-02-21 - v1.0.0 (Larry + ChatGPT):
      - Add stripe charge currency/amount + FX estimate fields to aquorix.dive_bookings
*/

BEGIN;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS stripe_charge_currency character(3);

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS stripe_charge_amount_minor bigint;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS fx_rate_estimate numeric(12,6);

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS fx_rate_estimate_at timestamp with time zone;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS fx_rate_source text;

COMMIT;

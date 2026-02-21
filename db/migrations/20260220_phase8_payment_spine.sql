/*
  File: 20260220_phase8_payment_spine.sql
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/20260220_phase8_payment_spine.sql
  Description:
    AQUORIX VIKING - Phase 8 Payment Spine DB foundation.
    - Adds Stripe identifiers + minor-unit storage to aquorix.dive_bookings
    - Adds aquorix.payment_events table for webhook idempotency/audit
    - Adds indexes for fast lookup

  Author: ChatGPT (Lead) + Larry McLean (Product Owner)
  Created: 2026-02-20
  Version: v1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE (VIKING)

  Change Log:
    - 2026-02-20 - v1.0.0 (ChatGPT + Larry):
      - Create payment spine storage columns + payment_events idempotency table.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) dive_bookings: Stripe linkage + authoritative amount storage (minor units)
-- ---------------------------------------------------------------------------

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255);

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255);

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS payment_amount_minor BIGINT;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Optional: helpful for ops/debug later (safe to add now, no behavior change)
ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS payment_checkout_created_at TIMESTAMPTZ;

-- Uniqueness: a booking should not have multiple Stripe checkout sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'uniq_dive_bookings_stripe_checkout_session_id'
  ) THEN
    CREATE UNIQUE INDEX uniq_dive_bookings_stripe_checkout_session_id
      ON aquorix.dive_bookings(stripe_checkout_session_id)
      WHERE stripe_checkout_session_id IS NOT NULL;
  END IF;
END $$;

-- Fast lookup by payment intent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'idx_dive_bookings_stripe_payment_intent_id'
  ) THEN
    CREATE INDEX idx_dive_bookings_stripe_payment_intent_id
      ON aquorix.dive_bookings(stripe_payment_intent_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) payment_events: webhook idempotency + audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS aquorix.payment_events (
  event_id TEXT PRIMARY KEY,                 -- Stripe event.id (evt_*)
  event_type TEXT NOT NULL,                  -- checkout.session.completed, etc.
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'pending', -- pending|processed|failed
  error_message TEXT,

  booking_id BIGINT,
  operator_id BIGINT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount_total_minor BIGINT,
  currency CHAR(3),

  raw_event JSONB
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'idx_payment_events_booking_id'
  ) THEN
    CREATE INDEX idx_payment_events_booking_id
      ON aquorix.payment_events(booking_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'idx_payment_events_operator_id'
  ) THEN
    CREATE INDEX idx_payment_events_operator_id
      ON aquorix.payment_events(operator_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'idx_payment_events_received_at'
  ) THEN
    CREATE INDEX idx_payment_events_received_at
      ON aquorix.payment_events(received_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'aquorix'
      AND indexname = 'idx_payment_events_processing_status'
  ) THEN
    CREATE INDEX idx_payment_events_processing_status
      ON aquorix.payment_events(processing_status);
  END IF;
END $$;

COMMIT;

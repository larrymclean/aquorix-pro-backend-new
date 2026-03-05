/*
 * AQUORIX Backend — DB Migration
 * File: 20260304_add_refund_fields_to_dive_bookings.sql
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/db/migrations/20260304_add_refund_fields_to_dive_bookings.sql
 * Description: Add minimal refund state fields to aquorix.dive_bookings for dashboard refund flow
 *
 * Created: 2026-03-04
 * Version: 1.0.0
 *
 * Change Log (append-only):
 *   - 2026-03-04: v1.0.0 - NEW: refund_status, refunded_at, refund_reason on aquorix.dive_bookings
 */

BEGIN;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS refund_status text;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone;

ALTER TABLE aquorix.dive_bookings
  ADD COLUMN IF NOT EXISTS refund_reason text;

COMMIT;

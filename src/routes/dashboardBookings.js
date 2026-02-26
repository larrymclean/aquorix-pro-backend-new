/**
 * ============================================================================
 * AQUORIX VIKING
 * File: src/routes/dashboardBookings.js
 * ----------------------------------------------------------------------------
 * Extracted from server.js (lines 469–629)
 * Phase: 8.3C – Dashboard Extraction
 * 
 * Created: 2026-02-25
 * Version: v1.0.1
 * ----------------------------------------------------------------------------
 * Purpose:
 *   GET /api/v1/dashboard/bookings
 *   Operator-scoped weekly bookings with UI status derivation.
 *
 * Doctrine:
 *   - No behavior changes during extraction.
 *   - Pure relocation from server.js.
 *   - Improvements occur AFTER successful extraction.
 *
 * Change Log:
 *   - 2026-02-25 – v1.0.0 - Initial extraction from server.js (no logic changes).
 *   - 2026-02-25 – v1.0.1 - Add dashboard cockpit fields, Rename derived flag
 * ============================================================================
 */

function registerDashboardBookingsRoutes(app, { pool, requireDashboardScope }) {

  app.get("/api/v1/dashboard/bookings", requireDashboardScope, async (req, res) => {

    // Never cache operator-scoped bookings
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const rawWeekStart = req.query.week_start;

    function isValidWeekStartYMD(value) {
      const s = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const [yyyy, mm, dd] = s.split("-").map((n) => parseInt(n, 10));
      if (!yyyy || !mm || !dd) return false;
      const d = new Date(Date.UTC(yyyy, mm - 1, dd));
      return (
        d.getUTCFullYear() === yyyy &&
        d.getUTCMonth() === mm - 1 &&
        d.getUTCDate() === dd
      );
    }

    if (rawWeekStart !== undefined) {
      const trimmed = String(rawWeekStart).trim();
      if (trimmed.length === 0 || !isValidWeekStartYMD(trimmed)) {
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "Invalid week_start. Use YYYY-MM-DD."
        });
      }
    }

    const weekStartParam =
      rawWeekStart === undefined ? null : String(rawWeekStart).trim();

    try {
      const op = await pool.query(
        `
        SELECT operator_id, timezone
        FROM aquorix.diveoperators
        WHERE operator_id = $1
        LIMIT 1
        `,
        [req.operator_id]
      );

      if (op.rowCount === 0) {
        return res.status(403).json({
          ok: false,
          status: "forbidden",
          message: "Operator not found for user scope"
        });
      }

      const tz = op.rows[0].timezone || "UTC";

      const weekRange = await pool.query(
        `
        WITH base AS (
          SELECT
            CASE
              WHEN $1::text IS NOT NULL THEN $1::date
              ELSE (
                (date_trunc('day', now() AT TIME ZONE $2)::date)
                - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE $2))::int) - 1)
              )
            END AS week_start
        )
        SELECT
          week_start::text AS week_start,
          (week_start + interval '6 days')::date::text AS week_end
        FROM base
        `,
        [weekStartParam, tz]
      );

      const week_start = weekRange.rows[0].week_start;
      const week_end = weekRange.rows[0].week_end;

      const r = await pool.query(
        `
        SELECT
          b.booking_id,
          b.booking_status::text AS booking_status,
          b.payment_status::text AS payment_status,
          b.payment_currency,
          b.payment_amount_minor,
          b.payment_amount,
          b.hold_expires_at,
          b.stripe_checkout_session_id,
          b.paid_at,
          b.manual_review_required,
          b.manual_review_reason,
          b.manual_review_flagged_at,
          b.stripe_payment_intent_id,
          b.stripe_charge_currency,
          b.stripe_charge_amount_minor,
          b.fx_rate_estimate,
          b.fx_rate_source,

          CASE
            WHEN b.payment_status::text = 'paid' AND b.booking_status::text <> 'confirmed' THEN true
            ELSE false
          END AS requires_manual_review_derived,

          CASE
            WHEN b.booking_status::text = 'cancelled' THEN 'cancelled'
            WHEN b.booking_status::text = 'confirmed'
                 AND b.payment_status::text = 'paid'
              THEN 'paid_confirmed'
            WHEN b.payment_status::text = 'paid'
                 AND b.booking_status::text <> 'confirmed'
              THEN 'paid_manual_review'
            WHEN b.stripe_checkout_session_id IS NOT NULL
              AND b.payment_status::text = 'unpaid'
              AND b.hold_expires_at IS NOT NULL
              AND b.hold_expires_at > now()
              THEN 'awaiting_payment'
            WHEN b.stripe_checkout_session_id IS NOT NULL
              AND b.payment_status::text = 'unpaid'
              AND (b.hold_expires_at IS NULL
                   OR b.hold_expires_at <= now())
              THEN 'payment_link_expired'
            WHEN b.payment_amount_minor IS NULL
              THEN 'needs_pricing_snapshot'
            ELSE 'pending'
          END AS ui_status,

          b.headcount,
          b.guest_name,
          b.guest_email,
          b.guest_phone,
          b.special_requests,
          b.source,
          b.created_at,
          b.updated_at,

          s.session_id,
          s.itinerary_id,
          (s.dive_datetime AT TIME ZONE $4) AS dive_datetime_local,
          to_char((s.dive_datetime AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS session_date,
          to_char((s.dive_datetime AT TIME ZONE $4)::time, 'HH24:MI') AS start_time,

          dsite.name AS site_name,

          it.title AS itinerary_title,
          it.itinerary_date::text AS itinerary_date,
          it.dive_slot::text AS itinerary_slot,
          it.itinerary_type::text AS itinerary_type,
          it.location_type::text AS itinerary_location_type

        FROM aquorix.dive_bookings b
        JOIN aquorix.dive_sessions s
          ON s.session_id = b.session_id
        JOIN aquorix.divesites dsite
          ON dsite.dive_site_id = s.dive_site_id
        JOIN aquorix.itineraries it
          ON it.itinerary_id = s.itinerary_id

        WHERE b.operator_id = $1
          AND b.session_id IS NOT NULL
          AND s.cancelled_at IS NULL
          AND (s.dive_datetime AT TIME ZONE $4)::date
              BETWEEN $2::date AND $3::date

        ORDER BY
          CASE WHEN b.booking_status::text = 'pending'
            THEN 0 ELSE 1 END ASC,
          (s.dive_datetime AT TIME ZONE $4) ASC,
          b.created_at ASC
        `,
        [req.operator_id, week_start, week_end, tz]
      );

      return res.json({
        ok: true,
        status: "success",
        operator_id: String(req.operator_id),
        week: { start: week_start, end: week_end },
        bookings: r.rows
      });

    } catch (err) {
      console.error(
        "[GET /api/v1/dashboard/bookings] Error:",
        err && err.stack ? err.stack : err
      );
      return res.status(500).json({
        ok: false,
        status: "error",
        message: "Internal server error"
      });
    }
  });
}

module.exports = registerDashboardBookingsRoutes;

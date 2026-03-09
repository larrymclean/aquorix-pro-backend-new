/*
 * AQUORIX Pro Backend - Widget Pending Booking Routes (Phase 9E)
 * File: widgetBookingsPending.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/widgetBookingsPending.js
 * Description:
 *   Public route(s) for widget checkout pending booking creation.
 *   This lane is intentionally separate from protected dashboard booking routes.
 *   Phase 9E initial implementation returns a deterministic pending-payment stub
 *   response and logs the inbound widget request for safe frontend/backend seam testing.
 *
 * Author: Larry McLean + ChatGPT (Lead Systems Architect)
 * Created: 2026-03-09
 * Version: 1.0.0
 *
 * Status: ACTIVE (Phase 9E)
 *
 * Change Log (append-only):
 *   - 2026-03-09: v1.0.0 - Initial public POST /api/v1/widget/bookings/pending stub route with
 *                         payload validation, holdExpiresAt calculation, and deterministic response.
 */

module.exports = function registerWidgetBookingsPendingRoutes(app, deps) {
  const {
    pool,
    HOLD_WINDOW_MINUTES,
  } = deps || {};

  if (!app) {
    throw new Error("registerWidgetBookingsPendingRoutes: app is required");
  }

  if (!pool) {
    throw new Error("registerWidgetBookingsPendingRoutes: pool is required");
  }

  app.post("/api/v1/widget/bookings/pending", async (req, res) => {
    try {
      const body = req && req.body ? req.body : {};

      const submittedAtIso = body.submittedAtIso ? String(body.submittedAtIso).trim() : null;
      const bookingSource = body.bookingSource ? String(body.bookingSource).trim() : "widget-embed";

      const customer = body.customer && typeof body.customer === "object" ? body.customer : {};
      const booking = body.booking && typeof body.booking === "object" ? body.booking : {};

      const firstName = customer.firstName ? String(customer.firstName).trim() : "";
      const lastName = customer.lastName ? String(customer.lastName).trim() : "";
      const email = customer.email ? String(customer.email).trim() : "";
      const phone = customer.phone ? String(customer.phone).trim() : "";
      const country = customer.country ? String(customer.country).trim() : "";
      const notes = customer.notes ? String(customer.notes).trim() : "";

      const operatorSlug = booking.operatorSlug ? String(booking.operatorSlug).trim() : "";
      const currency = booking.currency ? String(booking.currency).trim().toUpperCase() : "";
      const chargeableItems = Array.isArray(booking.chargeableItems) ? booking.chargeableItems : [];
      const waitlistItems = Array.isArray(booking.waitlistItems) ? booking.waitlistItems : [];
      const totalMinorRaw = booking.totalMinor;

      if (!submittedAtIso) {
        return res.status(400).json({
          ok: false,
          error: "submittedAtIso is required",
          code: "SUBMITTED_AT_REQUIRED",
        });
      }

      if (!firstName || !lastName || !email) {
        return res.status(400).json({
          ok: false,
          error: "customer firstName, lastName, and email are required",
          code: "CUSTOMER_IDENTITY_REQUIRED",
        });
      }

      if (!operatorSlug) {
        return res.status(400).json({
          ok: false,
          error: "booking.operatorSlug is required",
          code: "OPERATOR_SLUG_REQUIRED",
        });
      }

      if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        return res.status(400).json({
          ok: false,
          error: "booking.currency must be a valid 3-letter currency code",
          code: "BOOKING_CURRENCY_INVALID",
        });
      }

      if (!Array.isArray(chargeableItems) || chargeableItems.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "booking.chargeableItems must contain at least one item",
          code: "CHARGEABLE_ITEMS_REQUIRED",
        });
      }

      if (!Number.isInteger(Number(totalMinorRaw)) || Number(totalMinorRaw) < 0) {
        return res.status(400).json({
          ok: false,
          error: "booking.totalMinor must be a non-negative integer",
          code: "TOTAL_MINOR_INVALID",
        });
      }

      const now = new Date();
      const holdMinutes = Number(HOLD_WINDOW_MINUTES) || 15;
      const holdExpiresAt = new Date(now.getTime() + holdMinutes * 60 * 1000).toISOString();

      const bookingId = `WIDGET-PENDING-${Date.now()}`;

      // Resolve operator_id from operator_slug (Poseidon Law 15: operator context must be explicit)
      const opResult = await pool.query(
        `SELECT operator_id
        FROM aquorix.diveoperators
        WHERE operator_slug = $1
        LIMIT 1`,
        [operatorSlug]
      );

      if (!opResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "operator not found",
          code: "OPERATOR_NOT_FOUND"
        });
      }

      const operatorId = opResult.rows[0].operator_id;

      const insertSql = `
        INSERT INTO aquorix.dive_bookings (
          operator_id,
          session_id,
          booking_status,
          payment_status,
          headcount,
          guest_name,
          guest_email,
          guest_phone,
          source,
          hold_expires_at,
          payment_amount_minor,
          payment_currency
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        )
        RETURNING booking_id
      `;

      const headcount = chargeableItems.reduce((sum, i) => sum + (i.pax || 1), 0);

      const insertValues = [
        operatorId,
        null,
        'pending',
        'unpaid',
        headcount,
        `${firstName} ${lastName}`,
        email,
        phone,
        bookingSource,
        holdExpiresAt,
        Number(totalMinorRaw),
        currency
      ];

      const result = await pool.query(insertSql, insertValues);

      const realBookingId = result.rows[0].booking_id;

      const pendingBookingRequest = {
        submittedAtIso,
        bookingSource,
        customer: {
          firstName,
          lastName,
          email,
          phone,
          country,
          notes,
        },
        booking: {
          operatorSlug,
          currency,
          chargeableItems,
          waitlistItems,
          discounts: booking.discounts || null,
          subtotalMinor: booking.subtotalMinor,
          totalMinor: Number(totalMinorRaw),
          schemaVersion: booking.schemaVersion || null,
          operatorDisplayName: booking.operatorDisplayName || null,
          timezone: booking.timezone || null,
          createdAtIso: booking.createdAtIso || null,
        },
      };

      console.log("[AQUORIX][widget/bookings/pending] pending booking request received");
      console.log(JSON.stringify(pendingBookingRequest, null, 2));

      return res.status(201).json({
        ok: true,
        bookingId: realBookingId,
        bookingStatus: "PENDING_PAYMENT",
        paymentStatus: "unpaid",
        holdExpiresAt,
        currency,
        totalMinor: Number(totalMinorRaw),
      });
    } catch (err) {
      console.error(
        "[AQUORIX][widget/bookings/pending] failed:",
        err && err.stack ? err.stack : err
      );

      return res.status(500).json({
        ok: false,
        error: "Widget pending booking creation failed",
        code: "WIDGET_PENDING_CREATE_FAILED",
      });
    }
  });
};
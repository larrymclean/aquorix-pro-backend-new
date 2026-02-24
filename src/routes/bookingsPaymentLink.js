/*
 * AQUORIX Pro Backend - Booking Payment Link Routes
 * File: bookingsPaymentLink.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/bookingsPaymentLink.js
 * Description:
 *   Dashboard-only operator tools for payment links (Phase 8.3B).
 *   P0: Regenerate Stripe Checkout link for a booking without modifying pricing snapshot.
 *
 * Author: Larry McLean
 * Created: 2026-02-24
 * Version: 1.0.0
 *
 * Status: ACTIVE (Viking Phase 8.3B)
 *
 * Change Log (append-only):
 *   - 2026-02-24: v1.0.0 - Add POST /api/v1/dashboard/bookings/:booking_id/payment-link/regenerate
 *                         - Reuse payment_amount_minor + payment_currency snapshot (immutable)
 *                         - Overwrite stripe_checkout_session_id with new session id
 *                         - Refresh hold_expires_at (15 minutes)
 *                         - Audit to aquorix.payment_events using same columns/status as webhook ('received'/'error')
 */

module.exports = function registerBookingsPaymentLinkRoutes(app, deps) {
  const { pool, requireDashboardScope, getStripeClient } = deps;

  // ---------------------------------------------------------------------------
  // POST /api/v1/dashboard/bookings/:booking_id/payment-link/regenerate
  //
  // Contract (LOCKED):
  // - Dashboard-scoped (operator-only)
  // - Allowed if NOT paid and NOT confirmed; cancelled => noop
  // - Uses existing pricing snapshot on booking (DO NOT recalc from session)
  // - Overwrites stripe_checkout_session_id to latest
  // - Extends hold_expires_at to now + 15 minutes
  // - Inserts audit row into aquorix.payment_events using webhook conventions:
  //     (event_id, event_type, raw_event, received_at, processing_status='received')
  // ---------------------------------------------------------------------------
  app.post(
    "/api/v1/dashboard/bookings/:booking_id/payment-link/regenerate",
    requireDashboardScope,
    async (req, res) => {
      const booking_id = Number(req.params.booking_id);
      if (!Number.isFinite(booking_id) || booking_id <= 0) {
        return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid booking_id" });
      }

      // Operator scope is enforced by requireDashboardScope (never accept from client)
      const operator_id = req.operator_id;
      if (!operator_id) {
        return res.status(403).json({ ok: false, status: "forbidden", message: "Missing operator scope" });
      }

      // Env guardrails (same doctrine as approve)
      const successUrl = process.env.STRIPE_SUCCESS_URL;
      const cancelUrl = process.env.STRIPE_CANCEL_URL;

      if (!successUrl || !String(successUrl).trim()) {
        return res.status(500).json({ ok: false, status: "error", message: "STRIPE_SUCCESS_URL missing from environment" });
      }
      if (!cancelUrl || !String(cancelUrl).trim()) {
        return res.status(500).json({ ok: false, status: "error", message: "STRIPE_CANCEL_URL missing from environment" });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Stripe client (lazy init so server can boot without Stripe configured)
        let stripe;
        try {
          stripe = getStripeClient();
        } catch (_e) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            ok: false,
            status: "error",
            message: "Stripe is not configured on this server (missing STRIPE_SECRET_KEY)."
          });
        }

        // 1) Lock booking row (operator scoped)
        const b = await client.query(
          `
          SELECT
            booking_id,
            booking_status,
            payment_status,
            operator_id,
            session_id,
            headcount,
            guest_email,
            guest_name,
            payment_currency,
            payment_amount_minor,
            stripe_checkout_session_id
          FROM aquorix.dive_bookings
          WHERE booking_id = $1
            AND operator_id = $2
          FOR UPDATE
          `,
          [booking_id, operator_id]
        );

        if (b.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, status: "not_found", message: "Booking not found" });
        }

        const booking = b.rows[0];

        // 2) Terminal / noop rules (LOCKED)
        if (booking.booking_status === "cancelled") {
          await client.query("ROLLBACK");
          return res.json({ ok: true, status: "success", action: "noop_cancelled", booking_id: String(booking_id) });
        }

        if (booking.payment_status === "paid" && booking.booking_status === "confirmed") {
          await client.query("ROLLBACK");
          return res.json({ ok: true, status: "success", action: "noop_already_paid_confirmed", booking_id: String(booking_id) });
        }

        if (booking.payment_status === "paid") {
          await client.query("ROLLBACK");
          return res.json({ ok: true, status: "success", action: "noop_already_paid", booking_id: String(booking_id) });
        }

        if (booking.booking_status === "confirmed") {
          await client.query("ROLLBACK");
          return res.json({ ok: true, status: "success", action: "noop_already_confirmed", booking_id: String(booking_id) });
        }

        // 3) Snapshot must exist (Option B lock)
        const minorRaw = booking.payment_amount_minor;
        const ledger_minor_num = (minorRaw === null || typeof minorRaw === "undefined") ? NaN : Number(minorRaw);
        if (!Number.isFinite(ledger_minor_num) || ledger_minor_num <= 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            status: "conflict",
            message: "Booking has no pricing snapshot (payment_amount_minor). Create pricing at /api/v1/bookings/request first.",
            booking_id: String(booking_id)
          });
        }

        const ledger_currency_upper = String(booking.payment_currency || "").trim().toUpperCase();
        if (!ledger_currency_upper) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            status: "conflict",
            message: "Booking has no payment_currency snapshot. Create pricing at /api/v1/bookings/request first.",
            booking_id: String(booking_id)
          });
        }

        // 4) Dual-currency behavior MUST match approve (policy)
        function minorUnitMultiplier(currencyUpper) {
          switch (currencyUpper) {
            case "JOD": return 1000;
            case "USD": return 100;
            default: return 100;
          }
        }

        const isDev = String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
        const platformChargeCurrencyLower = String(process.env.STRIPE_PLATFORM_CHARGE_CURRENCY || "usd").trim().toLowerCase();
        const forceCurrencyLower = String(process.env.STRIPE_FORCE_CURRENCY || "").trim().toLowerCase();

        const charge_currency_lower = (isDev && forceCurrencyLower) ? forceCurrencyLower : platformChargeCurrencyLower;
        const charge_currency_upper = charge_currency_lower.toUpperCase();

        const ledger_multiplier = minorUnitMultiplier(ledger_currency_upper);
        const ledger_amount_minor = ledger_minor_num;
        const ledger_amount_major = ledger_amount_minor / ledger_multiplier;

        let fx_rate_estimate = null;
        let fx_rate_source = null;
        let charge_amount_major = ledger_amount_major;

        if (ledger_currency_upper !== charge_currency_upper) {
          if (!(ledger_currency_upper === "JOD" && charge_currency_upper === "USD")) {
            await client.query("ROLLBACK");
            return res.status(500).json({
              ok: false,
              status: "error",
              message: "Unsupported FX path for Viking (expected JOD->USD)",
              ledger_currency: ledger_currency_upper,
              charge_currency: charge_currency_upper
            });
          }

          const fxRaw = String(process.env.FX_RATE_JOD_TO_USD || "").trim();
          const fx = fxRaw ? Number(fxRaw) : NaN;

          if (!Number.isFinite(fx) || fx <= 0) {
            await client.query("ROLLBACK");
            return res.status(500).json({
              ok: false,
              status: "error",
              message: "FX_RATE_JOD_TO_USD missing or invalid",
              fx_raw: fxRaw
            });
          }

          fx_rate_estimate = fx;
          fx_rate_source = "env:FX_RATE_JOD_TO_USD";
          charge_amount_major = ledger_amount_major * fx_rate_estimate;
        }

        const charge_multiplier = minorUnitMultiplier(charge_currency_upper);
        const charge_amount_minor = Math.round(charge_amount_major * charge_multiplier);

        if (!Number.isFinite(charge_amount_minor) || charge_amount_minor <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            status: "bad_request",
            message: "Invalid computed Stripe charge amount minor",
            ledger_currency: ledger_currency_upper,
            charge_currency: charge_currency_upper
          });
        }

        // 5) Create new Stripe Checkout Session
        const oldSessionId = booking.stripe_checkout_session_id ? String(booking.stripe_checkout_session_id) : null;

        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          success_url: String(successUrl).trim(),
          cancel_url: String(cancelUrl).trim(),
          customer_email: booking.guest_email || undefined,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: charge_currency_lower,
                unit_amount: charge_amount_minor,
                product_data: {
                  name: "AQUORIX Dive Booking (Regenerated Link)",
                  description: booking.guest_name
                    ? `Booking #${booking_id} for ${booking.guest_name}`
                    : `Booking #${booking_id}`
                }
              }
            }
          ],
          metadata: {
            booking_id: String(booking_id),
            operator_id: String(operator_id),
            session_id: booking.session_id ? String(booking.session_id) : "",
            action: "regenerate_payment_link",
            old_stripe_checkout_session_id: oldSessionId || ""
          }
        });

        if (!checkoutSession || !checkoutSession.id) {
          throw new Error("Stripe checkout session creation failed (no session id returned)");
        }

        const newSessionId = String(checkoutSession.id);

        // 6) Update booking (overwrite session id, refresh hold)
        await client.query(
          `
          UPDATE aquorix.dive_bookings
          SET
            stripe_checkout_session_id = $1,
            payment_checkout_created_at = now(),
            updated_at = now(),
            hold_expires_at = now() + interval '15 minutes',

            -- store charge truth (matches approve)
            stripe_charge_currency = $2,
            stripe_charge_amount_minor = $3,

            fx_rate_estimate = $4::numeric,
            fx_rate_estimate_at = CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END,
            fx_rate_source = $5::text
          WHERE booking_id = $6
            AND operator_id = $7
          `,
          [
            newSessionId,
            charge_currency_upper,
            charge_amount_minor,
            fx_rate_estimate,
            fx_rate_source,
            booking_id,
            operator_id
          ]
        );

        // 7) Audit insert to payment_events (MATCH WEBHOOK CONVENTION EXACTLY)
        const event_id = `regen:${booking_id}:${newSessionId}`;
        const event_type = "checkout.link_regenerated";
        const raw_event = JSON.stringify({
          event_id,
          event_type,
          booking_id,
          operator_id,
          old_stripe_checkout_session_id: oldSessionId,
          new_stripe_checkout_session_id: newSessionId,
          ledger_currency: ledger_currency_upper,
          ledger_amount_minor: String(ledger_amount_minor),
          charge_currency: charge_currency_upper,
          charge_amount_minor: String(charge_amount_minor),
          fx_rate_estimate: fx_rate_estimate,
          fx_rate_source: fx_rate_source,
          regenerated_at: new Date().toISOString()
        });

        await client.query(
          `
          INSERT INTO aquorix.payment_events (event_id, event_type, raw_event, received_at, processing_status)
          VALUES ($1, $2, $3::jsonb, NOW(), 'received')
          ON CONFLICT (event_id) DO NOTHING
          `,
          [event_id, event_type, raw_event]
        );

        await client.query("COMMIT");

        return res.json({
          ok: true,
          status: "success",
          action: "payment_link_regenerated",
          booking_id: String(booking_id),
          old_stripe_checkout_session_id: oldSessionId,
          stripe_checkout_session_id: newSessionId,
          checkout_url: checkoutSession.url || null
        });

      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) {}

        // Best-effort: if we can, mark the audit row as error (only if it exists)
        // NOTE: We cannot guarantee a Stripe event id here; this is just internal regen.
        console.error("[regenerate payment link] error:", e && e.stack ? e.stack : e);

        return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
      } finally {
        client.release();
      }
    }
  );
};

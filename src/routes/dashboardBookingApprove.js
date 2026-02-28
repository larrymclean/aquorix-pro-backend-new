/*
 * AQUORIX Backend — Dashboard Booking Approve Route
 * File: dashboardBookingApprove.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/dashboardBookingApprove.js
 * Description: Extracted route for approving a booking and creating Stripe Checkout session
 *
 * Created: 2026-02-25
 * Version: 1.0.0
 *
 * Change Log (append-only):
 *   - 2026-02-25: v1.0.0 - Extracted POST /api/v1/dashboard/bookings/:booking_id/approve from server.js (no behavior change)
 */

module.exports = function registerDashboardBookingApproveRoutes(app, deps) {
  const {
    pool,
    requireDashboardScope,
    getStripeClient,
    getOperatorDefaultCapacity,
    getCapacityConsumedForSession
  } = deps;

  if (!app) throw new Error("registerDashboardBookingApproveRoutes: app is required");
  if (!pool) throw new Error("registerDashboardBookingApproveRoutes: pool is required");
  if (!requireDashboardScope) throw new Error("registerDashboardBookingApproveRoutes: requireDashboardScope is required");
  if (!getStripeClient) throw new Error("registerDashboardBookingApproveRoutes: getStripeClient is required");
  if (!getOperatorDefaultCapacity) throw new Error("registerDashboardBookingApproveRoutes: getOperatorDefaultCapacity is required");
  if (!getCapacityConsumedForSession) throw new Error("registerDashboardBookingApproveRoutes: getCapacityConsumedForSession is required");

  // ---------------------------------------------------------------------------
  // Phase 8: Approve Booking => Initiate Payment (Stripe Checkout)
  // POST /api/v1/dashboard/bookings/:booking_id/approve
  // ---------------------------------------------------------------------------
  app.post("/api/v1/dashboard/bookings/:booking_id/approve", requireDashboardScope, async (req, res) => {
    const booking_id = Number(req.params.booking_id);
    if (!Number.isFinite(booking_id) || booking_id <= 0) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid booking_id" });
    }

    const forceNew = String(req.query.force_new || "").trim() === "1";

    // Env guardrails (explicit)
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
      } catch (e) {
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
          payment_amount,
          payment_amount_minor,
          payment_currency,
          hold_expires_at,
          stripe_checkout_session_id
        FROM aquorix.dive_bookings
        WHERE booking_id = $1
          AND operator_id = $2
        FOR UPDATE
        `,
        [booking_id, req.operator_id]
      );

      if (b.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, status: "not_found", message: "Booking not found" });
      }

      const booking = b.rows[0];

      // 2) Terminal states / idempotency outcomes
      if (booking.booking_status === "cancelled") {
        await client.query("ROLLBACK");
        return res.json({ ok: true, status: "success", action: "noop_already_cancelled", booking_id: String(booking_id) });
      }

      // If already paid+confirmed, no checkout needed
      if (booking.payment_status === "paid" && booking.booking_status === "confirmed") {
        await client.query("ROLLBACK");
        return res.json({ ok: true, status: "success", action: "noop_already_paid_confirmed", booking_id: String(booking_id) });
      }

      // If we already created a checkout session before, return it (idempotent)
      // Unless force_new=1, which regenerates a fresh checkout session.
      if (booking.stripe_checkout_session_id && !forceNew) {
        await client.query("COMMIT");

        const existingSession = await stripe.checkout.sessions.retrieve(String(booking.stripe_checkout_session_id));
        return res.json({
          ok: true,
          status: "success",
          action: "checkout_already_created",
          booking_id: String(booking_id),
          stripe_checkout_session_id: String(booking.stripe_checkout_session_id),
          checkout_url: existingSession && existingSession.url ? existingSession.url : null
        });
      }

      // forceNew path: treat as if no checkout exists (regenerate)
      if (booking.stripe_checkout_session_id && forceNew) {
        // Continue through creation flow below; we will overwrite stripe_checkout_session_id on the booking.
      }

      // 3) Must have session_id for capacity enforcement + checkout metadata integrity
      const session_id = Number(booking.session_id);
      if (!Number.isFinite(session_id) || session_id <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "Booking has no valid session_id; cannot initiate payment"
        });
      }

      // 4) Capacity check (confirmed + active holds)
      const capacity = await getOperatorDefaultCapacity(req.operator_id);
      const consumed = await getCapacityConsumedForSession(client, req.operator_id, session_id);

      const requested = Number(booking.headcount || 1);
      if (!Number.isFinite(requested) || requested <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid headcount on booking" });
      }

      if (consumed + requested > capacity) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          status: "conflict",
          message: "Over capacity for this session",
          capacity,
          capacity_consumed: consumed,
          requested_headcount: requested
        });
      }

      // 5) Amount authority (Phase 8.3 rule)
      const minorRaw = booking.payment_amount_minor;
      const ledger_minor_num = (minorRaw === null || typeof minorRaw === "undefined") ? NaN : Number(minorRaw);

      if (!Number.isFinite(ledger_minor_num) || ledger_minor_num <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "payment_amount_minor is missing on booking; create booking request pricing snapshot before initiating Stripe checkout",
          booking_id: String(booking_id)
        });
      }

      // Helper: minor unit multiplier
      function minorUnitMultiplier(currencyUpper) {
        switch (currencyUpper) {
          case "JOD": return 1000;
          case "USD": return 100;
          default: return 100;
        }
      }

      const ledger_currency_upper = String(booking.payment_currency || "JOD").trim().toUpperCase();

      const isDev = String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
      const platformChargeCurrencyLower = String(process.env.STRIPE_PLATFORM_CHARGE_CURRENCY || "usd").trim().toLowerCase();
      const forceCurrencyLower = String(process.env.STRIPE_FORCE_CURRENCY || "").trim().toLowerCase();

      const charge_currency_lower = (isDev && forceCurrencyLower) ? forceCurrencyLower : platformChargeCurrencyLower;
      const charge_currency_upper = charge_currency_lower.toUpperCase();

      const ledger_multiplier = minorUnitMultiplier(ledger_currency_upper);
      const ledger_amount_minor = ledger_minor_num;

      const amountNumber = ledger_amount_minor / ledger_multiplier;

      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "Invalid derived ledger major amount from payment_amount_minor (ledger)",
          ledger_currency: ledger_currency_upper,
          ledger_multiplier: String(ledger_multiplier),
          payment_amount_minor: String(ledger_amount_minor),
          payment_amount_major_derived: String(amountNumber)
        });
      }

      let fx_rate_estimate = null;
      let fx_rate_source = null;

      let charge_amount_major = amountNumber;

      if (ledger_currency_upper !== charge_currency_upper) {
        if (!(ledger_currency_upper === "JOD" && charge_currency_upper === "USD")) {
          await client.query("ROLLBACK");
          return res.status(500).json({
            ok: false,
            status: "error",
            message: "Unsupported FX path for Phase 8.1 (expected JOD->USD)",
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
            message: "FX_RATE_JOD_TO_USD missing or invalid (required for JOD ledger -> USD charge)",
            fx_raw: fxRaw
          });
        }

        fx_rate_estimate = fx;
        fx_rate_source = "env:FX_RATE_JOD_TO_USD";

        charge_amount_major = amountNumber * fx_rate_estimate;
      }

      const charge_multiplier = minorUnitMultiplier(charge_currency_upper);
      const charge_amount_minor = Math.round(charge_amount_major * charge_multiplier);

      if (!Number.isFinite(charge_amount_minor) || charge_amount_minor <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "Invalid computed Stripe charge amount minor",
          ledger_amount: String(amountNumber),
          ledger_currency: ledger_currency_upper,
          fx_rate_estimate: fx_rate_estimate === null ? null : String(fx_rate_estimate),
          charge_amount_major: String(charge_amount_major),
          charge_currency: charge_currency_upper,
          charge_multiplier: String(charge_multiplier),
          charge_amount_minor: String(charge_amount_minor)
        });
      }

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
                name: "AQUORIX Dive Booking",
                description: booking.guest_name
                  ? `Booking #${booking_id} for ${booking.guest_name} | Operator price: ${amountNumber} ${ledger_currency_upper} | Charged: ${charge_currency_upper} ${(charge_amount_minor / charge_multiplier).toFixed(2)}`
                  : `Booking #${booking_id} | Operator price: ${amountNumber} ${ledger_currency_upper}`
              }
            }
          }
        ],
        metadata: {
          booking_id: String(booking_id),
          operator_id: String(req.operator_id),
          session_id: String(session_id),
          headcount: String(requested),
          ledger_amount: String(amountNumber),
          ledger_currency: ledger_currency_upper,
          ledger_amount_minor: String(ledger_amount_minor),
          charge_currency: charge_currency_upper,
          charge_amount_minor: String(charge_amount_minor),
          fx_rate_estimate: fx_rate_estimate === null ? "" : String(fx_rate_estimate),
          fx_rate_source: fx_rate_source === null ? "" : String(fx_rate_source)
        }
      });

      if (!checkoutSession || !checkoutSession.id) {
        throw new Error("Stripe checkout session creation failed (no session id returned)");
      }

      await client.query(
        `
        UPDATE aquorix.dive_bookings
        SET
          stripe_checkout_session_id = $1,
          payment_amount_minor = $2,
          stripe_charge_currency = $3,
          stripe_charge_amount_minor = $4,
          fx_rate_estimate = $5::numeric,
          fx_rate_estimate_at = CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() END,
          fx_rate_source = $6::text,
          payment_checkout_created_at = now(),
          updated_at = now(),
          hold_expires_at = CASE
            WHEN hold_expires_at IS NULL OR hold_expires_at <= now()
            THEN now() + interval '15 minutes'
            ELSE hold_expires_at
          END
        WHERE booking_id = $7
          AND operator_id = $8
        `,
        [
          String(checkoutSession.id),
          String(ledger_amount_minor),
          charge_currency_upper,
          charge_amount_minor,
          fx_rate_estimate,
          fx_rate_source,
          booking_id,
          req.operator_id
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        status: "success",
        action: "checkout_created",
        booking_id: String(booking_id),
        stripe_checkout_session_id: String(checkoutSession.id),
        checkout_url: checkoutSession.url || null,
        ledger_amount: Number(amountNumber),
        ledger_currency: ledger_currency_upper,
        ledger_amount_minor: Number(ledger_amount_minor),
        charge_currency: charge_currency_upper,
        charge_amount_minor: Number(charge_amount_minor),
        fx_rate_estimate: fx_rate_estimate
      });

    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("[approve booking => stripe checkout] error:", e && e.stack ? e.stack : e);
      return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
    } finally {
      client.release();
    }
  });
};

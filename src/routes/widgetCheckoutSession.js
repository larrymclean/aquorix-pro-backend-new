
/*
 * AQUORIX Pro Backend - Widget Checkout Session Routes (Phase 9F)
 * File: widgetCheckoutSession.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/widgetCheckoutSession.js
 *
 * Description:
 *   Public widget route responsible for creating a Stripe Checkout session
 *   from an existing pending booking row in aquorix.dive_bookings.
 *
 *   This route is intentionally separated from widgetBookingsPending.js so
 *   booking creation and payment creation remain deterministic, auditable,
 *   and independently retryable operations.
 *
 *   Flow:
 *     Widget
 *       ↓
 *     POST /api/v1/widget/bookings/pending
 *       ↓
 *     booking_id created (pending/unpaid)
 *       ↓
 *     POST /api/v1/widget/bookings/:booking_id/checkout-session
 *       ↓
 *     Stripe Checkout Session created
 *       ↓
 *     stripe_checkout_session_id stored
 *       ↓
 *     checkoutUrl returned to widget
 *
 *   Currency Model (Phase 8/9 Doctrine):
 *     Ledger currency (operator truth): JOD
 *     Stripe charge currency: USD
 *     FX conversion: FX_RATE_JOD_TO_USD (env)
 *
 * Author: Larry McLean + ChatGPT (Lead Systems Architect)
 * Created: 2026-03-10
 * Version: 1.1.0
 *
 * Status: ACTIVE (Phase 9F Stripe Checkout Session Creation)
 *
 * Change Log (append-only):
 *   - 2026-03-10: v1.0.0
 *       Initial skeleton route for widget checkout session creation.
 *
 *   - 2026-03-10: v1.1.0
 *       Implement Stripe Checkout session creation.
 *       Added FX conversion logic (JOD ledger → USD Stripe charge).
 *       Persist stripe_checkout_session_id and payment_checkout_created_at.
 *       Return checkoutUrl for widget redirect.
 */

module.exports = function registerWidgetCheckoutSessionRoutes(app, deps) {
  const {
    pool,
    getStripeClient,
  } = deps || {};

  if (!app) {
    throw new Error("registerWidgetCheckoutSessionRoutes: app is required");
  }

  if (!pool) {
    throw new Error("registerWidgetCheckoutSessionRoutes: pool is required");
  }

  if (!getStripeClient) {
    throw new Error("registerWidgetCheckoutSessionRoutes: getStripeClient is required");
  }

  app.post("/api/v1/widget/bookings/:booking_id/checkout-session", async (req, res) => {
  try {

    const bookingId = Number(req.params.booking_id);

    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid booking_id",
        code: "BOOKING_ID_INVALID"
      });
    }

    const stripe = getStripeClient();

    const bookingResult = await pool.query(
      `
      SELECT
        booking_id,
        operator_id,
        session_id,
        guest_email,
        payment_amount_minor,
        payment_currency
      FROM aquorix.dive_bookings
      WHERE booking_id = $1
      LIMIT 1
      `,
      [bookingId]
    );

    if (!bookingResult.rows.length) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found",
        code: "BOOKING_NOT_FOUND"
      });
    }

    const booking = bookingResult.rows[0];

    const ledgerCurrency = String(booking.payment_currency || "JOD").trim().toUpperCase();
    const ledgerMinor = Number(booking.payment_amount_minor || 0);

    if (!Number.isFinite(ledgerMinor) || ledgerMinor <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid booking payment amount",
        code: "PAYMENT_AMOUNT_INVALID"
      });
    }

    const fxRaw = String(process.env.FX_RATE_JOD_TO_USD || "").trim();
    const fx = Number(fxRaw);

    if (!Number.isFinite(fx) || fx <= 0) {
      return res.status(500).json({
        ok: false,
        error: "FX_RATE_JOD_TO_USD not configured"
      });
    }

    const ledgerMajor = ledgerMinor / 1000; // JOD uses 3 minor units
    const chargeMajor = ledgerMajor * fx;

    const chargeMinor = Math.round(chargeMajor * 100); // USD minor units

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: "http://localhost:3001/api/v1/stripe/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3001/api/v1/stripe/cancel?session_id={CHECKOUT_SESSION_ID}",
      customer_email: booking.guest_email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: chargeMinor,
            product_data: {
              name: `AQUORIX Dive Booking #${bookingId}`
            }
          }
        }
      ],
      metadata: {
        booking_id: String(bookingId),
        operator_id: String(booking.operator_id),
        session_id: String(booking.session_id),
        ledger_currency: ledgerCurrency,
        ledger_amount_minor: String(ledgerMinor),
        charge_currency: "USD",
        charge_amount_minor: String(chargeMinor)
      }
    });

    await pool.query(
      `
      UPDATE aquorix.dive_bookings
      SET
        stripe_checkout_session_id = $1,
        payment_checkout_created_at = now()
      WHERE booking_id = $2
      `,
      [session.id, bookingId]
    );

    return res.json({
      ok: true,
      bookingId,
      checkoutUrl: session.url
    });

  } catch (err) {

    console.error(
      "[AQUORIX][widget/checkout-session] failed:",
      err && err.stack ? err.stack : err
    );

    return res.status(500).json({
      ok: false,
      error: "Widget checkout session creation failed"
    });
  }
});
};
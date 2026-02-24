/**
 * ============================================================================
 * AQUORIX — Payments Webhook Route
 * File: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/paymentsWebhook.js
 * Description:
 *   Stripe webhook receiver (raw body + signature verification).
 *   Handles checkout.session.completed as the authority for "paid".
 *   Enforces strict hold contract (airline integrity):
 *     - If payment arrives after hold expiry => paid + manual_review_required (NOT confirmed)
 *     - If payment arrives in time => paid + confirmed
 *
 * Created: 2026-02-24
 * Version: v8.3.0
 *
 * Environment:
 *   - STRIPE_WEBHOOK_SECRET (required)
 *
 * Change Log (append-only):
 *   - 2026-02-24 — v8.3.0
 *     - Create webhook route (raw body + Stripe signature verification)
 *     - Insert payment event (best-effort; non-blocking)
 *     - Confirm booking on payment when hold is valid
 *     - Flag manual review on late payment (strict hold contract)
 * ============================================================================
 */

const express = require("express");
const { getStripeClient } = require("../services/stripe");

/**
 * Factory: createPaymentsWebhookRouter({ pool })
 */
function createPaymentsWebhookRouter({ pool }) {
  if (!pool) throw new Error("createPaymentsWebhookRouter requires { pool }");

  const router = express.Router();

  // NOTE: Stripe requires RAW body for signature verification.
  // We mount this router with express.raw(...) at the server.js wiring site.

  router.post("/", async (req, res) => {
    const stripe = getStripeClient();

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[webhook] Missing STRIPE_WEBHOOK_SECRET");
      // Stripe will retry — but this is a server misconfig, return 500.
      return res.status(500).json({ ok: false, error: "server_misconfigured" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ ok: false, error: "missing_stripe_signature" });
    }

    let event;
    try {
      // req.body is a Buffer because server mounts express.raw
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("[webhook] Signature verification failed:", err && err.message ? err.message : err);
      return res.status(400).json({ ok: false, error: "invalid_signature" });
    }

    // Best-effort event logging (never blocks booking truth)
    // If the table/schema differs, we log and continue.
    await bestEffortInsertPaymentEvent(pool, event).catch((e) => {
      console.error("[webhook] payment_events insert best-effort failed:", e && e.message ? e.message : e);
    });

    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted({ pool, event });
          break;

        // You can add more Stripe event types later as needed.
        default:
          // Ignore unknown/unneeded events — must still return 2xx.
          break;
      }

      // IMPORTANT: Always return 2xx for processed/ignored events
      // so Stripe does not retry endlessly.
      return res.status(200).json({ ok: true });
    } catch (err) {
      // IMPORTANT: For runtime errors, still return 200 after logging,
      // but mark event as errored if possible (best-effort).
      console.error("[webhook] Handler error:", err && err.stack ? err.stack : err);

      await bestEffortMarkPaymentEventError(pool, event, err).catch((e) => {
        console.error("[webhook] payment_events mark error best-effort failed:", e && e.message ? e.message : e);
      });

      // Return 200 to prevent Stripe retry storms; ops can resolve via manual review.
      return res.status(200).json({ ok: true, warning: "handler_error_logged" });
    }
  });

  return router;
}

/**
 * checkout.session.completed handler
 * Strict hold contract:
 *   - If hold_expires_at < now => paid + manual_review_required, NOT confirmed
 *   - Else => paid + confirmed
 */
async function handleCheckoutSessionCompleted({ pool, event }) {
  const session = event.data && event.data.object ? event.data.object : null;
  if (!session) throw new Error("checkout.session.completed missing session object");

  const stripeCheckoutSessionId = String(session.id);

  // Prefer metadata.booking_id if present; fallback to lookup by checkout session id.
  const metadata = session.metadata || {};
  const bookingIdFromMetadata = metadata.booking_id ? String(metadata.booking_id) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Load booking row FOR UPDATE (idempotency + safety)
    const booking = await loadBookingForUpdate({
      client,
      bookingIdFromMetadata,
      stripeCheckoutSessionId,
    });

    if (!booking) {
      // Not found: log + exit (returning 2xx is correct; Stripe must not retry forever).
      console.error("[webhook] Booking not found for session:", stripeCheckoutSessionId, "metadata.booking_id:", bookingIdFromMetadata);
      await client.query("COMMIT");
      return;
    }

    // 2) Idempotency: if already paid, do nothing.
    // NOTE: We don’t know exact enums; assume 'paid' is used.
    if (String(booking.payment_status) === "paid") {
      await client.query("COMMIT");
      return;
    }

    // 3) Strict hold contract check (Option A)
    const now = new Date();
    const holdExpiresAt = booking.hold_expires_at ? new Date(booking.hold_expires_at) : null;

    const holdExpired = holdExpiresAt ? holdExpiresAt.getTime() <= now.getTime() : false;

    if (holdExpired) {
      // Payment arrived after hold expiry => PAID + manual review required, NOT confirmed.
      await client.query(
        `
        UPDATE aquorix.dive_bookings
           SET payment_status = 'paid',
               paid_at = NOW(),
               manual_review_required = true,
               manual_review_reason = $2,
               manual_review_flagged_at = NOW()
         WHERE booking_id = $1
        `,
        [
          booking.booking_id,
          "payment_received_after_hold_expiry",
        ]
      );

      await client.query("COMMIT");
      return;
    }

    // 4) Clean path: PAID + CONFIRMED
    await client.query(
      `
      UPDATE aquorix.dive_bookings
         SET payment_status = 'paid',
             paid_at = NOW(),
             booking_status = 'confirmed'
       WHERE booking_id = $1
      `,
      [booking.booking_id]
    );

    await client.query("COMMIT");

    // 5) Notifications: best-effort (never block booking truth)
    await bestEffortSendConfirmation(booking).catch((e) => {
      console.error("[webhook] confirmation best-effort failed:", e && e.message ? e.message : e);
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function loadBookingForUpdate({ client, bookingIdFromMetadata, stripeCheckoutSessionId }) {
  // Prefer metadata booking_id if we have it
  if (bookingIdFromMetadata) {
    const r = await client.query(
      `
      SELECT *
        FROM aquorix.dive_bookings
       WHERE booking_id = $1
       FOR UPDATE
      `,
      [bookingIdFromMetadata]
    );
    if (r.rows && r.rows[0]) return r.rows[0];
  }

  // Fallback: lookup by checkout session id
  const r2 = await client.query(
    `
    SELECT *
      FROM aquorix.dive_bookings
     WHERE stripe_checkout_session_id = $1
     FOR UPDATE
    `,
    [String(stripeCheckoutSessionId)]
  );
  return r2.rows && r2.rows[0] ? r2.rows[0] : null;
}

/**
 * payment_events: best-effort insert (non-blocking)
 * We intentionally keep this tolerant to schema differences.
 */
async function bestEffortInsertPaymentEvent(pool, event) {
  const eventId = String(event.id);
  const eventType = String(event.type);

  // Store JSON payload for audit. If the table differs, this will fail and be caught upstream.
  // If your schema is different, we will adjust after you show me \d aquorix.payment_events.
  const payload = JSON.stringify(event);

  await pool.query(
    `
    INSERT INTO aquorix.payment_events (event_id, event_type, stripe_payload_json, received_at, processing_status)
    VALUES ($1, $2, $3::jsonb, NOW(), 'received')
    ON CONFLICT (event_id) DO NOTHING
    `,
    [eventId, eventType, payload]
  );
}

async function bestEffortMarkPaymentEventError(pool, event, err) {
  const eventId = String(event.id);
  const message = err && err.message ? String(err.message).slice(0, 500) : "unknown_error";

  await pool.query(
    `
    UPDATE aquorix.payment_events
       SET processing_status = 'error',
           error_message = $2,
           processed_at = NOW()
     WHERE event_id = $1
    `,
    [eventId, message]
  );
}

/**
 * Best-effort confirmation messaging (never blocks booking confirmation).
 * If your notifications module exists, we’ll use it. If not, we just log.
 */
async function bestEffortSendConfirmation(bookingRow) {
  // Lazy require so missing module doesn't crash webhook.
  let notifications;
  try {
    // If you already have this service, great. If not, we just skip.
    notifications = require("../services/notifications");
  } catch (_e) {
    notifications = null;
  }

  if (!notifications || typeof notifications.sendConfirmation !== "function") {
    console.log("[webhook] confirmed booking (no notifications module wired):", bookingRow.booking_id);
    return;
  }

  await notifications.sendConfirmation({
    booking_id: bookingRow.booking_id,
    guest_name: bookingRow.guest_name,
    guest_email: bookingRow.guest_email,
    guest_phone: bookingRow.guest_phone,
    // NOTE: Add session details later once purchase endpoint provides itinerary/session context cleanly.
    channels: ["whatsapp", "email", "sms"],
  });
}

module.exports = { createPaymentsWebhookRouter };

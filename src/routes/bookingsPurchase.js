/*
 * AQUORIX Pro Backend - Booking Purchase Routes (Phase 8.3 / Standard Lane)
 * File: bookingsPurchase.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/bookingsPurchase.js
 * Description:
 *   Gate 3 (Standard Lane): Buy -> Pay -> Confirm
 *   This endpoint creates a booking + Stripe Checkout session immediately (no operator approval step).
 *
 * Product Law:
 *   - Standard lane is customer self-service checkout
 *   - Webhook is the sole confirmer of 'confirmed' status
 *
 * CRITICAL INVARIANT (DB footgun mitigation):
 *   dive_bookings.booking_status DEFAULT is 'confirmed' in DB
 *   Therefore ALL booking inserts MUST explicitly set:
 *     booking_status = 'pending'
 *     payment_status = 'unpaid'
 *
 * Author: Larry McLean
 * Created: 2026-02-25
 * Version: 1.0.0
 *
 * Status: ACTIVE (Phase 8.3)
 *
 * Change Log (append-only):
 *   - 2026-02-25: v1.0.0 - Initial standard purchase endpoint: create booking + checkout immediately
 */

const { toMinorUnits, normalizeCurrency, minorToMajorDisplay } = require("../lib/money");

module.exports = function registerBookingsPurchaseRoutes(app, deps) {
  const {
    pool,
    requireAuthUser,
    HOLD_WINDOW_MINUTES,
    getStripeClient,
    getOperatorDefaultCapacity,
    getCapacityConsumedForSession,
  } = deps;

  if (!app) throw new Error("registerBookingsPurchaseRoutes: app is required");
  if (!pool) throw new Error("registerBookingsPurchaseRoutes: pool is required");
  if (!getStripeClient) throw new Error("registerBookingsPurchaseRoutes: getStripeClient is required");
  if (!getOperatorDefaultCapacity) throw new Error("registerBookingsPurchaseRoutes: getOperatorDefaultCapacity is required");
  if (!getCapacityConsumedForSession) throw new Error("registerBookingsPurchaseRoutes: getCapacityConsumedForSession is required");

  // Optional (depends on your client auth shape). We keep it consistent with existing route modules.
  const authMiddleware = requireAuthUser ? requireAuthUser : (req, _res, next) => next();

  // ---------------------------------------------------------------------------
  // Phase 8.3 / Gate 3: Standard Lane Purchase
  // POST /api/v1/bookings/purchase
  // Creates booking + Stripe checkout immediately (no approval step)
  // ---------------------------------------------------------------------------
  app.post("/api/v1/bookings/purchase", authMiddleware, async (req, res) => {
    // Env guardrails (explicit)
    const successUrl = process.env.STRIPE_SUCCESS_URL;
    const cancelUrl = process.env.STRIPE_CANCEL_URL;

    if (!successUrl || !String(successUrl).trim()) {
      return res.status(500).json({ ok: false, status: "error", message: "STRIPE_SUCCESS_URL missing from environment" });
    }
    if (!cancelUrl || !String(cancelUrl).trim()) {
      return res.status(500).json({ ok: false, status: "error", message: "STRIPE_CANCEL_URL missing from environment" });
    }

    const body = (req && req.body) ? req.body : {};

    // -----------------------------
    // 1) Inputs (deterministic)
    // -----------------------------
    const session_id = body.session_id;

    const first_name = body.first_name ? String(body.first_name).trim() : null;
    const last_name = body.last_name ? String(body.last_name).trim() : null;

    const guest_email = body.guest_email ? String(body.guest_email).trim() : null;
    const guest_phone = body.guest_phone ? String(body.guest_phone).trim() : null;

    const source = body.source ? String(body.source).trim() : "website";

    const certification_level = body.certification_level ? String(body.certification_level).trim() : null;
    const certification_agency = body.certification_agency ? String(body.certification_agency).trim() : null;
    const cert_ack = body.cert_acknowledged;

    const headcountRaw = body.headcount;
    const headcountParsed = (headcountRaw === undefined || headcountRaw === null || headcountRaw === "")
      ? 1
      : Number(headcountRaw);

    if (!session_id) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "session_id is required" });
    }

    // Headcount: integer 1..50
    if (!Number.isFinite(headcountParsed) || !Number.isInteger(headcountParsed) || headcountParsed < 1 || headcountParsed > 50) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "headcount must be an integer between 1 and 50" });
    }
    const headcount = headcountParsed;

    // Identity required (Owner locked)
    if (!first_name || !last_name) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "first_name and last_name are required" });
    }
    if (!guest_email) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "guest_email is required" });
    }
    if (!guest_phone) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "guest_phone is required" });
    }

    // Certification MVP (Owner locked)
    if (!certification_level) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "certification_level is required" });
    }
    if (cert_ack !== true) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "cert_acknowledged must be true" });
    }

    // Guest display name (denormalized snapshot on booking)
    const guest_name = `${first_name} ${last_name}`.trim();

    // Phone uniqueness toggle (Owner locked: toggleable, not DB-enforced now)
    const enforceUniquePhone = String(process.env.AQX_ENFORCE_UNIQUE_PHONE || "").trim().toLowerCase() === "true";

    // Stripe (lazy init)
    let stripe;
    try {
      stripe = getStripeClient();
    } catch (e) {
      return res.status(500).json({
        ok: false,
        status: "error",
        message: "Stripe is not configured on this server (missing STRIPE_SECRET_KEY)."
      });
    }

    // Helper: minor unit multiplier (match approve logic)
    function minorUnitMultiplier(currencyUpper) {
      switch (currencyUpper) {
        case "JOD": return 1000;
        case "USD": return 100;
        default: return 100;
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // -----------------------------
      // 2) Load session truth (operator derived server-side)
      // -----------------------------
      const s = await client.query(
        `
        SELECT
          session_id,
          operator_id,
          itinerary_id,
          price_per_diver,
          session_currency,
          cancelled_at
        FROM aquorix.dive_sessions
        WHERE session_id = $1
        LIMIT 1
        `,
        [session_id]
      );

      if (s.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, status: "not_found", message: "Session not found" });
      }

      const session = s.rows[0];

      if (session.cancelled_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, status: "conflict", message: "Session is cancelled" });
      }

      const operator_id = session.operator_id;
      const itinerary_id = session.itinerary_id;

      if (!operator_id) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, status: "error", message: "Session missing operator_id; cannot purchase" });
      }
      if (!itinerary_id) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, status: "error", message: "Session missing itinerary_id; cannot purchase" });
      }

      if (session.price_per_diver === null || typeof session.price_per_diver === "undefined") {
        await client.query("ROLLBACK");
        return res.status(409).json({ ok: false, status: "conflict", message: "Session is not priced yet" });
      }

      const currency = normalizeCurrency(session.session_currency);
      if (!currency) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, status: "error", message: "Invalid session currency configuration" });
      }

      // -----------------------------
      // 3) Capacity enforcement (confirmed + active holds)
      // -----------------------------
      const capacity = await getOperatorDefaultCapacity(operator_id);
      const consumed = await getCapacityConsumedForSession(client, operator_id, Number(session_id));

      if (consumed + headcount > capacity) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          status: "conflict",
          message: "Over capacity for this session",
          capacity,
          capacity_consumed: consumed,
          requested_headcount: headcount
        });
      }

      // -----------------------------
      // 4) Guest identity upsert (email unique always; phone uniqueness optional)
      // -----------------------------
      if (enforceUniquePhone) {
        const p = await client.query(
          `
          SELECT guest_id, email
          FROM aquorix.guest_identities
          WHERE phone = $1
          LIMIT 1
          `,
          [guest_phone]
        );
        if (p.rowCount > 0) {
          const row = p.rows[0];
          const existingEmail = row.email ? String(row.email) : null;
          if (existingEmail && existingEmail.toLowerCase() !== String(guest_email).toLowerCase()) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              ok: false,
              status: "conflict",
              message: "Phone number already registered to a different email",
              code: "PHONE_NOT_UNIQUE"
            });
          }
        }
      }

      // Email UNIQUE is enforced by DB; we upsert to keep identity fresh
      const gi = await client.query(
        `
        INSERT INTO aquorix.guest_identities (email, phone, first_name, last_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE
          SET phone = EXCLUDED.phone,
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              updated_at = now()
        RETURNING guest_id
        `,
        [guest_email, guest_phone, first_name, last_name]
      );

      const guest_id = gi.rows[0].guest_id;

      // -----------------------------
      // 5) Pricing snapshot (authoritative minor units)
      // -----------------------------
      const pricePerDiverMajorStr = String(session.price_per_diver);

      const t = await client.query(
        `SELECT ($1::numeric * $2::int)::numeric(12,3) AS total_major`,
        [pricePerDiverMajorStr, headcount]
      );

      const totalMajorStr = String(t.rows[0].total_major);
      const totalMinorStr = toMinorUnits(totalMajorStr, currency); // bigint string
      const displayMajor = minorToMajorDisplay(totalMinorStr, currency, 2);

      // -----------------------------
      // 6) Create booking row (MUST override defaults)
      // -----------------------------
      const now = new Date();
      const holdExpiresAt = new Date(now.getTime() + (Number(HOLD_WINDOW_MINUTES) || 10) * 60 * 1000);

      const b = await client.query(
        `
        INSERT INTO aquorix.dive_bookings (
          operator_id,
          itinerary_id,
          session_id,
          headcount,
          guest_name,
          guest_email,
          guest_phone,
          source,
          booking_status,
          payment_status,
          hold_expires_at,
          payment_currency,
          payment_amount_minor,
          payment_amount,
          certification_level
        )
        VALUES (
          $1, $2, $3,
          $4,
          $5, $6, $7,
          $8,
          'pending',
          'unpaid',
          $9,
          $10,
          $11::bigint,
          $12::numeric(10,2),
          $13
        )
        RETURNING booking_id
        `,
        [
          operator_id,
          itinerary_id,
          session_id,
          headcount,
          guest_name,
          guest_email,
          guest_phone,
          source,
          holdExpiresAt,
          currency,
          totalMinorStr,
          displayMajor,
          certification_level
        ]
      );

      const booking_id = b.rows[0].booking_id;

      // -----------------------------
      // 7) Stripe charge calculation (reuse approve policy)
      // -----------------------------
      const ledger_currency_upper = String(currency).trim().toUpperCase();

      const isDev = String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
      const platformChargeCurrencyLower = String(process.env.STRIPE_PLATFORM_CHARGE_CURRENCY || "usd").trim().toLowerCase();
      const forceCurrencyLower = String(process.env.STRIPE_FORCE_CURRENCY || "").trim().toLowerCase();

      const charge_currency_lower = (isDev && forceCurrencyLower) ? forceCurrencyLower : platformChargeCurrencyLower;
      const charge_currency_upper = charge_currency_lower.toUpperCase();

      const ledger_multiplier = minorUnitMultiplier(ledger_currency_upper);
      const ledger_amount_minor_num = Number(totalMinorStr);
      const amountNumber = ledger_amount_minor_num / ledger_multiplier;

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
          ledger_amount_major_derived: String(amountNumber),
          ledger_currency: ledger_currency_upper,
          fx_rate_estimate: fx_rate_estimate === null ? null : String(fx_rate_estimate),
          charge_amount_major: String(charge_amount_major),
          charge_currency: charge_currency_upper,
          charge_amount_minor: String(charge_amount_minor)
        });
      }

      // -----------------------------
      // 8) Create Stripe Checkout session immediately
      // -----------------------------
      const checkout = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: String(successUrl),
        cancel_url: String(cancelUrl),
        customer_email: String(guest_email),
        line_items: [
          {
            price_data: {
              currency: charge_currency_lower,
              unit_amount: charge_amount_minor,
              product_data: {
                name: `AQUORIX Dive Booking (Session ${session_id})`
              }
            },
            quantity: 1
          }
        ],
        metadata: {
          booking_id: String(booking_id),
          operator_id: String(operator_id),
          session_id: String(session_id),
          guest_id: String(guest_id)
        }
      });

      const stripe_checkout_session_id = checkout && checkout.id ? String(checkout.id) : null;

      if (!stripe_checkout_session_id) {
        await client.query("ROLLBACK");
        return res.status(500).json({ ok: false, status: "error", message: "Stripe checkout did not return session id" });
      }

      // -----------------------------
      // 9) Persist checkout + FX info to booking (authoritative)
      // -----------------------------
      await client.query(
        `
        UPDATE aquorix.dive_bookings
        SET
          stripe_checkout_session_id = $1,
          payment_checkout_created_at = now(),
          stripe_charge_currency = $2,
          stripe_charge_amount_minor = $3::bigint,
          fx_rate_estimate = $4::numeric(12,6),
          fx_rate_estimate_at = CASE WHEN $4 IS NULL THEN NULL ELSE now() END,
          fx_rate_source = $5
        WHERE booking_id = $6
        `,
        [
          stripe_checkout_session_id,
          charge_currency_upper,
          String(charge_amount_minor),
          fx_rate_estimate === null ? null : fx_rate_estimate,
          fx_rate_source,
          booking_id
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        ok: true,
        status: "success",
        action: "checkout_created",
        booking_id: String(booking_id),
        checkout_url: checkout && checkout.url ? checkout.url : null,
        stripe_checkout_session_id,
        operator_id: String(operator_id),
        session_id: String(session_id),
        itinerary_id: String(itinerary_id),
        payment_currency: ledger_currency_upper,
        payment_amount_minor: String(totalMinorStr),
        stripe_charge_currency: charge_currency_upper,
        stripe_charge_amount_minor: String(charge_amount_minor)
      });

    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_e) {}
      console.error("[bookingsPurchase] error:", err && err.stack ? err.stack : err);

      // Helpful conflict message for email uniqueness
      const msg = String(err && err.message ? err.message : "");
      if (msg.toLowerCase().includes("guest_identities_email_key")) {
        return res.status(409).json({ ok: false, status: "conflict", message: "Email already exists (unique)" });
      }

      return res.status(500).json({ ok: false, status: "error", message: "Purchase failed" });
    } finally {
      client.release();
    }
  });
};

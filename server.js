/*
 * AQUORIX Pro Backend Server
 * File: server.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/server.js
 * Description: Express server for AQUORIX Pro Dashboard + Public Widgets
 *
 * Author: Larry McLean
 * Created: 2025-07-01
 * Version: 1.2.8
 *
 * Last Updated: 2026-02-21
 * Status: ACTIVE (Local-first Dev / Phase 4-8)
 *
 * Change Log (append-only):
 *   - 2025-07-01: v1.0.0 - Initial setup with /api/health endpoint
 *   - 2025-07-01: v1.0.0 - Added CORS middleware for http://localhost:3004
 *   - 2025-07-01: v1.0.0 - Added .gitignore to exclude node_modules
 *   - 2025-07-02: v1.0.1 - Added PostgreSQL connection pool (pg) (local/dev)
 *   - 2025-07-03: v1.0.2 - Added GET /api/users endpoint for CRUD operations
 *   - 2025-07-03: v1.0.3 - Added POST /api/sensors endpoint for CRUD operations
 *   - 2025-07-03: v1.0.4 - Added GET /api/alerts endpoint for CRUD operations
 *   - 2025-07-03: v1.0.5 - Added error handling to /api/health endpoint
 *   - 2025-07-03: v1.0.5 - Added onboarding router for /api/onboarding endpoint
 *   - 2025-09-19: v1.0.6 - Fixed middleware order; removed duplicate middleware
 *   - 2026-02-04: v1.0.7 - Replace entire CORS block for live vs localhost
 *   - 2026-02-06: v1.0.8 - Add ui_mode + permissions to the existing JSON response
 *   - 2026-02-07: v1.0.9 - Allow localhost:3500 for local dev CORS
 *   - 2026-02-12: v1.1.0 - Add Public Schedule Widget endpoint (read-only)
 *   - 2026-02-12: v1.1.0 - Add Cache-Control header (public, max-age=300) for widget responses
 *   - 2026-02-12: v1.1.0 - Cleanup: remove accidental terminal artifact '%' from file
 *   - 2026-02-14: v1.2.0 - M4: Dashboard scheduling endpoints (scoped CRUD + cancel); auth-derived operator scope; widget excludes cancelled sessions
 *   - 2026-02-14: v1.2.1 - Add DB fingerprint log at startup; enforce multi-affiliation 409; enhance dashboard schedule payload w/ itineraries + teams + vessels joins
 *   - 2026-02-16: v1.2.2 - Phase 6: Add operator selection endpoint; requireDashboardScope honors users.active_operator_id for multi-affiliation users
 *   - 2026-02-17: v1.2.3 - Phase 6: Phase 6 hardening
 *   - 2026-02-18: v1.2.4 - Phase 7: POST /api/v1/bookings/request (pending) + best-effort notifications (email + WhatsApp) logged to aquorix.notifications
 *   - 2026-02-18: v1.2.5 - Phase 7: GET /api/v1/dashboard/bookings (scoped, week_start aware, pending-first sort)
 *   - 2026-02-18: v1.2.6 - Phase 7: Dashboard operator capacity GET/PATCH endpoints + operator capacity helper
 *   - 2026-02-19: v1.2.7 - Phase 7: Add HOLD to booking request (minimal, safe, immediate value)
 *   - 2026-02-20: v1.2.8 - Phase 8: Approve Booking => Stripe Checkout (payment spine) + idempotent checkout session creation
 *   - 2026-02-21: v1.2.8 - Phase 8.1: Dual-currency policy (ledger JOD, charge USD) + FX estimate + store stripe_charge_* + fx_rate_* fields
 *   - 2026-02-21: v1.2.8 - Phase 8.1: Fix Postgres param typing for nullable FX fields (explicit casts)
 *  - 2026-02-21: v1.2.8 - Phase 8.1: Dual-currency Stripe Checkout (JOD ledger + USD charge) with FX estimate + minor-unit hardening (JOD=3, USD=2); store stripe_charge_* + fx_rate_* fields; approve endpoint returns ledger + charge amounts; idempotent checkout retrieval
 */

require('dotenv').config();

const HOLD_WINDOW_MINUTES = Number(process.env.HOLD_WINDOW_MINUTES || 10);

const express = require('express');
const cors = require('cors');

const pool = require('./src/lib/pool');
const { getSupabaseUserIdFromBearer } = require('./src/lib/jwt');
const { requireAuthUserFactory } = require('./src/middleware/requireAuthUser');
const { requireDashboardScopeFactory } = require('./src/middleware/requireDashboardScope');

const { getStripeClient } = require('./src/services/stripe');

// -----------------------------------------------------------------------------
// Phase 7 (Viking): Notifications + DB Notification Store
// -----------------------------------------------------------------------------
const notifications = require("./src/services/notifications");
const notificationStore = require("./src/services/notificationStore");

const app = express();
const port = process.env.PORT || 3001;

// -----------------------------------------------------------------------------
// MIDDLEWARE SETUP - Must come before route registration
// -----------------------------------------------------------------------------

const ALLOWED_ORIGINS = new Set([
  "https://aquorix-frontend.onrender.com",
  "https://aquorix-frontend-dev.onrender.com",
  "http://localhost:3000",
  "http://localhost:3500",
]);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

async function logDbFingerprint() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS db_name,
        inet_server_addr() AS server_ip,
        inet_server_port() AS server_port,
        current_setting('server_version_num') AS server_version_num,
        current_user AS db_user
    `);

    const fp = result.rows && result.rows[0] ? result.rows[0] : null;

    console.log("------------------------------------------------------------");
    console.log("[AQUORIX DB FINGERPRINT]");
    console.log(fp);
    console.log("------------------------------------------------------------");
  } catch (err) {
    console.error("[AQUORIX DB FINGERPRINT] FAILED:", err && err.stack ? err.stack : err);
  }
}

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
    return;
  }
  console.log('Connected to PostgreSQL database');
  release();

  // fingerprint log (startup)
  await logDbFingerprint();
});

const requireAuthUser = requireAuthUserFactory({ pool });
const requireDashboardScope = requireDashboardScopeFactory({ pool });

// -----------------------------------------------------------------------------
// Phase 7: Operator Capacity (Viking Configurable)
// - Stored in aquorix.diveoperators.operator_default_capacity
// - Fallback: env VIKING_OPERATOR_DEFAULT_CAPACITY (default 20)
// -----------------------------------------------------------------------------
async function getOperatorDefaultCapacity(operator_id) {
  const fallbackRaw = process.env.VIKING_OPERATOR_DEFAULT_CAPACITY;
  const fallback = Number.isFinite(Number(fallbackRaw)) ? Number(fallbackRaw) : 20;

  try {
    const r = await pool.query(
      `
      SELECT operator_default_capacity
      FROM aquorix.diveoperators
      WHERE operator_id = $1
      LIMIT 1
      `,
      [operator_id]
    );

    if (r.rowCount === 0) return fallback;

    const v = r.rows[0].operator_default_capacity;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;

    return fallback;
  } catch (e) {
    console.error("[getOperatorDefaultCapacity] failed; using fallback:", e);
    return fallback;
  }
}

async function getCapacityConsumedForSession(clientOrPool, operator_id, session_id) {
  const r = await clientOrPool.query(
    `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN booking_status = 'confirmed' THEN headcount
          WHEN booking_status = 'pending'
            AND payment_status = 'unpaid'
            AND hold_expires_at IS NOT NULL
            AND hold_expires_at > now()
          THEN headcount
          ELSE 0
        END
      ), 0) AS capacity_consumed
    FROM aquorix.dive_bookings
    WHERE operator_id = $1
      AND session_id = $2
    `,
    [operator_id, session_id]
  );

  return Number(r.rows[0].capacity_consumed || 0);
}

// -----------------------------------------------------------------------------
// ROUTE REGISTRATION - After middleware setup
// -----------------------------------------------------------------------------

const onboardingRouter = require('./src/routes/onboarding');
app.use('/api/onboarding', onboardingRouter);

// -----------------------------------------------------------------------------
// /api/v1/me (Routing Authority)
// -----------------------------------------------------------------------------

app.get('/api/v1/me', async (req, res) => {
  const supabase_user_id = getSupabaseUserIdFromBearer(req.headers.authorization);

  if (!supabase_user_id) {
    return res.status(401).json({ ok: false, error: 'Missing or invalid Bearer token' });
  }

  let client;
  try {
    client = await pool.connect();

    const result = await client.query(
      `
      SELECT
        u.user_id,
        u.supabase_user_id,
        u.email,
        u.role,
        u.tier,
        u.is_active,
        u.active_operator_id,
        p.first_name,
        p.last_name,
        p.tier_level,
        p.onboarding_metadata,
        p.onboarding_completed_at
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
      LIMIT 1
      `,
      [supabase_user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const row = result.rows[0];

        // -----------------------------------------------------------------
    // PHASE 6: Operator Context Resolution
    // -----------------------------------------------------------------

    // 1) Fetch active affiliations for this user
    const affResult = await client.query(
      `
      SELECT
        uoa.operator_id,
        uoa.affiliation_type,
        d.name,
        d.operator_slug
      FROM aquorix.user_operator_affiliations uoa
      JOIN aquorix.diveoperators d
        ON d.operator_id = uoa.operator_id
      WHERE uoa.user_id = $1
        AND uoa.active = true
      ORDER BY uoa.updated_at DESC, uoa.created_at DESC
      `,
      [row.user_id]
    );

    const affiliations = affResult.rows.map(a => ({
      operator_id: a.operator_id,
      name: a.name,
      slug: a.operator_slug,
      role: a.affiliation_type
    }));

    const affiliation_count = affiliations.length;

    // 2) Determine active operator id (nullable)
    const active_operator_id = row.active_operator_id || null;

    const onboardingMeta = row.onboarding_metadata || {};
    const completionPctRaw = onboardingMeta.completion_percentage;
    const completionPct = Number.isFinite(Number(completionPctRaw)) ? Number(completionPctRaw) : null;

    const isComplete =
      Boolean(row.onboarding_completed_at) ||
      (completionPct !== null && completionPct >= 100) ||
      onboardingMeta.is_complete === true;

    let routing_hint = isComplete ? 'dashboard' : 'dashboard';

    const role = String(row.role || '').toLowerCase();
    if (role === 'admin') {
      routing_hint = 'admin';
    } else if (!isComplete && (onboardingMeta && onboardingMeta.current_step != null)) {
      routing_hint = 'onboarding';
    }

    const tier = String(row.tier || '').toLowerCase();
    const tierLevel = Number(row.tier_level) || 1;

    let ui_mode = 'pro';
    if (role === 'admin') {
      ui_mode = 'admin';
    } else if (tier === 'affiliate' || tierLevel >= 5) {
      ui_mode = 'affiliate';
    } else {
      ui_mode = 'pro';
    }

    let permissions = {
      can_use_admin_tools: false,
      can_use_operator_tools: false,
      can_use_affiliate_tools: false,
      can_view_schedule: false,
      can_edit_profile: false,
      can_manage_operator: false,
      can_edit: false,
      can_approve: false,
      can_modify_config: false
    };

    if (ui_mode === 'admin') {
      permissions = { ...permissions, can_use_admin_tools: true, can_modify_config: true };
    } else if (ui_mode === 'affiliate') {
      permissions = { ...permissions, can_use_affiliate_tools: true };
    } else {
      permissions = { ...permissions, can_use_operator_tools: true, can_view_schedule: true, can_edit_profile: true };
    }

    return res.json({
      ok: true,
      routing_hint,
      ui_mode,
      permissions,
      user: {
        supabase_user_id: row.supabase_user_id,
        email: row.email,
        role: row.role,
        tier: row.tier,
        is_active: row.is_active
      },
      profile: {
        first_name: row.first_name,
        last_name: row.last_name,
        tier_level: row.tier_level
      },
      onboarding: {
        is_complete: isComplete,
        metadata: onboardingMeta
      },

      // -----------------------------
      // NEW: Operator Context
      // -----------------------------
      operator_context: {
        affiliation_count,
        active_operator_id,
        affiliations
      }
    });

  } catch (err) {
    console.error('[api/v1/me] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
});


// -----------------------------------------------------------------------------
// Phase 6: Set Active Operator (multi-affiliation operator selection)
// POST /api/v1/operator/active
// Body: { "operator_id": 145 }
// Rules:
// - Caller must be an authenticated AQUORIX user (requireAuthUser)
// - operator_id must be one of the caller's ACTIVE affiliations
// - Sets aquorix.users.active_operator_id
// -----------------------------------------------------------------------------
app.post("/api/v1/operator/active", requireAuthUser, async (req, res) => {
  const operator_id_raw = req.body?.operator_id;

  const operator_id = Number(operator_id_raw);
  if (!Number.isFinite(operator_id) || operator_id <= 0) {
    return res.status(400).json({
      ok: false,
      status: "bad_request",
      message: "operator_id must be a positive number"
    });
  }

  try {
    // Confirm the operator is one of this user's active affiliations
    const aff = await pool.query(
      `
      SELECT 1
      FROM aquorix.user_operator_affiliations
      WHERE user_id = $1
        AND operator_id = $2
        AND active = true
      LIMIT 1
      `,
      [req.aquorix_user_basic.user_id, operator_id]
    );

    if (aff.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        status: "forbidden",
        message: "operator_id is not an active affiliation for this user"
      });
    }

    // Set active operator
    await pool.query(
      `
      UPDATE aquorix.users
      SET active_operator_id = $2,
          updated_at = now()
      WHERE user_id = $1
      `,
      [req.aquorix_user_basic.user_id, operator_id]
    );

    return res.json({
      ok: true,
      status: "success",
      active_operator_id: String(operator_id)
    });
  } catch (err) {
    console.error("[POST /api/v1/operator/active] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// PHASE 7 (VIKING): BOOKINGS - Request (Public / Widget / Internal Test)
// POST /api/v1/bookings/request
//
// Rules:
// - Never accept operator_id from client. Derive from dive_sessions.
// - Insert booking first (MUST succeed even if notifications fail).
// - Notifications are best-effort and ALWAYS logged to aquorix.notifications.
// - booking_status uses enum values: confirmed | pending | cancelled
// -----------------------------------------------------------------------------
app.post("/api/v1/bookings/request", async (req, res) => {
  const {
    session_id,
    guest_name,
    guest_email,
    guest_phone,
    headcount,
    special_requests,
    source
  } = req.body || {};

  // 1) Validate required fields (matches your CHECK constraint)
  const sidNum = Number(session_id);
  if (!Number.isFinite(sidNum) || sidNum <= 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "session_id must be a positive number" });
  }

  if (!guest_name || String(guest_name).trim().length === 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "guest_name is required" });
  }

  if (!guest_email || String(guest_email).trim().length === 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "guest_email is required" });
  }

  const guest_email_normalized = String(guest_email).trim().toLowerCase();

  const hc = headcount === undefined || headcount === null ? 1 : Number(headcount);
  if (!Number.isFinite(hc) || hc <= 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "headcount must be a positive number" });
  }

  // Source defaults to 'website' to match your table default convention
  const src = (source && String(source).trim().length > 0) ? String(source).trim() : "website";

  let operator_id = null;
  let itinerary_id = null;
  let dive_datetime = null;

  try {
    // 2) Resolve session → derive operator_id + itinerary_id
    const s = await pool.query(
      `
      SELECT session_id, operator_id, itinerary_id, dive_datetime
      FROM aquorix.dive_sessions
      WHERE session_id = $1 AND cancelled_at IS NULL
      LIMIT 1
      `,
      [sidNum]
    );

    if (s.rowCount === 0) {
      return res.status(404).json({ ok: false, status: "not_found", message: "Session not found (or cancelled)" });
    }

    operator_id = s.rows[0].operator_id;
    itinerary_id = s.rows[0].itinerary_id;
    dive_datetime = s.rows[0].dive_datetime;

    // 3) Insert booking (MUST succeed even if notifications fail)
    const b = await pool.query(
      `
      INSERT INTO aquorix.dive_bookings
        (itinerary_id, operator_id, booking_status, session_id, headcount, guest_name, guest_email, guest_phone, special_requests, source, hold_expires_at, created_at, updated_at)
      VALUES
        ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, now() + ($10::int * interval '1 minute'), now(), now())
      RETURNING booking_id
      `,
      [
        itinerary_id,
        operator_id,
        sidNum,
        hc,
        String(guest_name).trim(),
        guest_email_normalized,
        guest_phone ? String(guest_phone).trim() : null,
        special_requests ? String(special_requests).trim() : null,
        src,
        HOLD_WINDOW_MINUTES
      ]
    );

    const booking_id = b.rows[0].booking_id;

    // 4) Best-effort notifications (DO NOT block response)
    // WhatsApp (operator)
    (async () => {
      const waBody =
        `NEW BOOKING REQUEST\n\n` +
        `${String(guest_name).trim()}\n` +
        `Party of ${hc}\n` +
        `Session ID: ${sidNum}\n\n` +
        `Approve in AQUORIX dashboard`;

      try {
        const waResp = await notifications.sendOperatorWhatsApp({ body: waBody });

        await notificationStore.logSent(pool, {
          recipient_type: "operator",
          recipient_email: waResp.to || process.env.VIKING_TEST_WHATSAPP_TO || "whatsapp:unknown",
          event_type: "booking_request.operator.whatsapp",
          subject: null,
          body: waBody,
          booking_id,
          session_id: sidNum,
          operator_id
        });
        } catch (e) {
        try {
          await notificationStore.logFailed(pool, {
            recipient_type: "operator",
            recipient_email: process.env.VIKING_TEST_WHATSAPP_TO || "whatsapp:unknown",
            event_type: "booking_request.operator.whatsapp",
            subject: null,
            body: waBody,
            error_message: e && e.message ? e.message : String(e),
            booking_id,
            session_id: sidNum,
            operator_id
          });
        } catch (logErr) {
          console.error("[bookings/request] whatsapp notify failed AND logFailed failed:", logErr);
        }
      }

    })();

    // Email (operator)
    (async () => {
      const subject = `New Booking Request - ${String(guest_name).trim()} (${hc})`;
      const html = `
        <h2>New Booking Request</h2>
        <p><b>Guest:</b> ${String(guest_name).trim()}</p>
        <p><b>Headcount:</b> ${hc}</p>
        <p><b>Session ID:</b> ${sidNum}</p>
        ${dive_datetime ? `<p><b>Dive Time:</b> ${String(dive_datetime)}</p>` : ``}
        ${guest_phone ? `<p><b>Phone:</b> ${String(guest_phone).trim()}</p>` : ``}
        <p><b>Email:</b> ${String(guest_email).trim()}</p>
        ${special_requests ? `<p><b>Special Requests:</b><br/>${String(special_requests).trim()}</p>` : ``}
        <hr/>
        <p>Review in the AQUORIX dashboard.</p>
      `;

      try {
        const emResp = await notifications.sendOperatorEmail({ subject, html });

        await notificationStore.logSent(pool, {
          recipient_type: "operator",
          recipient_email: process.env.VIKING_OPERATOR_NOTIFICATION_EMAIL || "operator_email:unknown",
          event_type: "booking_request.operator.email",
          subject,
          body: html,
          booking_id,
          session_id: sidNum,
          operator_id
        });
            } catch (e) {
        try {
          await notificationStore.logFailed(pool, {
            recipient_type: "operator",
            recipient_email: process.env.VIKING_OPERATOR_NOTIFICATION_EMAIL || "operator_email:unknown",
            event_type: "booking_request.operator.email",
            subject,
            body: html,
            error_message: e && e.message ? e.message : String(e),
            booking_id,
            session_id: sidNum,
            operator_id
          });
        } catch (logErr) {
          console.error("[bookings/request] email notify failed AND logFailed failed:", logErr);
        }
      }

    })();

    // 5) Respond immediately (do NOT wait for notifications)
    return res.status(201).json({
      ok: true,
      status: "created",
      booking_id: String(booking_id),
      booking_status: "pending"
    });

  } catch (err) {
    console.error("[POST /api/v1/bookings/request] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// PHASE 7 (VIKING): DASHBOARD BOOKINGS LIST (Scoped to active operator)
// GET /api/v1/dashboard/bookings?week_start=YYYY-MM-DD
//
// Rules:
// - requireDashboardScope enforces operator_id (no bleed)
// - week_start validation identical to schedule endpoints
// - stable sort: pending first, then dive_datetime, then created_at
// -----------------------------------------------------------------------------
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
    return (d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd);
  }

  if (rawWeekStart !== undefined) {
    const trimmed = String(rawWeekStart).trim();
    if (trimmed.length === 0 || !isValidWeekStartYMD(trimmed)) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid week_start. Use YYYY-MM-DD." });
    }
  }

  const weekStartParam = rawWeekStart === undefined ? null : String(rawWeekStart).trim();

  try {
    // Resolve operator timezone (same approach as schedule)
    const op = await pool.query(
      `SELECT operator_id, timezone FROM aquorix.diveoperators WHERE operator_id = $1 LIMIT 1`,
      [req.operator_id]
    );

    if (op.rowCount === 0) {
      return res.status(403).json({ ok: false, status: "forbidden", message: "Operator not found for user scope" });
    }

    const tz = op.rows[0].timezone || "UTC";

    // Compute week range in operator timezone
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

    // Bookings joined to sessions/sites/itineraries for UI context
    const r = await pool.query(
      `
      SELECT
        b.booking_id,
        b.booking_status::text AS booking_status,
        b.payment_status::text AS payment_status,
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
      JOIN aquorix.dive_sessions s ON s.session_id = b.session_id
      JOIN aquorix.divesites dsite ON dsite.dive_site_id = s.dive_site_id
      JOIN aquorix.itineraries it ON it.itinerary_id = s.itinerary_id
      WHERE b.operator_id = $1
        AND b.session_id IS NOT NULL
        AND s.cancelled_at IS NULL
        AND (s.dive_datetime AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY
        CASE WHEN b.booking_status::text = 'pending' THEN 0 ELSE 1 END ASC,
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
    console.error("[GET /api/v1/dashboard/bookings] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// Phase 8: Approve Booking => Initiate Payment (Stripe Checkout)
// POST /api/v1/dashboard/bookings/:booking_id/approve
//
// Viking Doctrine:
// - "Approval" initiates payment and returns checkout_url.
// - Seat is reserved ONLY when payment succeeds (webhook will confirm).
//
// Idempotency + Concurrency:
// - Locks booking row FOR UPDATE.
// - If stripe_checkout_session_id already exists, returns existing Stripe session URL.
// - Capacity check uses getCapacityConsumedForSession (confirmed + active holds).
//
// Amount Authority:
// - Server decides the amount. Client cannot inject pricing.
// - For now: booking.payment_amount MUST be set (NUMERIC(10,2)) or approve returns 400.
// -----------------------------------------------------------------------------
app.post("/api/v1/dashboard/bookings/:booking_id/approve", requireDashboardScope, async (req, res) => {
  const booking_id = Number(req.params.booking_id);
  if (!Number.isFinite(booking_id) || booking_id <= 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid booking_id" });
  }

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
    if (booking.stripe_checkout_session_id) {
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

    // 5) Amount authority (Phase 8 MVP rule)
    // booking.payment_amount must be present (numeric 10,2)
    const amt = booking.payment_amount;
    const amountNumber = amt === null || typeof amt === "undefined" ? NaN : Number(amt);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        status: "bad_request",
        message: "payment_amount is missing on booking; set payment_amount before initiating Stripe checkout",
        booking_id: String(booking_id)
      });
    }

        // -------------------------------------------------------------------------
    // Phase 8.1 (LOCKED 2026-02-21): Dual-currency policy (Jordan)
    // - Ledger currency = booking.payment_currency (JOD)
    // - Charge currency = Stripe-supported platform currency (USD)
    // - Store both truths in DB:
    //     payment_amount_minor (ledger minor units)
    //     stripe_charge_currency + stripe_charge_amount_minor (charge truth)
    //     fx_rate_estimate (+ timestamp/source) when FX is involved
    //
    // NOTE: Stripe API expects lowercase currency codes ('usd').
    //       DB stores uppercase currency codes ('USD', 'JOD').
    // -------------------------------------------------------------------------

    // Helper: minor unit multiplier (world-class: JOD has 3 decimals)
    function minorUnitMultiplier(currencyUpper) {
      switch (currencyUpper) {
        case "JOD": return 1000; // 0.001
        case "USD": return 100;  // 0.01
        default: return 100;     // MVP fallback; expand later
      }
    }

    // Ledger currency (operator truth)
    const ledger_currency_upper = String(booking.payment_currency || "JOD").trim().toUpperCase();

    // Charge currency (platform truth)
    const isDev = String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
    const platformChargeCurrencyLower = String(process.env.STRIPE_PLATFORM_CHARGE_CURRENCY || "usd").trim().toLowerCase();
    const forceCurrencyLower = String(process.env.STRIPE_FORCE_CURRENCY || "").trim().toLowerCase();

    const charge_currency_lower = (isDev && forceCurrencyLower) ? forceCurrencyLower : platformChargeCurrencyLower;
    const charge_currency_upper = charge_currency_lower.toUpperCase();

    // Ledger minor units (e.g., 50.00 JOD -> 50000 minor, because JOD=1000)
    const ledger_multiplier = minorUnitMultiplier(ledger_currency_upper);
    const ledger_amount_minor = Math.round(amountNumber * ledger_multiplier);

    if (!Number.isFinite(ledger_amount_minor) || ledger_amount_minor <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        status: "bad_request",
        message: "Invalid computed payment_amount_minor (ledger)",
        payment_amount: String(amountNumber),
        ledger_currency: ledger_currency_upper,
        ledger_multiplier: String(ledger_multiplier),
        payment_amount_minor: String(ledger_amount_minor)
      });
    }

    // FX logic (Phase 8.1 MVP: env-based JOD->USD rate)
    // We only require FX if ledger_currency != charge_currency
    let fx_rate_estimate = null;
    let fx_rate_source = null;

    let charge_amount_major = amountNumber;

    if (ledger_currency_upper !== charge_currency_upper) {
      // MVP: only supporting JOD ledger -> USD charge for now
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

    // Charge minor units for Stripe (USD cents)
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

    // 6) Create Stripe Checkout Session (outside DB writes, but still inside our logical flow)
    // NOTE: We have NOT committed yet. If Stripe call fails, we roll back.
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: String(successUrl).trim(),
      cancel_url: String(cancelUrl).trim(),
      customer_email: booking.guest_email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: charge_currency_lower,         // Stripe expects lowercase (usd)
            unit_amount: charge_amount_minor,        // Stripe minor units (cents)
            product_data: {
              name: "AQUORIX Dive Booking",
              description: booking.guest_name
                ? `Booking #${booking_id} for ${booking.guest_name} | Operator price: ${amountNumber} ${ledger_currency_upper} | Charged: ${charge_currency_upper} ${ (charge_amount_minor / charge_multiplier).toFixed(2) }`
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

        // Dual-currency facts (for audit/debug)
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

    // 7) Persist Stripe checkout facts (idempotency anchor is UNIQUE index on stripe_checkout_session_id)
    await client.query(
      `
      UPDATE aquorix.dive_bookings
      SET
        stripe_checkout_session_id = $1,

        -- Ledger (operator truth)
        payment_amount_minor = $2,

        -- Stripe charge truth
        stripe_charge_currency = $3,
        stripe_charge_amount_minor = $4,

        -- FX estimate (only meaningful when ledger != charge)
        fx_rate_estimate = $5::numeric,
        fx_rate_estimate_at = CASE WHEN $5::numeric IS NULL THEN NULL ELSE now() END,
        fx_rate_source = $6::text,

        payment_checkout_created_at = now(),
        updated_at = now(),

        -- refresh hold so customer has time to complete checkout (Phase 8 MVP policy)
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
        ledger_amount_minor,
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

      // Returned for transparency/testing (Option B)
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

// -----------------------------------------------------------------------------
// Phase 7: Reject Booking (idempotent)
// POST /api/v1/dashboard/bookings/:booking_id/reject
// -----------------------------------------------------------------------------
app.post("/api/v1/dashboard/bookings/:booking_id/reject", requireDashboardScope, async (req, res) => {
  const booking_id = Number(req.params.booking_id);
  if (!Number.isFinite(booking_id) || booking_id <= 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid booking_id" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const b = await client.query(
      `
      SELECT booking_id, booking_status, operator_id, session_id, guest_email, guest_name
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

    // Idempotency
    if (booking.booking_status === "cancelled") {
      await client.query("ROLLBACK");
      return res.json({ ok: true, status: "success", action: "noop_already_cancelled", booking_id: String(booking_id) });
    }
    if (booking.booking_status === "confirmed") {
      // Still allow cancellation via reject for MVP moderation behavior
      // (You can split “cancel confirmed” into a separate endpoint later)
    }

    await client.query(
      `
      UPDATE aquorix.dive_bookings
      SET booking_status = 'cancelled',
          updated_at = now()
      WHERE booking_id = $1
        AND operator_id = $2
      `,
      [booking_id, req.operator_id]
    );

    await client.query("COMMIT");

        // Best-effort guest notification (EMAIL) + ALWAYS logged
    (async () => {
      if (!booking.guest_email) return;

      const subject = "AQUORIX Booking Update";
      const html = `<h2>Booking Update</h2><p>Hello ${booking.guest_name || "Guest"}, your booking request was not approved.</p>`;

      try {
        await notifications.sendGuestEmail({
          to: booking.guest_email,
          subject,
          html
        });

        await notificationStore.logSent(pool, {
          recipient_type: "guest",
          recipient_email: String(booking.guest_email).trim(),
          event_type: "booking_rejected.guest.email",
          subject,
          body: html,
          booking_id,
          session_id: booking.session_id,
          operator_id: req.operator_id
        });
      } catch (e) {
        try {
          await notificationStore.logFailed(pool, {
            recipient_type: "guest",
            recipient_email: String(booking.guest_email).trim(),
            event_type: "booking_rejected.guest.email",
            subject,
            body: html,
            error_message: e && e.message ? e.message : String(e),
            booking_id,
            session_id: booking.session_id,
            operator_id: req.operator_id
          });
        } catch (logErr) {
          console.error("[reject booking] guest notify failed AND logFailed failed:", logErr);
        }
      }
    })();

    return res.json({ ok: true, status: "success", action: "rejected", booking_id: String(booking_id) });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[reject booking] error:", e);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  } finally {
    client.release();
  }
});


// -----------------------------------------------------------------------------
// Health check
// -----------------------------------------------------------------------------

app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'healthy', dbConnected: true });
  } catch (err) {
    console.error('Health check failed:', err.stack);
    res.status(500).json({ status: 'unhealthy', dbConnected: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Legacy endpoints (unchanged)
// -----------------------------------------------------------------------------

app.get('/api/users', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT user_id, email, role, tier, created_at FROM aquorix.users');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.stack);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/users/by-supabase-id/:supabase_user_id', async (req, res) => {
  try {
    const { supabase_user_id } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT 
        u.role, u.tier, u.email,
        p.onboarding_metadata, p.first_name, p.last_name, p.tier_level
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
    `, [supabase_user_id]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user by supabase_id:', err.stack);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.get('/api/users/me', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const client = await pool.connect();
    const result = await client.query(
      `
      SELECT 
        u.role,
        u.tier,
        u.email,
        p.onboarding_metadata,
        p.first_name,
        p.last_name,
        p.tier_level
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
      `,
      [user_id]
    );

    client.release();

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/users/update-step', async (req, res) => {
  const { supabase_user_id, step, metadata } = req.body;
  if (!supabase_user_id || !step) {
    return res.status(400).json({ error: 'supabase_user_id and step are required' });
  }

  try {
    const client = await pool.connect();
    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET onboarding_metadata = jsonb_set(
        onboarding_metadata::jsonb,
        '{current_step}',
        to_jsonb($2::int),
        true
      ) || $3::jsonb
      FROM aquorix.users u
      WHERE pro_profiles.user_id = u.user_id
        AND u.supabase_user_id = $1
      `,
      [supabase_user_id, step, metadata ? JSON.stringify(metadata) : '{}']
    );

    client.release();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating onboarding step:', err);
    res.status(500).json({ error: 'Failed to update onboarding step' });
  }
});

// -----------------------------------------------------------------------------
// PUBLIC WIDGET (Read-Only) - excludes cancelled sessions
// -----------------------------------------------------------------------------

app.get("/api/v1/public/widgets/schedule/:operator_slug", async (req, res) => {
  const { operator_slug } = req.params;
  const rawWeekStart = req.query.week_start;

  function isValidWeekStartYMD(value) {
    const s = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [yyyy, mm, dd] = s.split("-").map((n) => parseInt(n, 10));
    if (!yyyy || !mm || !dd) return false;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return (d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd);
  }

  if (rawWeekStart !== undefined) {
    const trimmed = String(rawWeekStart).trim();
    if (trimmed.length === 0 || !isValidWeekStartYMD(trimmed)) {
      return res.status(400).json({
        ok: false,
        status: "bad_request",
        message: "Invalid week_start format. Use YYYY-MM-DD (e.g., 2026-02-09)",
      });
    }
  }

  const weekStartParam = rawWeekStart === undefined ? null : String(rawWeekStart).trim();

  try {
    const opResult = await pool.query(
      `
      SELECT operator_id, operator_slug, name, timezone, default_currency
      FROM aquorix.diveoperators
      WHERE operator_slug = $1
      LIMIT 1
      `,
      [operator_slug]
    );

    if (opResult.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        status: "not_found",
        message: `Operator not found: ${operator_slug}`,
      });
    }

    const operator = opResult.rows[0];
    const tz = operator.timezone || "UTC";
    const weekStartSql = weekStartParam;

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
      [weekStartSql, tz]
    );

    const week_start = weekRange.rows[0].week_start;
    const week_end = weekRange.rows[0].week_end;

    const sessions = await pool.query(
      `
      SELECT
        ds.session_id,
        (ds.dive_datetime AT TIME ZONE $4)::date::text AS session_date,
        EXTRACT(ISODOW FROM (ds.dive_datetime AT TIME ZONE $4))::int AS day_of_week,
        to_char((ds.dive_datetime AT TIME ZONE $4)::time, 'HH24:MI') AS start_time,
        dsite.name AS site_name
      FROM aquorix.dive_sessions ds
      JOIN aquorix.divesites dsite ON dsite.dive_site_id = ds.dive_site_id
      WHERE ds.operator_id = $1
        AND (ds.dive_datetime AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
        AND ds.cancelled_at IS NULL
      ORDER BY session_date ASC, start_time ASC
      `,
      [operator.operator_id, week_start, week_end, tz]
    );

    const weekdayNames = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
    const byDate = new Map();

    for (const row of sessions.rows) {
      if (!byDate.has(row.session_date)) {
        byDate.set(row.session_date, { date: row.session_date, weekday: weekdayNames[row.day_of_week], sessions: [] });
      }
      byDate.get(row.session_date).sessions.push({
        session_id: row.session_id,
        start_time: row.start_time,
        site_name: row.site_name,
        capacity_total: null,
        capacity_remaining: null,
      });
    }

    res.set("Cache-Control", "public, max-age=300");

    return res.json({
      ok: true,
      status: "success",
      operator: { slug: operator.operator_slug, name: operator.name, timezone: tz, currency: operator.default_currency },
      week: { start: week_start, end: week_end },
      days: Array.from(byDate.values()),
    });
  } catch (err) {
    console.error("Public Schedule Widget Error:", err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// DASHBOARD: OPERATOR CAPACITY (Phase 7 - Viking)
// - Read/write operator_default_capacity (dashboard configurable)
// - Scoped by requireDashboardScope (never accept operator_id from client)
// -----------------------------------------------------------------------------

app.get("/api/v1/dashboard/operator/capacity", requireDashboardScope, async (req, res) => {
  try {
    const r = await pool.query(
      `
      SELECT operator_id, operator_default_capacity
      FROM aquorix.diveoperators
      WHERE operator_id = $1
      LIMIT 1
      `,
      [req.operator_id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        status: "not_found",
        message: "Operator not found for scoped user"
      });
    }

    const row = r.rows[0];

    return res.json({
      ok: true,
      status: "success",
      operator_id: String(row.operator_id),
      operator_default_capacity: row.operator_default_capacity == null ? null : Number(row.operator_default_capacity)
    });
  } catch (err) {
    console.error("[GET /api/v1/dashboard/operator/capacity] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

app.patch("/api/v1/dashboard/operator/capacity", requireDashboardScope, async (req, res) => {
  const raw = req.body?.operator_default_capacity;
  const n = Number(raw);

  if (!Number.isFinite(n) || n <= 0 || n > 200) {
    return res.status(400).json({
      ok: false,
      status: "bad_request",
      message: "operator_default_capacity must be a positive number (1..200)"
    });
  }

  try {
    const r = await pool.query(
      `
      UPDATE aquorix.diveoperators
      SET operator_default_capacity = $2,
          updated_at = now()
      WHERE operator_id = $1
      RETURNING operator_id, operator_default_capacity
      `,
      [req.operator_id, n]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        status: "not_found",
        message: "Operator not found for scoped user"
      });
    }

    return res.json({
      ok: true,
      status: "success",
      operator_id: String(r.rows[0].operator_id),
      operator_default_capacity: Number(r.rows[0].operator_default_capacity)
    });
  } catch (err) {
    console.error("[PATCH /api/v1/dashboard/operator/capacity] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// DASHBOARD SCHEDULING (M4) - Scoped CRUD + Cancel
// NOTE: This endpoint now returns itinerary/team/vessel context for UI rendering.
// -----------------------------------------------------------------------------

app.get("/api/v1/dashboard/schedule", requireDashboardScope, async (req, res) => {
  // Phase 6 hardening: never cache operator-scoped dashboard schedule
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
    return (d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd);
  }

  if (rawWeekStart !== undefined) {
    const trimmed = String(rawWeekStart).trim();
    if (trimmed.length === 0 || !isValidWeekStartYMD(trimmed)) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid week_start. Use YYYY-MM-DD." });
    }
  }

  const weekStartParam = rawWeekStart === undefined ? null : String(rawWeekStart).trim();

  try {
    const op = await pool.query(
      `SELECT operator_id, timezone FROM aquorix.diveoperators WHERE operator_id = $1 LIMIT 1`,
      [req.operator_id]
    );

    if (op.rowCount === 0) {
      return res.status(403).json({ ok: false, status: "forbidden", message: "Operator not found for user scope" });
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

    const sessions = await pool.query(
      `
      SELECT
        ds.session_id,

        -- itinerary context (requested focus)
        ds.itinerary_id,
        it.title AS itinerary_title,
        it.itinerary_date::text AS itinerary_date,
        it.dive_slot::text AS itinerary_slot,
        it.location_type::text AS itinerary_location_type,
        it.itinerary_type::text AS itinerary_type,

        -- team context
        ds.team_id,
        dt.team_name,

        -- vessel context (optional)
        ds.vessel_id,
        v.name AS vessel_name,
        v.max_capacity AS vessel_max_capacity,

        -- site + session details
        ds.dive_site_id,
        dsite.name AS site_name,
        (ds.dive_datetime AT TIME ZONE $4)::date::text AS session_date,
        to_char((ds.dive_datetime AT TIME ZONE $4)::time, 'HH24:MI') AS start_time,
        to_char((ds.meet_time AT TIME ZONE $4)::time, 'HH24:MI') AS meet_time,
        ds.session_type,
        ds.notes
      FROM aquorix.dive_sessions ds
      JOIN aquorix.divesites dsite ON dsite.dive_site_id = ds.dive_site_id
      JOIN aquorix.itineraries it ON it.itinerary_id = ds.itinerary_id
      JOIN aquorix.dive_teams dt ON dt.team_id = ds.team_id
      LEFT JOIN aquorix.vessels v ON v.vessel_id = ds.vessel_id
      WHERE ds.operator_id = $1
        AND (ds.dive_datetime AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
        AND ds.cancelled_at IS NULL
      ORDER BY session_date ASC, start_time ASC
      `,
      [req.operator_id, week_start, week_end, tz]
    );

    return res.json({
      ok: true,
      status: "success",
      operator_id: String(req.operator_id),
      week: { start: week_start, end: week_end },
      sessions: sessions.rows
    });
  } catch (err) {
    console.error("[dashboard schedule] Error:", err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

app.post("/api/v1/dashboard/schedule/sessions", requireDashboardScope, async (req, res) => {
  const { dive_site_id, dive_datetime, meet_time, notes, session_type, itinerary_id, team_id, vessel_id, price_per_diver } = req.body || {};

  // NOTE: your schema requires itinerary_id + team_id + dive_site_id + dive_datetime
  if (!itinerary_id || !team_id || !dive_site_id || !dive_datetime) {
    return res.status(400).json({
      ok: false,
      status: "bad_request",
      message: "itinerary_id, team_id, dive_site_id, and dive_datetime are required"
    });
  }

  // price_per_diver is optional for now, but if provided it must be a valid non-negative number
  if (price_per_diver !== undefined && price_per_diver !== null && price_per_diver !== "") {
    const n = Number(price_per_diver);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({
        ok: false,
        status: "bad_request",
        message: "price_per_diver must be a non-negative number"
      });
    }
  }

  try {
    // Ledger currency MUST come from operator profile (never from client)
  const operatorRow = await pool.query(
  `SELECT default_currency FROM aquorix.diveoperators WHERE operator_id = $1`,
  [req.operator_id]
);

if (operatorRow.rowCount === 0) {
  return res.status(404).json({ ok: false, status: "not_found", message: "Operator not found" });
}

const operatorCurrency = operatorRow.rows[0].default_currency;

  const result = await pool.query(
    `
    INSERT INTO aquorix.dive_sessions
      (
        operator_id,
        itinerary_id,
        team_id,
        dive_site_id,
        dive_datetime,
        meet_time,
        notes,
        session_type,
        vessel_id,
        price_per_diver,
        session_currency,
        updated_at
      )
    VALUES
      (
        $1, $2, $3, $4,
        $5::timestamptz,
        $6::timestamptz,
        $7, $8, $9,
        $10::numeric,
        $11,
        now()
      )
    RETURNING session_id
    `,
    [
      req.operator_id,
      itinerary_id,
      team_id,
      dive_site_id,
      dive_datetime,
      meet_time || null,
      notes || null,
      session_type || null,
      vessel_id || null,
      price_per_diver !== undefined && price_per_diver !== null && price_per_diver !== "" ? price_per_diver : null,
      operatorCurrency
    ]
  );

    return res.status(201).json({ ok: true, status: "created", session_id: String(result.rows[0].session_id) });
  } catch (err) {
    console.error("[dashboard create session] Error:", err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

app.patch("/api/v1/dashboard/schedule/sessions/:session_id", requireDashboardScope, async (req, res) => {
  const { session_id } = req.params;

  const allowed = {
    dive_site_id: req.body?.dive_site_id,
    dive_datetime: req.body?.dive_datetime,
    meet_time: req.body?.meet_time,
    notes: req.body?.notes,
    session_type: req.body?.session_type,
    vessel_id: req.body?.vessel_id,
    price_per_diver: req.body?.price_per_diver
  };

  // If this session has bookings, lock down critical fields (allow notes only)
  const coreFieldsLockedWhenBooked = new Set([
    "dive_site_id",
    "dive_datetime",
    "meet_time",
    "session_type",
    "vessel_id",
    "price_per_diver"
  ]);

  const attemptedKeys = Object.entries(allowed)
    .filter(([_, v]) => v !== undefined)
    .map(([k]) => k);

  const isAttemptingLockedChange = attemptedKeys.some((k) => coreFieldsLockedWhenBooked.has(k) && k !== "notes");

  if (isAttemptingLockedChange) {
    const bookingCountRow = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM aquorix.dive_bookings WHERE session_id = $1`,
      [session_id]
    );

    if ((bookingCountRow.rows[0]?.cnt || 0) > 0) {
      return res.status(409).json({
        ok: false,
        status: "conflict",
        message: "Session has bookings. Only notes can be edited."
      });
    }
  }

  const setParts = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(allowed)) {
    if (val === undefined) continue;

    if (key === "dive_datetime" || key === "meet_time") {
      setParts.push(`${key} = $${idx}::timestamptz`);
    } else if (key === "price_per_diver") {
      // numeric(10,3) in DB
      setParts.push(`${key} = $${idx}::numeric`);
    } else {
      setParts.push(`${key} = $${idx}`);
    }

    values.push(val);
    idx++;
  }

  if (setParts.length === 0) {
    return res.status(400).json({ ok: false, status: "bad_request", message: "No editable fields provided" });
  }

  setParts.push(`updated_at = now()`);

  values.push(session_id);
  const sessionIdParam = `$${idx}`;
  idx++;

  values.push(req.operator_id);
  const operatorIdParam = `$${idx}`;

  try {
    const result = await pool.query(
      `
      UPDATE aquorix.dive_sessions
      SET ${setParts.join(", ")}
      WHERE session_id = ${sessionIdParam}
        AND operator_id = ${operatorIdParam}
        AND cancelled_at IS NULL
      RETURNING session_id
      `,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, status: "not_found", message: "Session not found" });
    }

    return res.json({ ok: true, status: "success", session_id: String(result.rows[0].session_id) });
  } catch (err) {
    console.error("[dashboard patch session] Error:", err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

app.post("/api/v1/dashboard/schedule/sessions/:session_id/cancel", requireDashboardScope, async (req, res) => {
  const { session_id } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE aquorix.dive_sessions
      SET cancelled_at = now(),
          cancelled_by_user_id = $3,
          updated_at = now()
      WHERE session_id = $1
        AND operator_id = $2
        AND cancelled_at IS NULL
      RETURNING session_id
      `,
      [session_id, req.operator_id, req.aquorix_user.user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, status: "not_found", message: "Session not found" });
    }

    return res.json({ ok: true, status: "success", session_id: String(result.rows[0].session_id) });
  } catch (err) {
    console.error("[dashboard cancel session] Error:", err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// DEBUG: DB Fingerprint (LOCAL DEV ONLY)
// -----------------------------------------------------------------------------
app.get('/api/v1/debug/db-fingerprint', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        current_database() AS db_name,
        inet_server_addr() AS server_ip,
        inet_server_port() AS server_port,
        current_setting('server_version_num') AS server_version_num,
        current_user AS db_user
    `);
    return res.json({ ok: true, fingerprint: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// -----------------------------------------------------------------------------
// Server start
// -----------------------------------------------------------------------------

app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`);
});

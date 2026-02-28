/*
 * AQUORIX Pro Backend Server
 * File: server.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/server.js
 * Description: Express server for AQUORIX Pro Dashboard + Public Widgets
 *
 * Author: Larry McLean
 * Created: 2025-07-01
 * Version: 1.2.9
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
 *   - 2026-02-21: v1.2.8 - Phase 8.1: Dual-currency Stripe Checkout (JOD ledger + USD charge) with FX estimate + minor-unit hardening (JOD=3, USD=2); store stripe_charge_* + fx_rate_* fields; approve endpoint returns ledger + charge amounts; idempotent checkout retrieval
 * - 2026-02-25: v1.2.9 - Phase 8.3: Add success landing routes
 */

// Load local environment variables from .env (dev only)
require("dotenv").config();

const HOLD_WINDOW_MINUTES = Number(process.env.HOLD_WINDOW_MINUTES || 15);

const express = require('express');
const cors = require('cors');

const pool = require('./src/lib/pool');
const { getSupabaseUserIdFromBearer } = require('./src/lib/jwt');
const { requireAuthUserFactory } = require('./src/middleware/requireAuthUser');
const { requireDashboardScopeFactory } = require('./src/middleware/requireDashboardScope');

const { getStripeClient } = require('./src/services/stripe');
const { createPaymentsWebhookRouter } = require("./src/routes/paymentsWebhook");
const registerBookingsRequestRoutes = require("./src/routes/bookingsRequest");
const registerBookingsPurchaseRoutes = require("./src/routes/bookingsPurchase");
const registerBookingsPaymentLinkRoutes = require("./src/routes/bookingsPaymentLink");
const registerDashboardBookingsRoutes = require("./src/routes/dashboardBookings");
const registerDashboardBookingApproveRoutes = require("./src/routes/dashboardBookingApprove");
const registerDashboardBookingRejectRoutes = require("./src/routes/dashboardBookingReject");

const path = require('path');

// -----------------------------------------------------------------------------
// Phase 7 (Viking): Notifications + DB Notification Store
// -----------------------------------------------------------------------------
const notifications = require("./src/services/notifications");
const notificationStore = require("./src/services/notificationStore");

const app = express();

// Stripe webhook MUST use raw body BEFORE express.json()
app.use(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json" }),
  createPaymentsWebhookRouter({ pool })
);

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

app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// Phase 8.3 (Local Dev): Stripe return landing endpoints
// - Stripe Checkout success/cancel URLs may point here in local dev.
// - These endpoints are intentionally simple and MUST NOT affect webhook truth.
// -----------------------------------------------------------------------------
app.get("/api/v1/stripe/success", (req, res) => {
  const session_id = req.query && req.query.session_id ? String(req.query.session_id).trim() : "";
  return res.redirect(302, `/success.html?session_id=${encodeURIComponent(session_id)}`);
});

app.get("/api/v1/stripe/cancel", (req, res) => {
  const session_id = req.query && req.query.session_id ? String(req.query.session_id).trim() : "";
  return res.redirect(302, `/cancel.html?session_id=${encodeURIComponent(session_id)}`);
});

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
// Phase 8.3-B: Route Extraction - Booking Request
// -----------------------------------------------------------------------------
registerDashboardBookingsRoutes(app, {
  pool,
  requireDashboardScope
});

registerDashboardBookingApproveRoutes(app, {
  pool,
  requireDashboardScope,
  getStripeClient,
  getOperatorDefaultCapacity,
  getCapacityConsumedForSession
});

registerDashboardBookingRejectRoutes(app, {
  pool,
  requireDashboardScope,
  notifications,
  notificationStore
});

// -----------------------------------------------------------------------------
// Phase 8.3-A: Route Extraction - Booking Request
// -----------------------------------------------------------------------------
registerBookingsRequestRoutes(app, {
  pool,
  requireAuthUser,
  requireDashboardScope,
  HOLD_WINDOW_MINUTES,
  notifications,
  notificationStore,
});

registerBookingsPurchaseRoutes(app, {
  pool,
  requireAuthUser,
  HOLD_WINDOW_MINUTES,
  getStripeClient,
  getOperatorDefaultCapacity,
  getCapacityConsumedForSession,
});

registerBookingsPaymentLinkRoutes(app, {
  pool,
  requireDashboardScope,
  getStripeClient,
});

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

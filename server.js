/*
 * AQUORIX Pro Backend Server
 * File: server.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/server.js
 * Description: Express server for AQUORIX Pro Dashboard + Public Widgets
 *
 * Author: Larry McLean
 * Created: 2025-07-01
 * Version: 1.2.2
 *
 * Last Updated: 2026-02-14
 * Status: ACTIVE (Local-first Dev / Phase 4)
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
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

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

// -----------------------------------------------------------------------------
// Database connection pool
// NOTE:
// - Local-first dev: ssl=false
// - When running on Render production, you may need ssl enabled depending on Render config.
//   We keep local-first deterministic here.
// -----------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
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

// -----------------------------------------------------------------------------
// JWT helper (best-effort decode to extract Supabase user id)
// -----------------------------------------------------------------------------

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSupabaseUserIdFromBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson);
    if (!payload || !payload.sub) return null;
    return String(payload.sub);
  } catch (e) {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Phase 6: Lightweight Auth Middleware (NO operator scope)
// - Validates Bearer token format
// - Resolves AQUORIX user (users table)
// - Attaches req.aquorix_user_basic
// -----------------------------------------------------------------------------
async function requireAuthUser(req, res, next) {
  const supabase_user_id = getSupabaseUserIdFromBearer(req);

  if (!supabase_user_id) {
    return res.status(401).json({ ok: false, status: "unauthorized", message: "Missing or invalid Bearer token" });
  }

  try {
    const userResult = await pool.query(
      `
      SELECT user_id, role, tier, is_active
      FROM aquorix.users
      WHERE supabase_user_id = $1
      LIMIT 1
      `,
      [supabase_user_id]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ ok: false, status: "not_found", message: "User not found in AQUORIX DB" });
    }

    const user = userResult.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({ ok: false, status: "forbidden", message: "User is inactive" });
    }

    req.aquorix_user_basic = {
      supabase_user_id,
      user_id: user.user_id,
      role: user.role,
      tier: user.tier
    };

    return next();
  } catch (err) {
    console.error("[requireAuthUser] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
}

// -----------------------------------------------------------------------------
// Dashboard Auth + Operator Scope Middleware (PHASE 4 RULE A)
// - Derive operator_id from: users.supabase_user_id -> users.user_id -> user_operator_affiliations(active=true)
// - Never accept operator_id from request body/query params.
// - If >1 active affiliations: return 409 (operator selection required).
// -----------------------------------------------------------------------------

async function requireDashboardScope(req, res, next) {
  const supabase_user_id = getSupabaseUserIdFromBearer(req);

  if (!supabase_user_id) {
    return res.status(401).json({ ok: false, status: "unauthorized", message: "Missing or invalid Bearer token" });
  }

  try {
    // 1) Resolve AQUORIX user
    const userResult = await pool.query(
      `
      SELECT user_id, role, tier, is_active, active_operator_id
      FROM aquorix.users
      WHERE supabase_user_id = $1
      LIMIT 1
      `,
      [supabase_user_id]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ ok: false, status: "not_found", message: "User not found in AQUORIX DB" });
    }

    const user = userResult.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({ ok: false, status: "forbidden", message: "User is inactive" });
    }

    // 2) Resolve operator affiliations (active=true)
    const affAll = await pool.query(
      `
      SELECT operator_id, affiliation_type, updated_at, created_at, affiliation_id
      FROM aquorix.user_operator_affiliations
      WHERE user_id = $1
        AND active = true
      ORDER BY updated_at DESC, created_at DESC, affiliation_id DESC
      `,
      [user.user_id]
    );

    if (affAll.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        status: "forbidden",
        message: "User has no active operator affiliation"
      });
    }

    // -----------------------------------------------------------------
    // PHASE 6: Auto-set active_operator_id when exactly ONE affiliation
    // -----------------------------------------------------------------
    if (!user.active_operator_id && affAll.rowCount === 1) {
      const onlyOperatorId = affAll.rows[0].operator_id;

      try {
        await pool.query(
          `
          UPDATE aquorix.users
          SET active_operator_id = $1,
              updated_at = now()
          WHERE user_id = $2
          `,
          [onlyOperatorId, user.user_id]
        );

        // Update in-memory value so this request uses it immediately
        user.active_operator_id = onlyOperatorId;
      } catch (e) {
        console.error("[requireDashboardScope] Auto-set active_operator_id failed:", e);
        // Do NOT block the request; fallback to normal behavior below
      }
    }

    if (affAll.rowCount > 1) {
  const activeOp = user.active_operator_id;

  // If user already selected an active operator and it is still affiliated, use it.
  if (activeOp) {
    const match = affAll.rows.find(a => String(a.operator_id) === String(activeOp));
      if (match) {
        req.aquorix_user = {
          supabase_user_id,
          user_id: user.user_id,
          role: user.role,
          tier: user.tier
        };
        req.operator_id = match.operator_id;
        return next();
      }
    }

    // Otherwise force selection
    return res.status(409).json({
      ok: false,
      status: "conflict",
      message: "User has multiple active operator affiliations; operator selection required",
      affiliation_count: affAll.rowCount,
      active_operator_id: activeOp ? String(activeOp) : null
    });
  }

    req.aquorix_user = {
      supabase_user_id,
      user_id: user.user_id,
      role: user.role,
      tier: user.tier
    };

    req.operator_id = affAll.rows[0].operator_id;

    return next();
  } catch (err) {
    console.error("[requireDashboardScope] Error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
  }
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
  const supabase_user_id = getSupabaseUserIdFromBearer(req);

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
    const result = await client.query('SELECT user_id, email, role, tier, created_at FROM users');
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
// DASHBOARD SCHEDULING (M4) - Scoped CRUD + Cancel
// NOTE: This endpoint now returns itinerary/team/vessel context for UI rendering.
// -----------------------------------------------------------------------------

app.get("/api/v1/dashboard/schedule", requireDashboardScope, async (req, res) => {
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
  const { dive_site_id, dive_datetime, meet_time, notes, session_type, itinerary_id, team_id, vessel_id } = req.body || {};

  // NOTE: your schema requires itinerary_id + team_id + dive_site_id + dive_datetime
  if (!itinerary_id || !team_id || !dive_site_id || !dive_datetime) {
    return res.status(400).json({
      ok: false,
      status: "bad_request",
      message: "itinerary_id, team_id, dive_site_id, and dive_datetime are required"
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO aquorix.dive_sessions
        (operator_id, itinerary_id, team_id, dive_site_id, dive_datetime, meet_time, notes, session_type, vessel_id, updated_at)
      VALUES
        ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, now())
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
        vessel_id || null
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
    vessel_id: req.body?.vessel_id
  };

  const setParts = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(allowed)) {
    if (val === undefined) continue;
    setParts.push(`${key} = $${idx}`);
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

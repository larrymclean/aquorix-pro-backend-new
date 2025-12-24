/**
 * ============================================================================
 * AQUORIX API - /api/v1/me (Identity + Operator Context)
 * ============================================================================
 * File:        src/routes/me.js
 * Purpose:     Single source of truth for authenticated user identity, operator
 *              context, onboarding status, and permission flags (Phase C keystone).
 * Version:     v1.0.1
 * Created:     2025-12-23
 * Updated:     2025-12-24
 * Author:      Larry McLean
 * Project:     AQUORIX™ API Project
 *
 * Description:
 * - Returns authenticated user context used for frontend routing and guards.
 * - Requires JWT auth (Supabase) and resolves operator context via affiliations.
 * - DB-backed: pulls canonical user + onboarding_metadata from aquorix DB.
 *
 * Dependencies:
 * - middleware/auth.js (requireAuth)
 * - middleware/resolveOperator.js (resolveOperator)
 * - req.user (from requireAuth)
 * - req.operator (from resolveOperator)
 * - req.app.locals.pool (Postgres pool)
 *
 * Change Log:
 * -----------
 * v1.0.0 - 2025-12-23 - Larry McLean
 *   - Initial creation of GET /api/v1/me endpoint
 * v1.0.1 - 2025-12-24 - Larry McLean
 *   - DB-backed /me: joins aquorix.users + aquorix.pro_profiles
 *   - Returns onboarding_metadata and stable routing_hint
 *   - Removes ambiguous export/import “support both” patterns
 *
 * Notes:
 * - Do NOT alter existing changelog entries
 * - Always append new changes with version bump
 * - Follow semantic versioning: MAJOR.MINOR.PATCH
 * ============================================================================
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const resolveOperator = require("../middleware/resolveOperator");

// Fail fast if middleware wiring breaks (prevents silent drift)
if (typeof requireAuth !== "function") {
  throw new Error("Middleware load error: requireAuth is not a function.");
}
if (typeof resolveOperator !== "function") {
  throw new Error("Middleware load error: resolveOperator is not a function.");
}

/**
 * GET /api/v1/me
 * Requires: Authorization: Bearer <Supabase JWT>
 */
router.get('/', requireAuth, resolveOperator, async (req, res) => {
  try {
    const pool = req.app?.locals?.pool;
    if (!pool) {
      return res.status(500).json({ ok: false, error: "DB_POOL_MISSING" });
    }

    // ✅ Read auth context from req.auth (set by requireAuth)
    const supabase_user_id = req.auth?.supabase_user_id || null;
    const email_from_jwt = req.auth?.email || null;

    if (!supabase_user_id) {
      return res.status(401).json({
        ok: false,
        error: "AUTH_CONTEXT_MISSING",
        message: "JWT verified but supabase_user_id not found on req.auth",
      });
    }

    // ✅ Read operator context from req.operatorContext (set by resolveOperator)
    const operatorCtx = req.operatorContext || {};
    const operator_id = operatorCtx.operator_id ?? null;
    const affiliation = operatorCtx.affiliation_type ?? null;

    // Canonical user + profile (DB truth)
    const userQ = `
      SELECT
        u.user_id,
        u.supabase_user_id,
        u.email,
        u.tier,
        u.created_at,
        p.first_name,
        p.last_name,
        p.phone,
        p.onboarding_metadata
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON p.user_id = u.user_id
      WHERE u.supabase_user_id = $1
      LIMIT 1;
    `;
    const userR = await pool.query(userQ, [supabase_user_id]);

    if (userR.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "AQUORIX_USER_NOT_FOUND",
        identity: { supabase_user_id, email: email_from_jwt },
        routing_hint: "onboarding",
      });
    }

    const dbUser = userR.rows[0];

    // Operator details (optional if operator_id missing)
    let operatorRow = null;
    if (operator_id) {
      const opQ = `
        SELECT operator_id, name, COALESCE(timezone, 'UTC') AS timezone
        FROM aquorix.diveoperators
        WHERE operator_id = $1
        LIMIT 1;
      `;
      const opR = await pool.query(opQ, [operator_id]);
      operatorRow = opR.rows[0] || null;
    }

    // Onboarding status
    const om = dbUser.onboarding_metadata || {};
    const current_step = om.current_step ?? null;
    const completed_steps = Array.isArray(om.completed_steps) ? om.completed_steps : [];
    const completion_percentage = om.completion_percentage ?? null;

    // Conservative completion check (match your existing 80% reality)
    const is_complete =
      completed_steps.length >= 4 &&
      (completion_percentage === null || completion_percentage >= 80);

    const routing_hint = is_complete ? "dashboard" : "onboarding";

    const permissions = {
      can_view_schedule: true,
      can_edit_profile: true,
      can_manage_operator: affiliation === "owner" || affiliation === "admin",
    };

    return res.json({
      ok: true,
      authenticated: true,

      identity: {
        supabase_user_id,
        email: dbUser.email || email_from_jwt,
      },

      aquorix_user: {
        user_id: dbUser.user_id,
        tier: dbUser.tier || null,
        created_at: dbUser.created_at || null,
        profile: {
          first_name: dbUser.first_name || null,
          last_name: dbUser.last_name || null,
          phone: dbUser.phone || null,
        },
      },

      operator: {
        operator_id: operator_id || null,
        name: operatorRow?.name || null,
        timezone: operatorRow?.timezone || null,
        affiliation,
      },

      onboarding: {
        current_step,
        completed_steps,
        completion_percentage,
        is_complete,
      },

      routing_hint,
      permissions,
      server_time_utc: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/v1/me] failed:", err);
    return res.status(500).json({
      ok: false,
      error: "ME_ENDPOINT_FAILED",
      message: err?.message || "Unknown error",
    });
  }
});

module.exports = router;
/**
 * ============================================================================
 * AQUORIX API - /api/v1/me (Identity + Operator/Affiliate Context)
 * ============================================================================
 * File:        src/routes/me.js
 * Purpose:     Single source of truth for authenticated user identity, operator
 *              context, affiliate context, onboarding status, and permission flags.
 * Version:     v1.0.6
 * Created:     2025-12-23
 * Updated:     2026-01-05
 * Author:      Larry McLean
 * Project:     AQUORIX™ API Project
 *
 * Description:
 * - Returns authenticated user context used for frontend routing and guards.
 * - Requires JWT auth (Supabase).
 * - DB-backed: canonical tier comes from aquorix.pro_profiles.tier_level (NOT users.tier).
 * - Tier 0: Internal Admin (AQUORIX staff) — routes to /admin/* and overrides onboarding.
 * - Tier 1–4: operator context from most recent active affiliation
 * - Tier 5: affiliate context from aquorix.affiliates; operator MUST be null
 *
 * Change Log:
 * -----------
 * v1.0.0 - 2025-12-23 - Larry McLean
 * v1.0.1 - 2025-12-24 - Larry McLean
 * v1.0.2 - 2025-12-25 - Larry McLean
 * v1.0.3 - 2025-12-29 - Larry McLean
 * v1.0.4 - 2026-01-04 - Larry McLean + ChatGPT Lead
 *   - Tier 5: operator is NULL; affiliate context returned from aquorix.affiliates
 *   - Reads Tier 5 country from pro_profiles.affiliate_details.country (JSONB)
 * v1.0.5 - 2026-01-05 - Larry McLean + ChatGPT Lead
 *   - Tier 0 precedence: tier_level === 0 ALWAYS routes admin, bypasses onboarding checks
 *   - Adds internal_admin object + deterministic permissions for Tier 0
 * v1.0.6 = 2026-01-06 - Larry McLean + AI Team
 *  - Added ui_mode to prevent future ambiguity
 * ============================================================================
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");

if (typeof requireAuth !== "function") {
  throw new Error("Middleware load error: requireAuth is not a function.");
}

function tierLabelFromLevel(tier_level) {
  const t = Number(tier_level);
  if (t === 0) return "internal_admin";
  if (t === 1) return "solo_pro";
  if (t === 2) return "solo_pro_entrepreneur";
  if (t === 3) return "dive_center";
  if (t === 4) return "integrated_operator";
  if (t === 5) return "affiliate";
  return "unknown";
}

function adminRoleFromLevel(admin_level) {
  const lvl = Number(admin_level);
  if (lvl === 1) return "viewer";
  if (lvl === 2) return "editor";
  if (lvl === 3) return "admin";
  return "viewer";
}

function deriveAdminPermissions(admin_level) {
  const basePermissions = {
    // Admin tools ON
    can_use_admin_tools: true,

    // Never allow Tier 0 to act as operator/affiliate user
    can_use_operator_tools: false,
    can_use_affiliate_tools: false,

    // Generic app permissions
    can_view_schedule: true,
    can_edit_profile: true,
    can_manage_operator: false,
  };

  const lvl = Number(admin_level);

  if (lvl === 1) {
    return {
      ...basePermissions,
      can_edit: false,
      can_approve: false,
      can_modify_config: false,
    };
  }

  if (lvl === 2) {
    return {
      ...basePermissions,
      can_edit: true,
      can_approve: false,
      can_modify_config: false,
    };
  }

  // lvl === 3 (or default)
  return {
    ...basePermissions,
    can_edit: true,
    can_approve: true,
    can_modify_config: true,
  };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const pool = req.app?.locals?.pool;
    if (!pool) {
      return res.status(500).json({ ok: false, error: "DB_POOL_MISSING" });
    }

    const supabase_user_id = req.auth?.supabase_user_id || null;
    const email_from_jwt = req.auth?.email || null;

    if (!supabase_user_id) {
      return res.status(401).json({
        ok: false,
        error: "AUTH_CONTEXT_MISSING",
        message: "JWT verified but supabase_user_id not found on req.auth",
      });
    }

    const userQ = `
      SELECT
        u.user_id,
        u.supabase_user_id,
        u.email,
        u.tier,          -- legacy
        u.role,
        u.created_at,
        p.tier_level,    -- canonical
        p.first_name,
        p.last_name,
        p.phone,
        p.business_name,
        p.logo_url AS pro_logo_url,
        p.affiliate_details,
        p.onboarding_metadata
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON p.user_id = u.user_id
      WHERE u.supabase_user_id = $1
      LIMIT 1;
    `;

    let userR = await pool.query(userQ, [supabase_user_id]);

    // Self-heal (unchanged behavior)
    if (userR.rows.length === 0) {
      if (!email_from_jwt) {
        return res.status(400).json({
          ok: false,
          error: "AUTH_EMAIL_MISSING",
          message: "JWT verified but email not found on req.auth; cannot self-heal users row.",
          identity: { supabase_user_id, email: null },
          routing_hint: "onboarding",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const emailLocal = String(email_from_jwt).split("@")[0] || "user";
        const safeBase = emailLocal
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");

        const uuidSuffix = String(supabase_user_id).replace(/-/g, "").slice(0, 8);
        const base = safeBase || "user";

        const u1 = `${base}_${uuidSuffix}`.slice(0, 50);
        const uuidSuffix2 = String(supabase_user_id).replace(/-/g, "").slice(0, 12);
        const u2 = `user_${uuidSuffix2}`.slice(0, 50);

        const userUpsertQ = `
          INSERT INTO aquorix.users (supabase_user_id, email, username, tier, role, created_at)
          VALUES ($1, $2, $3, 'solo', 'user', NOW())
          ON CONFLICT (supabase_user_id)
          DO UPDATE SET email = EXCLUDED.email
          RETURNING user_id;
        `;

        let user_id;

        try {
          const up1 = await client.query(userUpsertQ, [supabase_user_id, email_from_jwt, u1]);
          user_id = up1.rows[0]?.user_id;
        } catch (e) {
          if (e && e.code === "23505") {
            const up2 = await client.query(userUpsertQ, [supabase_user_id, email_from_jwt, u2]);
            user_id = up2.rows[0]?.user_id;
          } else {
            throw e;
          }
        }

        if (!user_id) throw new Error("SELF_HEAL_FAILED_NO_USER_ID");

        const nowIso = new Date().toISOString();
        const initOnboarding = {
          started_at: nowIso,
          current_step: 1,
          last_activity: nowIso,
          completed_steps: [],
          completion_percentage: 0,
        };

        await client.query(
          `
          INSERT INTO aquorix.pro_profiles (user_id, tier_level, onboarding_metadata)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (user_id) DO NOTHING;
          `,
          [user_id, 1, JSON.stringify(initOnboarding)]
        );

        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (rbErr) {
          console.error("[/api/v1/me] self-heal rollback failed:", rbErr);
        }

        console.error("[/api/v1/me] self-heal failed:", err);
        return res.status(500).json({
          ok: false,
          error: "SELF_HEAL_FAILED",
          message: err?.message || "Self-heal failed",
          identity: { supabase_user_id, email: email_from_jwt },
          routing_hint: "onboarding",
        });
      } finally {
        client.release();
      }

      userR = await pool.query(userQ, [supabase_user_id]);

      if (!userR.rows || userR.rows.length === 0) {
        return res.status(500).json({
          ok: false,
          error: "SELF_HEAL_POST_QUERY_FAILED",
          message: "Self-heal completed but canonical user query returned no rows.",
          identity: { supabase_user_id, email: email_from_jwt },
          routing_hint: "onboarding",
        });
      }
    }

    const dbUser = userR.rows[0];

    const tier_level = dbUser.tier_level ?? null;
    const tier_label = tierLabelFromLevel(tier_level);

    // Onboarding status (default behavior)
    const om = dbUser.onboarding_metadata || {};
    const current_step_default = om.current_step ?? null;
    const completed_steps_default = Array.isArray(om.completed_steps) ? om.completed_steps : [];
    const completion_percentage_default =
      typeof om.completion_percentage === "number" ? om.completion_percentage : null;

    const is_complete_default = om.is_complete === true || completion_percentage_default === 100;
    const routing_hint_default = is_complete_default ? "dashboard" : "onboarding";

    // Tier 0 precedence (CRITICAL): override onboarding and operator/affiliate context
    if (Number(tier_level) === 0) {
      // Fetch admin_level; default to 1 (viewer) if missing
      const adminQ = `
        SELECT admin_level
        FROM aquorix.internal_admins
        WHERE user_id = $1
        LIMIT 1;
      `;
      const adminR = await pool.query(adminQ, [dbUser.user_id]);
      const admin_level = adminR.rows[0]?.admin_level ?? 1;

      const internal_admin = {
        admin_level: Number(admin_level),
        admin_role: adminRoleFromLevel(admin_level),
      };

      const permissions = deriveAdminPermissions(admin_level);

      // Force onboarding complete for Tier 0 (single truth inside onboarding object)
      const onboarding = {
        current_step: null,
        completed_steps: [1, 2, 3, 4],
        completion_percentage: 100,
        is_complete: true,
      };

      const affiliateCountry =
        typeof dbUser?.affiliate_details?.country === "string"
          ? dbUser.affiliate_details.country
          : null;

      return res.json({
        ok: true,
        authenticated: true,

        identity: {
          supabase_user_id,
          email: dbUser.email || email_from_jwt,
        },

        aquorix_user: {
          user_id: dbUser.user_id,
          tier_level: tier_level,
          tier_label: tier_label,
          role: dbUser.role || "user",
          created_at: dbUser.created_at || null,
          legacy_tier: dbUser.tier || null,

          profile: {
            first_name: dbUser.first_name || null,
            last_name: dbUser.last_name || null,
            phone: dbUser.phone || null,
            business_name: dbUser.business_name || null,
            pro_logo_url: dbUser.pro_logo_url || null,
            affiliate_country: affiliateCountry || null,
          },
        },

        operator: null,
        affiliate: null,

        internal_admin, // NEW: Tier 0 only

        onboarding,

        routing_hint: "dashboard",
        ui_mode: "admin",

        permissions,
        server_time_utc: new Date().toISOString(),
      });
    }

    // Tier 5: affiliate context (operator MUST be null)
    let affiliate = null;
    let operator = null;

    const affiliateCountry =
      typeof dbUser?.affiliate_details?.country === "string"
        ? dbUser.affiliate_details.country
        : null;

    if (Number(tier_level) === 5) {
      const affQ = `
        SELECT
          affiliate_id,
          user_id,
          languages_spoken,
          short_description,
          verified_by_aquorix,
          verified_at,
          logo_url,
          is_test
        FROM aquorix.affiliates
        WHERE user_id = $1
        LIMIT 1;
      `;

      const affR = await pool.query(affQ, [dbUser.user_id]);
      affiliate = affR.rows[0] || null;

      // Hard invariant: operator must be null for Tier 5
      operator = null;
    } else {
      // Tier 1–4: deterministic operator selection
      const affiliationQ = `
        SELECT
          a.operator_id,
          a.affiliation_type,
          a.created_at
        FROM aquorix.user_operator_affiliations a
        WHERE a.user_id = $1
          AND a.active = true
        ORDER BY a.created_at DESC
        LIMIT 1;
      `;

      const affR = await pool.query(affiliationQ, [dbUser.user_id]);
      const primaryAff = affR.rows[0] || null;

      const operator_id = primaryAff?.operator_id ?? null;
      const affiliation_type = primaryAff?.affiliation_type ?? null;

      let operatorRow = null;
      if (operator_id) {
        const opQ = `
          SELECT
            operator_id,
            name,
            logo_url,
            COALESCE(timezone, 'UTC') AS timezone
          FROM aquorix.diveoperators
          WHERE operator_id = $1
          LIMIT 1;
        `;
        const opR = await pool.query(opQ, [operator_id]);
        operatorRow = opR.rows[0] || null;
      }

      operator = {
        operator_id: operator_id || null,
        name: operatorRow?.name || null,
        logo_url: operatorRow?.logo_url || null,
        timezone: operatorRow?.timezone || null,
        affiliation_type: affiliation_type || null,
      };
    }

    // Permissions (simple, deterministic)
    const can_manage_operator =
      dbUser.role === "admin" ||
      (operator?.affiliation_type === "staff" &&
        (Number(tier_level) === 2 || Number(tier_level) === 3 || Number(tier_level) === 4));

    const permissions = {
      can_view_schedule: true,
      can_edit_profile: true,
      can_manage_operator: Boolean(can_manage_operator),
      can_use_affiliate_tools: Number(tier_level) === 5,
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
        tier_level: tier_level,
        tier_label: tier_label,
        role: dbUser.role || "user",
        created_at: dbUser.created_at || null,
        legacy_tier: dbUser.tier || null,

        profile: {
          first_name: dbUser.first_name || null,
          last_name: dbUser.last_name || null,
          phone: dbUser.phone || null,
          business_name: dbUser.business_name || null,
          pro_logo_url: dbUser.pro_logo_url || null,
          affiliate_country: affiliateCountry || null,
        },
      },

      operator,   // Tier 5: null, Tier 1–4: object
      affiliate,  // Tier 5: object (if exists), Tier 1–4: null

      onboarding: {
        current_step: current_step_default,
        completed_steps: completed_steps_default,
        completion_percentage: completion_percentage_default,
        is_complete: is_complete_default,
      },

      routing_hint: routing_hint_default,
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
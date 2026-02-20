/*
  File: requireDashboardScope.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/middleware/requireDashboardScope.js
  Description:
    AQUORIX VIKING - Dashboard auth + operator scope middleware (Phase 4/6 rules).
    - Derives operator_id from:
        users.supabase_user_id -> users.user_id -> user_operator_affiliations(active=true)
    - Never accepts operator_id from request body/query params
    - If >1 active affiliations:
        - If users.active_operator_id matches an active affiliation, uses it
        - Else returns 409 conflict (operator selection required)
    - Phase 6 behavior:
        - If active_operator_id is NULL and exactly one affiliation exists, auto-sets it in DB

    Attaches:
      req.aquorix_user  { supabase_user_id, user_id, role, tier }
      req.operator_id   (scoped operator_id)

  Author: ChatGPT (Lead) + Larry McLean (Product Owner)
  Created: 2026-02-20
  Version: v1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE (VIKING)

  Change Log:
    - 2026-02-20 - v1.0.0 (ChatGPT + Larry):
      - Extracted requireDashboardScope from server.js Phase 4/6 section (no behavior change).
      - Removed duplicate JSON key "status" in one 403 response (no functional change; duplicate keys overwrite).
*/

const { getSupabaseUserIdFromBearer } = require('../lib/jwt');

function requireDashboardScopeFactory({ pool }) {
  if (!pool) throw new Error('[requireDashboardScopeFactory] Missing required dependency: pool');

  return async function requireDashboardScope(req, res, next) {
    const supabase_user_id = getSupabaseUserIdFromBearer(req.headers.authorization);

    if (!supabase_user_id) {
      return res
        .status(401)
        .json({ ok: false, status: "unauthorized", message: "Missing or invalid Bearer token" });
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
        return res
          .status(404)
          .json({ ok: false, status: "not_found", message: "User not found in AQUORIX DB" });
      }

      const user = userResult.rows[0];

      if (user.is_active === false) {
        return res
          .status(403)
          .json({ ok: false, status: "forbidden", message: "User is inactive" });
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
      return res
        .status(500)
        .json({ ok: false, status: "error", message: "Internal server error" });
    }
  };
}

module.exports = { requireDashboardScopeFactory };

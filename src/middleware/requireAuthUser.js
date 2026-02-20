/*
  File: requireAuthUser.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/middleware/requireAuthUser.js
  Description:
    AQUORIX VIKING - Basic auth middleware (NO operator scope).
    - Validates Bearer token format
    - Resolves AQUORIX user (aquorix.users)
    - Attaches req.aquorix_user_basic

  Author: ChatGPT (Lead) + Larry McLean (Product Owner)
  Created: 2026-02-20
  Version: v1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE (VIKING)

  Change Log:
    - 2026-02-20 - v1.0.0 (ChatGPT + Larry):
      - Extracted requireAuthUser from server.js Phase 6 section (no behavior change).
*/

const { getSupabaseUserIdFromBearer } = require('../lib/jwt');

function requireAuthUserFactory({ pool }) {
  if (!pool) throw new Error('[requireAuthUserFactory] Missing required dependency: pool');

  return async function requireAuthUser(req, res, next) {
    const supabase_user_id = getSupabaseUserIdFromBearer(req.headers.authorization);

    if (!supabase_user_id) {
      return res
        .status(401)
        .json({ ok: false, status: "unauthorized", message: "Missing or invalid Bearer token" });
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

      req.aquorix_user_basic = {
        supabase_user_id,
        user_id: user.user_id,
        role: user.role,
        tier: user.tier
      };

      return next();
    } catch (err) {
      console.error("[requireAuthUser] Error:", err && err.stack ? err.stack : err);
      return res
        .status(500)
        .json({ ok: false, status: "error", message: "Internal server error" });
    }
  };
}

module.exports = { requireAuthUserFactory };

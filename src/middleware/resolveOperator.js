/**
 * ============================================================================
 * AQUORIX Operator Resolution Middleware (Phase B)
 * ============================================================================
 * Purpose:
 *  - Resolve operator_id from authenticated Supabase user (JWT sub)
 *  - Uses canonical linkage:
 *      supabase_user_id (UUID) -> aquorix.users.user_id (bigint)
 *      -> aquorix.user_operator_affiliations.operator_id (active=true)
 *
 * Created: Not sure ?
 * Version: (?) 1.0.1
 * 
 * Notes:
 *  - Phase B: READ ONLY
 *  - No permission enforcement yet (that is B3/B4)
 *
 * IMPORTANT (Phase B+ Gate 1):
 *  - This middleware MUST NOT block brand-new Supabase users before /api/v1/me self-heal runs.
 *  - This middleware MUST NOT block Tier 1/2 users who legitimately have no operator affiliation.
 * 
 * Change Log:
 *  - 12-26-2025 - v1.0.1 - Replace the function with this version (keeps your header, preserves Phase B read-only intent, but removes hard-fails for “missing user” and “no affiliation”)
 * ============================================================================
 */

async function resolveOperator(req, res, next) {
  try {
    if (!req.auth?.supabase_user_id) {
      return res.status(401).json({ error: "missing_auth_context" });
    }

    const pool = req.app.locals.pool;
    const supabaseUserId = req.auth.supabase_user_id;

    // Default: no operator context (allowed for Tier 1/2 and for brand-new users)
    req.operatorContext = {
      user_id: null,
      operator_id: null,
      affiliation_type: null,
    };

    // 1) supabase_user_id -> user_id (may not exist yet for brand-new signup)
    const userQ = `
      SELECT user_id
      FROM aquorix.users
      WHERE supabase_user_id = $1
      LIMIT 1
    `;
    const userR = await pool.query(userQ, [supabaseUserId]);

    // Phase B+ Gate 1: do NOT hard-fail here.
    // Allow /api/v1/me to self-heal and create the missing user row.
    if (userR.rowCount === 0) {
      // Phase B+: allow brand-new Supabase users to reach /api/v1/me self-heal
      req.operatorContext = {
        user_id: null,
        operator_id: null,
        affiliation_type: null,
      };
      return next();
    }


    const userId = userR.rows[0].user_id;
    req.operatorContext.user_id = userId;

    // 2) user_id -> active operator affiliation (may legitimately not exist for Tier 1/2)
    const affQ = `
      SELECT operator_id, affiliation_type
      FROM aquorix.user_operator_affiliations
      WHERE user_id = $1
        AND active = true
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const affR = await pool.query(affQ, [userId]);

    // Phase B+: do NOT hard-fail if no operator affiliation.
    // Tier 1/2 users are allowed to have no operator.
    if (affR.rowCount === 0) {
      // Phase B+: user exists but has no operator yet (Tier 1/2 expected)
      req.operatorContext = {
        user_id: userId,
        operator_id: null,
        affiliation_type: null,
      };
      return next();
    }

    req.operatorContext.operator_id = affR.rows[0].operator_id;
    req.operatorContext.affiliation_type = affR.rows[0].affiliation_type || null;

    return next();
  } catch (err) {
    console.error("[resolveOperator] failed:", err);
    return res.status(500).json({ error: "operator_resolution_failed" });
  }
}

module.exports = resolveOperator;
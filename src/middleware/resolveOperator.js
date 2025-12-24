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
 * Notes:
 *  - Phase B: READ ONLY
 *  - No permission enforcement yet (that is B3/B4)
 * ============================================================================
 */

async function resolveOperator(req, res, next) {
  try {
    if (!req.auth?.supabase_user_id) {
      return res.status(401).json({ error: "missing_auth_context" });
    }

    const pool = req.app.locals.pool;
    const supabaseUserId = req.auth.supabase_user_id;

    // 1) supabase_user_id -> user_id
    const userQ = `
      SELECT user_id
      FROM aquorix.users
      WHERE supabase_user_id = $1
      LIMIT 1
    `;
    const userR = await pool.query(userQ, [supabaseUserId]);

    if (userR.rowCount === 0) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const userId = userR.rows[0].user_id;

    // 2) user_id -> active operator affiliation
    const affQ = `
      SELECT operator_id, affiliation_type
      FROM aquorix.user_operator_affiliations
      WHERE user_id = $1
        AND active = true
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const affR = await pool.query(affQ, [userId]);

    if (affR.rowCount === 0) {
      return res.status(403).json({ error: "no_operator_affiliation" });
    }

    req.operatorContext = {
      user_id: userId,
      operator_id: affR.rows[0].operator_id,
      affiliation_type: affR.rows[0].affiliation_type || null,
    };

    return next();
  } catch (err) {
    console.error("[resolveOperator] failed:", err);
    return res.status(500).json({ error: "operator_resolution_failed" });
  }
}

module.exports = resolveOperator;
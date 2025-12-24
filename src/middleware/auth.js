/**
 * ============================================================================
 * AQUORIX Auth Middleware (Phase B)
 * ============================================================================
 * Purpose:
 *  - Verify Supabase JWT from Authorization header
 *  - Extract supabase_user_id (sub)
 *  - Attach user context to request
 *
 * Notes:
 *  - READ ONLY in Phase B
 *  - No permissions enforced yet
 * ============================================================================
 */

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);

    req.auth = {
      supabase_user_id: decoded.sub,
      email: decoded.email || null,
      role: decoded.role || null,
      raw: decoded
    };

    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      detail: err.message
    });
  }
}

module.exports = requireAuth;
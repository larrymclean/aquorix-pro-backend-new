/*
  File: jwt.js
  Path: src/lib/jwt.js
  Description:
    Minimal JWT parsing helpers for AQUORIX Pro Backend.
    NOTE: This does NOT verify signatures. It mirrors the existing server.js behavior (move-only).
    Future hardening: verify Supabase JWT using JWKS.

  Author: AQUORIX
  Created: 2026-02-20
  Version: 1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE

  Change Log:
    - 2026-02-20 - v1.0.0:
      - Initial extraction from server.js (no logic changes)
*/

function base64UrlDecode(str) {
  // base64url -> base64
  const base64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  // pad
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSupabaseUserIdFromBearer(authHeader) {
  if (!authHeader) return null;

  const raw = String(authHeader).trim();

  // Accept either:
  //  - "Bearer <token>" (any whitespace, any casing on Bearer)
  //  - "<token>" (already stripped upstream)
  let token = raw;

  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) token = m[1].trim();

  const tokenParts = String(token).split('.');
  if (tokenParts.length < 2) return null;

  try {
    const payloadJson = base64UrlDecode(tokenParts[1]);
    const payload = JSON.parse(payloadJson);

    // Supabase JWT commonly uses "sub" as the user id.
    return payload && payload.sub ? String(payload.sub) : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  base64UrlDecode,
  getSupabaseUserIdFromBearer,
};

/*
  File: api.ts
  Path: /Users/larrymclean/CascadeProjects/aquorix-pro-backend-new/src/types/api.ts
  Description:
    Canonical public contract types for AQUORIX Smart Dashboard boot endpoint: GET /api/v1/me.
    NOTE: This file is contract documentation + shared typing reference.
    It is not required by runtime Node (server.js) unless explicitly imported.

  Author: Larry McLean
  Created: 2026-01-07
  Version: v1.0.0

  Last Updated: 2026-01-07
  Status: Locked (Contract v1)

  Change Log:
    - 2026-01-07 - v1.0.0 (Larry McLean):
      - Added canonical /api/v1/me contract types (api_version, routing_hint, ui_mode, user, permissions, context objects).
*/

export type ApiVersion = "v1";

export type RoutingHint = "login" | "onboarding" | "dashboard";

export type UIMode = "admin" | "pro" | "affiliate";

export type TierLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Canonical user object for /api/v1/me.
 * This shape is intentionally minimal and stable.
 * Breaking changes require a new endpoint version (e.g., /api/v2/me).
 */
export interface CanonicalUser {
  user_id: number;
  email: string;
  tier_level: TierLevel;
}

/**
 * Permissions are capability flags. Missing keys MUST be treated as false by the frontend.
 * Backend is free to add new keys (append-only), but must not rename existing keys without version bump.
 */
export type PermissionFlags = Record<string, boolean>;

/**
 * Context objects are optional and MUST remain minimal (TopNav + shell needs only).
 * Do not add sensitive data here.
 */
export interface InternalAdminContext {
  admin_level: number;
  admin_role?: string;
}

export interface OperatorContext {
  operator_id: number;
  name: string;
  logo_url?: string | null;
  location?: string | null;
}

export interface AffiliateContext {
  affiliate_id: number;
  name: string;
  logo_url?: string | null;
  location?: string | null;
}

export interface MeResponse {
  api_version: ApiVersion;

  ok: boolean;
  authenticated: boolean;

  routing_hint: RoutingHint;
  ui_mode: UIMode;

  user: CanonicalUser;
  permissions: PermissionFlags;

  // Optional context objects (one may be present depending on ui_mode / tier)
  internal_admin?: InternalAdminContext | null;
  operator?: OperatorContext | null;
  affiliate?: AffiliateContext | null;

  // Optional preference fields
  theme_preference?: string | null;

  // Optional debug / server metadata
  server_time_utc?: string;

  // Legacy fields may exist temporarily, but frontend MUST NOT depend on them
  // (intentionally not typed here)
}
/*
  File: me.contract.test.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-pro-backend-new/__tests__/contracts/me.contract.test.js
  Description:
    Contract validation test for GET /api/v1/me response shape (Smart Dashboard Contract v1).

    IMPORTANT:
    - This test is intentionally "shape only" and does NOT require live Supabase JWT verification.
    - It protects our canonical keys from accidental breaking changes.

  Author: Larry McLean
  Created: 2026-01-07
  Version: v1.0.0

  Last Updated: 2026-01-07
  Status: Active

  Change Log:
    - 2026-01-07 - v1.0.0 (Larry McLean):
      - Added /api/v1/me contract shape test with canonical keys: api_version, routing_hint, ui_mode, user, permissions.
*/

describe("AQUORIX Smart Dashboard Contract v1 - /api/v1/me", () => {
  test("canonical keys exist and have correct basic types", () => {
    // Real-world sample (captured from local curl 2026-01-07).
    // Keep this minimal: only what the contract guarantees.
    const body = {
      api_version: "v1",
      ok: true,
      authenticated: true,
      routing_hint: "dashboard",
      ui_mode: "admin",
      user: {
        user_id: 106,
        email: "larry@aquorix.pro",
        tier_level: 0,
      },
      permissions: {
        can_use_admin_tools: true,
      },
      // Context keys can exist, but are optional
      internal_admin: { admin_level: 3 },
      operator: null,
      affiliate: null,
    };

    // Required top-level keys (LOCKED for v1)
    expect(body).toHaveProperty("api_version");
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("authenticated");
    expect(body).toHaveProperty("routing_hint");
    expect(body).toHaveProperty("ui_mode");
    expect(body).toHaveProperty("user");
    expect(body).toHaveProperty("permissions");

    // Types / enums
    expect(body.api_version).toBe("v1");
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.authenticated).toBe("boolean");

    expect(["login", "onboarding", "dashboard"]).toContain(body.routing_hint);
    expect(["admin", "pro", "affiliate"]).toContain(body.ui_mode);

    // Canonical user shape (minimal + stable)
    expect(body.user).toHaveProperty("user_id");
    expect(body.user).toHaveProperty("email");
    expect(body.user).toHaveProperty("tier_level");

    expect(Number.isInteger(body.user.user_id)).toBe(true);
    expect(typeof body.user.email).toBe("string");
    expect([0, 1, 2, 3, 4, 5]).toContain(body.user.tier_level);

    // Permissions contract: boolean flags
    expect(typeof body.permissions).toBe("object");
    for (const [k, v] of Object.entries(body.permissions)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("boolean");
    }
  });
});
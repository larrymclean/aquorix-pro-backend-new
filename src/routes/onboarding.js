// File: src/routes/onboarding.js
// Description: AQUORIX Onboarding API routes for user onboarding steps (Step 1, ...)
// Author: Cascade AI (with Larry McLean)
// Created: 2025-09-17
// Last Updated: 2025-09-17
// Status: In Progress
// Dependencies: express, pg (Pool)
// Notes: Implements POST /api/onboarding/step1 for onboarding Step 1 identity persistence.
// Change Log:
//   - 2025-09-17 (Cascade): Initial implementation of onboarding step 1 endpoint, transaction-safe upsert into users and pro_profiles.

const express = require('express');
const router = express.Router();

// POST /api/onboarding/step1
router.post('/step1', async (req, res) => {
  const { supabase_user_id, first_name, last_name, phone, email } = req.body;

  const pool = req.app.locals.pool;

  if (!supabase_user_id || !first_name || !last_name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists in aquorix.users
    const userResult = await client.query(
      `
      INSERT INTO aquorix.users (supabase_user_id, email, username, phone_number, role, tier)
      VALUES ($1, $2, $3, $4, 'user', 'solo')
      ON CONFLICT (supabase_user_id) DO UPDATE
        SET email = EXCLUDED.email,
            phone_number = EXCLUDED.phone_number
      RETURNING user_id
      `,
      [supabase_user_id, email, email, phone]
    );

    const userId = userResult.rows[0].user_id;

    // 2. Upsert into pro_profiles with new Step 1 fields
    await client.query(
      `
      INSERT INTO aquorix.pro_profiles (
        user_id, tier_level, first_name, last_name, phone, dashboard_theme, onboarding_metadata
      )
      VALUES ($1, 1, $2, $3, $4, 'default',
        jsonb_build_object(
          'started_at', NOW(),
          'current_step', 1,
          'last_activity', NOW(),
          'completed_steps', ARRAY[1],
          'completion_percentage', 20
        )
      )
      ON CONFLICT (user_id) DO UPDATE
        SET first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            phone = EXCLUDED.phone,
            onboarding_metadata = jsonb_set(
              pro_profiles.onboarding_metadata,
              '{last_activity}', to_jsonb(NOW()), true
            )
      `,
      [userId, first_name, last_name, phone]
    );

    await client.query('COMMIT');
    return res.status(200).json({ success: true, user_id: userId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Onboarding Step 1 DB error:', err);
    return res.status(500).json({ error: 'Failed to save profile data.' });
  } finally {
    client.release();
  }
});


/**
 * GET /api/onboarding/step1/:supabase_user_id
 * Fetch Step 1 identity data (first_name, last_name, phone) from pro_profiles for the given supabase_user_id.
 * Returns 404 if not found, 500 on error.
 * Last Updated: 2025-09-17 (Cascade)
 */
router.get('/step1/:supabase_user_id', async (req, res) => {
  const { supabase_user_id } = req.params;

  const pool = req.app.locals.pool;
  
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT p.first_name, p.last_name, p.phone
       FROM aquorix.pro_profiles p
       JOIN aquorix.users u ON u.user_id = p.user_id
       WHERE u.supabase_user_id = $1`,
      [supabase_user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching Step 1 data:', err);
    res.status(500).json({ error: 'Failed to fetch Step 1 data' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/users/update-step
 * Update onboarding progress in pro_profiles.onboarding_metadata
 */
router.post("/update-step", async (req, res) => {
  const pool = req.app.locals.pool;

  const {
    supabase_user_id,
    current_step,
    completed_steps,
    completion_percentage
  } = req.body;

  if (!supabase_user_id || typeof current_step !== "number") {
    return res.status(400).json({ error: "Missing required fields: supabase_user_id, current_step(number)" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const u = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );

    if (u.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const userId = u.rows[0].user_id;

    const completed = Array.isArray(completed_steps) ? completed_steps : [];
    const pct = typeof completion_percentage === "number" ? completion_percentage : 0;

    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET onboarding_metadata =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(onboarding_metadata, '{}'::jsonb),
              '{current_step}', to_jsonb($2::int), true
            ),
            '{completed_steps}', to_jsonb($3::int[]), true
          ),
          '{completion_percentage}', to_jsonb($4::int), true
        )
      WHERE user_id = $1
      `,
      [userId, current_step, completed, pct]
    );

    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[update-step] error:", err);
    return res.status(500).json({ error: "Failed to update onboarding step", detail: err.message });
  } finally {
    client.release();
  }
});

// PROMOTE USER (Tier-only)
// Guardrail: Do NOT update users.role here (users.role is a PostgreSQL ENUM and can break if invalid).
router.post("/promote", async (req, res) => {
  const pool = req.app?.locals?.pool;

  if (!pool) {
    return res.status(500).json({
      success: false,
      error: "Server misconfigured: PostgreSQL pool missing (req.app.locals.pool)",
    });
  }

  const { supabase_user_id, tier } = req.body || {};

  if (!supabase_user_id || typeof supabase_user_id !== "string") {
    return res.status(400).json({ success: false, error: "supabase_user_id is required" });
  }
  if (!tier || typeof tier !== "string") {
    return res.status(400).json({ success: false, error: "tier is required" });
  }

  try {
    // Update ONLY tier. Do not touch role.
    // NOTE: If your column is NOT named "tier", adjust it here (see Step 4 below to verify).
    const sql = `
      UPDATE aquorix.users
      SET tier = $1,
          updated_at = NOW()
      WHERE supabase_user_id = $2
      RETURNING user_id, tier
    `;

    const result = await pool.query(sql, [tier, supabase_user_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "No user found for supabase_user_id",
      });
    }

    return res.json({
      success: true,
      user_id: result.rows[0].user_id,
      tier: result.rows[0].tier,
    });
  } catch (err) {
    // This will catch invalid tier enum too (if tier is an enum), but role will NEVER break promote again.
    console.error("POST /promote error:", err);
    return res.status(500).json({
      success: false,
      error: "Promotion failed",
      detail: err?.message,
    });
  }
});

module.exports = router;

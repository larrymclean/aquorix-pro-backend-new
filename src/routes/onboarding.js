/*
  File: onboarding.js
  Path: src/routes/onboarding.js
  Description: AQUORIX onboarding API routes for user onboarding steps (Step 1, Step 1 GET)
  Author: Cascade AI (with Larry McLean)
  Created: 2025-09-18
  Last Updated: 2025-09-18
  Status: Restored after directory cleanup
  Dependencies: express, pg (Pool)
  Notes: Implements POST /api/onboarding/step1 and GET /api/onboarding/step1/:supabase_user_id for onboarding identity persistence and retrieval.
  Change Log:
    - 2025-09-18 (Cascade): Restore onboarding.js with POST and GET endpoints after directory migration.
*/

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

// POST /api/onboarding/step1
router.post('/step1', async (req, res) => {
  const { supabase_user_id, first_name, last_name, phone, email } = req.body;

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
 * Last Updated: 2025-09-18 (Cascade)
 */
router.get('/step1/:supabase_user_id', async (req, res) => {
  const { supabase_user_id } = req.params;
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

module.exports = router;

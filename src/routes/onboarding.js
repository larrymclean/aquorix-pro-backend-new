// File: src/routes/onboarding.js
// Description: AQUORIX Onboarding API routes for user onboarding steps.
// Author: Cascade AI (with Larry McLean) + ChatGPT Lead
// Created: 2025-09-17
// Last Updated: 2025-12-28
// Status: Phase B+ — Backend-authoritative onboarding (Wizard = single writer)
// Dependencies: express, pg (Pool)
// Notes:
//  - Step 1 persists identity into aquorix.users + aquorix.pro_profiles.
//  - update-step persists onboarding_metadata and performs strict sealing at 100%.
//  - Step 3 (NEW): creates operator + affiliation in AQUORIX Postgres (bigint IDs), stores logo_url, no client DB writes.
//  - affiliation_type enum labels are: staff, customer, freelance. MVP uses 'staff' as owner-equivalent membership.
// Change Log:
//   - 2025-09-17 (Cascade): Initial implementation of onboarding step 1 endpoint, transaction-safe upsert into users and pro_profiles.
//   - 2025-12-27 (Larry + ChatGPT Lead): Phase B+ Gate 2 strict seal + optional tier_level persistence (canonical pro_profiles.tier_level)
//   - 2025-12-28 (Larry + ChatGPT Lead): Added POST /api/onboarding/step3 (E2) to insert diveoperators + affiliations (staff) using bigint user_id resolution.

const express = require('express');
const router = express.Router();

/**
 * POST /api/onboarding/step1
 * Persist onboarding Step 1 identity into AQUORIX Postgres.
 */
router.post('/step1', async (req, res) => {
  // LSM Debug 12-27-2025
  console.log('[step1] origin:', req.headers.origin);
  console.log('[step1] body:', req.body);

  const { supabase_user_id, first_name, last_name, phone, email } = req.body;

  const pool = req.app.locals.pool;

  if (!supabase_user_id || !first_name || !last_name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Ensure user exists in aquorix.users
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

    // 2) Upsert into pro_profiles with Step 1 fields
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
 * POST /api/onboarding/step3
 * E2: Create operator + user affiliation (bigint IDs) and store logo_url in AQUORIX Postgres.
 *
 * Input (JSON):
 *  - supabase_user_id (uuid string) REQUIRED
 *  - tier_level (1..5) OPTIONAL (wizard often sets earlier via update-step)
 *  - operator_name (string) REQUIRED for tiers 1..4 (for tier 5, may be provided or can be omitted)
 *  - logo_url (string|null) OPTIONAL
 *  - contact_info (jsonb) OPTIONAL
 *  - website (string|null) OPTIONAL
 *  - description (string|null) OPTIONAL
 *  - is_test (boolean) OPTIONAL
 *
 * Output:
 *  - success
 *  - user_id (bigint)
 *  - operator_id (bigint)
 *  - affiliation_type ('staff')
 *  - logo_url (string|null)
 */
router.post('/step3', async (req, res) => {
  console.log('[step3] origin:', req.headers.origin);
  console.log('[step3] body keys:', Object.keys(req.body || {}));

  const pool = req.app.locals.pool;

  const {
    supabase_user_id,
    tier_level,
    operator_name,
    logo_url,
    contact_info,
    website,
    description,
    is_test,
  } = req.body || {};

  if (!supabase_user_id || typeof supabase_user_id !== 'string') {
    return res.status(400).json({ error: 'Missing required field: supabase_user_id' });
  }

  // For MVP, Step 3 is primarily for operator context (tiers 1..4).
  // If your Tier 5 flow creates affiliates only, you can relax this later.
  if (!operator_name || typeof operator_name !== 'string' || !operator_name.trim()) {
    return res.status(400).json({ error: 'Missing required field: operator_name' });
  }

  const operatorName = operator_name.trim().slice(0, 100); // matches diveoperators.name varchar(100)
  const logoUrl = typeof logo_url === 'string' && logo_url.trim() ? logo_url.trim().slice(0, 255) : null;
  const websiteVal = typeof website === 'string' && website.trim() ? website.trim().slice(0, 255) : null;
  const descriptionVal = typeof description === 'string' && description.trim() ? description.trim() : null;
  const isTest = typeof is_test === 'boolean' ? is_test : false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Resolve bigint user_id
    const u = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );

    if (u.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found for supabase_user_id' });
    }

    const userId = u.rows[0].user_id;

    // 2) OPTIONAL: persist tier_level (DB is King)
    if (tier_level !== undefined && tier_level !== null) {
      const parsedTier = Number(tier_level);
      if (![1, 2, 3, 4, 5].includes(parsedTier)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid tier_level '${tier_level}'. Must be 1..5.` });
      }

      await client.query(
        `
        UPDATE aquorix.pro_profiles
        SET tier_level = $1,
            updated_at = NOW()
        WHERE user_id = $2
        `,
        [parsedTier, userId]
      );
    }

    // 3) Create operator (or reuse latest operator created by user with same name)
    // We prefer to avoid duplicates if user retries.
    let operatorId = null;

    const existingOp = await client.query(
      `
      SELECT operator_id
      FROM aquorix.diveoperators
      WHERE created_by_user_id = $1 AND name = $2
      ORDER BY operator_id DESC
      LIMIT 1
      `,
      [userId, operatorName]
    );

    if (existingOp.rowCount > 0) {
      operatorId = existingOp.rows[0].operator_id;

      // Update mutable fields if provided (safe, idempotent)
      await client.query(
        `
        UPDATE aquorix.diveoperators
        SET logo_url = COALESCE($1, logo_url),
            contact_info = COALESCE($2::jsonb, contact_info),
            website = COALESCE($3, website),
            description = COALESCE($4, description),
            is_test = $5,
            updated_at = NOW()
        WHERE operator_id = $6
        `,
        [logoUrl, contact_info ? JSON.stringify(contact_info) : null, websiteVal, descriptionVal, isTest, operatorId]
      );
    } else {
      const opR = await client.query(
        `
        INSERT INTO aquorix.diveoperators
          (name, created_by_user_id, logo_url, contact_info, website, description, is_test, updated_at)
        VALUES
          ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
        RETURNING operator_id
        `,
        [
          operatorName,
          userId,
          logoUrl,
          contact_info ? JSON.stringify(contact_info) : null,
          websiteVal,
          descriptionVal,
          isTest,
        ]
      );

      operatorId = opR.rows[0]?.operator_id || null;
      if (!operatorId) {
        throw new Error('OPERATOR_CREATE_FAILED');
      }
    }

    // 4) Create affiliation (MVP owner-equivalent membership)
    // Enum labels confirmed: staff, customer, freelance. We use 'staff'.
    await client.query(
      `
      INSERT INTO aquorix.user_operator_affiliations
        (user_id, operator_id, affiliation_type, active)
      SELECT $1, $2, 'staff', true
      WHERE NOT EXISTS (
        SELECT 1
        FROM aquorix.user_operator_affiliations uoa
        WHERE uoa.user_id = $1
          AND uoa.operator_id = $2
          AND uoa.active = true
      )
      `,
      [userId, operatorId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      user_id: userId,
      operator_id: operatorId,
      affiliation_type: 'staff',
      logo_url: logoUrl,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Onboarding Step 3 DB error:', err);
    return res.status(500).json({ error: 'Failed to save Step 3 data.', detail: err?.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/onboarding/update-step
 * Update onboarding progress in pro_profiles.onboarding_metadata
 */
router.post('/update-step', async (req, res) => {
  const pool = req.app.locals.pool;

  const {
    supabase_user_id,
    current_step,
    completed_steps,
    completion_percentage,
    tier_level,
    selected_tier,
  } = req.body;

  if (!supabase_user_id || typeof current_step !== 'number') {
    return res
      .status(400)
      .json({ error: 'Missing required fields: supabase_user_id, current_step(number)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );

    if (u.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = u.rows[0].user_id;

    // OPTIONAL: Persist tier_level (DB is King)
    if (tier_level !== undefined && tier_level !== null) {
      const parsedTier = Number(tier_level);

      if (![1, 2, 3, 4, 5].includes(parsedTier)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Invalid tier_level '${tier_level}'. Must be 1..5.`,
          hint: 'Admin is role-based, not tier_level.',
        });
      }

      await client.query(
        `
        UPDATE aquorix.pro_profiles
        SET tier_level = $1,
            updated_at = NOW()
        WHERE user_id = $2
        `,
        [parsedTier, userId]
      );
    }

    const completed = Array.isArray(completed_steps) ? completed_steps : [];
    const pct = typeof completion_percentage === 'number' ? completion_percentage : 0;

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

    // STRICT sealing: only when step 4 reached AND pct >= 100
    const reachedStep4 = current_step >= 4 || (Array.isArray(completed) && completed.includes(4));
    const reachedPct = pct >= 100;
    const shouldSeal = reachedStep4 && reachedPct;

    let sealed = false;

    if (shouldSeal) {
      const tierR = await client.query(
        `
        SELECT tier_level
        FROM aquorix.pro_profiles
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );

      const tier_level_db = tierR.rows[0]?.tier_level || null;
      if (!tier_level_db) {
        throw new Error('TIER_LEVEL_NOT_FOUND');
      }

      // Tier 1–2: Optional dive_leaders
      if (tier_level_db === 1 || tier_level_db === 2) {
        await client.query(
          `
          INSERT INTO aquorix.dive_leaders (user_id)
          SELECT $1
          WHERE NOT EXISTS (
            SELECT 1 FROM aquorix.dive_leaders dl WHERE dl.user_id = $1
          )
          `,
          [userId]
        );
      }

      // Tier 3–4: Required operator + affiliation (fallback if missing)
      if (tier_level_db === 3 || tier_level_db === 4) {
        const existingAff = await client.query(
          `
          SELECT operator_id
          FROM aquorix.user_operator_affiliations
          WHERE user_id = $1 AND active = true
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [userId]
        );

        if (existingAff.rowCount === 0) {
          const profileR = await client.query(
            `
            SELECT business_name, first_name, last_name
            FROM aquorix.pro_profiles
            WHERE user_id = $1
            LIMIT 1
            `,
            [userId]
          );

          const p = profileR.rows[0] || {};
          const operatorName =
            (p.business_name || '').trim() ||
            `${(p.first_name || 'Pro').trim()} ${(p.last_name || 'Diver').trim()} Diving`;

          const opR = await client.query(
            `
            INSERT INTO aquorix.diveoperators (name, created_by_user_id, updated_at)
            VALUES ($1, $2, NOW())
            RETURNING operator_id
            `,
            [operatorName.slice(0, 100), userId]
          );

          const operator_id = opR.rows[0]?.operator_id;
          if (!operator_id) throw new Error('OPERATOR_CREATE_FAILED');

          await client.query(
            `
            INSERT INTO aquorix.user_operator_affiliations
              (user_id, operator_id, affiliation_type, active)
            SELECT $1, $2, 'staff', true
            WHERE NOT EXISTS (
              SELECT 1
              FROM aquorix.user_operator_affiliations uoa
              WHERE uoa.user_id = $1
                AND uoa.operator_id = $2
                AND uoa.active = true
            )
            `,
            [userId, operator_id]
          );
        }
      }

      // Tier 5: Required affiliate
      if (tier_level_db === 5) {
        await client.query(
          `
          INSERT INTO aquorix.affiliates (user_id)
          SELECT $1
          WHERE NOT EXISTS (
            SELECT 1 FROM aquorix.affiliates a WHERE a.user_id = $1
          )
          `,
          [userId]
        );
      }

      // Mark onboarding complete
      await client.query(
        `
        UPDATE aquorix.pro_profiles
        SET onboarding_metadata =
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(onboarding_metadata, '{}'::jsonb),
                '{is_complete}', to_jsonb(true), true
              ),
              '{completion_percentage}', to_jsonb(100), true
            ),
            '{last_activity}', to_jsonb(NOW()), true
          )
        WHERE user_id = $1
        `,
        [userId]
      );

      sealed = true;
    }

    await client.query('COMMIT');
    return res.json({ success: true, sealed });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[update-step] error:', err);
    return res.status(500).json({ error: 'Failed to update onboarding step', detail: err.message });
  } finally {
    client.release();
  }
});

// PROMOTE USER (Tier-only)
router.post('/promote', async (req, res) => {
  const pool = req.app?.locals?.pool;

  if (!pool) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfigured: PostgreSQL pool missing (req.app.locals.pool)',
    });
  }

  const { supabase_user_id, tier } = req.body || {};

  if (!supabase_user_id || typeof supabase_user_id !== 'string') {
    return res.status(400).json({ success: false, error: 'supabase_user_id is required' });
  }
  if (!tier || typeof tier !== 'string') {
    return res.status(400).json({ success: false, error: 'tier is required' });
  }

  try {
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
        error: 'No user found for supabase_user_id',
      });
    }

    return res.json({
      success: true,
      user_id: result.rows[0].user_id,
      tier: result.rows[0].tier,
    });
  } catch (err) {
    console.error('POST /promote error:', err);
    return res.status(500).json({
      success: false,
      error: 'Promotion failed',
      detail: err?.message,
    });
  }
});

module.exports = router;
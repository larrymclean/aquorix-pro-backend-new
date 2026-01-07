// File: src/routes/onboarding.js
// Version: 1.2.8
// Last Updated: 2026-01-05
//
// PURPOSE:
//  Backend-authoritative onboarding routes for AQUORIX.PRO.
//
// CHANGE LOG:
// - 2026-01-05 (v1.2.8) (Larry + AI Team):
//    - ADD POST /complete: finalize onboarding (sets onboarding_completed_at + metadata step4/100%).
//    - Keep backend as single writer for completion state (no client-side DB writes).
// - 2026-01-05 (v1.2.7) (Larry + AI Team):
//    - FIX Step 3 DB writes to match actual aquorix.pro_profiles schema:
//      - Removed writes to non-existent columns (country, website, short_description).
//      - Store country/website/description/contact_info under pro_profiles.affiliate_details (jsonb).
//    - FIX Tier 5 affiliates upsert to not require UNIQUE(user_id) (SELECT then INSERT/UPDATE).
// - 2026-01-05 (v1.2.6):
//    - RESTORE missing endpoints: POST /update-step and POST /step3 (regression fix).
// - 2026-01-04 (v1.2.5):
//    - Fix Step 1 phone sanitization rules for users.phone_number (varchar(15)).

const express = require('express');
const router = express.Router();

/**
 * Tier mapping (frontend uses numeric tier_level in most flows).
 * NOTE: aquorix.users.tier uses string enums ('solo', 'affiliate', etc.)
 */
function tierEnumFromLevel(level) {
  switch (Number(level)) {
    case 1: return 'solo';
    case 2: return 'entrepreneur';
    case 3: return 'dive_center';
    case 4: return 'complex';
    case 5: return 'affiliate';
    default: return null;
  }
}

function parseTierLevel(v) {
  const n = Number(v);
  if (![1, 2, 3, 4, 5].includes(n)) return null;
  return n;
}

function extractCountry(reqBody) {
  const direct = typeof reqBody?.country === 'string' ? reqBody.country.trim() : '';
  if (direct) return direct.slice(0, 10);

  const nested = reqBody?.contact_info?.address?.country;
  const nestedVal = typeof nested === 'string' ? nested.trim() : '';
  if (nestedVal) return nestedVal.slice(0, 10);

  return null;
}

/**
 * Normalize phone for users.phone_number (varchar(15)).
 * E.164 allows max 15 digits (excluding '+').
 * We store digits-only.
 */
function normalizePhoneDigitsForUsers(phoneRaw) {
  const s = typeof phoneRaw === 'string' ? phoneRaw : '';
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(0, 15);
}

/**
 * Normalize phone for pro_profiles.phone (varchar(20)).
 * Keep user-friendly formatting but cap to 20.
 */
function normalizePhoneForProfiles(phoneRaw) {
  const s = typeof phoneRaw === 'string' ? phoneRaw.trim() : '';
  if (!s) return null;
  return s.slice(0, 20);
}

/**
 * Ensure completed_steps is unique/sorted int[]
 */
function normalizeCompletedSteps(arr) {
  if (!Array.isArray(arr)) return [];
  const nums = arr
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/**
 * Defensive helper: ensure a pro_profiles row exists for a user_id.
 * pro_profiles.tier_level is NOT NULL, so provide a safe default (1).
 */
async function ensureProProfileRow(client, userId) {
  await client.query(
    `
    INSERT INTO aquorix.pro_profiles (user_id, tier_level, onboarding_metadata)
    VALUES ($1, 1, jsonb_build_object('started_at', NOW()))
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
}

/**
 * POST /api/onboarding/step1
 * Body: { supabase_user_id, first_name, last_name, phone, email }
 */
router.post('/step1', async (req, res) => {
  console.log('[step1] origin:', req.headers.origin);
  console.log('[step1] body:', req.body);

  const { supabase_user_id, first_name, last_name, phone, email } = req.body;
  const pool = req.app.locals.pool;

  if (!supabase_user_id || !first_name || !last_name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const phoneUsers = normalizePhoneDigitsForUsers(phone);
  const phoneProfile = normalizePhoneForProfiles(phone);

  if (!phoneUsers || !phoneProfile) {
    return res.status(400).json({ error: 'Invalid phone number.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `
      INSERT INTO aquorix.users (supabase_user_id, email, username, phone_number, role, tier)
      VALUES ($1, $2, $3, $4, 'user', 'solo')
      ON CONFLICT (supabase_user_id) DO UPDATE
        SET email = EXCLUDED.email,
            phone_number = EXCLUDED.phone_number
      RETURNING user_id
      `,
      [supabase_user_id, email, email, phoneUsers]
    );

    const userId = userResult.rows[0].user_id;

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
              COALESCE(pro_profiles.onboarding_metadata, '{}'::jsonb),
              '{last_activity}', to_jsonb(NOW()), true
            )
      `,
      [userId, first_name, last_name, phoneProfile]
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
 */
router.get('/step1/:supabase_user_id', async (req, res) => {
  const { supabase_user_id } = req.params;
  const pool = req.app.locals.pool;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT p.first_name, p.last_name, p.phone
      FROM aquorix.pro_profiles p
      JOIN aquorix.users u ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
      `,
      [supabase_user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching Step 1 data:', err);
    res.status(500).json({ error: 'Failed to fetch Step 1 data' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/onboarding/update-step
 */
router.post('/update-step', async (req, res) => {
  console.log('[update-step] body:', req.body);

  const { supabase_user_id, current_step, completed_steps, completion_percentage } = req.body;
  const pool = req.app.locals.pool;

  if (!supabase_user_id) {
    return res.status(400).json({ error: 'Missing supabase_user_id.' });
  }

  const stepNum = Number(current_step);
  const pctNum = Number(completion_percentage);

  const safeStep = Number.isFinite(stepNum) ? Math.max(1, Math.min(10, stepNum)) : 1;
  const safePct = Number.isFinite(pctNum) ? Math.max(0, Math.min(100, pctNum)) : 0;
  const safeCompleted = normalizeCompletedSteps(completed_steps);
  const finalCompleted = safeCompleted.length ? safeCompleted : [1];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].user_id;

    await ensureProProfileRow(client, userId);

    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET onboarding_metadata =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(onboarding_metadata, '{}'::jsonb),
                '{last_activity}', to_jsonb(NOW()), true
              ),
              '{current_step}', to_jsonb($2::int), true
            ),
            '{completed_steps}', to_jsonb($3::int[]), true
          ),
          '{completion_percentage}', to_jsonb($4::int), true
        )
      WHERE user_id = $1
      `,
      [userId, safeStep, finalCompleted, safePct]
    );

    await client.query('COMMIT');
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('update-step DB error:', err);
    return res.status(500).json({ error: 'Failed to update onboarding step.' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/onboarding/step3
 * Writes canonical business fields to pro_profiles and tier5 details to affiliate_details JSONB.
 */
router.post('/step3', async (req, res) => {
  console.log('[step3] body:', req.body);

  const {
    supabase_user_id,
    tier_level,
    tier,
    operator_name,
    country,
    logo_url,
    website,
    description,
    contact_info,
    is_test,
  } = req.body;

  const pool = req.app.locals.pool;

  if (!supabase_user_id) return res.status(400).json({ error: 'Missing supabase_user_id.' });
  if (!operator_name || !String(operator_name).trim()) return res.status(400).json({ error: 'Missing operator_name.' });

  const countryCode = extractCountry({ country, contact_info });
  if (!countryCode) return res.status(400).json({ error: 'Missing country.' });

  const parsedLevel = parseTierLevel(tier_level);
  const tierFromString =
    typeof tier === 'string'
      ? ({ solo: 1, entrepreneur: 2, dive_center: 3, complex: 4, affiliate: 5 }[tier] || null)
      : null;

  const effectiveTierLevel = parsedLevel || tierFromString || 1;
  const effectiveTierEnum = tierEnumFromLevel(effectiveTierLevel) || 'solo';

  const businessName = String(operator_name).trim().slice(0, 255);
  const safeLogoUrl = typeof logo_url === 'string' ? logo_url.trim().slice(0, 2000) : null;
  const safeWebsite = typeof website === 'string' ? website.trim().slice(0, 500) : null;
  const safeDesc = typeof description === 'string' ? description.trim().slice(0, 2000) : null;
  const safeIsTest = Boolean(is_test);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].user_id;

    // Update users.tier to match selection (critical for Tier 5)
    await client.query(
      `UPDATE aquorix.users SET tier = $2 WHERE user_id = $1`,
      [userId, effectiveTierEnum]
    );

    await ensureProProfileRow(client, userId);

    // Build affiliate_details patch (jsonb)
    const affiliatePatch = {
      country: countryCode,
      website: safeWebsite,
      description: safeDesc,
      contact_info: contact_info || null,
    };

    // Update pro_profiles (ONLY columns that exist)
    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET
        tier_level = $2,
        business_name = $3,
        logo_url = COALESCE($4, logo_url),
        affiliate_details = COALESCE(affiliate_details, '{}'::jsonb) || $5::jsonb,
        onboarding_metadata =
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(onboarding_metadata, '{}'::jsonb),
                  '{last_activity}', to_jsonb(NOW()), true
                ),
                '{current_step}', to_jsonb(3), true
              ),
              '{completed_steps}', to_jsonb(ARRAY[1,2,3]::int[]), true
            ),
            '{completion_percentage}', to_jsonb(75), true
          )
      WHERE user_id = $1
      `,
      [userId, effectiveTierLevel, businessName, safeLogoUrl, JSON.stringify(affiliatePatch)]
    );

    // Tier 5: Upsert affiliates row WITHOUT relying on UNIQUE(user_id)
    if (effectiveTierLevel === 5) {
      const existing = await client.query(
        `SELECT affiliate_id FROM aquorix.affiliates WHERE user_id = $1 LIMIT 1`,
        [userId]
      );

      if (existing.rows.length === 0) {
        await client.query(
          `
          INSERT INTO aquorix.affiliates (
            user_id,
            short_description,
            verified_by_aquorix,
            verified_at,
            logo_url,
            is_test
          )
          VALUES ($1, $2, false, NULL, $3, $4)
          `,
          [userId, safeDesc, safeLogoUrl, safeIsTest]
        );
      } else {
        await client.query(
          `
          UPDATE aquorix.affiliates
          SET
            short_description = COALESCE($2, short_description),
            logo_url = COALESCE($3, logo_url),
            is_test = $4
          WHERE user_id = $1
          `,
          [userId, safeDesc, safeLogoUrl, safeIsTest]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('step3 DB error:', err);
    return res.status(500).json({ error: 'Failed to save Step 3 data.' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/onboarding/complete
 * Finalize onboarding.
 *
 * Body:
 * {
 *   supabase_user_id: string
 * }
 *
 * Effects:
 * - pro_profiles.onboarding_completed_at = NOW()
 * - onboarding_metadata: current_step=4, completed_steps=[1,2,3,4], completion_percentage=100, last_activity=NOW()
 */
router.post('/complete', async (req, res) => {
  console.log('[complete] body:', req.body);

  const { supabase_user_id } = req.body;
  const pool = req.app.locals.pool;

  if (!supabase_user_id) {
    return res.status(400).json({ error: 'Missing supabase_user_id.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      `SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1 LIMIT 1`,
      [supabase_user_id]
    );
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].user_id;

    await ensureProProfileRow(client, userId);

    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET
        onboarding_completed_at = NOW(),
        onboarding_metadata =
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(onboarding_metadata, '{}'::jsonb),
                  '{last_activity}', to_jsonb(NOW()), true
                ),
                '{current_step}', to_jsonb(4), true
              ),
              '{completed_steps}', to_jsonb(ARRAY[1,2,3,4]::int[]), true
            ),
            '{completion_percentage}', to_jsonb(100), true
          )
      WHERE user_id = $1
      `,
      [userId]
    );

    await client.query('COMMIT');
    return res.status(200).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('complete DB error:', err);
    return res.status(500).json({ error: 'Failed to complete onboarding.' });
  } finally {
    client.release();
  }
});

module.exports = router;
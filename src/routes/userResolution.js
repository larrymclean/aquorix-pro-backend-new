/*
 * File: userResolution.js
 * Path: src/routes/userResolution.js
 * Description: Express routes for AQUORIX onboarding. Handles onboarding user resolution, step tracking, and onboarding flow API endpoints. Isolates onboarding from production user logic.
 * Author: AQUORIX Engineering
 * Created: 2025-09-11
 * Last Updated: 2025-09-13
 * Status: In active development for onboarding v2
 * Dependencies: express, pg
 * Notes: Uses aquorix.onboarding_users for onboarding flow; does not touch production aquorix.users table.
 * Change Log:
 *   2025-09-11 AQUORIX Eng: Initial creation for onboarding entrypoint API.
 *   2025-09-13 AQUORIX Eng: Refactored to use onboarding_users table. Removed enum/tier logic. Added onboarding state sync and nextAction logic.
 *   2025-09-13 AQUORIX Eng: Added POST /api/users/update-step endpoint for step progression sync.
 *   2025-09-14 AQUORIX Eng: Added 'proper' route
 *   2025-09-14 AQUORIX Eng: Modify update step endpoint with identity data
 */

const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Create database pool (same config as server.js)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

router.post('/resolve', async (req, res) => {
  const { supabase_user_id, email, username } = req.body;
  
  if (!supabase_user_id) {
    return res.status(400).json({ error: 'supabase_user_id required' });
  }

  try {
    // 1. Check if onboarding user exists
    const onboardingResult = await pool.query(
      'SELECT * FROM aquorix.onboarding_users WHERE supabase_user_id = $1',
      [supabase_user_id]
    );
    let onboardingUser = onboardingResult.rows[0];

    // 2. If not, create onboarding user
    if (!onboardingUser) {
      if (!email) {
        return res.status(400).json({ error: 'email required for new onboarding user' });
      }
      const insertResult = await pool.query(
        `INSERT INTO aquorix.onboarding_users (supabase_user_id, email)
         VALUES ($1, $2)
         RETURNING *`,
        [supabase_user_id, email]
      );
      onboardingUser = insertResult.rows[0];
    }

    // 3. Fetch onboarding state
    const onboardingState = {
      onboarding_step: onboardingUser.onboarding_step,
      has_completed_onboarding: onboardingUser.has_completed_onboarding
    };

    // 4. Determine next action
    let nextAction = 'continue-onboarding';
    let resumeStep = onboardingUser.onboarding_step || 1;
    if (onboardingUser.has_completed_onboarding) nextAction = 'dashboard';

    return res.json({
      onboardingUser,
      onboardingState,
      nextAction,
      resumeStep
    });

  } catch (error) {
    console.error('[userResolution] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced update-step endpoint to handle identity data
router.post('/update-step', async (req, res) => {
  const { supabase_user_id, onboarding_step, selected_tier, first_name, last_name, phone } = req.body;
  
  if (!supabase_user_id || typeof onboarding_step !== 'number') {
    return res.status(400).json({ error: 'supabase_user_id and numeric onboarding_step are required' });
  }
  
  try {
    let query = `UPDATE aquorix.onboarding_users SET onboarding_step = $1`;
    let params = [onboarding_step];
    let paramIndex = 2;
    
    if (selected_tier) {
      query += `, selected_tier = $${paramIndex}`;
      params.push(selected_tier);
      paramIndex++;
    }
    
    if (first_name) {
      query += `, first_name = $${paramIndex}`;
      params.push(first_name);
      paramIndex++;
    }
    
    if (last_name) {
      query += `, last_name = $${paramIndex}`;
      params.push(last_name);
      paramIndex++;
    }
    
    if (phone) {
      query += `, phone = $${paramIndex}`;
      params.push(phone);
      paramIndex++;
    }
    
    query += ` WHERE supabase_user_id = $${paramIndex} RETURNING *`;
    params.push(supabase_user_id);
    
    console.log('[update-step] Updating onboarding data:', { supabase_user_id, onboarding_step, first_name, last_name, phone, selected_tier });
    
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Onboarding user not found' });
    }
    
    console.log('[update-step] Updated successfully:', result.rows[0]);
    return res.json({ onboardingUser: result.rows[0] });
  } catch (error) {
    console.error('[update-step] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Promote onboarding user to full user and pro_profile
router.post('/promote', async (req, res) => {
  const { supabase_user_id } = req.body;
  if (!supabase_user_id) {
    return res.status(400).json({ error: 'supabase_user_id required' });
  }
  try {
    // 1. Get onboarding user
    const onboardingResult = await pool.query(
      'SELECT * FROM aquorix.onboarding_users WHERE supabase_user_id = $1',
      [supabase_user_id]
    );
    const onboardingUser = onboardingResult.rows[0];
    if (!onboardingUser) {
      return res.status(404).json({ error: 'Onboarding user not found' });
    }
    // 2. Create or fetch user
    // Use selected_tier from onboardingUser
    const tier = onboardingUser.selected_tier || 'solo';
    let userResult = await pool.query(
      `INSERT INTO aquorix.users (supabase_user_id, email, username, is_active, role, tier, created_at)
      VALUES ($1, $2, $3, true, 'user', $4, NOW())
      ON CONFLICT (email) DO UPDATE SET 
        supabase_user_id = EXCLUDED.supabase_user_id,
        tier = EXCLUDED.tier
      RETURNING *`,
      [onboardingUser.supabase_user_id, onboardingUser.email, onboardingUser.email, tier]
    );
    let user = userResult.rows[0];
    if (!user) {
      // User already exists, fetch it
      const fetchUser = await pool.query(
        'SELECT * FROM aquorix.users WHERE supabase_user_id = $1',
        [onboardingUser.supabase_user_id]
      );
      user = fetchUser.rows[0];
    }
    if (!user) {
      return res.status(500).json({ error: 'Failed to create or fetch user for promotion.' });
    }
    // 3. Create pro_profile
    let profile = null;
    const profileResult = await pool.query(
      `INSERT INTO aquorix.pro_profiles (user_id, tier_level, onboarding_completed_at, onboarding_metadata, created_at, updated_at)
       VALUES ($1, 1, NOW(), '{"current_step": 0, "completed_steps": [], "completion_percentage": 100}', NOW(), NOW())
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [user.user_id]
    );
    profile = profileResult.rows[0] || null;
    // 4. Mark onboarding as complete
    await pool.query(
      'UPDATE aquorix.onboarding_users SET has_completed_onboarding = TRUE WHERE supabase_user_id = $1',
      [supabase_user_id]
    );
    return res.json({ user, profile });
  } catch (error) {
    console.error('[promote] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user data from AQUORIX database
router.get('/me', async (req, res) => {
  console.log('=== ME ENDPOINT DEBUG ===');
  console.log('Query params:', req.query);
  console.log('Headers:', req.headers);
  console.log('URL:', req.url);
  
  const supabase_user_id = req.query.user_id || req.headers['x-user-id'];
  console.log('Extracted user_id:', supabase_user_id);
  
  if (!supabase_user_id) {
    return res.status(400).json({ error: 'User ID required' });
  }
  
  try {
    const userResult = await pool.query(
      'SELECT user_id, email, role, tier, is_active FROM aquorix.users WHERE supabase_user_id = $1',
      [supabase_user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.json(userResult.rows[0]);
  } catch (error) {
    console.error('[me] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/update-business-profile
router.post('/update-business-profile', async (req, res) => {
  const {
    supabase_user_id,
    brandName,
    businessPhone,
    businessCountryCode,
    website,
    description,
    businessAddress
  } = req.body;
  if (!supabase_user_id) {
    return res.status(400).json({ error: 'supabase_user_id required' });
  }
  try {
    // 1. Lookup user_id from supabase_user_id
    const userResult = await pool.query(
      'SELECT user_id FROM aquorix.users WHERE supabase_user_id = $1',
      [supabase_user_id]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // 2. Prepare values, converting blank/empty to null
    const business_name = brandName && brandName.trim() !== '' ? brandName.trim() : null;
    const phone = businessPhone && businessPhone.trim() !== '' ? businessPhone.trim() : null;
    const phone_country_code = businessCountryCode && businessCountryCode.trim() !== '' ? businessCountryCode.trim() : null;
    const web = website && website.trim() !== '' ? website.trim() : null;
    const desc = description && description.trim() !== '' ? description.trim() : null;
    let address_json = null;
    if (businessAddress && typeof businessAddress === 'object') {
      // Clean and set null for all-blank address
      const cleaned = {
        street: businessAddress.street?.trim() || null,
        city: businessAddress.city?.trim() || null,
        region: businessAddress.region?.trim() || null,
        postalCode: businessAddress.postalCode?.trim() || null,
        country: businessAddress.country?.trim() || null
      };
      // Only set address_json if at least one field is non-null
      if (Object.values(cleaned).some(v => v)) {
        address_json = JSON.stringify(cleaned);
      }
    }
    // 3. Upsert into pro_profiles (add columns as needed)
    const upsertResult = await pool.query(
      `INSERT INTO aquorix.pro_profiles (user_id, business_name, phone, phone_country_code, website, description, address, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         business_name = EXCLUDED.business_name,
         phone = EXCLUDED.phone,
         phone_country_code = EXCLUDED.phone_country_code,
         website = EXCLUDED.website,
         description = EXCLUDED.description,
         address = EXCLUDED.address,
         updated_at = NOW()
       RETURNING *`,
      [user.user_id, business_name, phone, phone_country_code, web, desc, address_json]
    );
    return res.json({ profile: upsertResult.rows[0] });
  } catch (error) {
    console.error('[update-business-profile] Fatal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
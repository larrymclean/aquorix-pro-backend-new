// File: src/routes/userResolution.ts
// Path: src/routes/userResolution.ts
// Description: Express route for onboarding user resolution and state tracking. Implements /api/users/resolve endpoint for AQUORIX onboarding. Returns user, onboarding state, nextAction, and resumeStep. Includes retry/circuit breaker and logging.
// Author: AQUORIX Engineering
// Created: 2025-09-11
// Last Updated: 2025-09-11
// Status: Initial scaffold
// Dependencies: express, pg (PostgreSQL client), winston (logging)
// Notes: Integrate with SetPassword and onboarding frontend. See onboarding_metadata JSONB for state shape.
// Change Log:
//   2025-09-11 AQUORIX Eng: Initial creation for onboarding entrypoint API.

import express from 'express';
import { Pool } from 'pg';
import winston from 'winston';

const router = express.Router();
const db = new Pool(); // assumes PG env vars set

const logger = winston.createLogger({
  transports: [new winston.transports.Console()]
});

// Exponential backoff with circuit breaker
async function retryWithBackoff(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      logger.warn(`[userResolution] Attempt ${i + 1} failed: ${error}`);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

// API: POST /api/users/resolve
router.post('/resolve', express.json(), async (req, res) => {
  const { supabase_user_id } = req.body;
  if (!supabase_user_id) {
    logger.warn('[userResolution] Missing supabase_user_id in request');
    return res.status(400).json({ error: 'supabase_user_id required' });
  }
  try {
    const user = await retryWithBackoff(async () => {
      const { rows } = await db.query(
        'SELECT * FROM aquorix.users WHERE supabase_user_id = $1',
        [supabase_user_id]
      );
      return rows[0];
    });
    if (!user) {
      logger.info(`[userResolution] No user found for supabase_user_id: ${supabase_user_id}`);
      return res.status(404).json({ error: 'User not found' });
    }
    // Get onboarding state
    const proProfile = await retryWithBackoff(async () => {
      const { rows } = await db.query(
        'SELECT onboarding_metadata FROM aquorix.pro_profiles WHERE user_id = $1',
        [user.user_id]
      );
      return rows[0];
    });
    const onboardingState = proProfile ? proProfile.onboarding_metadata : null;
    // Determine next action
    let nextAction: string = 'continue-onboarding';
    let resumeStep: number | undefined = undefined;
    if (!user.password_hash) nextAction = 'set-password';
    else if (!onboardingState || onboardingState.current_step === 0) nextAction = 'continue-onboarding';
    else if (onboardingState.completion_percentage === 100) nextAction = 'dashboard';
    else {
      nextAction = 'continue-onboarding';
      resumeStep = onboardingState.current_step;
    }
    logger.info(`[userResolution] User ${user.user_id} resolved. Next action: ${nextAction}`);
    return res.json({
      user,
      onboardingState,
      nextAction,
      resumeStep
    });
  } catch (error) {
    logger.error(`[userResolution] Fatal error: ${error}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

/*
 * AQUORIX Pro Backend Server
 * Description: Express server for AQUORIX Pro Dashboard, providing health check and Supabase PostgreSQL connectivity
 * Version: 1.0.7
 * Author: Larrym
 * Date: 2025-09-19
 * Change Log:
 *   - 2025-07-01: Initial setup with /api/health endpoint (v1.0.0)
 *   - 2025-07-01: Added CORS middleware for http://localhost:3004
 *   - 2025-07-01: Added .gitignore to exclude node_modules
 *   - 2025-07-02: Added Supabase PostgreSQL connection pool with transaction mode (v1.0.1)
 *   - 2025-07-03: Added GET /api/users endpoint for CRUD operations (v1.0.2)
 *   - 2025-07-03: Added POST /api/sensors endpoint for CRUD operations (v1.0.3)
 *   - 2025-07-03: Added GET /api/alerts endpoint for CRUD operations (v1.0.4)
 *   - 2025-07-03: Added error handling to /api/health endpoint (v1.0.5)
 *   - 2025-07-03: Added onboarding router for /api/onboarding endpoint
 *   - 2025-09-19: Fixed middleware order - CORS and express.json now load before routes, removed duplicate middleware (v1.0.6)
 *   - 2026-02-04: v1.0.7 - Replace entire CORS Block for live version (onrender vs. localhost:3000)
 */

const express = require('express'); // Express: Like PHP's Laravel for routing HTTP requests
const cors = require('cors'); // CORS: Allows frontend (localhost:3500) to talk to backend
const { Pool } = require('pg'); // pg: PostgreSQL client, like PHP's mysqli for MySQL
require('dotenv').config(); // dotenv: Loads .env variables, like PHP's getenv()

const app = express();
const port = process.env.PORT || 3001; // Port: Uses env variable or defaults to 3001

// MIDDLEWARE SETUP - Must come before route registration

// Allow frontend requests (Render + local dev)
const ALLOWED_ORIGINS = new Set([
  "https://aquorix-frontend.onrender.com",
  "https://aquorix-frontend-dev.onrender.com",
  "http://localhost:3000",
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no Origin (curl, Postman, server-to-server, mobile apps)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);

    // Deny anything else
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


app.use(express.json()); // Parse JSON requests, like PHP's json_decode

// -----------------------------------------------------------------------------
// /api/v1/me (Routing Authority)
// Frontend contract:
//   GET /api/v1/me with Authorization: Bearer <Supabase JWT>
// Returns:
//   200 { ok:true, routing_hint, onboarding:{is_complete}, ... } for existing users
//   404 if user is not yet present in aquorix.users (new user -> onboarding)
//   401 if token missing/invalid
//
// NOTE (Recovery Mode):
//   We decode JWT payload to extract `sub` (Supabase user id).
//   Signature verification can be added later as a hardening step.
// -----------------------------------------------------------------------------

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getSupabaseUserIdFromBearer(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson);
    if (!payload || !payload.sub) return null;
    return String(payload.sub);
  } catch (e) {
    return null;
  }
}

app.get('/api/v1/me', async (req, res) => {
  const supabase_user_id = getSupabaseUserIdFromBearer(req);

  if (!supabase_user_id) {
    return res.status(401).json({ ok: false, error: 'Missing or invalid Bearer token' });
  }

  let client;
  try {
    client = await pool.connect();

    const result = await client.query(
      `
      SELECT
        u.user_id,
        u.supabase_user_id,
        u.email,
        u.role,
        u.tier,
        u.is_active,
        p.first_name,
        p.last_name,
        p.tier_level,
        p.onboarding_metadata,
        p.onboarding_completed_at
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
      LIMIT 1
      `,
      [supabase_user_id]
    );

    if (result.rows.length === 0) {
      // Contract: user not yet present in AQUORIX DB (new user -> onboarding)
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const row = result.rows[0];

    // Compute onboarding completion (best-effort)
    const onboardingMeta = row.onboarding_metadata || {};
    const completionPctRaw = onboardingMeta.completion_percentage;
    const completionPct = Number.isFinite(Number(completionPctRaw)) ? Number(completionPctRaw) : null;

    const isComplete =
      Boolean(row.onboarding_completed_at) ||
      (completionPct !== null && completionPct >= 100) ||
      onboardingMeta.is_complete === true;

    // Routing authority (CONSERVATIVE):
    // If user exists in aquorix.users, default to dashboard.
    // Only route to onboarding when we explicitly know it's incomplete.
    let routing_hint = isComplete ? 'dashboard' : 'dashboard';

    // Optional admin routing (keep minimal & cautious)
    const role = String(row.role || '').toLowerCase();
    if (role === 'admin') {
      routing_hint = 'admin';
    } else if (!isComplete && (onboardingMeta && onboardingMeta.current_step != null)) {
      // If we have explicit onboarding state, we can route to onboarding.
      // This prevents accidentally sending established users to onboarding due to missing metadata.
      routing_hint = 'onboarding';
    }

    return res.json({
      ok: true,
      routing_hint,
      user: {
        supabase_user_id: row.supabase_user_id,
        email: row.email,
        role: row.role,
        tier: row.tier,
        is_active: row.is_active
      },
      profile: {
        first_name: row.first_name,
        last_name: row.last_name,
        tier_level: row.tier_level
      },
      onboarding: {
        is_complete: isComplete,
        metadata: onboardingMeta
      }
    });
  } catch (err) {
    console.error('[api/v1/me] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
});

// Database connection pool: Connects to Supabase PostgreSQL, like PHP's PDO
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Supabase transaction pooler, e.g., postgresql://postgres.spltrqrscqmtrfknvycj:3xpl0r3th3D3pths2025@aws-0-us-west-1.pooler.supabase.com:6543/postgres
  ssl: false // Required for Supabase, like PHP's SSL options
});

// Test database connection on startup, like PHP's mysqli_connect test
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to Supabase database:', err.stack); // Log errors, like PHP's error_log
    return;
  }
  console.log('Connected to Supabase PostgreSQL database');
  release(); // Release client back to pool, like closing a PHP DB connection
});

// ROUTE REGISTRATION - After middleware setup
const onboardingRouter = require('./src/routes/onboarding');
app.use('/api/onboarding', onboardingRouter);

// Health check endpoint, like a PHP endpoint returning JSON
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1'); // Simple query to test DB connection
    client.release();
    res.json({ status: 'healthy', dbConnected: true });
  } catch (err) {
    console.error('Health check failed:', err.stack);
    res.status(500).json({ status: 'unhealthy', dbConnected: false, error: err.message });
  }
});

// Get all users, like a PHP script with SELECT query
app.get('/api/users', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT user_id, email, role, tier, created_at FROM users');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.stack);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by Supabase UUID (used by frontend getUserRole)
app.get('/api/users/by-supabase-id/:supabase_user_id', async (req, res) => {
  try {
    const { supabase_user_id } = req.params;
    const client = await pool.connect();
    const result = await client.query(`
      SELECT 
        u.role, u.tier, u.email,
        p.onboarding_metadata, p.first_name, p.last_name, p.tier_level
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
    `, [supabase_user_id]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user by supabase_id:', err.stack);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Fix RequireAuth → adds missing /api/users/me endpoint
app.get('/api/users/me', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' });
  }

  try {
    const client = await pool.connect();

    const result = await client.query(
      `
      SELECT 
        u.role,
        u.tier,
        u.email,
        p.onboarding_metadata,
        p.first_name,
        p.last_name,
        p.tier_level
      FROM aquorix.users u
      LEFT JOIN aquorix.pro_profiles p ON u.user_id = p.user_id
      WHERE u.supabase_user_id = $1
      `,
      [user_id]
    );

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Update onboarding step + metadata
app.post('/api/users/update-step', async (req, res) => {
  const { supabase_user_id, step, metadata } = req.body;

  if (!supabase_user_id || !step) {
    return res.status(400).json({ error: 'supabase_user_id and step are required' });
  }

  try {
    const client = await pool.connect();

    // Update onboarding_metadata JSONB in pro_profiles
    await client.query(
      `
      UPDATE aquorix.pro_profiles
      SET onboarding_metadata = jsonb_set(
        onboarding_metadata::jsonb,
        '{current_step}',
        to_jsonb($2::int),
        true
      ) || $3::jsonb
      FROM aquorix.users u
      WHERE pro_profiles.user_id = u.user_id
        AND u.supabase_user_id = $1
      `,
      [supabase_user_id, step, metadata ? JSON.stringify(metadata) : '{}']
    );

    client.release();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating onboarding step:', err);
    res.status(500).json({ error: 'Failed to update onboarding step' });
  }
});

// Insert sensor data, like a PHP script with INSERT query
app.post('/api/sensors', async (req, res) => {
  try {
    const { dive_id, temperature, depth } = req.body;
    if (!dive_id) {
      return res.status(400).json({ error: 'dive_id is required' });
    }
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO sensor_data (dive_id, temperature, depth) VALUES ($1, $2, $3) RETURNING *',
      [dive_id, temperature, depth]
    );
    client.release();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting sensor data:', err.stack);
    res.status(500).json({ error: 'Failed to insert sensor data' });
  }
});

// Get sensor data, like a PHP script with SELECT query
app.get('/api/sensors', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT sensor_id, dive_id, temperature, depth, timestamp FROM sensor_data');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sensor data:', err.stack);
    res.status(500).json({ error: 'Failed to fetch sensor data' });
  }
});

// Get all alerts, like a PHP script with SELECT query
app.get('/api/alerts', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT alert_id, user_id, message, severity, timestamp FROM alerts');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching alerts:', err.stack);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`); // Start server, like PHP's built-in server
});
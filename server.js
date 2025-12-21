/*
 * AQUORIX Pro Backend Server
 * Description: Express server for AQUORIX Pro Dashboard, providing health check and Supabase PostgreSQL connectivity
 * Version: 1.0.7
 * Author: Larrym
 * Date: 2025-07-03
 * Change Log:
 *   - 2025-07-01: Initial setup with /api/health endpoint (v1.0.0)
 *   - 2025-07-01: Added CORS middleware for http://localhost:3004
 *   - 2025-07-01: Added .gitignore to exclude node_modules
 *   - 2025-07-02: Added Supabase PostgreSQL connection pool with transaction mode (v1.0.1)
 *   - 2025-07-03: Added GET /api/users endpoint for CRUD operations (v1.0.2)
 *   - 2025-07-03: Added POST /api/sensors endpoint for CRUD operations (v1.0.3)
 *   - 2025-07-03: Added GET /api/alerts endpoint for CRUD operations (v1.0.4)
 *   - 2025-07-03: Added error handling to /api/health endpoint (v1.0.5)
 *   - 2025-12-18: Added cont lines for swagger + yamljs (v1.0.6)
 *   - 2025-12-18: Fixed Swagger UI setup order and added /docs endpoint (v1.0.7)
 */

  require('dotenv').config();

  const express = require('express');
  const cors = require('cors');
  const { Pool } = require('pg');
  const path = require('path');
  const swaggerUi = require('swagger-ui-express');
  const YAML = require('yamljs');
  const schedulerRouter = require('./src/routes/scheduler');

  const app = express();
  const port = process.env.PORT || 3001;

  app.use(express.json());

  /**
   * ----------------------------------------------------------------------------
   * CORS (Phase A)
   * ----------------------------------------------------------------------------
   * Purpose:
   *  - Allow local Pro Dashboard dev server to call scheduler endpoints
   * Notes:
   *  - Tight whitelist: only local dashboard dev origins
   *  - Expand later for widget/public gateway in Phase C
   * ----------------------------------------------------------------------------
   */
  const ALLOWED_ORIGINS = [
    'http://localhost:3500',
    'http://127.0.0.1:3500'
  ];

  app.use(cors({
    origin: function (origin, callback) {
      // Allow non-browser tools (curl, Postman) with no Origin header
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('CORS blocked: ' + origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  }));

  app.options('*', cors());

   // Swagger UI (Scheduler M1 Contract - 2025-12-18 - v1.0.6)
   try {
    const openApiPath = path.join(__dirname, "openapi-scheduler-m1.yaml");
    const openApiSpec = YAML.load(openApiPath);
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, {
      customSiteTitle: "AQUORIX Scheduler API",
      customCss: ".swagger-ui .topbar { display: none }"
    }));
    console.log("Swagger docs wired at /docs");
  } catch (err) {
    console.error("Swagger spec load failed:", err.message);
  }

   // Database connection pool: Connects to AQUORIX PostgreSQL (db: aquorix, schema: aquorix)
   const useSsl = (process.env.DB_SSL || "true").toLowerCase() !== "false";

   const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    options: "-c search_path=aquorix,public",
  });

   // Test database connection on startup, like PHP's mysqli_connect test
   pool.connect((err, client, release) => {
     if (err) {
       console.error('Error connecting to AQUORIX Postgres (aquorix):', err.stack); // Log errors, like PHP's error_log
       return;
     }
     console.log('Connected to AQUORIX Postgres (aquorix)');
     release(); // Release client back to pool, like closing a PHP DB connection
   });

   // Make DB pool available to routers
    app.locals.pool = pool;

    // Scheduler routes (M1)
    app.use("/api/v1", schedulerRouter);
    console.log("Scheduler routes mounted at /api/v1");

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

   app.get('/api/dbinfo', async (req, res) => {
    try {
      const client = await pool.connect();
      const r = await client.query(`
        SELECT current_database() AS db,
              current_user AS usr,
              current_schema() AS schema
      `);
      client.release();
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
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

   app.listen(port, () => {
     console.log(`AQUORIX Pro Backend running at http://localhost:${port}`); // Start server, like PHP's built-in server
     console.log(`API Documentation: http://localhost:${port}/docs`);
   });
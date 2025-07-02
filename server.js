/*
    * AQUORIX Pro Backend Server
    * Description: Express server for AQUORIX Pro Dashboard, providing health check and Supabase PostgreSQL connectivity
    * Version: 1.0.5
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
    */

   const express = require('express'); // Express: Like PHP's Laravel for routing HTTP requests
   const cors = require('cors'); // CORS: Allows frontend (localhost:3004) to talk to backend
   const { Pool } = require('pg'); // pg: PostgreSQL client, like PHP's mysqli for MySQL
   require('dotenv').config(); // dotenv: Loads .env variables, like PHP's getenv()

   const app = express();
   const port = process.env.PORT || 3001; // Port: Uses env variable or defaults to 3001

   // Database connection pool: Connects to Supabase PostgreSQL, like PHP's PDO
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL, // Supabase transaction pooler, e.g., postgresql://postgres.spltrqrscqmtrfknvycj:3xpl0r3th3D3pths2025@aws-0-us-west-1.pooler.supabase.com:6543/postgres
     ssl: { rejectUnauthorized: false } // Required for Supabase, like PHP's SSL options
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

   app.use(cors({ origin: 'http://localhost:3004' })); // Allow frontend requests
   app.use(express.json()); // Parse JSON requests, like PHP's json_decode

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

   app.listen(port, () => {
     console.log(`AQUORIX Pro Backend running at http://localhost:${port}`); // Start server, like PHP's built-in server
   });
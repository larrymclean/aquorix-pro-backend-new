/*
    * AQUORIX Pro Backend Server
    * Description: Express server for AQUORIX Pro Dashboard, providing health check and Supabase PostgreSQL connectivity
    * Version: 1.0.1
    * Author: Larrym
    * Date: 2025-07-02
    * Change Log:
    *   - 2025-07-01: Initial setup with /api/health endpoint (v1.0.0)
    *   - 2025-07-01: Added CORS middleware for http://localhost:3004
    *   - 2025-07-01: Added .gitignore to exclude node_modules
    *   - 2025-07-02: Added Supabase PostgreSQL connection pool with transaction mode (v1.0.1)
    */

   const express = require('express'); // Express: Like PHP's Laravel for routing HTTP requests
   const cors = require('cors'); // CORS: Allows frontend (localhost:3004) to talk to backend
   const { Pool } = require('pg'); // pg: PostgreSQL client, like PHP's mysqli for MySQL
   require('dotenv').config(); // dotenv: Loads .env variables, like PHP's getenv()

   const app = express();
   const port = process.env.PORT || 3001; // Port: Uses env variable or defaults to 3001

   // Database connection pool: Connects to Supabase PostgreSQL in transaction mode, like PHP's PDO
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL, // Supabase transaction pooler, e.g., postgresql://postgres.spltrqrscqmtrfknvycj:3xpl0r3th3D3pths2025@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
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
   app.get('/api/health', (req, res) => {
     res.json({ status: 'healthy' });
   });

   app.listen(port, () => {
     console.log(`AQUORIX Pro Backend running at http://localhost:${port}`); // Start server, like PHP's built-in server
   });
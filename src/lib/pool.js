/*
  File: pool.js
  Path: src/lib/pool.js
  Description:
    Centralized PostgreSQL connection pool for AQUORIX Pro Backend.

  Author: AQUORIX
  Created: 2026-02-20
  Version: 1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE

  Change Log:
    - 2026-02-20 - v1.0.0:
      - Initial extraction from server.js (no logic changes)
*/

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;

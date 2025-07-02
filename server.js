/*
 * AQUORIX Pro Backend Server
 * Description: Minimal Express server for AQUORIX Pro, providing a health check endpoint
 * Version: 1.0.0
 * Author: Larrym
 * Date: 2025-07-01
 * Change Log:
 *   - 2025-07-01: Initial setup with /api/health endpoint (v1.0.0)
 *   - 2025-07-01: Added CORS middleware for http://localhost:3004
 *   - 2025-07-01: Added .gitignore to exclude node_modules
 */

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: 'http://localhost:3004' }));
const port = 3001;

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`);
});
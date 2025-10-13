// AQUORIX Pro Backend JavaScript File
// └── File: server.ts (Main Express server)
// └── Purpose: Sets up minimal Express server for AQUORIX Pro APIs
// Version: 1.0.0 - 2025-06-30 00:22 PDT
// Author: Larry M.
// License: AQUORIX Pro Backend, Copyright 2025 AQUORIX
// Changelog:
//   - 1.0.0: Initial setup of minimal Express server
//   - 1.0.1: Added CORS support (2025-07-01 19:38 PDT)
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: 'http://localhost:3004' })); // Specific origin for development
const port = 3001;

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`);
});
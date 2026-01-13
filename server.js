/*
 * AQUORIX Pro Backend Server
 * Description: Express server for AQUORIX Pro Dashboard (local dev + API)
 * Version: 1.2.1
 * Author: Larrym
 * Date Created: 2025-12-27
 *
 * Change Log:
 *   - 2025-12-27 (ChatGPT Lead): DIR fix — single CORS middleware, correct init order
 *     - Fix "Cannot access 'app' before initialization"
 *     - Remove duplicate CORS blocks (single source of truth)
 *     - Allow Swagger UI origin (http://localhost:3001) to prevent self-blocking
 *  - 2026-01-12 - v1.0.9 - (larry/ChatGPT Lead)
 *    - Added health Endpoint
 *  - 2026-01-13 - v1.2.0 - Authors: larry with ChatGPT Lead
 *    - Replace the dev-only CORS with an allowlist + preflight
 *  - 2026-01-13 - v1.2.1 - Authors: Larry McLean + ChatGPT Lead
 *    - Fix CORS for live Render frontend:
 *      - Add Render frontend origins to allowlist
 *      - Use the SAME corsOptions for both app.use(cors(...)) and app.options("*", cors(...))
 *      - Add maxAge for cleaner browser preflight behavior
 *      - Allow curl/Postman (no Origin) without weakening browser-origin enforcement
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const schedulerRouter = require("./src/routes/scheduler");
const meSchedulerRouter = require("./src/routes/meScheduler");
const me = require("./src/routes/me");
const onboardingRouter = require("./src/routes/onboarding");

// ----------------------------------------------------------------------------
// App + Port
// ----------------------------------------------------------------------------
const app = express();
const port = process.env.PORT || 3001;

// ----------------------------------------------------------------------------
// CORS (SINGLE SOURCE OF TRUTH - DIR)
// ----------------------------------------------------------------------------
// Why include 3001?
// - Swagger UI is served from http://localhost:3001/docs
// - Browser requests from /docs can include Origin: http://localhost:3001
// - If we don't allow it, the server blocks itself.
//
// Live Render: frontend is a different origin than the API.
// If CORS is not explicitly allowing the frontend origin, /api/v1/me will fail
// with a browser preflight error.
const ALLOWED_ORIGINS = new Set([
  // Local dev frontend(s)
  "http://localhost:3500",
  "http://127.0.0.1:3500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",

  // Local Swagger UI served by backend
  "http://localhost:3001",
  "http://127.0.0.1:3001",

  // Render frontend(s)
  "https://aquorix-frontend-dev.onrender.com",
  "https://aquorix-frontend.onrender.com",
]);

// Optional extension via env (comma-separated list)
// Example: CORS_ALLOW_ORIGINS="https://app.aquorix.pro,https://aquorix.pro"
if (process.env.CORS_ALLOW_ORIGINS) {
  String(process.env.CORS_ALLOW_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((origin) => ALLOWED_ORIGINS.add(origin));
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow server-to-server / curl / Postman (no Origin header)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);

    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400, // 24h: reduces repeated preflights in browsers
};

// Apply CORS to ALL requests
app.use(cors(corsOptions));

// Ensure preflight works across all routes (MUST match corsOptions)
app.options("*", cors(corsOptions));

// ----------------------------------------------------------------------------
// Body parsing
// ----------------------------------------------------------------------------
app.use(express.json());

// ----------------------------------------------------------------------------
// Swagger UI (Scheduler M1 Contract)
// ----------------------------------------------------------------------------
try {
  const openApiPath = path.join(__dirname, "openapi-scheduler-m1.yaml");
  const openApiSpec = YAML.load(openApiPath);

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: "AQUORIX Scheduler API",
      customCss: ".swagger-ui .topbar { display: none }",
    })
  );

  console.log("Swagger docs wired at /docs");
} catch (err) {
  console.error("Swagger spec load failed:", err.message);
}

// ----------------------------------------------------------------------------
// Database connection pool
// ----------------------------------------------------------------------------
const useSsl = (process.env.DB_SSL || "true").toLowerCase() !== "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  options: "-c search_path=aquorix,public",
});

// Test DB connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error connecting to AQUORIX Postgres (aquorix):", err.stack);
    return;
  }
  console.log("Connected to AQUORIX Postgres (aquorix)");
  release();
});

// Make pool available to routers
app.locals.pool = pool;

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

// Scheduler routes (M1)
app.use("/api/v1", schedulerRouter);
console.log("Scheduler routes mounted at /api/v1");

// Me scheduler router (if this is a router that expects /api/v1 base)
app.use("/api/v1", meSchedulerRouter);
console.log("MeScheduler routes mounted at /api/v1");

// Me route
app.use("/api/v1/me", me);

// Onboarding
app.use("/api/onboarding", onboardingRouter);
console.log("Onboarding routes mounted at /api/onboarding");

// DB health check (deeper diagnostic)
app.get("/api/v1/health/db", async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    res.json({ status: "healthy", dbConnected: true });
  } catch (err) {
    console.error("Health check failed:", err.stack);
    res
      .status(500)
      .json({ status: "unhealthy", dbConnected: false, error: err.message });
  }
});

// ----------------------------------------------------------------------------
// Health Endpoint - Added 01-12-2026
// ----------------------------------------------------------------------------

// Health check (Render / monitoring)
app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "aquorix-backend",
    timestamp: new Date().toISOString(),
  });
});

// DB info
app.get("/api/dbinfo", async (req, res) => {
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

// ----------------------------------------------------------------------------
// Start server
// ----------------------------------------------------------------------------
app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`);
  console.log(`API Documentation: http://localhost:${port}/docs`);
});

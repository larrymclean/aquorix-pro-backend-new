/**
 * AQUORIX — Legacy Schedule Routes
 *
 * File: /src/routes/schedule/legacySchedule.routes.js
 * Version: v1.0.1
 * Created: 2026-03-05
 * Author: Larry McLean
 *
 * Purpose:
 * - Serve LOCKED legacy schedule JSON fixtures for parity testing.
 * - This is NOT the canonical scheduler engine.
 * - This is a deterministic “oracle fixture endpoint” used to prevent drift.
 *
 * Endpoints:
 * - GET /api/v1/schedule/legacy/fixture
 *
 * Notes:
 * - “Arab Divers” is the operator name. This file is feature-named “legacySchedule”.
 * - Fixture file is stored in /contracts/legacy/.
 *
 * Change Log:
 * - 2026-03-05: v1.0.0 - Initial legacy schedule fixture endpoint. [LM]
 *  * - 2026-03-05: v1.0.1 - Rename fixture endpoint + file to remove operator branding (oracle remains). [LM]
 */

const fs = require("fs");
const path = require("path");

function readJsonFixture(relativePathFromRepoRoot) {
  const fullPath = path.join(process.cwd(), relativePathFromRepoRoot);
  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function registerLegacyScheduleRoutes(app) {
  // Legacy fixture endpoint (parity oracle)
    app.get("/api/v1/schedule/legacy/fixture", (req, res) => {
    try {
      res.set("X-Aquorix-Oracle", "legacy-schedule-fixture");
      const payload = readJsonFixture("contracts/legacy/schedule-legacy-fixture.json");
      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({
        status: "error",
        message: "Failed to load legacy schedule fixture",
        error: String(err && err.message ? err.message : err),
      });
    }
  });
}

module.exports = { registerLegacyScheduleRoutes };

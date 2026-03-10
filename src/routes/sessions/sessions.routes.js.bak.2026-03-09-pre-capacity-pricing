/**
 * AQUORIX — Sessions API Routes (Canonical)
 *
 * File: /src/routes/sessions/sessions.routes.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/sessions/sessions.routes.js
 * Version: v1.0.0
 * Created: 2026-03-05
 * Author: Larry McLean
 *
 * Purpose:
 * - Canonical schedule feed for the React widget (Phase 9).
 * - Read-only endpoint that returns real dive_sessions for a given operator + week.
 * - “Available space” is represented as capacity_remaining (available inventory).
 *
 * Endpoint:
 * - GET /api/v1/sessions?operator_slug=...&week_start=YYYY-MM-DD
 *
 * Notes:
 * - operator_slug is REQUIRED (prevents accidental cross-operator leakage).
 * - week_start is OPTIONAL; defaults to operator-local current week start (ISO week, Monday start).
 * - Legacy oracle fixture endpoint remains separate and unchanged:
 *   /api/v1/schedule/legacy/arab-divers
 *
 * Change Log (append-only):
 * - 2026-03-05: v1.0.0 - Initial canonical sessions read-only endpoint. [LM]
 */

function isValidYmd(value) {
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [yyyy, mm, dd] = s.split("-").map((n) => parseInt(n, 10));
  if (!yyyy || !mm || !dd) return false;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.getUTCFullYear() === yyyy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd;
}

function registerSessionsRoutes(app, { pool }) {
  app.get("/api/v1/sessions", async (req, res) => {
    try {
      res.set("X-Aquorix-API", "sessions-v1");

      const operator_slug_raw = req.query?.operator_slug;
      const week_start_raw = req.query?.week_start;

      const operator_slug = operator_slug_raw ? String(operator_slug_raw).trim() : "";
      if (!operator_slug) {
        return res.status(400).json({
          ok: false,
          status: "bad_request",
          message: "operator_slug is required"
        });
      }

      if (week_start_raw !== undefined) {
        const s = String(week_start_raw).trim();
        if (!s || !isValidYmd(s)) {
          return res.status(400).json({
            ok: false,
            status: "bad_request",
            message: "Invalid week_start format. Use YYYY-MM-DD."
          });
        }
      }

      const weekStartParam = week_start_raw === undefined ? null : String(week_start_raw).trim();

      // 1) Resolve operator
      const opResult = await pool.query(
        `
        SELECT operator_id, operator_slug, name, timezone, default_currency
        FROM aquorix.diveoperators
        WHERE operator_slug = $1
        LIMIT 1
        `,
        [operator_slug]
      );

      if (opResult.rowCount === 0) {
        return res.status(404).json({
          ok: false,
          status: "not_found",
          message: `Operator not found: ${operator_slug}`
        });
      }

      const operator = opResult.rows[0];
      const tz = operator.timezone || "UTC";

      // 2) Compute operator-local week range (Mon..Sun)
      const weekRange = await pool.query(
        `
        WITH base AS (
          SELECT
            CASE
              WHEN $1::text IS NOT NULL THEN $1::date
              ELSE (
                (date_trunc('day', now() AT TIME ZONE $2)::date)
                - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE $2))::int) - 1)
              )
            END AS week_start
        )
        SELECT
          week_start::text AS week_start,
          (week_start + interval '6 days')::date::text AS week_end
        FROM base
        `,
        [weekStartParam, tz]
      );

      const week_start = weekRange.rows[0].week_start;
      const week_end = weekRange.rows[0].week_end;

      // 3) Fetch sessions (exclude cancelled)
      // NOTE: capacity_total/capacity_remaining are returned as null for now.
      // We will fill these in once we finalize capacity math for Phase 9.
      const sessionsResult = await pool.query(
        `
        SELECT
          ds.session_id,
          (ds.dive_datetime AT TIME ZONE $4)::date::text AS session_date,
          EXTRACT(ISODOW FROM (ds.dive_datetime AT TIME ZONE $4))::int AS day_of_week,
          to_char((ds.dive_datetime AT TIME ZONE $4)::time, 'HH24:MI') AS start_time,
          to_char((ds.meet_time AT TIME ZONE $4)::time, 'HH24:MI') AS meet_time,
          dsite.name AS site_name,
          ds.session_type
        FROM aquorix.dive_sessions ds
        JOIN aquorix.divesites dsite ON dsite.dive_site_id = ds.dive_site_id
        WHERE ds.operator_id = $1
          AND (ds.dive_datetime AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
          AND ds.cancelled_at IS NULL
        ORDER BY session_date ASC, start_time ASC
        `,
        [operator.operator_id, week_start, week_end, tz]
      );

      const sessions = sessionsResult.rows.map((r) => ({
        session_id: String(r.session_id),
        session_date: r.session_date,
        day_of_week: Number(r.day_of_week),
        start_time: r.start_time,
        meet_time: r.meet_time || null,
        site_name: r.site_name,
        session_type: r.session_type || null,
        capacity_total: null,
        capacity_remaining: null
      }));

      return res.json({
        ok: true,
        status: "success",
        operator: {
          slug: operator.operator_slug,
          name: operator.name,
          timezone: tz,
          currency: operator.default_currency || null
        },
        week: { start: week_start, end: week_end },
        sessions
      });
    } catch (err) {
      console.error("[GET /api/v1/sessions] Error:", err && err.stack ? err.stack : err);
      return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
    }
  });
}

module.exports = { registerSessionsRoutes };
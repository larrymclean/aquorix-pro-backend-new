/**
 * ============================================================================
 * AQUORIX "Me" Scheduler Routes (Phase B)
 * ============================================================================
 * Purpose:
 *  - Authenticated schedule access WITHOUT operator_id in URL
 *  - Resolves operator_id from JWT → users → affiliations
 *
 * Endpoints:
 *  - GET /api/v1/me/schedule/today
 *  - GET /api/v1/me/schedule/week?start_date=YYYY-MM-DD
 *
 * Notes:
 *  - Reuses the proven SQL logic from scheduler.js (inline, no DB functions)
 *  - Phase A endpoints remain unchanged
 * ============================================================================
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/auth");
const resolveOperator = require("../middleware/resolveOperator");

// Error checking while stabilizing
if (typeof requireAuth !== "function") {
  throw new Error("Middleware load error: requireAuth is not a function");
}
if (typeof resolveOperator !== "function") {
  throw new Error("Middleware load error: resolveOperator is not a function");
}

/**
 * Copied from scheduler.js (keep in sync; Phase B uses inline to avoid drift)
 */
async function getOperatorTimezone(pool, operatorId) {
  const r = await pool.query(
    `SELECT COALESCE(timezone, 'UTC') AS tz
     FROM aquorix.diveoperators
     WHERE operator_id = $1
     LIMIT 1`,
    [operatorId]
  );
  if (r.rowCount === 0) return null;
  return r.rows[0].tz;
}

const BOOKING_TOTALS_CTE = `
  booking_totals AS (
    SELECT
      b.session_id,
      SUM(CASE WHEN b.booking_status = 'confirmed' THEN COALESCE(b.headcount, 1) ELSE 0 END) AS confirmed_headcount,
      SUM(CASE WHEN b.booking_status = 'pending'   THEN COALESCE(b.headcount, 1) ELSE 0 END) AS pending_headcount
    FROM aquorix.dive_bookings b
    WHERE b.operator_id = $1
    GROUP BY b.session_id
  )
`;

function formatSessionRow(row) {
  const maxCap = row.max_capacity === null ? null : Number(row.max_capacity);
  const confirmed = Number(row.confirmed_headcount || 0);
  const pending = Number(row.pending_headcount || 0);

  const capacity =
    maxCap === null
      ? {
          max_capacity: null,
          confirmed_headcount: confirmed,
          pending_headcount: pending,
          available_if_confirmed_only: null,
          available_if_pending_reserved: null,
          is_over_capacity_confirmed_only: null,
          is_over_capacity_with_pending: null,
        }
      : {
          max_capacity: maxCap,
          confirmed_headcount: confirmed,
          pending_headcount: pending,
          available_if_confirmed_only: maxCap - confirmed,
          available_if_pending_reserved: maxCap - (confirmed + pending),
          is_over_capacity_confirmed_only: confirmed > maxCap,
          is_over_capacity_with_pending: confirmed + pending > maxCap,
        };

  const capacity_mode = row.vessel_id ? "vessel_limited" : "shore_unlimited";

  return {
    session_id: Number(row.session_id),
    operator_id: Number(row.operator_id),
    itinerary_id: Number(row.itinerary_id),
    team_id: Number(row.team_id),
    dive_site_id: Number(row.dive_site_id),
    dive_site_name: row.dive_site_name,
    session_type: row.session_type,

    dive_datetime: row.dive_datetime_local ?? row.dive_datetime,
    meet_time: row.meet_time_local ?? row.meet_time,

    dive_datetime_utc: row.dive_datetime_utc ?? row.dive_datetime,
    dive_datetime_local: row.dive_datetime_local ?? null,
    meet_time_utc: row.meet_time_utc ?? row.meet_time,
    meet_time_local: row.meet_time_local ?? null,

    notes: row.notes || null,

    vessel: row.vessel_id
      ? {
          vessel_id: Number(row.vessel_id),
          name: row.vessel_name || null,
          max_capacity: row.max_capacity === null ? null : Number(row.max_capacity),
        }
      : null,

    capacity: {
      capacity_mode,
      capacity_note:
        capacity_mode === "shore_unlimited"
          ? "Shore dive (no vessel capacity limit)"
          : null,
      ...capacity,
    },
  };
}

/**
 * GET /api/v1/me/schedule/today
 * Authenticated "today" in operator timezone.
 */
router.get("/me/schedule/today", requireAuth, resolveOperator, async (req, res) => {
  const pool = req.app.locals.pool;
  const operatorId = req.operatorContext.operator_id;

  try {
    const tz = await getOperatorTimezone(pool, operatorId);
    if (!tz) return res.status(404).json({ error: "operator_not_found" });

    const sql = `
      WITH
        ${BOOKING_TOTALS_CTE}
      SELECT
        ds.session_id,
        ds.operator_id,
        ds.itinerary_id,
        ds.team_id,
        ds.vessel_id,
        v.name AS vessel_name,
        v.max_capacity,
        ds.dive_site_id,
        s.name AS dive_site_name,
        ds.session_type,
        ds.dive_datetime,
        ds.meet_time,
        ds.notes,
        ds.dive_datetime AS dive_datetime_utc,
        to_char(ds.dive_datetime AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS dive_datetime_local,
        ds.meet_time AS meet_time_utc,
        to_char(ds.meet_time    AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS meet_time_local,
        COALESCE(bt.confirmed_headcount, 0) AS confirmed_headcount,
        COALESCE(bt.pending_headcount, 0)   AS pending_headcount
      FROM aquorix.dive_sessions ds
      JOIN aquorix.divesites s ON s.dive_site_id = ds.dive_site_id
      LEFT JOIN aquorix.vessels v ON v.vessel_id = ds.vessel_id
      LEFT JOIN booking_totals bt ON bt.session_id = ds.session_id
      WHERE ds.operator_id = $1
        AND (ds.dive_datetime AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
      ORDER BY ds.dive_datetime ASC;
    `;

    const r = await pool.query(sql, [operatorId, tz]);

    return res.json({
      operator_id: operatorId,
      timezone: tz,
      meta: {
        generated_at: new Date().toISOString(),
        source: "aquorix-scheduler-api",
        api_version: "v1",
        operator_timezone: tz,
        endpoint: "me/schedule/today",
      },
      session_count: r.rowCount,
      sessions: r.rows.map(formatSessionRow),
    });
  } catch (err) {
    console.error("[me/schedule/today] error:", err);
    return res.status(500).json({ error: "schedule_today_failed", details: err.message });
  }
});

/**
 * GET /api/v1/me/schedule/week?start_date=YYYY-MM-DD
 */
router.get("/me/schedule/week", requireAuth, resolveOperator, async (req, res) => {
  const pool = req.app.locals.pool;
  const operatorId = req.operatorContext.operator_id;
  const { start_date } = req.query;

  const startDate = typeof start_date === "string" ? start_date : null;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
  }

  try {
    const tz = await getOperatorTimezone(pool, operatorId);
    if (!tz) return res.status(404).json({ error: "operator_not_found" });

    const sql = `
      WITH
        params AS (SELECT $3::date AS start_date),
        ${BOOKING_TOTALS_CTE}
      SELECT
        to_char(p.start_date, 'YYYY-MM-DD') AS week_start_date,
        ds.session_id,
        ds.operator_id,
        ds.itinerary_id,
        ds.team_id,
        ds.vessel_id,
        v.name AS vessel_name,
        v.max_capacity,
        ds.dive_site_id,
        s.name AS dive_site_name,
        ds.session_type,
        ds.dive_datetime,
        ds.meet_time,
        ds.notes,
        ds.dive_datetime AS dive_datetime_utc,
        to_char(ds.dive_datetime AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS dive_datetime_local,
        ds.meet_time AS meet_time_utc,
        to_char(ds.meet_time    AT TIME ZONE $2, 'YYYY-MM-DD"T"HH24:MI:SS') AS meet_time_local,
        COALESCE(bt.confirmed_headcount, 0) AS confirmed_headcount,
        COALESCE(bt.pending_headcount, 0)   AS pending_headcount
      FROM aquorix.dive_sessions ds
      JOIN params p ON TRUE
      JOIN aquorix.divesites s ON s.dive_site_id = ds.dive_site_id
      LEFT JOIN aquorix.vessels v ON v.vessel_id = ds.vessel_id
      LEFT JOIN booking_totals bt ON bt.session_id = ds.session_id
      WHERE ds.operator_id = $1
        AND (ds.dive_datetime AT TIME ZONE $2)::date >= p.start_date
        AND (ds.dive_datetime AT TIME ZONE $2)::date < (p.start_date + interval '7 days')
      ORDER BY ds.dive_datetime ASC;
    `;

    const r = await pool.query(sql, [operatorId, tz, startDate]);

    return res.json({
      operator_id: operatorId,
      timezone: tz,
      meta: {
        generated_at: new Date().toISOString(),
        source: "aquorix-scheduler-api",
        api_version: "v1",
        operator_timezone: tz,
        endpoint: "me/schedule/week",
      },
      week_start: r.rowCount ? r.rows[0].week_start_date : startDate,
      session_count: r.rowCount,
      sessions: r.rows.map(formatSessionRow),
    });
  } catch (err) {
    console.error("[me/schedule/week] error:", err);
    return res.status(500).json({ error: "schedule_week_failed", details: err.message });
  }
});

module.exports = router;
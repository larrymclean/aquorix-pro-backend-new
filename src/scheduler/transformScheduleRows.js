/*
  Product: AQUORIX Scheduler App v1
  File: transformScheduleRows.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/scheduler/transformScheduleRows.js
  Description:
    Pure transform module for the Public Schedule Widget.
    Input: DB rows (sessions query) + operator + week
    Output: JSON contract used by:
      GET /api/v1/public/widgets/schedule/:operator_slug

  Author: Larry McLean + ChatGPT (Lead Technical Architect)
  Created: 2026-02-13
  Version: 1.0.0

  Last Updated: 2026-02-13
  Status: ACTIVE (Scheduler App v1)

  Change Log:
    - 2026-02-13 - v1.0.0 (Larry + ChatGPT):
      - Extract transform logic into a pure function for M3 strict parity testing
*/

function transformScheduleRows(rows, operator, week) {
  const tz = operator && operator.timezone ? operator.timezone : "UTC";

  const weekdayNames = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
  };

  // rows expected shape (from query):
  // [
  //   { session_id, session_date:'YYYY-MM-DD', day_of_week:1..7, start_time:'HH:MM', site_name }
  // ]

  const byDate = new Map();

  for (const row of rows || []) {
    const date = row.session_date;

    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        weekday: weekdayNames[row.day_of_week] || null,
        sessions: [],
      });
    }

    byDate.get(date).sessions.push({
      session_id: row.session_id,
      start_time: row.start_time,
      site_name: row.site_name,
      capacity_total: null,
      capacity_remaining: null,
    });
  }

  // Deterministic ordering (important for deep-equal)
  const sortedDates = Array.from(byDate.keys()).sort();
  const days = sortedDates.map((date) => {
    const day = byDate.get(date);

    // Ensure sessions are deterministically ordered
    day.sessions.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

    return day;
  });

  return {
    ok: true,
    status: "success",
    operator: {
      slug: operator.operator_slug,
      name: operator.name,
      timezone: tz,
      currency: operator.default_currency,
    },
    week: {
      start: week.start,
      end: week.end,
    },
    days,
  };
}

module.exports = { transformScheduleRows };

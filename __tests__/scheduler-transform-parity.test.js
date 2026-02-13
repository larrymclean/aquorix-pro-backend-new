/*
  Product: AQUORIX Scheduler App v1
  File: scheduler-transform-parity.test.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/__tests__/scheduler-transform-parity.test.js
  Description:
    M3 Ship-Blocking Gate:
      Strict deep-equal parity test (transform-level) against pinned oracle fixture.
    This test avoids HTTP flakiness and validates the actual transform logic.

  Author: Larry McLean + ChatGPT (Lead Technical Architect)
  Created: 2026-02-13
  Version: 1.0.0

  Last Updated: 2026-02-13
  Status: ACTIVE (Scheduler App v1)

  Change Log:
    - 2026-02-13 - v1.0.0 (Larry + ChatGPT):
      - Initial strict parity test for schedule transform vs oracle fixture
*/

require("dotenv").config();

const path = require("path");
const { Pool } = require("pg");
const { transformScheduleRows } = require("../src/scheduler/transformScheduleRows");

const ORACLE_PATH = path.join(
  __dirname,
  "..",
  "contracts",
  "scheduler",
  "oracle",
  "blue-current-week-2026-02-09.json"
);

const oracleFixture = require(ORACLE_PATH);

describe("Scheduler App v1 — M3 Transform Parity (Strict Deep Equal)", () => {
  let pool;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is missing. Ensure /Users/larrymclean/CascadeProjects/aquorix-backend/.env is set.");
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false,
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test("transform(rows) matches oracle fixture exactly for known week", async () => {
    const operatorSlug = "blue-current-diving";
    const week = { start: "2026-02-09", end: "2026-02-15" };

    // 1) Resolve operator
    const opResult = await pool.query(
      `
      SELECT operator_id, operator_slug, name, timezone, default_currency
      FROM aquorix.diveoperators
      WHERE operator_slug = $1
      LIMIT 1
      `,
      [operatorSlug]
    );

    expect(opResult.rowCount).toBe(1);
    const operator = opResult.rows[0];
    const tz = operator.timezone || "UTC";

    // 2) Pull sessions for that operator during that week (same shape as endpoint query)
    const sessions = await pool.query(
      `
      SELECT
        ds.session_id,
        (ds.dive_datetime AT TIME ZONE $4)::date::text AS session_date,
        EXTRACT(ISODOW FROM (ds.dive_datetime AT TIME ZONE $4))::int AS day_of_week,
        to_char((ds.dive_datetime AT TIME ZONE $4)::time, 'HH24:MI') AS start_time,
        dsite.name AS site_name
      FROM aquorix.dive_sessions ds
      JOIN aquorix.divesites dsite ON dsite.dive_site_id = ds.dive_site_id
      WHERE ds.operator_id = $1
        AND (ds.dive_datetime AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY session_date ASC, start_time ASC
      `,
      [operator.operator_id, week.start, week.end, tz]
    );

    // 3) Transform + strict deep-equal parity
    const actual = transformScheduleRows(sessions.rows, operator, week);

    expect(actual).toStrictEqual(oracleFixture);
  });
});

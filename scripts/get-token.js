/*
  File: get-token.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/scripts/get-token.js
  Description: Supabase Auth helper. Returns a JWT access token (prints token only).
  Author: Larry McLean
  Created: 2026-02-14
  Version: 1.0.0
  Status: ACTIVE (Local dev tool)

  Change Log (append-only):
    - 2026-02-14 - v1.0.0 (Larry McLean):
      - Initial version: password grant via Supabase Auth REST endpoint.
*/

require('dotenv').config();

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  // Use separate env names so you never confuse them with app users.
  const email = process.env.AQX_TEST_EMAIL;
  const password = process.env.AQX_TEST_PASSWORD;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !email || !password) {
    console.error("Missing env vars. Required: SUPABASE_URL, SUPABASE_ANON_KEY, AQX_TEST_EMAIL, AQX_TEST_PASSWORD");
    process.exit(1);
  }

  const url = `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password })
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error(data);
    process.exit(1);
  }

  if (!data.access_token) {
    console.error("No access_token returned.");
    process.exit(1);
  }

  // IMPORTANT: print token only (no extra text)
  process.stdout.write(String(data.access_token));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

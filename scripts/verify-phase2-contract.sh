#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------
# AQUORIX — VIKING
# Phase 3.2: Contract Drift Guard (Public Schedule Widget)
#
# Verifies:
#  - Endpoint responds
#  - Required top-level keys exist
#  - Required operator keys exist
#  - days[] is an array
#  - (optional, but recommended) start_time contains a known seeded value (08:30)
#
# Usage:
#   ./scripts/verify-phase2-contract.sh
#
# Notes:
#  - Requires: curl, jq
# ------------------------------------------------------------

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
URL="$BASE_URL/api/v1/public/widgets/schedule/blue-current-diving?week_start=2026-02-09"

echo "AQUORIX VIKING Phase 3.2 — Contract Drift Guard"
echo "Fetching: $URL"
echo ""

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ FAIL: jq is not installed. Install with: brew install jq"
  exit 1
fi

LIVE_JSON="$(curl -s "$URL")"

# --- Required keys ---
REQUIRED_KEYS=("ok" "status" "operator" "week" "days")
for key in "${REQUIRED_KEYS[@]}"; do
  echo "$LIVE_JSON" | jq -e ".$key" >/dev/null
  echo "✅ PASS: top-level key '$key' present"
done

# --- Operator keys ---
OP_KEYS=("slug" "name" "timezone" "currency")
for key in "${OP_KEYS[@]}"; do
  echo "$LIVE_JSON" | jq -e ".operator.$key" >/dev/null
  echo "✅ PASS: operator key '$key' present"
done

# --- days must be array ---
echo "$LIVE_JSON" | jq -e '.days | type == "array"' >/dev/null
echo "✅ PASS: 'days' is an array"

# --- Optional “time correctness” canary ---
# This is a cheap regression guard against timezone/format drift.
# If your seed week includes 08:30, this should pass. If it fails, review seed or time formatting.
if echo "$LIVE_JSON" | jq -e '.days[].sessions[]? | select(.start_time=="08:30")' >/dev/null; then
  echo "✅ PASS: found seeded start_time \"08:30\" (timezone/format canary)"
else
  echo "⚠️ WARN: did not find start_time \"08:30\". If seed changed, update canary."
fi

echo ""
echo "✅ ALL REQUIRED CHECKS PASSED"

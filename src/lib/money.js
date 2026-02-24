/*
 * AQUORIX Pro Backend - Money Helpers
 * File: money.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/lib/money.js
 * Description: Single source of truth for currency normalization + minor-unit conversion.
 *
 * Author: Larry McLean
 * Created: 2026-02-23
 * Version: 1.0.0
 *
 * Status: ACTIVE (Phase 8.3)
 *
 * Change Log (append-only):
 *   - 2026-02-23: v1.0.0 - Initial money helpers (minor units, normalization, safe parsing)
 */

function normalizeCurrency(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  return c;
}

/**
 * Minor-unit multiplier (exponent) mapping.
 * - JOD commonly uses 3 decimals (fils) -> 1000
 * - USD/EUR/GBP generally use 2 decimals -> 100
 *
 * IMPORTANT: We keep this small + deterministic. Expand only when needed.
 */
function minorUnitMultiplier(currency) {
  const c = normalizeCurrency(currency);
  if (!c) return null;

  if (c === "JOD") return 1000;
  // default 2-decimal currencies
  return 100;
}

/**
 * Convert major units (e.g. "95.500" JOD) -> minor units integer string (e.g. "95500" fils).
 * Avoids JS float math; uses string parsing.
 *
 * Returns: string representing an integer (safe for Postgres BIGINT via pg).
 */
function toMinorUnits(amountMajor, currency) {
  const c = normalizeCurrency(currency);
  const mult = minorUnitMultiplier(c);
  if (!c || !mult) {
    throw new Error("Invalid currency for toMinorUnits()");
  }

  const raw = String(amountMajor).trim();
  if (!raw) throw new Error("Invalid amount for toMinorUnits()");

  // Accept "95", "95.5", "95.50", "95.500"
  const m = raw.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error("Invalid amount format for toMinorUnits()");

  const sign = m[1] ? "-" : "";
  const whole = m[2];
  const fracRaw = m[3] || "";

  const scale = mult === 1000 ? 3 : 2;
  const frac = (fracRaw + "0".repeat(scale)).slice(0, scale);

  // Build integer string: whole + padded frac
  const minorStr = whole + frac;

  // Strip leading zeros safely (but keep "0")
  const cleaned = minorStr.replace(/^0+(?=\d)/, "");
  return sign ? "-" + cleaned : cleaned;
}

/**
 * Convert minor units integer string -> major string with fixed decimals (2 for display by default).
 * This is for display/logging; authoritative value is payment_amount_minor.
 */
function minorToMajorDisplay(amountMinor, currency, displayDecimals = 2) {
  const c = normalizeCurrency(currency);
  const mult = minorUnitMultiplier(c);
  if (!c || !mult) return null;

  const raw = String(amountMinor).trim();
  if (!/^-?\d+$/.test(raw)) return null;

  const sign = raw.startsWith("-") ? "-" : "";
  const abs = sign ? raw.slice(1) : raw;

  const scale = mult === 1000 ? 3 : 2;

  const padded = abs.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const frac = padded.slice(-scale);

  // Round/truncate to displayDecimals
  const fracDisplay = frac.slice(0, Math.max(0, displayDecimals)).padEnd(displayDecimals, "0");
  return `${sign}${whole}.${fracDisplay}`;
}

module.exports = {
  normalizeCurrency,
  minorUnitMultiplier,
  toMinorUnits,
  minorToMajorDisplay,
};

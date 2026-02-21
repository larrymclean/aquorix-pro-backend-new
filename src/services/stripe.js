/*
  File: stripe.js
  Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/services/stripe.js
  Description:
    AQUORIX VIKING - Stripe client initialization (server-side only).
    This file centralizes Stripe SDK usage so server.js stays cleaner.

  Author: ChatGPT (Lead) + Larry McLean (Product Owner)
  Created: 2026-02-20
  Version: v1.0.0

  Last Updated: 2026-02-20
  Status: ACTIVE (VIKING)

  Change Log:
    - 2026-02-20 - v1.0.0 (ChatGPT + Larry):
      - Add Stripe client wrapper with strict env validation.
*/

"use strict";

const Stripe = require("stripe");

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("STRIPE_SECRET_KEY is missing. Add it to your environment before starting the server.");
  }

  // NOTE: We intentionally do NOT hardcode apiVersion here.
  // Stripe's Node SDK handles default versioning unless you lock it.
  // If we decide to lock apiVersion later, we will do it explicitly as a Phase 8.x hardening step.
  return Stripe(key.trim(), {
    maxNetworkRetries: 2,
    timeout: 30000
  });
}

module.exports = {
  getStripeClient
};

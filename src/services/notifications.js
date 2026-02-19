/*
 * AQUORIX Notifications Service (Phase 7 - Viking)
 * File: notifications.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/services/notifications.js
 * Description:
 *   Centralized notification senders for Phase 7:
 *   - Resend Email (transactional)
 *   - Twilio WhatsApp (sandbox for MVP testing)
 *
 * Author: Larry McLean
 * Created: 2026-02-18
 * Version: 1.0.0
 *
 * Last Updated: 2026-02-18
 * Status: ACTIVE (Phase 7 - local dev)
 *
 * Change Log (append-only):
 *   - 2026-02-18: v1.0.0 - Initial notifications service (Resend + Twilio WhatsApp)
 */

"use strict";

const { Resend } = require("resend");
const twilio = require("twilio");

/**
 * Read env var safely.
 * - If required and missing, throws with a clear message.
 */
function env(name, { required = true } = {}) {
  const v = process.env[name];
  if (required && (!v || String(v).trim().length === 0)) {
    throw new Error(`[notifications] Missing required env var: ${name}`);
  }
  return v;
}

/**
 * Create clients lazily (only when used).
 */
function getResendClient() {
  const apiKey = env("RESEND_API_KEY");
  return new Resend(apiKey);
}

function getTwilioClient() {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  return twilio(sid, token);
}

/**
 * Send operator WhatsApp (Sandbox for Phase 7 MVP)
 * Uses:
 * - TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 * - VIKING_TEST_WHATSAPP_TO (e.g. whatsapp:+962777916312)
 */
async function sendOperatorWhatsApp({ body }) {
  if (!body || String(body).trim().length === 0) {
    throw new Error("[notifications] WhatsApp body is required");
  }

  const client = getTwilioClient();

  const from = env("TWILIO_WHATSAPP_FROM");
  const to = env("VIKING_TEST_WHATSAPP_TO");

  const msg = await client.messages.create({
    from,
    to,
    body: String(body),
  });

  return {
    provider: "twilio",
    channel: "whatsapp",
    sid: msg.sid,
    status: msg.status,
    to: msg.to,
    from: msg.from,
  };
}

/**
 * Send email via Resend
 * Uses:
 * - RESEND_FROM_EMAIL (e.g. AQUORIX <bookings@aquorix.com>)
 * - optional replyTo param (recommended: contact@aquorix.com)
 */
async function sendEmail({ to, subject, html, replyTo }) {
  if (!to || String(to).trim().length === 0) {
    throw new Error("[notifications] Email 'to' is required");
  }
  if (!subject || String(subject).trim().length === 0) {
    throw new Error("[notifications] Email 'subject' is required");
  }
  if (!html || String(html).trim().length === 0) {
    throw new Error("[notifications] Email 'html' is required");
  }

  const resend = getResendClient();
  const from = env("RESEND_FROM_EMAIL");

  const resp = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });

  // resp = { data: {id}, error }
  if (resp && resp.error) {
    const msg = resp.error && resp.error.message ? resp.error.message : String(resp.error);
    throw new Error(`[notifications] Resend error: ${msg}`);
  }

  return {
    provider: "resend",
    channel: "email",
    id: resp && resp.data ? resp.data.id : null,
  };
}

/**
 * Convenience wrappers for Phase 7 names.
 */
async function sendOperatorEmail({ subject, html }) {
  const to = env("VIKING_OPERATOR_NOTIFICATION_EMAIL");
  return sendEmail({
    to,
    subject,
    html,
    replyTo: "contact@aquorix.com",
  });
}

async function sendGuestEmail({ to, subject, html }) {
  // guest "to" is passed in from booking payload
  return sendEmail({
    to,
    subject,
    html,
    replyTo: "contact@aquorix.com",
  });
}

module.exports = {
  sendOperatorWhatsApp,
  sendOperatorEmail,
  sendGuestEmail,
  sendEmail, // exported for flexibility
};

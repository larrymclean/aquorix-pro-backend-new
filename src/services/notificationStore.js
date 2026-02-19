/*
 * AQUORIX Notification Store (Phase 7 - Viking)
 * File: notificationStore.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/services/notificationStore.js
 * Description:
 *   DB logger for aquorix.notifications.
 *   Used by Phase 7 booking flow to ensure:
 *   - Notifications are best-effort (never block booking insert)
 *   - Every attempt is logged (sent/failed + error_message)
 *
 * Author: Larry McLean
 * Created: 2026-02-18
 * Version: 1.0.0
 *
 * Last Updated: 2026-02-18
 * Status: ACTIVE (Phase 7 - local dev)
 *
 * Change Log (append-only):
 *   - 2026-02-18: v1.0.0 - Initial notification store for aquorix.notifications
 */

"use strict";

/**
 * Insert a notification record as SENT.
 * We store WhatsApp numbers in recipient_email for MVP simplicity:
 * - e.g. recipient_email = "whatsapp:+962777916312"
 */
async function logSent(pool, {
  recipient_type,      // 'operator' | 'guest' | 'staff' | 'admin'
  recipient_email,     // email OR "whatsapp:+E164"
  event_type,          // e.g. 'booking_request.operator.whatsapp'
  subject = null,      // optional
  body = null,         // optional (text)
  booking_id = null,
  session_id = null,
  operator_id = null,
  recipient_id = null  // optional bigint
}) {
  const q = `
    INSERT INTO aquorix.notifications
      (recipient_type, recipient_id, recipient_email, event_type, subject, body,
       status, attempts, last_attempt_at, sent_at,
       error_message, booking_id, session_id, operator_id, created_at, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6,
       'sent', 1, now(), now(),
       NULL, $7, $8, $9, now(), now())
    RETURNING notification_id
  `;

  const vals = [
    recipient_type || null,
    recipient_id || null,
    String(recipient_email || "").trim(),
    String(event_type || "").trim(),
    subject,
    body,
    booking_id,
    session_id,
    operator_id
  ];

  const r = await pool.query(q, vals);
  return r.rows && r.rows[0] ? r.rows[0] : null;
}

/**
 * Insert a notification record as FAILED.
 */
async function logFailed(pool, {
  recipient_type,
  recipient_email,
  event_type,
  subject = null,
  body = null,
  error_message = "unknown_error",
  booking_id = null,
  session_id = null,
  operator_id = null,
  recipient_id = null
}) {
  const q = `
    INSERT INTO aquorix.notifications
      (recipient_type, recipient_id, recipient_email, event_type, subject, body,
       status, attempts, last_attempt_at, sent_at,
       error_message, booking_id, session_id, operator_id, created_at, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6,
       'failed', 1, now(), NULL,
       $7, $8, $9, $10, now(), now())
    RETURNING notification_id
  `;

  const vals = [
    recipient_type || null,
    recipient_id || null,
    String(recipient_email || "").trim(),
    String(event_type || "").trim(),
    subject,
    body,
    String(error_message || "unknown_error"),
    booking_id,
    session_id,
    operator_id
  ];

  const r = await pool.query(q, vals);
  return r.rows && r.rows[0] ? r.rows[0] : null;
}

module.exports = {
  logSent,
  logFailed
};

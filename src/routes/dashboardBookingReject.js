/*
 * AQUORIX Backend — Dashboard Booking Reject Route Module
 * File: dashboardBookingReject.js
 * Path: /Users/larrymclean/CascadeProjects/aquorix-backend/src/routes/dashboardBookingReject.js
 * Description: Extracted dashboard booking reject endpoint (idempotent cancel)
 *
 * Author: Larry McLean
 * Created: 2026-02-25
 * Version: 1.0.0
 *
 * Change Log (append-only):
 *   - 2026-02-25: v1.0.0 - Extract POST /api/v1/dashboard/bookings/:booking_id/reject from server.js (no behavior change)
 */

module.exports = function registerDashboardBookingRejectRoutes(app, deps) {
  const { pool, requireDashboardScope, notifications, notificationStore } = deps || {};

  if (!app) throw new Error("[dashboardBookingReject] app is required");
  if (!pool) throw new Error("[dashboardBookingReject] pool is required");
  if (!requireDashboardScope) throw new Error("[dashboardBookingReject] requireDashboardScope is required");
  if (!notifications) throw new Error("[dashboardBookingReject] notifications is required");
  if (!notificationStore) throw new Error("[dashboardBookingReject] notificationStore is required");

  // ---------------------------------------------------------------------------
  // Phase 7: Reject Booking (idempotent)
  // POST /api/v1/dashboard/bookings/:booking_id/reject
  // ---------------------------------------------------------------------------
  app.post("/api/v1/dashboard/bookings/:booking_id/reject", requireDashboardScope, async (req, res) => {
    const booking_id = Number(req.params.booking_id);
    if (!Number.isFinite(booking_id) || booking_id <= 0) {
      return res.status(400).json({ ok: false, status: "bad_request", message: "Invalid booking_id" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const b = await client.query(
        `
        SELECT booking_id, booking_status, operator_id, session_id, guest_email, guest_name
        FROM aquorix.dive_bookings
        WHERE booking_id = $1
          AND operator_id = $2
        FOR UPDATE
        `,
        [booking_id, req.operator_id]
      );

      if (b.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, status: "not_found", message: "Booking not found" });
      }

      const booking = b.rows[0];

      // Idempotency
      if (booking.booking_status === "cancelled") {
        await client.query("ROLLBACK");
        return res.json({ ok: true, status: "success", action: "noop_already_cancelled", booking_id: String(booking_id) });
      }
      if (booking.booking_status === "confirmed") {
        // Still allow cancellation via reject for MVP moderation behavior
        // (You can split “cancel confirmed” into a separate endpoint later)
      }

      await client.query(
        `
        UPDATE aquorix.dive_bookings
        SET booking_status = 'cancelled',
            updated_at = now()
        WHERE booking_id = $1
          AND operator_id = $2
        `,
        [booking_id, req.operator_id]
      );

      await client.query("COMMIT");

      // Best-effort guest notification (EMAIL) + ALWAYS logged
      (async () => {
        if (!booking.guest_email) return;

        const subject = "AQUORIX Booking Update";
        const html = `<h2>Booking Update</h2><p>Hello ${booking.guest_name || "Guest"}, your booking request was not approved.</p>`;

        try {
          await notifications.sendGuestEmail({
            to: booking.guest_email,
            subject,
            html
          });

          await notificationStore.logSent(pool, {
            recipient_type: "guest",
            recipient_email: String(booking.guest_email).trim(),
            event_type: "booking_rejected.guest.email",
            subject,
            body: html,
            booking_id,
            session_id: booking.session_id,
            operator_id: req.operator_id
          });
        } catch (e) {
          try {
            await notificationStore.logFailed(pool, {
              recipient_type: "guest",
              recipient_email: String(booking.guest_email).trim(),
              event_type: "booking_rejected.guest.email",
              subject,
              body: html,
              error_message: e && e.message ? e.message : String(e),
              booking_id,
              session_id: booking.session_id,
              operator_id: req.operator_id
            });
          } catch (logErr) {
            console.error("[reject booking] guest notify failed AND logFailed failed:", logErr);
          }
        }
      })();

      return res.json({ ok: true, status: "success", action: "rejected", booking_id: String(booking_id) });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("[reject booking] error:", e);
      return res.status(500).json({ ok: false, status: "error", message: "Internal server error" });
    } finally {
      client.release();
    }
  });
};

BEGIN;

-- ==========================================
-- Blue Current (operator_id=143) Demo Bookings
-- itinerary_id = 9
-- sessions:
--   7: boat  Power Station (vessel Dolphin)
--   8: boat  Tristar        (vessel Dolphin Plus)
--   9: shore Cedar Pride
--  10: shore Japanese Gardens
-- ==========================================

-- 1) Idempotency: remove only prior demo bookings for this operator+itinerary
--    (keeps any “real” bookings safe, if you ever add them later)
DELETE FROM aquorix.dive_bookings
WHERE operator_id = 143
  AND itinerary_id = 9
  AND source = 'demo';

-- Optional: also remove prior booking test_entity markers (if you want clean tracking)
DELETE FROM aquorix.test_entities
WHERE entity_type = 'booking'
  AND notes ILIKE '%Blue Current%'
  AND created_by = 'seed-script';

-- Insert 4 demo bookings (diver_id 16, 21, 22, 27)
WITH inserted AS (
  INSERT INTO aquorix.dive_bookings (
    itinerary_id, diver_id, operator_id, session_id,
    booking_status, payment_status,
    guest_name, guest_email, guest_phone,
    headcount, source, certification_level,
    special_requests, payment_amount, payment_currency, payment_method, payment_notes
  )
  VALUES
    -- Diver 16 -> Session 7 (boat) pending/unpaid
    (9, 16, 143, 7,
    'pending', 'unpaid',
    'Demo Guest A (D16)', 'demo.d16@example.com', '+962-3-000-1016',
    2, 'demo', 'Advanced Open Water',
    'DEMO: pending boat booking for capacity + roster flow',
    NULL, 'JOD', NULL, 'Seeded demo booking'),


    -- Diver 21 -> Session 8 (boat) confirmed/paid
    (9, 21, 143, 8,
     'confirmed', 'paid',
     'Demo Guest B (D21)', 'demo.d21@example.com', '+962-3-000-1021',
     4, 'demo', 'Rescue Diver',
     'DEMO: confirmed boat booking (tests paid path)',
     240.00, 'JOD', 'cash', 'Seeded demo booking'),

    -- Diver 22 -> Session 9 (shore) pending/unpaid
    (9, 22, 143, 9,
     'pending', 'unpaid',
     'Demo Guest C (D22)', 'demo.d22@example.com', '+962-3-000-1022',
     1, 'demo', 'Open Water',
     'DEMO: shore booking (tests shore workflow)',
     NULL, 'JOD', NULL, 'Seeded demo booking'),

    -- Diver 27 -> Session 10 (shore) confirmed/unpaid (tests confirmed + unpaid)
    (9, 27, 143, 10,
     'confirmed', 'unpaid',
     'Demo Guest D (D27)', 'demo.d27@example.com', '+962-3-000-1027',
     3, 'demo', 'Advanced Open Water',
     'DEMO: confirmed but unpaid (tests overdue/pending payment)',
     NULL, 'JOD', NULL, 'Seeded demo booking')

  RETURNING booking_id, diver_id, session_id
)
INSERT INTO aquorix.test_entities (entity_type, entity_id, label, notes, created_by)
SELECT
  'booking',
  booking_id,
  'Blue Current Demo Booking',
  'Blue Current operator_id=143 itinerary_id=9 session_id=' || session_id || ' diver_id=' || diver_id,
  'seed-script'
FROM inserted;

COMMIT;

-- 3) Show what we inserted (helpful output in psql)
SELECT booking_id, diver_id, session_id, booking_status, payment_status, headcount, guest_name
FROM aquorix.dive_bookings
WHERE operator_id = 143
  AND itinerary_id = 9
  AND source = 'demo'
ORDER BY booking_id ASC;
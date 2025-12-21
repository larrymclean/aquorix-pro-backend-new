BEGIN;

-- Blue Current Diving (operator_id=143), itinerary_id=9
-- Stress test: over-capacity booking on Session 7 (Dolphin capacity 18)

INSERT INTO aquorix.dive_bookings (
  itinerary_id,
  diver_id,
  operator_id,
  session_id,
  booking_status,
  payment_status,
  created_at,
  guest_name,
  guest_email,
  guest_phone,
  headcount,
  source,
  certification_level,
  special_requests,
  payment_amount,
  payment_currency,
  payment_method,
  payment_notes
)
VALUES
(
  9,
  27,              -- use diver_id 27 (your preferred single demo diver)
  143,
  7,               -- Session 7: Power Station / Dolphin
  'pending',
  'unpaid',
  CURRENT_TIMESTAMP,
  'Stress Test Guest (Overcapacity)',
  'stress.overcap@example.com',
  '+962-3-000-9999',
  20,              -- intentionally > Dolphin capacity when combined with other pending
  'demo',
  'Advanced Open Water',
  'DEMO: stress test to trigger capacity warnings on Dolphin (session 7)',
  NULL,
  'JOD',
  NULL,
  'Seeded capacity stress booking'
);

COMMIT;
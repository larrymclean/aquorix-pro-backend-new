BEGIN;

-- Create a Blue Current single-day itinerary for tomorrow AM boat slot.
-- Satisfies the itineraries check constraint:
-- single_day => itinerary_date NOT NULL, start_date/end_date MUST be NULL.
WITH ins AS (
  INSERT INTO aquorix.itineraries (
    operator_id,
    title,
    itinerary_date,
    dive_slot,
    location_type,
    vessel_or_vehicle_name,
    itinerary_type,
    notes
  )
  VALUES (
    143,
    'DEMO: Blue Current AM Boat Itinerary',
    (CURRENT_DATE + 1),
    'AM',
    'Boat',
    'Dolphin',
    'single_day',
    'Demo itinerary for Swagger + scheduler endpoints'
  )
  RETURNING itinerary_id
)
SELECT itinerary_id AS blue_current_itinerary_id FROM ins;

COMMIT;
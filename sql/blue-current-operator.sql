BEGIN;

-- Safety: do not create duplicates (unique constraint: destination_id + name)
-- Aqaba destination_id confirmed as 19 in your output.
WITH ins AS (
  INSERT INTO aquorix.diveoperators (
    destination_id,
    name,
    website,
    services,
    certifications_offered,
    has_shore_diving,
    vehicle_inventory,
    description,
    is_preferred,
    parent_operator_id,
    location_type,
    is_test,
    created_by_user_id,
    logo_url,
    contact_info,
    timezone,
    default_currency,
    overdue_threshold_hours
  )
  VALUES (
    19,
    'Blue Current Diving',
    'https://bluecurrentdiving.demo',
    'Daily boat diving, shore diving, DSD, continuing education (DEMO)',
    'PADI/SSI (DEMO)',
    true,
    'DEMO: 2 trucks, standard day-boat logistics',
    'DEMO operator for Aqaba. Fictional mirror of Coral Gardens operational complexity (2 day boats). Used for internal testing, screenshots, sales demos, and contract validation.',
    false,
    NULL,
    'main',
    true,
    NULL,
    NULL,
    jsonb_build_object(
      'phone', '+962-3-201-0000',
      'email', 'info@bluecurrentdiving.demo',
      'scheduler_notes', 'Demo operator mirroring Coral Gardens profile. Two day boats: Dolphin (18) + Dolphin Plus (30).',
      'mirrors', 'Coral Gardens Dive Center (future client)',
      'purpose', 'Sales demos + internal testing'
    ),
    'Asia/Amman',
    'JOD',
    24
  )
  ON CONFLICT (destination_id, name)
  DO UPDATE SET
    is_test = EXCLUDED.is_test,
    contact_info = EXCLUDED.contact_info,
    timezone = EXCLUDED.timezone,
    default_currency = EXCLUDED.default_currency,
    overdue_threshold_hours = EXCLUDED.overdue_threshold_hours,
    updated_at = NOW()
  RETURNING operator_id
)
SELECT operator_id AS blue_current_operator_id FROM ins;

COMMIT;
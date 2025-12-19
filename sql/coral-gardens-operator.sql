BEGIN;

INSERT INTO aquorix.diveoperators (
  destination_id,
  name,
  website,
  services,
  certifications_offered,
  has_shore_diving,
  description,
  is_preferred,
  location_type,
  is_test,
  contact_info,
  timezone,
  default_currency,
  overdue_threshold_hours
)
VALUES (
  19,
  'Coral Gardens Dive Center',
  'https://coralgardens.example', -- placeholder until real
  'Daily boat diving, shore diving, training, equipment rental',
  'PADI/SSI',
  true,
  'Aqaba-based dive operator. Two day boats supporting daily recreational operations and training. (Seeded for product implementation + sales mirror to Blue Current).',
  false,
  'main',
  false,
  jsonb_build_object(
    'phone', '+962-3-000-0000',
    'email', 'info@coralgardens.example',
    'notes', 'Seed operator for future high-value implementation project. Blue Current is the is_test mirror.'
  ),
  'Asia/Amman',
  'JOD',
  24
)
ON CONFLICT (destination_id, name)
DO UPDATE SET
  website = EXCLUDED.website,
  services = EXCLUDED.services,
  certifications_offered = EXCLUDED.certifications_offered,
  has_shore_diving = EXCLUDED.has_shore_diving,
  description = EXCLUDED.description,
  is_test = EXCLUDED.is_test,
  contact_info = EXCLUDED.contact_info,
  timezone = EXCLUDED.timezone,
  default_currency = EXCLUDED.default_currency,
  overdue_threshold_hours = EXCLUDED.overdue_threshold_hours,
  updated_at = NOW();

COMMIT;

-- Return operator_id
SELECT operator_id, name, is_test, destination_id
FROM aquorix.diveoperators
WHERE destination_id=19 AND name='Coral Gardens Dive Center';
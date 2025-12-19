BEGIN;

-- Find Coral Gardens operator_id (real operator)
WITH cg AS (
  SELECT operator_id
  FROM aquorix.diveoperators
  WHERE destination_id=19 AND name='Coral Gardens Dive Center'
  ORDER BY operator_id DESC
  LIMIT 1
)
INSERT INTO aquorix.vessels (operator_id, name, max_capacity, vessel_type, notes, is_active, is_test)
SELECT
  cg.operator_id,
  'Destiny',
  30,
  'dayboat',
  'Primary day boat (seed data)',
  true,
  false
FROM cg
WHERE NOT EXISTS (
  SELECT 1 FROM aquorix.vessels v
  WHERE v.operator_id=cg.operator_id AND v.name='Destiny'
);

WITH cg AS (
  SELECT operator_id
  FROM aquorix.diveoperators
  WHERE destination_id=19 AND name='Coral Gardens Dive Center'
  ORDER BY operator_id DESC
  LIMIT 1
)
INSERT INTO aquorix.vessels (operator_id, name, max_capacity, vessel_type, notes, is_active, is_test)
SELECT
  cg.operator_id,
  'Destiny Plus',
  45,
  'dayboat',
  'Larger day boat (seed data)',
  true,
  false
FROM cg
WHERE NOT EXISTS (
  SELECT 1 FROM aquorix.vessels v
  WHERE v.operator_id=cg.operator_id AND v.name='Destiny Plus'
);

COMMIT;

-- Verify
SELECT o.operator_id, o.name AS operator_name, v.vessel_id, v.name, v.max_capacity, v.is_test
FROM aquorix.diveoperators o
JOIN aquorix.vessels v ON v.operator_id=o.operator_id
WHERE o.destination_id=19 AND o.name='Coral Gardens Dive Center'
ORDER BY v.vessel_id;
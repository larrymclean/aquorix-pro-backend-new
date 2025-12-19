BEGIN;

WITH bc AS (
  SELECT operator_id
  FROM aquorix.diveoperators
  WHERE name = 'Blue Current Diving'
    AND is_test = true
    AND destination_id = 19
  ORDER BY operator_id DESC
  LIMIT 1
)
INSERT INTO aquorix.vessels (operator_id, name, max_capacity, is_test)
SELECT bc.operator_id, 'Dolphin', 18, true
FROM bc
ON CONFLICT DO NOTHING;

WITH bc AS (
  SELECT operator_id
  FROM aquorix.diveoperators
  WHERE name = 'Blue Current Diving'
    AND is_test = true
    AND destination_id = 19
  ORDER BY operator_id DESC
  LIMIT 1
)
INSERT INTO aquorix.vessels (operator_id, name, max_capacity, is_test)
SELECT bc.operator_id, 'Dolphin Plus', 30, true
FROM bc
ON CONFLICT DO NOTHING;

COMMIT;
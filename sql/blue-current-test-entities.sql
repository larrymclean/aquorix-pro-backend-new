BEGIN;

-- 1) Operator row
INSERT INTO aquorix.test_entities (entity_type, entity_id, label, notes)
SELECT
  'diveoperator',
  o.operator_id,
  'Blue Current Diving',
  'Fictional Aqaba operator (is_test=true). Mirrors Coral Gardens operational shape. Boats: Dolphin (18) + Dolphin Plus (30).'
FROM aquorix.diveoperators o
WHERE o.operator_id = 143
  AND o.is_test = true
  AND NOT EXISTS (
    SELECT 1 FROM aquorix.test_entities te
    WHERE te.entity_type='diveoperator' AND te.entity_id=o.operator_id
  );

-- 2) Vessel rows
INSERT INTO aquorix.test_entities (entity_type, entity_id, label, notes)
SELECT
  'vessel',
  v.vessel_id,
  v.name,
  'Blue Current Diving demo vessel'
FROM aquorix.vessels v
WHERE v.operator_id = 143
  AND v.is_test = true
  AND v.name IN ('Dolphin','Dolphin Plus')
  AND NOT EXISTS (
    SELECT 1 FROM aquorix.test_entities te
    WHERE te.entity_type='vessel' AND te.entity_id=v.vessel_id
  );

COMMIT;
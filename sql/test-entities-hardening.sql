BEGIN;

-- Add columns we want for demo/test tracking (safe / non-destructive)
ALTER TABLE aquorix.test_entities
  ADD COLUMN IF NOT EXISTS label varchar(200);

ALTER TABLE aquorix.test_entities
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE aquorix.test_entities
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Helpful index (non-unique to avoid failures if duplicates already exist)
CREATE INDEX IF NOT EXISTS idx_test_entities_type_id
ON aquorix.test_entities(entity_type, entity_id);

COMMIT;
ALTER TABLE "location_search_areas"
  ADD COLUMN IF NOT EXISTS "scope_key" text,
  ADD COLUMN IF NOT EXISTS "parent_division_id" text,
  ADD COLUMN IF NOT EXISTS "parent_area_kind" varchar(16);

UPDATE "location_search_areas"
SET "scope_key" = "area_key"
WHERE "scope_key" IS NULL;

ALTER TABLE "location_search_areas"
  ALTER COLUMN "scope_key" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_search_areas_parent_division_id_fkey'
  ) THEN
    ALTER TABLE "location_search_areas"
      ADD CONSTRAINT "location_search_areas_parent_division_id_fkey"
      FOREIGN KEY ("parent_division_id") REFERENCES "overture_divisions"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_search_areas_parent_area_kind_check'
  ) THEN
    ALTER TABLE "location_search_areas"
      ADD CONSTRAINT "location_search_areas_parent_area_kind_check"
      CHECK (
        "parent_area_kind" IS NULL
        OR "parent_area_kind" IN ('city', 'region', 'country')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "location_search_areas_scope_key_idx"
  ON "location_search_areas" ("scope_key");

CREATE INDEX IF NOT EXISTS "location_search_areas_parent_division_idx"
  ON "location_search_areas" ("parent_division_id");

CREATE INDEX IF NOT EXISTS "location_search_areas_street_parent_rank_idx"
  ON "location_search_areas" ("country_code", "match_value", "parent_division_id", "property_count" DESC)
  WHERE "area_kind" = 'street';

CREATE INDEX IF NOT EXISTS "location_search_areas_postcode_parent_rank_idx"
  ON "location_search_areas" ("country_code", "match_value", "parent_division_id", "property_count" DESC)
  WHERE "area_kind" IN ('postcode', 'postcode_prefix');

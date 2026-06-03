CREATE TABLE IF NOT EXISTS "overture_divisions" (
  "id" text PRIMARY KEY,
  "subtype" varchar(32) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "region" varchar(32),
  "name" text NOT NULL,
  "parent_division_id" text,
  "admin_level" integer,
  "geometry" geometry(Point, 4326),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "overture_divisions_subtype_check"
    CHECK ("subtype" IN ('country', 'region', 'locality', 'localadmin')),
  CONSTRAINT "overture_divisions_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2)
);

CREATE TABLE IF NOT EXISTS "overture_division_areas" (
  "id" text PRIMARY KEY,
  "division_id" text NOT NULL REFERENCES "overture_divisions"("id") ON DELETE CASCADE,
  "subtype" varchar(32) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "region" varchar(32),
  "name" text NOT NULL,
  "admin_level" integer,
  "min_lon" double precision,
  "min_lat" double precision,
  "max_lon" double precision,
  "max_lat" double precision,
  "geometry" geometry(Geometry, 4326) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "overture_division_areas_subtype_check"
    CHECK ("subtype" IN ('country', 'region', 'locality', 'localadmin')),
  CONSTRAINT "overture_division_areas_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2),
  CONSTRAINT "overture_division_areas_bbox_check"
    CHECK (
      (
        "min_lon" IS NULL
        AND "min_lat" IS NULL
        AND "max_lon" IS NULL
        AND "max_lat" IS NULL
      )
      OR
      (
        "min_lon" IS NOT NULL
        AND "min_lat" IS NOT NULL
        AND "max_lon" IS NOT NULL
        AND "max_lat" IS NOT NULL
        AND "min_lon" <= "max_lon"
        AND "min_lat" <= "max_lat"
      )
    )
);

CREATE TABLE IF NOT EXISTS "property_location_division_memberships" (
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "area_kind" varchar(16) NOT NULL,
  "division_id" text NOT NULL REFERENCES "overture_divisions"("id") ON DELETE CASCADE,
  "division_area_id" text NOT NULL REFERENCES "overture_division_areas"("id") ON DELETE CASCADE,
  "subtype" varchar(32) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("property_id", "area_kind"),
  CONSTRAINT "property_location_division_memberships_area_kind_check"
    CHECK ("area_kind" IN ('city', 'region', 'country')),
  CONSTRAINT "property_location_division_memberships_subtype_check"
    CHECK ("subtype" IN ('country', 'region', 'locality', 'localadmin')),
  CONSTRAINT "property_location_division_memberships_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2)
);

ALTER TABLE "location_search_areas"
  ADD COLUMN IF NOT EXISTS "source" varchar(32),
  ADD COLUMN IF NOT EXISTS "division_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_search_areas_source_check'
  ) THEN
    ALTER TABLE "location_search_areas"
      ADD CONSTRAINT "location_search_areas_source_check"
      CHECK ("source" IS NULL OR "source" IN ('properties', 'overture'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_search_areas_division_source_check'
  ) THEN
    ALTER TABLE "location_search_areas"
      ADD CONSTRAINT "location_search_areas_division_source_check"
      CHECK (("division_id" IS NULL) OR ("source" = 'overture'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_search_areas_division_id_fkey'
  ) THEN
    ALTER TABLE "location_search_areas"
      ADD CONSTRAINT "location_search_areas_division_id_fkey"
      FOREIGN KEY ("division_id") REFERENCES "overture_divisions"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "overture_divisions_country_subtype_idx"
  ON "overture_divisions" ("country_code", "subtype");

CREATE INDEX IF NOT EXISTS "overture_divisions_parent_idx"
  ON "overture_divisions" ("parent_division_id");

CREATE INDEX IF NOT EXISTS "overture_division_areas_division_idx"
  ON "overture_division_areas" ("division_id");

CREATE INDEX IF NOT EXISTS "overture_division_areas_country_subtype_idx"
  ON "overture_division_areas" ("country_code", "subtype");

CREATE INDEX IF NOT EXISTS "overture_division_areas_geometry_gist_idx"
  ON "overture_division_areas" USING gist ("geometry");

CREATE INDEX IF NOT EXISTS "property_location_division_memberships_division_idx"
  ON "property_location_division_memberships" ("division_id");

CREATE INDEX IF NOT EXISTS "property_location_division_memberships_area_idx"
  ON "property_location_division_memberships" ("division_area_id");

CREATE INDEX IF NOT EXISTS "property_location_division_memberships_country_kind_idx"
  ON "property_location_division_memberships" ("country_code", "area_kind");

CREATE INDEX IF NOT EXISTS "location_search_areas_source_division_idx"
  ON "location_search_areas" ("source", "division_id");

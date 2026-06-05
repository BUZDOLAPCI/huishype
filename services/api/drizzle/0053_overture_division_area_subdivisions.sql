CREATE TABLE IF NOT EXISTS "overture_division_area_subdivisions" (
  "id" serial PRIMARY KEY,
  "division_area_id" text NOT NULL REFERENCES "overture_division_areas"("id") ON DELETE CASCADE,
  "division_id" text NOT NULL REFERENCES "overture_divisions"("id") ON DELETE CASCADE,
  "country_code" varchar(2) NOT NULL,
  "subtype" varchar(32) NOT NULL,
  "selection_rank" integer NOT NULL,
  "area_sort" double precision NOT NULL,
  "geometry" geometry(Geometry, 4326) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "overture_division_area_subdivisions_subtype_check"
    CHECK ("subtype" IN ('country', 'region', 'locality', 'localadmin')),
  CONSTRAINT "overture_division_area_subdivisions_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2)
);

CREATE INDEX IF NOT EXISTS "overture_division_area_subdivisions_area_idx"
  ON "overture_division_area_subdivisions" ("division_area_id");

CREATE INDEX IF NOT EXISTS "overture_division_area_subdivisions_division_idx"
  ON "overture_division_area_subdivisions" ("division_id");

CREATE INDEX IF NOT EXISTS "overture_division_area_subdivisions_country_subtype_idx"
  ON "overture_division_area_subdivisions" ("country_code", "subtype");

CREATE INDEX IF NOT EXISTS "overture_division_area_subdivisions_geometry_gist_idx"
  ON "overture_division_area_subdivisions" USING gist ("geometry");

CREATE TABLE IF NOT EXISTS "location_search_areas" (
  "area_key" text PRIMARY KEY,
  "area_kind" varchar(32) NOT NULL,
  "suggestion_type" varchar(16) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "match_value" text NOT NULL,
  "label" text NOT NULL,
  "city" varchar(100),
  "region" varchar(255),
  "postal_code" varchar(32),
  "street" varchar(255),
  "lon" double precision,
  "lat" double precision,
  "min_lon" double precision,
  "min_lat" double precision,
  "max_lon" double precision,
  "max_lat" double precision,
  "property_count" integer NOT NULL,
  "geometry_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "location_search_areas_area_kind_check"
    CHECK ("area_kind" IN ('city', 'street', 'postcode', 'postcode_prefix', 'region', 'country')),
  CONSTRAINT "location_search_areas_suggestion_type_check"
    CHECK ("suggestion_type" IN ('city', 'street', 'postcode', 'region', 'country')),
  CONSTRAINT "location_search_areas_kind_type_check"
    CHECK (
      ("area_kind" = "suggestion_type")
      OR ("area_kind" = 'postcode_prefix' AND "suggestion_type" = 'postcode')
    ),
  CONSTRAINT "location_search_areas_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2),
  CONSTRAINT "location_search_areas_match_value_check"
    CHECK ("match_value" <> ''),
  CONSTRAINT "location_search_areas_property_count_check"
    CHECK ("property_count" > 0),
  CONSTRAINT "location_search_areas_geometry_count_check"
    CHECK ("geometry_count" >= 0 AND "geometry_count" <= "property_count"),
  CONSTRAINT "location_search_areas_geometry_extent_check"
    CHECK (
      (
        "geometry_count" = 0
        AND "lon" IS NULL
        AND "lat" IS NULL
        AND "min_lon" IS NULL
        AND "min_lat" IS NULL
        AND "max_lon" IS NULL
        AND "max_lat" IS NULL
      )
      OR
      (
        "geometry_count" > 0
        AND "lon" IS NOT NULL
        AND "lat" IS NOT NULL
        AND "min_lon" IS NOT NULL
        AND "min_lat" IS NOT NULL
        AND "max_lon" IS NOT NULL
        AND "max_lat" IS NOT NULL
      )
    ),
  CONSTRAINT "location_search_areas_kind_columns_check"
    CHECK (
      ("area_kind" = 'country')
      OR ("area_kind" = 'region' AND "region" IS NOT NULL)
      OR ("area_kind" = 'city' AND "city" IS NOT NULL)
      OR ("area_kind" IN ('postcode', 'postcode_prefix') AND "postal_code" IS NOT NULL)
      OR (
        "area_kind" = 'street'
        AND "street" IS NOT NULL
        AND "city" IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS "location_search_areas_kind_country_match_idx"
  ON "location_search_areas" ("area_kind", "country_code", "match_value");

CREATE INDEX IF NOT EXISTS "location_search_areas_city_exists_idx"
  ON "location_search_areas" ("country_code", "match_value")
  WHERE "area_kind" = 'city' AND "region" IS NULL;

CREATE INDEX IF NOT EXISTS "location_search_areas_postcode_prefix_idx"
  ON "location_search_areas" ("country_code", "match_value")
  WHERE "area_kind" = 'postcode_prefix';

CREATE INDEX IF NOT EXISTS "location_search_areas_suggestion_country_match_idx"
  ON "location_search_areas" ("suggestion_type", "country_code", "match_value");

CREATE INDEX IF NOT EXISTS "location_search_areas_kind_country_count_idx"
  ON "location_search_areas" ("area_kind", "country_code", "property_count" DESC);

CREATE TABLE IF NOT EXISTS "property_country_stats" (
  "country_code" varchar(2) PRIMARY KEY,
  "property_count" integer NOT NULL,
  "geometry_count" integer NOT NULL DEFAULT 0,
  "sum_lon" double precision NOT NULL DEFAULT 0,
  "sum_lat" double precision NOT NULL DEFAULT 0,
  "min_lon" double precision,
  "min_lat" double precision,
  "max_lon" double precision,
  "max_lat" double precision,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_country_stats_country_code_check"
    CHECK ("country_code" = UPPER("country_code") AND LENGTH("country_code") = 2),
  CONSTRAINT "property_country_stats_property_count_check"
    CHECK ("property_count" > 0),
  CONSTRAINT "property_country_stats_geometry_count_check"
    CHECK ("geometry_count" >= 0 AND "geometry_count" <= "property_count"),
  CONSTRAINT "property_country_stats_geometry_extent_check"
    CHECK (
      (
        "geometry_count" = 0
        AND "sum_lon" = 0
        AND "sum_lat" = 0
        AND "min_lon" IS NULL
        AND "min_lat" IS NULL
        AND "max_lon" IS NULL
        AND "max_lat" IS NULL
      )
      OR
      (
        "geometry_count" > 0
        AND "min_lon" IS NOT NULL
        AND "min_lat" IS NOT NULL
        AND "max_lon" IS NOT NULL
        AND "max_lat" IS NOT NULL
      )
    )
);

DROP TABLE IF EXISTS "property_country_stats_backfill";

CREATE TEMP TABLE "property_country_stats_backfill" AS
SELECT
  "country_code",
  COUNT(*)::integer AS "property_count",
  COUNT("geometry")::integer AS "geometry_count",
  COALESCE(SUM(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lon",
  COALESCE(SUM(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lat",
  MIN(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "min_lon",
  MIN(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "min_lat",
  MAX(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "max_lon",
  MAX(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "max_lat"
FROM "properties"
WHERE "status" = 'active'
GROUP BY "country_code";

INSERT INTO "property_country_stats" (
  "country_code",
  "property_count",
  "geometry_count",
  "sum_lon",
  "sum_lat",
  "min_lon",
  "min_lat",
  "max_lon",
  "max_lat"
)
SELECT
  "country_code",
  "property_count",
  "geometry_count",
  "sum_lon",
  "sum_lat",
  "min_lon",
  "min_lat",
  "max_lon",
  "max_lat"
FROM "property_country_stats_backfill"
ON CONFLICT ("country_code") DO UPDATE SET
  "property_count" = EXCLUDED."property_count",
  "geometry_count" = EXCLUDED."geometry_count",
  "sum_lon" = EXCLUDED."sum_lon",
  "sum_lat" = EXCLUDED."sum_lat",
  "min_lon" = EXCLUDED."min_lon",
  "min_lat" = EXCLUDED."min_lat",
  "max_lon" = EXCLUDED."max_lon",
  "max_lat" = EXCLUDED."max_lat",
  "updated_at" = now();

DELETE FROM "property_country_stats" stats
WHERE NOT EXISTS (
  SELECT 1
  FROM "property_country_stats_backfill" backfill
  WHERE backfill."country_code" = stats."country_code"
);

DROP TABLE "property_country_stats_backfill";

CREATE OR REPLACE FUNCTION "property_country_stats_recompute_bounds"(
  "target_country_code" varchar(2)
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "property_country_stats" stats
  SET
    "min_lon" = bounds."min_lon",
    "min_lat" = bounds."min_lat",
    "max_lon" = bounds."max_lon",
    "max_lat" = bounds."max_lat",
    "updated_at" = now()
  FROM (
    SELECT
      MIN(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "min_lon",
      MIN(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "min_lat",
      MAX(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "max_lon",
      MAX(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL) AS "max_lat"
    FROM "properties"
    WHERE "status" = 'active'
      AND "country_code" = "target_country_code"
  ) bounds
  WHERE stats."country_code" = "target_country_code";

  UPDATE "property_country_stats"
  SET
    "min_lon" = NULL,
    "min_lat" = NULL,
    "max_lon" = NULL,
    "max_lat" = NULL,
    "updated_at" = now()
  WHERE "country_code" = "target_country_code"
    AND "geometry_count" = 0;
END;
$$;

CREATE OR REPLACE FUNCTION "property_country_stats_after_insert_statement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "property_country_stats" (
    "country_code",
    "property_count",
    "geometry_count",
    "sum_lon",
    "sum_lat",
    "min_lon",
    "min_lat",
    "max_lon",
    "max_lat"
  )
  SELECT
    "country_code",
    COUNT(*)::integer,
    COUNT("geometry")::integer,
    COALESCE(SUM(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0),
    COALESCE(SUM(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0),
    MIN(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MIN(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MAX(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MAX(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL)
  FROM new_properties
  WHERE "status" = 'active'
  GROUP BY "country_code"
  ON CONFLICT ("country_code") DO UPDATE SET
    "property_count" = "property_country_stats"."property_count" + EXCLUDED."property_count",
    "geometry_count" = "property_country_stats"."geometry_count" + EXCLUDED."geometry_count",
    "sum_lon" = "property_country_stats"."sum_lon" + EXCLUDED."sum_lon",
    "sum_lat" = "property_country_stats"."sum_lat" + EXCLUDED."sum_lat",
    "min_lon" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."min_lon"
      ELSE LEAST(COALESCE("property_country_stats"."min_lon", EXCLUDED."min_lon"), EXCLUDED."min_lon")
    END,
    "min_lat" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."min_lat"
      ELSE LEAST(COALESCE("property_country_stats"."min_lat", EXCLUDED."min_lat"), EXCLUDED."min_lat")
    END,
    "max_lon" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."max_lon"
      ELSE GREATEST(COALESCE("property_country_stats"."max_lon", EXCLUDED."max_lon"), EXCLUDED."max_lon")
    END,
    "max_lat" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."max_lat"
      ELSE GREATEST(COALESCE("property_country_stats"."max_lat", EXCLUDED."max_lat"), EXCLUDED."max_lat")
    END,
    "updated_at" = now();

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "property_country_stats_after_delete_statement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_country record;
BEGIN
  DELETE FROM "property_country_stats" stats
  USING (
    SELECT
      "country_code",
      COUNT(*)::integer AS "property_count"
    FROM old_properties
    WHERE "status" = 'active'
    GROUP BY "country_code"
  ) delta
  WHERE stats."country_code" = delta."country_code"
    AND stats."property_count" <= delta."property_count";

  UPDATE "property_country_stats" stats
  SET
    "property_count" = stats."property_count" - delta."property_count",
    "geometry_count" = stats."geometry_count" - delta."geometry_count",
    "sum_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN 0
      ELSE stats."sum_lon" - delta."sum_lon"
    END,
    "sum_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN 0
      ELSE stats."sum_lat" - delta."sum_lat"
    END,
    "min_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."min_lon"
    END,
    "min_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."min_lat"
    END,
    "max_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."max_lon"
    END,
    "max_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."max_lat"
    END,
    "updated_at" = now()
  FROM (
    SELECT
      "country_code",
      COUNT(*)::integer AS "property_count",
      COUNT("geometry")::integer AS "geometry_count",
      COALESCE(SUM(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lon",
      COALESCE(SUM(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lat"
    FROM old_properties
    WHERE "status" = 'active'
    GROUP BY "country_code"
  ) delta
  WHERE stats."country_code" = delta."country_code"
    AND stats."property_count" > delta."property_count";

  FOR affected_country IN
    SELECT DISTINCT old_row."country_code"
    FROM old_properties old_row
    JOIN "property_country_stats" stats
      ON stats."country_code" = old_row."country_code"
    WHERE old_row."status" = 'active'
      AND old_row."geometry" IS NOT NULL
      AND (
        ST_X(old_row."geometry") IS NOT DISTINCT FROM stats."min_lon"
        OR ST_X(old_row."geometry") IS NOT DISTINCT FROM stats."max_lon"
        OR ST_Y(old_row."geometry") IS NOT DISTINCT FROM stats."min_lat"
        OR ST_Y(old_row."geometry") IS NOT DISTINCT FROM stats."max_lat"
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM "property_country_stats"
      WHERE "country_code" = affected_country."country_code"
    ) THEN
      PERFORM "property_country_stats_recompute_bounds"(affected_country."country_code");
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "property_country_stats_after_update_statement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_country record;
BEGIN
  DELETE FROM "property_country_stats" stats
  USING (
    SELECT
      "country_code",
      COUNT(*)::integer AS "property_count"
    FROM old_properties
    WHERE "status" = 'active'
    GROUP BY "country_code"
  ) delta
  WHERE stats."country_code" = delta."country_code"
    AND stats."property_count" <= delta."property_count";

  UPDATE "property_country_stats" stats
  SET
    "property_count" = stats."property_count" - delta."property_count",
    "geometry_count" = stats."geometry_count" - delta."geometry_count",
    "sum_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN 0
      ELSE stats."sum_lon" - delta."sum_lon"
    END,
    "sum_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN 0
      ELSE stats."sum_lat" - delta."sum_lat"
    END,
    "min_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."min_lon"
    END,
    "min_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."min_lat"
    END,
    "max_lon" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."max_lon"
    END,
    "max_lat" = CASE
      WHEN stats."geometry_count" - delta."geometry_count" = 0 THEN NULL
      ELSE stats."max_lat"
    END,
    "updated_at" = now()
  FROM (
    SELECT
      "country_code",
      COUNT(*)::integer AS "property_count",
      COUNT("geometry")::integer AS "geometry_count",
      COALESCE(SUM(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lon",
      COALESCE(SUM(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0) AS "sum_lat"
    FROM old_properties
    WHERE "status" = 'active'
    GROUP BY "country_code"
  ) delta
  WHERE stats."country_code" = delta."country_code"
    AND stats."property_count" > delta."property_count";

  INSERT INTO "property_country_stats" (
    "country_code",
    "property_count",
    "geometry_count",
    "sum_lon",
    "sum_lat",
    "min_lon",
    "min_lat",
    "max_lon",
    "max_lat"
  )
  SELECT
    "country_code",
    COUNT(*)::integer,
    COUNT("geometry")::integer,
    COALESCE(SUM(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0),
    COALESCE(SUM(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL), 0),
    MIN(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MIN(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MAX(ST_X("geometry")) FILTER (WHERE "geometry" IS NOT NULL),
    MAX(ST_Y("geometry")) FILTER (WHERE "geometry" IS NOT NULL)
  FROM new_properties
  WHERE "status" = 'active'
  GROUP BY "country_code"
  ON CONFLICT ("country_code") DO UPDATE SET
    "property_count" = "property_country_stats"."property_count" + EXCLUDED."property_count",
    "geometry_count" = "property_country_stats"."geometry_count" + EXCLUDED."geometry_count",
    "sum_lon" = "property_country_stats"."sum_lon" + EXCLUDED."sum_lon",
    "sum_lat" = "property_country_stats"."sum_lat" + EXCLUDED."sum_lat",
    "min_lon" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."min_lon"
      ELSE LEAST(COALESCE("property_country_stats"."min_lon", EXCLUDED."min_lon"), EXCLUDED."min_lon")
    END,
    "min_lat" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."min_lat"
      ELSE LEAST(COALESCE("property_country_stats"."min_lat", EXCLUDED."min_lat"), EXCLUDED."min_lat")
    END,
    "max_lon" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."max_lon"
      ELSE GREATEST(COALESCE("property_country_stats"."max_lon", EXCLUDED."max_lon"), EXCLUDED."max_lon")
    END,
    "max_lat" = CASE
      WHEN EXCLUDED."geometry_count" = 0 THEN "property_country_stats"."max_lat"
      ELSE GREATEST(COALESCE("property_country_stats"."max_lat", EXCLUDED."max_lat"), EXCLUDED."max_lat")
    END,
    "updated_at" = now();

  FOR affected_country IN
    SELECT DISTINCT old_row."country_code"
    FROM old_properties old_row
    JOIN "property_country_stats" stats
      ON stats."country_code" = old_row."country_code"
    WHERE old_row."status" = 'active'
      AND old_row."geometry" IS NOT NULL
      AND (
        ST_X(old_row."geometry") IS NOT DISTINCT FROM stats."min_lon"
        OR ST_X(old_row."geometry") IS NOT DISTINCT FROM stats."max_lon"
        OR ST_Y(old_row."geometry") IS NOT DISTINCT FROM stats."min_lat"
        OR ST_Y(old_row."geometry") IS NOT DISTINCT FROM stats."max_lat"
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM "property_country_stats"
      WHERE "country_code" = affected_country."country_code"
    ) THEN
      PERFORM "property_country_stats_recompute_bounds"(affected_country."country_code");
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "property_country_stats_properties_after_insert" ON "properties";
DROP TRIGGER IF EXISTS "property_country_stats_properties_after_delete" ON "properties";
DROP TRIGGER IF EXISTS "property_country_stats_properties_after_update" ON "properties";

DROP FUNCTION IF EXISTS "property_country_stats_properties_trigger"();
DROP FUNCTION IF EXISTS "property_country_stats_add_property"(varchar(2), geometry);
DROP FUNCTION IF EXISTS "property_country_stats_remove_property"(varchar(2), geometry);

CREATE TRIGGER "property_country_stats_properties_after_insert"
AFTER INSERT ON "properties"
REFERENCING NEW TABLE AS new_properties
FOR EACH STATEMENT
EXECUTE FUNCTION "property_country_stats_after_insert_statement"();

CREATE TRIGGER "property_country_stats_properties_after_delete"
AFTER DELETE ON "properties"
REFERENCING OLD TABLE AS old_properties
FOR EACH STATEMENT
EXECUTE FUNCTION "property_country_stats_after_delete_statement"();

CREATE TRIGGER "property_country_stats_properties_after_update"
AFTER UPDATE ON "properties"
REFERENCING OLD TABLE AS old_properties NEW TABLE AS new_properties
FOR EACH STATEMENT
EXECUTE FUNCTION "property_country_stats_after_update_statement"();

CREATE INDEX IF NOT EXISTS "properties_active_country_city_token_idx"
  ON "properties" (
    "country_code",
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("city", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''))
  )
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "properties_active_country_city_region_token_idx"
  ON "properties" (
    "country_code",
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("city", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '')),
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("region", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''))
  )
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "properties_active_country_region_token_idx"
  ON "properties" (
    "country_code",
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("region", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''))
  )
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "properties_active_country_street_city_token_idx"
  ON "properties" (
    "country_code",
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("street", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '')),
    (NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE("city", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''))
  )
  WHERE "status" = 'active';

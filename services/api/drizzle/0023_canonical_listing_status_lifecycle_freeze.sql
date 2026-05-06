DROP MATERIALIZED VIEW IF EXISTS "mv_price_guess_start_market_summaries";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "mv_latest_active_listings";--> statement-breakpoint
DROP VIEW IF EXISTS "v_canonical_listing_facts";--> statement-breakpoint

CREATE TEMP TABLE IF NOT EXISTS "_canonical_listing_status_0023_affected_properties"
ON COMMIT DROP AS
SELECT DISTINCT "property_id"
FROM "canonical_listings"
WHERE "status"::text IN ('not_found', 'blocked', 'invalid', 'parser_error', 'unknown');--> statement-breakpoint

DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_candidate_refresh"
ON "canonical_listings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_fact_refresh"
ON "canonical_listings";--> statement-breakpoint
DROP INDEX IF EXISTS "canonical_listings_property_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "canonical_listings_tile_candidate_status_property_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "canonical_listings_tile_thumbnail_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "canonical_listings_tile_active_latest_idx";--> statement-breakpoint

UPDATE "canonical_listings"
SET "status" = CASE "status"::text
  WHEN 'not_found' THEN 'withdrawn'::"canonical_listing_status"
  WHEN 'blocked' THEN 'withdrawn'::"canonical_listing_status"
  WHEN 'invalid' THEN 'withdrawn'::"canonical_listing_status"
  WHEN 'parser_error' THEN 'withdrawn'::"canonical_listing_status"
  WHEN 'unknown' THEN 'withdrawn'::"canonical_listing_status"
  ELSE "status"
END
WHERE "status"::text IN ('not_found', 'blocked', 'invalid', 'parser_error', 'unknown');--> statement-breakpoint

DO $$
DECLARE
  current_labels text[];
  old_type_name text;
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
    INTO current_labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
    AND t.typname = 'canonical_listing_status';

  IF current_labels IS NULL THEN
    CREATE TYPE "public"."canonical_listing_status" AS ENUM ('active', 'sold', 'rented', 'withdrawn');
  ELSIF current_labels IS DISTINCT FROM ARRAY['active', 'sold', 'rented', 'withdrawn']::text[] THEN
    ALTER TABLE IF EXISTS "canonical_listings"
      DROP CONSTRAINT IF EXISTS "canonical_listings_status_lifecycle_check";
    ALTER TABLE IF EXISTS "canonical_listings"
      ALTER COLUMN "status" DROP DEFAULT;

    old_type_name := 'canonical_listing_status_old_0023_' || txid_current()::text;
    EXECUTE format('ALTER TYPE "public"."canonical_listing_status" RENAME TO %I', old_type_name);
    CREATE TYPE "public"."canonical_listing_status" AS ENUM ('active', 'sold', 'rented', 'withdrawn');

    ALTER TABLE IF EXISTS "canonical_listings"
      ALTER COLUMN "status" TYPE "public"."canonical_listing_status"
      USING (
        CASE
          WHEN "status"::text IN ('active', 'sold', 'rented', 'withdrawn') THEN "status"::text
          ELSE 'withdrawn'
        END
      )::"public"."canonical_listing_status";
    ALTER TABLE IF EXISTS "canonical_listings"
      ALTER COLUMN "status" SET DEFAULT 'active'::"public"."canonical_listing_status";

    EXECUTE format('DROP TYPE "public".%I', old_type_name);
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE IF EXISTS "canonical_listings"
  ALTER COLUMN "status" SET DEFAULT 'active'::"public"."canonical_listing_status";--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "canonical_listings"
    ADD CONSTRAINT "canonical_listings_status_lifecycle_check"
    CHECK ("status"::text IN ('active', 'sold', 'rented', 'withdrawn'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_property_status_idx"
ON "canonical_listings" ("property_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_candidate_status_property_idx"
ON "canonical_listings" ("status", "property_id")
WHERE "verification_state" <> 'invalid'
  AND "status" IN ('active', 'sold', 'rented');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_thumbnail_idx"
ON "canonical_listings" (
  "property_id",
  ("status" = 'active') DESC,
  COALESCE(
    "last_reconciled_at",
    "last_mirror_seen_at",
    "last_user_seen_at",
    "last_seen_at",
    "updated_at",
    "created_at"
  ) DESC,
  "created_at" DESC,
  "id" DESC
)
INCLUDE ("thumbnail_url")
WHERE "verification_state" <> 'invalid'
  AND "thumbnail_url" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_active_latest_idx"
ON "canonical_listings" (
  "property_id",
  COALESCE(
    "last_reconciled_at",
    "last_mirror_seen_at",
    "last_user_seen_at",
    "last_seen_at",
    "updated_at",
    "created_at"
  ) DESC,
  "created_at" DESC,
  "id" DESC
)
WHERE "verification_state" <> 'invalid'
  AND "status" = 'active';--> statement-breakpoint

CREATE TRIGGER "canonical_listings_property_tile_listing_candidate_refresh"
AFTER INSERT OR DELETE OR UPDATE OF "property_id", "status", "verification_state"
ON "canonical_listings"
FOR EACH ROW
EXECUTE FUNCTION refresh_property_tile_listing_candidate_from_listing();--> statement-breakpoint

CREATE TRIGGER "canonical_listings_property_tile_listing_fact_refresh"
AFTER INSERT OR DELETE OR UPDATE OF
  "id",
  "property_id",
  "status",
  "verification_state",
  "source_name",
  "price_type",
  "last_reconciled_at",
  "last_mirror_seen_at",
  "last_user_seen_at",
  "last_seen_at",
  "updated_at",
  "created_at"
ON "canonical_listings"
FOR EACH ROW
EXECUTE FUNCTION refresh_property_tile_listing_fact_from_listing();--> statement-breakpoint

DO $$
DECLARE
  affected_property_id uuid;
BEGIN
  FOR affected_property_id IN
    SELECT "property_id"
    FROM "_canonical_listing_status_0023_affected_properties"
  LOOP
    PERFORM refresh_property_tile_listing_candidate(affected_property_id);
    PERFORM refresh_property_tile_listing_fact(affected_property_id);
  END LOOP;
END $$;--> statement-breakpoint

CREATE VIEW "v_canonical_listing_facts" AS
SELECT
  cl.id AS listing_id,
  cl.property_id,
  p.country_code,
  cl.source_name,
  cl.status::text AS status,
  CASE
    WHEN lower(cl.source_name) = 'funda' AND lower(btrim(cl.price_type)) = 'buy'
      THEN 'sale'
    WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent')
      THEN lower(btrim(cl.price_type))
    WHEN lower(cl.source_name) = 'pararius'
      THEN 'rent'
    ELSE 'sale'
  END AS normalized_price_type,
  (
    cl.status = 'active'
    AND cl.asking_price IS NOT NULL
    AND (
      CASE
        WHEN lower(cl.source_name) = 'funda' AND lower(btrim(cl.price_type)) = 'buy'
          THEN 'sale'
        WHEN lower(btrim(cl.price_type)) IN ('sale', 'rent')
          THEN lower(btrim(cl.price_type))
        WHEN lower(cl.source_name) = 'pararius'
          THEN 'rent'
        ELSE 'sale'
      END
    ) = 'sale'
  ) AS is_active_sale,
  cl.asking_price,
  cl.first_seen_at AS listed_at,
  cl.living_area_m2,
  cl.thumbnail_url,
  cl.verification_state,
  cl.origin_summary,
  cl.submitted_by,
  COALESCE(
    cl.last_reconciled_at,
    cl.last_mirror_seen_at,
    cl.last_user_seen_at,
    cl.last_seen_at,
    cl.updated_at,
    cl.created_at
  ) AS sort_at,
  cl.created_at AS listing_created_at
FROM canonical_listings cl
JOIN properties p ON p.id = cl.property_id
WHERE cl.verification_state <> 'invalid';--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_latest_active_listings" AS
SELECT DISTINCT ON (property_id)
  property_id,
  asking_price,
  thumbnail_url,
  listed_at
FROM v_canonical_listing_facts
WHERE status = 'active'
ORDER BY property_id, sort_at DESC, listing_created_at DESC, listing_id DESC;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mv_latest_active_listings_property"
ON "mv_latest_active_listings" ("property_id");--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_price_guess_start_market_summaries" AS
WITH sale_facts AS (
  SELECT
    clf.country_code,
    CASE
      WHEN clf.country_code = 'NL'
        AND regexp_replace(p.postal_code, '\s+', '', 'g') ~ '^[0-9]{4}[[:alpha:]]{2}$'
        THEN nullif(substring(regexp_replace(p.postal_code, '\s+', '', 'g') from 1 for 4), '')
      ELSE NULL
    END AS postal_scope_key,
    lower(btrim(p.city)) AS city_scope_key,
    lower(btrim(p.region)) AS region_scope_key,
    p.official_valuation,
    COALESCE(clf.living_area_m2, p.floor_area_m2) AS comparable_area_m2,
    clf.asking_price
  FROM v_canonical_listing_facts clf
  JOIN properties p ON p.id = clf.property_id
  WHERE lower(clf.source_name) = 'funda'
    AND clf.normalized_price_type = 'sale'
    AND clf.status = 'active'
    AND clf.asking_price BETWEEN 50000 AND 2000000
    AND nullif(btrim(clf.country_code), '') IS NOT NULL
),
scoped_facts AS (
  SELECT
    country_code,
    'postal_prefix'::text AS scope_type,
    postal_scope_key AS scope_key,
    8 AS minimum_sample_size,
    official_valuation,
    comparable_area_m2,
    asking_price
  FROM sale_facts
  WHERE postal_scope_key IS NOT NULL

  UNION ALL

  SELECT
    country_code,
    'city'::text AS scope_type,
    city_scope_key AS scope_key,
    20 AS minimum_sample_size,
    official_valuation,
    comparable_area_m2,
    asking_price
  FROM sale_facts
  WHERE city_scope_key IS NOT NULL AND city_scope_key <> ''

  UNION ALL

  SELECT
    country_code,
    'region'::text AS scope_type,
    region_scope_key AS scope_key,
    40 AS minimum_sample_size,
    official_valuation,
    comparable_area_m2,
    asking_price
  FROM sale_facts
  WHERE region_scope_key IS NOT NULL AND region_scope_key <> ''

  UNION ALL

  SELECT
    country_code,
    'country'::text AS scope_type,
    country_code AS scope_key,
    100 AS minimum_sample_size,
    official_valuation,
    comparable_area_m2,
    asking_price
  FROM sale_facts
)
SELECT
  country_code,
  scope_type,
  scope_key,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY asking_price::numeric / nullif(official_valuation, 0)
  ) FILTER (WHERE official_valuation > 0) AS median_asking_to_official_ratio,
  count(*) FILTER (WHERE official_valuation > 0)::integer AS ratio_sample_size,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY asking_price::numeric / nullif(comparable_area_m2, 0)
  ) FILTER (WHERE comparable_area_m2 > 0) AS median_asking_per_m2,
  count(*) FILTER (WHERE comparable_area_m2 > 0)::integer AS per_m2_sample_size,
  now() AS refreshed_at
FROM scoped_facts
GROUP BY country_code, scope_type, scope_key, minimum_sample_size
HAVING
  count(*) FILTER (WHERE official_valuation > 0) >= minimum_sample_size
  OR count(*) FILTER (WHERE comparable_area_m2 > 0) >= minimum_sample_size;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mv_price_guess_start_market_summaries_unique"
ON "mv_price_guess_start_market_summaries" ("country_code", "scope_type", "scope_key");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_mv_price_guess_start_market_summaries_lookup"
ON "mv_price_guess_start_market_summaries" ("country_code", "scope_type", "scope_key");--> statement-breakpoint

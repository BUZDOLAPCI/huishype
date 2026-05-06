DO $$
BEGIN
  CREATE TYPE "public"."canonical_listing_status" AS ENUM(
    'active',
    'sold',
    'rented',
    'withdrawn'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "public"."canonical_listing_status_source" AS ENUM('mirror', 'user', 'system');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "public"."canonical_listing_verification_state" AS ENUM(
    'provisional',
    'validated',
    'invalid',
    'validation_pending',
    'validation_blocked',
    'validation_failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "public"."canonical_listing_origin_summary" AS ENUM(
    'user',
    'mirror',
    'user_and_mirror'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "canonical_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "primary_source_listing_id" varchar(255),
  "canonical_url" text,
  "display_url" text,
  "status" "canonical_listing_status" DEFAULT 'active' NOT NULL,
  "status_source" "canonical_listing_status_source" DEFAULT 'system' NOT NULL,
  "verification_state" "canonical_listing_verification_state" DEFAULT 'provisional' NOT NULL,
  "origin_summary" "canonical_listing_origin_summary" DEFAULT 'user' NOT NULL,
  "submitted_by" uuid,
  "thumbnail_url" text,
  "title" text,
  "description" text,
  "asking_price" bigint,
  "price_currency" varchar(3) DEFAULT 'EUR' NOT NULL,
  "price_type" varchar(10),
  "living_area_m2" integer,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_mirror_seen_at" timestamp with time zone,
  "last_user_seen_at" timestamp with time zone,
  "last_reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "price_type" varchar(10);--> statement-breakpoint
ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "living_area_m2" integer;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "canonical_listings"
    ADD CONSTRAINT "canonical_listings_property_id_properties_id_fk"
    FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "canonical_listings"
    ADD CONSTRAINT "canonical_listings_submitted_by_users_id_fk"
    FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "canonical_listings_source_identity_idx"
  ON "canonical_listings" USING btree ("source_name", "primary_source_listing_id")
  WHERE primary_source_listing_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canonical_listings_source_url_idx"
  ON "canonical_listings" USING btree ("source_name", "canonical_url")
  WHERE canonical_url IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_property_id_idx"
  ON "canonical_listings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_property_status_idx"
  ON "canonical_listings" USING btree ("property_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_listings_verification_state_idx"
  ON "canonical_listings" USING btree ("verification_state");--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS mv_price_guess_start_market_summaries;--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS mv_latest_active_listings;--> statement-breakpoint
DROP VIEW IF EXISTS v_canonical_listing_facts;--> statement-breakpoint

CREATE VIEW v_canonical_listing_facts AS
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

CREATE MATERIALIZED VIEW mv_latest_active_listings AS
SELECT DISTINCT ON (property_id)
  property_id,
  asking_price,
  thumbnail_url,
  listed_at
FROM v_canonical_listing_facts
WHERE status = 'active'
ORDER BY property_id, sort_at DESC, listing_created_at DESC, listing_id DESC;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_latest_active_listings_property
ON mv_latest_active_listings (property_id);--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_price_guess_start_market_summaries AS
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_price_guess_start_market_summaries_unique
ON mv_price_guess_start_market_summaries (country_code, scope_type, scope_key);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_mv_price_guess_start_market_summaries_lookup
ON mv_price_guess_start_market_summaries (country_code, scope_type, scope_key);--> statement-breakpoint

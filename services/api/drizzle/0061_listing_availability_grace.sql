-- Preserve factual lifecycle separately from the thirty-day display policy.
ALTER TABLE canonical_listings
  ADD COLUMN last_positive_availability_at timestamptz,
  ADD COLUMN availability_ended_at timestamptz,
  ADD COLUMN availability_expires_at timestamptz,
  ADD COLUMN active_eligible boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE INDEX canonical_listings_availability_expiry_idx
ON canonical_listings (availability_expires_at, id)
WHERE active_eligible = true;--> statement-breakpoint

CREATE TABLE listing_lifecycle_maintenance (
  id text PRIMARY KEY,
  requested_at timestamptz NOT NULL,
  refreshed_at timestamptz
);--> statement-breakpoint

-- Use source observation times, never the migration or reconciliation clock.
-- No positive evidence is inferred from inventory absence or HTTP failures.
WITH evidence AS (
  SELECT lol.canonical_listing_id,
    max(COALESCE(lo.last_seen_at, lo.source_updated_at, lo.observed_at))
      FILTER (WHERE lo.source_status = 'available') AS positive_at,
    max(COALESCE(lo.last_seen_at, lo.source_updated_at, lo.observed_at))
      FILTER (WHERE lo.source_status IN ('sold', 'rented', 'withdrawn')) AS ended_at
  FROM listing_observation_links lol
  JOIN listing_observations lo ON lo.id = lol.listing_observation_id
  WHERE lo.stale_for_projection = false AND lo.origin <> 'user'
  GROUP BY lol.canonical_listing_id
)
UPDATE canonical_listings cl
SET last_positive_availability_at = e.positive_at,
    availability_ended_at = e.ended_at
FROM evidence e WHERE cl.id = e.canonical_listing_id;--> statement-breakpoint

-- Older app generations mapped diagnostic failures / local inventory absence
-- to withdrawal. Repair only rows with both identifiable diagnostic evidence
-- and an earlier positive observation, and no later explicit terminal fact.
WITH evidence AS (
  SELECT lol.canonical_listing_id,
    max(COALESCE(lo.last_seen_at, lo.source_updated_at, lo.observed_at))
      FILTER (WHERE lo.source_status = 'available') AS positive_at,
    max(COALESCE(lo.last_seen_at, lo.source_updated_at, lo.observed_at))
      FILTER (WHERE lo.source_status IN ('sold', 'rented', 'withdrawn')) AS ended_at,
    max(COALESCE(lo.last_seen_at, lo.source_updated_at, lo.observed_at))
      FILTER (WHERE lo.source_status = 'not_found' OR lo.diagnostic_status IS NOT NULL) AS diagnostic_at
  FROM listing_observation_links lol
  JOIN listing_observations lo ON lo.id = lol.listing_observation_id
  WHERE lo.stale_for_projection = false AND lo.origin <> 'user'
  GROUP BY lol.canonical_listing_id
)
UPDATE canonical_listings cl
SET status = 'active', withdrawn_at = NULL
FROM evidence e
WHERE cl.id = e.canonical_listing_id AND cl.status = 'withdrawn'
  AND e.positive_at IS NOT NULL AND e.diagnostic_at >= e.positive_at
  AND (e.ended_at IS NULL OR e.ended_at < e.positive_at);--> statement-breakpoint

-- Legacy mirror-backed rows without source observations retain only their
-- recorded source-seen time. User preview creation and diagnostic-only source
-- histories cannot invent positive availability at cutover.
UPDATE canonical_listings cl
SET last_positive_availability_at = COALESCE(last_mirror_seen_at, last_seen_at)
WHERE status = 'active' AND last_positive_availability_at IS NULL
  AND origin_summary IN ('mirror', 'user_and_mirror')
  AND NOT EXISTS (
    SELECT 1 FROM listing_observation_links lol
    JOIN listing_observations lo ON lo.id = lol.listing_observation_id
    WHERE lol.canonical_listing_id = cl.id AND lo.origin <> 'user'
  );--> statement-breakpoint

UPDATE canonical_listings
SET availability_ended_at = COALESCE(sold_at, rented_at, withdrawn_at, last_seen_at)
WHERE status IN ('sold', 'rented', 'withdrawn') AND availability_ended_at IS NULL;--> statement-breakpoint

UPDATE canonical_listings
SET availability_expires_at = last_positive_availability_at + interval '720 hours',
    active_eligible = COALESCE(status = 'active'
      AND verification_state <> 'invalid'
      AND last_positive_availability_at + interval '720 hours' > now()
      AND (availability_ended_at IS NULL OR last_positive_availability_at > availability_ended_at), false);--> statement-breakpoint

DROP MATERIALIZED VIEW mv_price_guess_start_market_summaries;--> statement-breakpoint
DROP MATERIALIZED VIEW mv_latest_active_listings;--> statement-breakpoint
CREATE OR REPLACE VIEW "v_canonical_listing_facts" AS
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
    cl.status = 'active' AND cl.active_eligible AND cl.availability_expires_at > now()
    AND cl.asking_price IS NOT NULL
    AND cl.price_unit = 'listing' AND cl.price_condition = 'asking' AND cl.price_period = 'total'
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
  CASE WHEN cl.asking_price > 0 AND cl.price_unit = 'listing' AND cl.price_condition = 'asking'
    AND (
      (cl.price_period = 'total' AND (lower(btrim(cl.price_type)) = 'sale'
        OR (lower(btrim(cl.source_name)) = 'funda' AND lower(btrim(cl.price_type)) = 'buy')))
      OR (cl.price_period = 'month' AND (lower(btrim(cl.price_type)) = 'rent'
        OR (lower(btrim(cl.source_name)) = 'pararius' AND COALESCE(lower(btrim(cl.price_type)), '') <> 'sale')))
    ) THEN cl.asking_price ELSE NULL END AS asking_price,
  COALESCE(cl.listed_at, cl.first_seen_at) AS listed_at,
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
  cl.created_at AS listing_created_at,
  (cl.status = 'active' AND cl.active_eligible AND cl.availability_expires_at > now()) AS active_eligible
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
WHERE active_eligible
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
    AND clf.active_eligible
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

-- Persist demand for a projection rebuild even if no ingest arrives after release.
INSERT INTO listing_lifecycle_maintenance (id, requested_at)
VALUES ('availability', clock_timestamp());--> statement-breakpoint
INSERT INTO property_tile_pyramid_source_watermarks
  (scope, scope_key, watermark_value, watermark_timestamp, watermark_json, updated_at)
VALUES ('listing_facts', 'global', 1, clock_timestamp(), '{}'::jsonb, clock_timestamp()),
       ('property_status', 'global', 1, clock_timestamp(), '{}'::jsonb, clock_timestamp())
ON CONFLICT (scope, scope_key) DO UPDATE SET
  watermark_value = property_tile_pyramid_source_watermarks.watermark_value + 1,
  watermark_timestamp = EXCLUDED.watermark_timestamp,
  updated_at = EXCLUDED.updated_at;

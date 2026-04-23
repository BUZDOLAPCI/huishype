-- Canonical listing facts for price-guess starting points.
-- Keeps legacy listing-row quirks behind one read model:
-- - Funda "buy" is sale-compatible.
-- - Blank/null price_type is not treated as sale.
-- - Active sale status is explicit and does not reuse FMV asking-price reads.

CREATE OR REPLACE VIEW v_canonical_listing_facts AS
SELECT
  listing_id,
  property_id,
  country_code,
  source_name,
  status,
  normalized_price_type,
  (
    status = 'active'
    AND normalized_price_type = 'sale'
    AND asking_price IS NOT NULL
  ) AS is_active_sale,
  asking_price,
  listed_at,
  living_area_m2
FROM (
  SELECT
    l.id AS listing_id,
    l.property_id,
    p.country_code,
    l.source_name,
    l.status,
    CASE
      WHEN lower(l.source_name) = 'funda' AND lower(btrim(l.price_type)) = 'buy'
        THEN 'sale'
      WHEN lower(btrim(l.price_type)) IN ('sale', 'rent')
        THEN lower(btrim(l.price_type))
      ELSE NULL
    END AS normalized_price_type,
    l.asking_price,
    l.created_at AS listed_at,
    l.living_area_m2
  FROM listings l
  JOIN properties p ON p.id = l.property_id
) facts;--> statement-breakpoint

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_price_guess_start_market_summaries AS
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

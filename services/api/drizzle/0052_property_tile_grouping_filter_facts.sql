ALTER TABLE "property_tile_grouping_facts"
  ADD COLUMN IF NOT EXISTS "country_code" varchar(2),
  ADD COLUMN IF NOT EXISTS "city" varchar(100),
  ADD COLUMN IF NOT EXISTS "region" varchar(255),
  ADD COLUMN IF NOT EXISTS "postal_code" varchar(10),
  ADD COLUMN IF NOT EXISTS "street" varchar(255),
  ADD COLUMN IF NOT EXISTS "house_number" integer,
  ADD COLUMN IF NOT EXISTS "house_number_addition" varchar(50),
  ADD COLUMN IF NOT EXISTS "official_valuation_year" integer,
  ADD COLUMN IF NOT EXISTS "asking_price" bigint,
  ADD COLUMN IF NOT EXISTS "thumbnail_url" text,
  ADD COLUMN IF NOT EXISTS "city_token" text,
  ADD COLUMN IF NOT EXISTS "region_token" text,
  ADD COLUMN IF NOT EXISTS "postal_code_norm" text,
  ADD COLUMN IF NOT EXISTS "street_token" text,
  ADD COLUMN IF NOT EXISTS "sale_effective_price" bigint,
  ADD COLUMN IF NOT EXISTS "rent_effective_price" bigint;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_snapshot_scope" ON COMMIT DROP AS
SELECT DISTINCT ON (s."coverage_id", s."filter_signature", s."pyramid_kind")
  s."id" AS "snapshot_id",
  COALESCE(cutoff."cutoff_at", s."build_finished_at", s."updated_at", s."created_at", now()) AS "cutoff_at"
FROM "property_tile_candidate_source_snapshots" s
LEFT JOIN "property_tile_candidate_source_current" current_snapshot
  ON current_snapshot."snapshot_id" = s."id"
 AND current_snapshot."coverage_id" = s."coverage_id"
 AND current_snapshot."filter_signature" = s."filter_signature"
 AND current_snapshot."pyramid_kind" = s."pyramid_kind"
LEFT JOIN LATERAL (
  SELECT NULLIF(source_item->>'cutoffAt', '')::timestamptz AS "cutoff_at"
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(s."source_watermarks_json"->'sources') = 'array'
        THEN s."source_watermarks_json"->'sources'
      ELSE '[]'::jsonb
    END
  ) AS source_item
  WHERE source_item->>'source' = 'rolling_social_window'
    AND NULLIF(source_item->>'cutoffAt', '') IS NOT NULL
  LIMIT 1
) cutoff ON TRUE
WHERE s."coverage_id" = 'public_default_low_zoom'
  AND s."filter_signature" = 'default'
  AND s."pyramid_kind" = 'public_default_low_zoom'
  AND s."status" = 'ready'
  AND s."grouping_fact_row_count" IS NOT NULL
  AND s."social_fact_row_count" IS NOT NULL
ORDER BY
  s."coverage_id",
  s."filter_signature",
  s."pyramid_kind",
  (current_snapshot."snapshot_id" IS NOT NULL) DESC,
  s."build_finished_at" DESC NULLS LAST,
  s."created_at" DESC;--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_snapshot_scope_idx"
ON "property_tile_grouping_filter_snapshot_scope" ("snapshot_id");--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_backfill" ON COMMIT DROP AS
SELECT
  pgf."snapshot_id",
  pgf."property_id",
  pgf."official_valuation",
  snapshot_scope."cutoff_at",
  p."country_code",
  p."city",
  p."region",
  p."postal_code",
  p."street",
  p."house_number",
  p."house_number_addition",
  p."official_valuation_year",
  NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p."city", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS "city_token",
  NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p."region", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS "region_token",
  NULLIF(REGEXP_REPLACE(UPPER(TRIM(COALESCE(p."postal_code", ''))), '\s+', '', 'g'), '') AS "postal_code_norm",
  NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRIM(COALESCE(p."street", ''))), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') AS "street_token"
FROM "property_tile_grouping_facts" pgf
INNER JOIN "property_tile_grouping_filter_snapshot_scope" snapshot_scope
  ON snapshot_scope."snapshot_id" = pgf."snapshot_id"
INNER JOIN "properties" p ON p."id" = pgf."property_id"
WHERE pgf."country_code" IS NULL
   OR pgf."city_token" IS NULL
   OR pgf."postal_code_norm" IS NULL
   OR pgf."sale_effective_price" IS NULL
   OR (
     pgf."market_state" IN ('for-rent', 'rented')
     AND pgf."rent_effective_price" IS NULL
   );--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_backfill_property_idx"
ON "property_tile_grouping_filter_backfill" ("property_id");--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_backfill_snapshot_property_idx"
ON "property_tile_grouping_filter_backfill" ("snapshot_id", "property_id");--> statement-breakpoint

UPDATE "property_tile_grouping_facts" pgf
SET
  "country_code" = backfill."country_code",
  "city" = backfill."city",
  "region" = backfill."region",
  "postal_code" = backfill."postal_code",
  "street" = backfill."street",
  "house_number" = backfill."house_number",
  "house_number_addition" = backfill."house_number_addition",
  "official_valuation_year" = backfill."official_valuation_year",
  "city_token" = backfill."city_token",
  "region_token" = backfill."region_token",
  "postal_code_norm" = backfill."postal_code_norm",
  "street_token" = backfill."street_token",
  "updated_at" = now()
FROM "property_tile_grouping_filter_backfill" backfill
WHERE pgf."snapshot_id" = backfill."snapshot_id"
  AND pgf."property_id" = backfill."property_id";--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_listing_rows" ON COMMIT DROP AS
SELECT
  backfill."snapshot_id",
  cl."id" AS "listing_id",
  cl."property_id",
  cl."status"::text AS "status",
  CASE
    WHEN lower(cl."source_name") = 'funda'
      AND lower(btrim(cl."price_type")) = 'buy'
      THEN 'sale'
    WHEN lower(btrim(cl."price_type")) IN ('sale', 'rent')
      THEN lower(btrim(cl."price_type"))
    WHEN lower(cl."source_name") = 'pararius'
      THEN 'rent'
    ELSE 'sale'
  END AS "normalized_price_type",
  cl."asking_price",
  cl."thumbnail_url",
  COALESCE(
    cl."last_reconciled_at",
    cl."last_mirror_seen_at",
    cl."last_user_seen_at",
    cl."last_seen_at",
    cl."updated_at",
    cl."created_at"
  ) AS "sort_at",
  cl."created_at" AS "listing_created_at"
FROM "canonical_listings" cl
INNER JOIN "property_tile_grouping_filter_backfill" backfill
  ON backfill."property_id" = cl."property_id"
WHERE cl."verification_state" <> 'invalid';--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_listing_rows_order_idx"
ON "property_tile_grouping_filter_listing_rows" (
  "snapshot_id",
  "property_id",
  "status",
  "sort_at",
  "listing_created_at",
  "listing_id"
);--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_latest_listing" ON COMMIT DROP AS
SELECT DISTINCT ON ("snapshot_id", "property_id")
  "snapshot_id",
  "property_id",
  "status"
FROM "property_tile_grouping_filter_listing_rows"
ORDER BY
  "snapshot_id",
  "property_id",
  ("status" = 'active') DESC,
  "sort_at" DESC,
  "listing_created_at" DESC,
  "listing_id" DESC;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_active_listing" ON COMMIT DROP AS
SELECT DISTINCT ON ("snapshot_id", "property_id")
  "snapshot_id",
  "property_id",
  "asking_price",
  "normalized_price_type" AS "price_type"
FROM "property_tile_grouping_filter_listing_rows"
WHERE "status" = 'active'
ORDER BY
  "snapshot_id",
  "property_id",
  ("status" = 'active') DESC,
  "sort_at" DESC,
  "listing_created_at" DESC,
  "listing_id" DESC;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_listing_thumbnail" ON COMMIT DROP AS
SELECT DISTINCT ON ("snapshot_id", "property_id")
  "snapshot_id",
  "property_id",
  "thumbnail_url"
FROM "property_tile_grouping_filter_listing_rows"
WHERE "thumbnail_url" IS NOT NULL
ORDER BY
  "snapshot_id",
  "property_id",
  ("status" = 'active') DESC,
  "sort_at" DESC,
  "listing_created_at" DESC,
  "listing_id" DESC;--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_latest_listing_idx"
ON "property_tile_grouping_filter_latest_listing" ("snapshot_id", "property_id");--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_active_listing_idx"
ON "property_tile_grouping_filter_active_listing" ("snapshot_id", "property_id");--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_listing_thumbnail_idx"
ON "property_tile_grouping_filter_listing_thumbnail" ("snapshot_id", "property_id");--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_sold_history" ON COMMIT DROP AS
SELECT DISTINCT ON (backfill."snapshot_id", ph."property_id")
  backfill."snapshot_id",
  ph."property_id",
  ph."price" AS "last_sold_price"
FROM "price_history" ph
INNER JOIN "property_tile_grouping_filter_backfill" backfill
  ON backfill."property_id" = ph."property_id"
WHERE ph."event_type" = 'sold'
ORDER BY
  backfill."snapshot_id",
  ph."property_id",
  ph."price_date" DESC,
  ph."created_at" DESC,
  ph."id" DESC;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_rented_history" ON COMMIT DROP AS
SELECT DISTINCT ON (backfill."snapshot_id", ph."property_id")
  backfill."snapshot_id",
  ph."property_id",
  ph."price" AS "last_rented_price"
FROM "price_history" ph
INNER JOIN "property_tile_grouping_filter_backfill" backfill
  ON backfill."property_id" = ph."property_id"
WHERE ph."event_type" = 'rented'
ORDER BY
  backfill."snapshot_id",
  ph."property_id",
  ph."price_date" DESC,
  ph."created_at" DESC,
  ph."id" DESC;--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_sold_history_idx"
ON "property_tile_grouping_filter_sold_history" ("snapshot_id", "property_id");--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_rented_history_idx"
ON "property_tile_grouping_filter_rented_history" ("snapshot_id", "property_id");--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_latest_guesses" ON COMMIT DROP AS
SELECT DISTINCT ON (backfill."snapshot_id", pg."property_id", pg."user_id")
  backfill."snapshot_id",
  pg."property_id",
  pg."user_id",
  pg."guessed_price",
  pg."is_meme_guess"
FROM "price_guesses" pg
INNER JOIN "property_tile_grouping_filter_backfill" backfill
  ON backfill."property_id" = pg."property_id"
WHERE GREATEST(pg."created_at", pg."updated_at") <= backfill."cutoff_at"
ORDER BY
  backfill."snapshot_id",
  pg."property_id",
  pg."user_id",
  GREATEST(pg."created_at", pg."updated_at") DESC,
  pg."created_at" DESC,
  pg."id" DESC;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_grouping_filter_guess_facts" ON COMMIT DROP AS
SELECT
  lpg."snapshot_id",
  lpg."property_id",
  CASE
    WHEN COUNT(*) = 0 THEN NULL::bigint
    WHEN COUNT(*) <= 2 THEN ROUND(
      CASE
        WHEN backfill."official_valuation" IS NOT NULL
          THEN backfill."official_valuation"::numeric * 0.7
            + (
              SUM(lpg."guessed_price"::numeric * GREATEST(u."karma", 1)::numeric)
              / NULLIF(SUM(GREATEST(u."karma", 1)::numeric), 0)
            ) * 0.3
        ELSE (
          SUM(lpg."guessed_price"::numeric * GREATEST(u."karma", 1)::numeric)
          / NULLIF(SUM(GREATEST(u."karma", 1)::numeric), 0)
        )
      END
    )::bigint
    WHEN COUNT(*) <= 9 THEN ROUND(
      CASE
        WHEN backfill."official_valuation" IS NOT NULL
          THEN backfill."official_valuation"::numeric * 0.3
            + (
              SUM(lpg."guessed_price"::numeric * GREATEST(u."karma", 1)::numeric)
              / NULLIF(SUM(GREATEST(u."karma", 1)::numeric), 0)
            ) * 0.7
        ELSE (
          SUM(lpg."guessed_price"::numeric * GREATEST(u."karma", 1)::numeric)
          / NULLIF(SUM(GREATEST(u."karma", 1)::numeric), 0)
        )
      END
    )::bigint
    ELSE ROUND(
      SUM(lpg."guessed_price"::numeric * GREATEST(u."karma", 1)::numeric)
      / NULLIF(SUM(GREATEST(u."karma", 1)::numeric), 0)
    )::bigint
  END AS "canonical_fmv"
FROM "property_tile_grouping_filter_latest_guesses" lpg
INNER JOIN "users" u ON u."id" = lpg."user_id"
INNER JOIN "property_tile_grouping_filter_backfill" backfill
  ON backfill."snapshot_id" = lpg."snapshot_id"
 AND backfill."property_id" = lpg."property_id"
WHERE lpg."is_meme_guess" = false
GROUP BY lpg."snapshot_id", lpg."property_id", backfill."official_valuation";--> statement-breakpoint

CREATE INDEX "property_tile_grouping_filter_guess_facts_idx"
ON "property_tile_grouping_filter_guess_facts" ("snapshot_id", "property_id");--> statement-breakpoint

UPDATE "property_tile_grouping_facts" pgf
SET
  "asking_price" = CASE
    WHEN active_listing."property_id" IS NOT NULL
      THEN active_listing."asking_price"
    ELSE NULL
  END,
  "thumbnail_url" = listing_thumbnail."thumbnail_url",
  "sale_effective_price" = COALESCE(
    CASE
      WHEN active_listing."property_id" IS NOT NULL
        AND active_listing."price_type" = 'sale'
        THEN active_listing."asking_price"
      ELSE NULL
    END,
    sold_history."last_sold_price",
    guess_facts."canonical_fmv",
    backfill."official_valuation"
  ),
  "rent_effective_price" = COALESCE(
    CASE
      WHEN active_listing."property_id" IS NOT NULL
        AND active_listing."price_type" = 'rent'
        THEN active_listing."asking_price"
      ELSE NULL
    END,
    rented_history."last_rented_price"
  ),
  "updated_at" = now()
FROM "property_tile_grouping_filter_backfill" backfill
LEFT JOIN "property_tile_grouping_filter_active_listing" active_listing
  ON active_listing."snapshot_id" = backfill."snapshot_id"
 AND active_listing."property_id" = backfill."property_id"
LEFT JOIN "property_tile_grouping_filter_listing_thumbnail" listing_thumbnail
  ON listing_thumbnail."snapshot_id" = backfill."snapshot_id"
 AND listing_thumbnail."property_id" = backfill."property_id"
LEFT JOIN "property_tile_grouping_filter_sold_history" sold_history
  ON sold_history."snapshot_id" = backfill."snapshot_id"
 AND sold_history."property_id" = backfill."property_id"
LEFT JOIN "property_tile_grouping_filter_rented_history" rented_history
  ON rented_history."snapshot_id" = backfill."snapshot_id"
 AND rented_history."property_id" = backfill."property_id"
LEFT JOIN "property_tile_grouping_filter_guess_facts" guess_facts
  ON guess_facts."snapshot_id" = backfill."snapshot_id"
 AND guess_facts."property_id" = backfill."property_id"
WHERE pgf."snapshot_id" = backfill."snapshot_id"
  AND pgf."property_id" = backfill."property_id";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_visible_snapshot_geometry_gist_idx"
ON "property_tile_grouping_facts" USING gist ("snapshot_id", "geometry")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_last_social_at_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "last_social_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_city_token_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "city_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_region_token_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "region_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_postal_norm_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "postal_code_norm")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_street_city_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "street_token", "city_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_sale_price_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state", "sale_effective_price")
WHERE ("has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75)
  AND "sale_effective_price" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_rent_price_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state", "rent_effective_price")
WHERE ("has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75)
  AND "rent_effective_price" IS NOT NULL;--> statement-breakpoint

ANALYZE "property_tile_grouping_facts";

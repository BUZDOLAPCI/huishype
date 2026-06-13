ALTER TABLE "property_tile_listing_facts"
  ADD COLUMN IF NOT EXISTS "displayed_listing_lifecycle_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "property_tile_grouping_facts"
  ADD COLUMN IF NOT EXISTS "displayed_listing_lifecycle_at" timestamp with time zone;--> statement-breakpoint

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
  COALESCE(cl.listed_at, cl.first_seen_at, cl.created_at) AS listed_at,
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

CREATE TEMP TABLE "property_tile_lifecycle_listing_rows" ON COMMIT DROP AS
SELECT
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
  COALESCE(cl."listed_at", cl."first_seen_at", cl."created_at") AS "listing_lifecycle_at",
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
WHERE cl."verification_state" <> 'invalid';--> statement-breakpoint

CREATE INDEX "property_tile_lifecycle_listing_rows_order_idx"
ON "property_tile_lifecycle_listing_rows" (
  "property_id",
  "status",
  "sort_at",
  "listing_created_at",
  "listing_id"
);--> statement-breakpoint

CREATE TEMP TABLE "property_tile_lifecycle_latest_listing" ON COMMIT DROP AS
SELECT DISTINCT ON ("property_id")
  "property_id",
  "status",
  "listing_lifecycle_at"
FROM "property_tile_lifecycle_listing_rows"
ORDER BY
  "property_id",
  "sort_at" DESC,
  "listing_created_at" DESC,
  "listing_id" DESC;--> statement-breakpoint

CREATE TEMP TABLE "property_tile_lifecycle_active_listing" ON COMMIT DROP AS
SELECT DISTINCT ON ("property_id")
  "property_id",
  "normalized_price_type" AS "price_type",
  "listing_lifecycle_at"
FROM "property_tile_lifecycle_listing_rows"
WHERE "status" = 'active'
ORDER BY
  "property_id",
  "sort_at" DESC,
  "listing_created_at" DESC,
  "listing_id" DESC;--> statement-breakpoint

CREATE INDEX "property_tile_lifecycle_latest_listing_idx"
ON "property_tile_lifecycle_latest_listing" ("property_id");--> statement-breakpoint

CREATE INDEX "property_tile_lifecycle_active_listing_idx"
ON "property_tile_lifecycle_active_listing" ("property_id");--> statement-breakpoint

UPDATE "property_tile_listing_facts" ptlf
SET
  "displayed_listing_lifecycle_at" = CASE
    WHEN active_listing."property_id" IS NOT NULL
      THEN active_listing."listing_lifecycle_at"
    WHEN latest_listing."status" IN ('sold', 'rented')
      THEN latest_listing."listing_lifecycle_at"
    ELSE NULL
  END,
  "updated_at" = now()
FROM "property_tile_lifecycle_latest_listing" latest_listing
LEFT JOIN "property_tile_lifecycle_active_listing" active_listing
  ON active_listing."property_id" = latest_listing."property_id"
WHERE ptlf."property_id" = latest_listing."property_id"
  AND ptlf."displayed_listing_lifecycle_at" IS DISTINCT FROM CASE
    WHEN active_listing."property_id" IS NOT NULL
      THEN active_listing."listing_lifecycle_at"
    WHEN latest_listing."status" IN ('sold', 'rented')
      THEN latest_listing."listing_lifecycle_at"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "property_tile_grouping_facts" pgf
SET
  "displayed_listing_lifecycle_at" = CASE
    WHEN active_listing."property_id" IS NOT NULL
      THEN active_listing."listing_lifecycle_at"
    WHEN latest_listing."status" IN ('sold', 'rented')
      THEN latest_listing."listing_lifecycle_at"
    ELSE NULL
  END,
  "updated_at" = now()
FROM "property_tile_lifecycle_latest_listing" latest_listing
LEFT JOIN "property_tile_lifecycle_active_listing" active_listing
  ON active_listing."property_id" = latest_listing."property_id"
WHERE pgf."property_id" = latest_listing."property_id"
  AND pgf."displayed_listing_lifecycle_at" IS DISTINCT FROM CASE
    WHEN active_listing."property_id" IS NOT NULL
      THEN active_listing."listing_lifecycle_at"
    WHEN latest_listing."status" IN ('sold', 'rented')
      THEN latest_listing."listing_lifecycle_at"
    ELSE NULL
  END;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_facts_snapshot_market_lifecycle_idx"
ON "property_tile_listing_facts" ("snapshot_id", "market_state", "displayed_listing_lifecycle_at")
WHERE "displayed_listing_lifecycle_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_lifecycle_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state", "displayed_listing_lifecycle_at")
WHERE (
  "has_active_listing"
  OR "has_completed_listing"
  OR "social_score" >= 0.75
)
AND "displayed_listing_lifecycle_at" IS NOT NULL;--> statement-breakpoint

ANALYZE "property_tile_listing_facts";--> statement-breakpoint
ANALYZE "property_tile_grouping_facts";

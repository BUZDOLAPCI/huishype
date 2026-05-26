ALTER TYPE "public"."listing_price_observation_event_type" ADD VALUE IF NOT EXISTS 'asking_price';--> statement-breakpoint
ALTER TYPE "public"."listing_price_observation_event_type" ADD VALUE IF NOT EXISTS 'sold';--> statement-breakpoint
ALTER TYPE "public"."listing_price_observation_event_type" ADD VALUE IF NOT EXISTS 'rented';--> statement-breakpoint
ALTER TYPE "public"."listing_price_observation_event_type" ADD VALUE IF NOT EXISTS 'withdrawn';--> statement-breakpoint

ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "sold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "rented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "canonical_listings"
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "listing_observations"
  ADD COLUMN IF NOT EXISTS "sold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_observations"
  ADD COLUMN IF NOT EXISTS "rented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_observations"
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "listing_replay_staging"
  ADD COLUMN IF NOT EXISTS "sold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_replay_staging"
  ADD COLUMN IF NOT EXISTS "rented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_replay_staging"
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone;--> statement-breakpoint

UPDATE "canonical_listings" cl
SET "listed_at" = COALESCE(
  cl."listed_at",
  (
    SELECT MIN(lo."listed_at")
    FROM "listing_observation_links" lol
    JOIN "listing_observations" lo ON lo."id" = lol."listing_observation_id"
    WHERE lol."canonical_listing_id" = cl."id"
      AND lo."listed_at" IS NOT NULL
      AND lo."stale_for_projection" = false
  ),
  cl."first_seen_at"
)
WHERE cl."listed_at" IS NULL;--> statement-breakpoint

WITH observed_terminal_dates AS (
  SELECT
    lpo."canonical_listing_id",
    MAX(
      CASE
        WHEN lpo."event_type"::text = 'sold'
          OR (lpo."event_type"::text = 'status_change' AND lo."source_status" = 'sold')
          THEN (lpo."price_date"::text || 'T00:00:00.000Z')::timestamptz
        ELSE NULL
      END
    ) AS "sold_at",
    MAX(
      CASE
        WHEN lpo."event_type"::text = 'rented'
          OR (lpo."event_type"::text = 'status_change' AND lo."source_status" = 'rented')
          THEN (lpo."price_date"::text || 'T00:00:00.000Z')::timestamptz
        ELSE NULL
      END
    ) AS "rented_at",
    MAX(
      CASE
        WHEN lpo."event_type"::text = 'withdrawn'
          THEN (lpo."price_date"::text || 'T00:00:00.000Z')::timestamptz
        ELSE NULL
      END
    ) AS "withdrawn_at"
  FROM "listing_price_observations" lpo
  LEFT JOIN "listing_observations" lo ON lo."id" = lpo."listing_observation_id"
  GROUP BY lpo."canonical_listing_id"
),
legacy_terminal_dates AS (
  SELECT
    cl."id" AS "canonical_listing_id",
    MAX(CASE WHEN ph."event_type" = 'sold' THEN (ph."price_date"::text || 'T00:00:00.000Z')::timestamptz ELSE NULL END) AS "sold_at",
    MAX(CASE WHEN ph."event_type" = 'rented' THEN (ph."price_date"::text || 'T00:00:00.000Z')::timestamptz ELSE NULL END) AS "rented_at",
    MAX(CASE WHEN ph."event_type" = 'withdrawn' THEN (ph."price_date"::text || 'T00:00:00.000Z')::timestamptz ELSE NULL END) AS "withdrawn_at"
  FROM "canonical_listings" cl
  JOIN "price_history" ph
    ON ph."property_id" = cl."property_id"
   AND ph."source" = cl."source_name"
   AND ph."event_type" IN ('sold', 'rented', 'withdrawn')
  GROUP BY cl."id"
)
UPDATE "canonical_listings" cl
SET
  "sold_at" = COALESCE(cl."sold_at", otd."sold_at", ltd."sold_at"),
  "rented_at" = COALESCE(cl."rented_at", otd."rented_at", ltd."rented_at"),
  "withdrawn_at" = COALESCE(cl."withdrawn_at", otd."withdrawn_at", ltd."withdrawn_at")
FROM observed_terminal_dates otd
FULL OUTER JOIN legacy_terminal_dates ltd
  ON ltd."canonical_listing_id" = otd."canonical_listing_id"
WHERE cl."id" = COALESCE(otd."canonical_listing_id", ltd."canonical_listing_id")
  AND (
    cl."sold_at" IS NULL
    OR cl."rented_at" IS NULL
    OR cl."withdrawn_at" IS NULL
  );--> statement-breakpoint

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
  cl.created_at AS listing_created_at
FROM canonical_listings cl
JOIN properties p ON p.id = cl.property_id
WHERE cl.verification_state <> 'invalid';

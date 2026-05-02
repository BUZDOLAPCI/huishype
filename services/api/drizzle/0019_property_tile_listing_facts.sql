CREATE TABLE IF NOT EXISTS "property_tile_listing_facts" (
  "property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE cascade,
  "has_active_listing" boolean NOT NULL,
  "has_completed_listing" boolean NOT NULL,
  "market_state" varchar(20) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_listing_facts_market_state_check"
    CHECK ("market_state" IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed'))
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_fact(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_property_id IS NULL THEN
    RETURN;
  END IF;

  WITH latest_listing AS MATERIALIZED (
    SELECT
      cl."property_id",
      cl."status"::text AS "status"
    FROM "canonical_listings" cl
    WHERE cl."property_id" = target_property_id
      AND cl."verification_state" <> 'invalid'
    ORDER BY
      COALESCE(
        cl."last_reconciled_at",
        cl."last_mirror_seen_at",
        cl."last_user_seen_at",
        cl."last_seen_at",
        cl."updated_at",
        cl."created_at"
      ) DESC,
      cl."created_at" DESC,
      cl."id" DESC
    LIMIT 1
  ),
  active_listing AS MATERIALIZED (
    SELECT
      cl."property_id",
      CASE
        WHEN lower(cl."source_name") = 'funda'
          AND lower(btrim(cl."price_type")) = 'buy'
          THEN 'sale'
        WHEN lower(btrim(cl."price_type")) IN ('sale', 'rent')
          THEN lower(btrim(cl."price_type"))
        WHEN lower(cl."source_name") = 'pararius'
          THEN 'rent'
        ELSE 'sale'
      END AS "price_type"
    FROM "canonical_listings" cl
    WHERE cl."property_id" = target_property_id
      AND cl."verification_state" <> 'invalid'
      AND cl."status" = 'active'
    ORDER BY
      COALESCE(
        cl."last_reconciled_at",
        cl."last_mirror_seen_at",
        cl."last_user_seen_at",
        cl."last_seen_at",
        cl."updated_at",
        cl."created_at"
      ) DESC,
      cl."created_at" DESC,
      cl."id" DESC
    LIMIT 1
  ),
  listing_fact AS MATERIALIZED (
    SELECT
      target_property_id AS "property_id",
      active_listing."property_id" IS NOT NULL AS "has_active_listing",
      (
        active_listing."property_id" IS NULL
        AND latest_listing."status" IN ('sold', 'rented')
      ) AS "has_completed_listing",
      CASE
        WHEN active_listing."property_id" IS NOT NULL AND active_listing."price_type" = 'rent'
          THEN 'for-rent'
        WHEN active_listing."property_id" IS NOT NULL
          THEN 'for-sale'
        WHEN latest_listing."status" = 'sold'
          THEN 'sold'
        WHEN latest_listing."status" = 'rented'
          THEN 'rented'
        ELSE 'not-listed'
      END AS "market_state"
    FROM latest_listing
    LEFT JOIN active_listing ON active_listing."property_id" = latest_listing."property_id"
  ),
  upserted AS (
    INSERT INTO "property_tile_listing_facts" (
      "property_id",
      "has_active_listing",
      "has_completed_listing",
      "market_state",
      "updated_at"
    )
    SELECT
      "property_id",
      "has_active_listing",
      "has_completed_listing",
      "market_state",
      now()
    FROM listing_fact
    ON CONFLICT ("property_id") DO UPDATE
      SET
        "has_active_listing" = EXCLUDED."has_active_listing",
        "has_completed_listing" = EXCLUDED."has_completed_listing",
        "market_state" = EXCLUDED."market_state",
        "updated_at" = now()
    WHERE "property_tile_listing_facts"."has_active_listing" IS DISTINCT FROM EXCLUDED."has_active_listing"
      OR "property_tile_listing_facts"."has_completed_listing" IS DISTINCT FROM EXCLUDED."has_completed_listing"
      OR "property_tile_listing_facts"."market_state" IS DISTINCT FROM EXCLUDED."market_state"
    RETURNING 1
  )
  DELETE FROM "property_tile_listing_facts"
  WHERE "property_id" = target_property_id
    AND NOT EXISTS (SELECT 1 FROM listing_fact);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_fact_from_listing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_property_tile_listing_fact(OLD."property_id");
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."property_id" IS DISTINCT FROM NEW."property_id" THEN
    PERFORM refresh_property_tile_listing_fact(OLD."property_id");
  END IF;

  PERFORM refresh_property_tile_listing_fact(NEW."property_id");
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_fact_refresh"
ON "canonical_listings";--> statement-breakpoint
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

WITH latest_listing AS MATERIALIZED (
  SELECT DISTINCT ON (cl."property_id")
    cl."property_id",
    cl."status"::text AS "status"
  FROM "canonical_listings" cl
  WHERE cl."verification_state" <> 'invalid'
  ORDER BY
    cl."property_id",
    COALESCE(
      cl."last_reconciled_at",
      cl."last_mirror_seen_at",
      cl."last_user_seen_at",
      cl."last_seen_at",
      cl."updated_at",
      cl."created_at"
    ) DESC,
    cl."created_at" DESC,
    cl."id" DESC
),
active_listing AS MATERIALIZED (
  SELECT DISTINCT ON (cl."property_id")
    cl."property_id",
    CASE
      WHEN lower(cl."source_name") = 'funda'
        AND lower(btrim(cl."price_type")) = 'buy'
        THEN 'sale'
      WHEN lower(btrim(cl."price_type")) IN ('sale', 'rent')
        THEN lower(btrim(cl."price_type"))
      WHEN lower(cl."source_name") = 'pararius'
        THEN 'rent'
      ELSE 'sale'
    END AS "price_type"
  FROM "canonical_listings" cl
  WHERE cl."verification_state" <> 'invalid'
    AND cl."status" = 'active'
  ORDER BY
    cl."property_id",
    COALESCE(
      cl."last_reconciled_at",
      cl."last_mirror_seen_at",
      cl."last_user_seen_at",
      cl."last_seen_at",
      cl."updated_at",
      cl."created_at"
    ) DESC,
    cl."created_at" DESC,
    cl."id" DESC
)
INSERT INTO "property_tile_listing_facts" (
  "property_id",
  "has_active_listing",
  "has_completed_listing",
  "market_state",
  "updated_at"
)
SELECT
  latest_listing."property_id",
  active_listing."property_id" IS NOT NULL AS "has_active_listing",
  (
    active_listing."property_id" IS NULL
    AND latest_listing."status" IN ('sold', 'rented')
  ) AS "has_completed_listing",
  CASE
    WHEN active_listing."property_id" IS NOT NULL AND active_listing."price_type" = 'rent'
      THEN 'for-rent'
    WHEN active_listing."property_id" IS NOT NULL
      THEN 'for-sale'
    WHEN latest_listing."status" = 'sold'
      THEN 'sold'
    WHEN latest_listing."status" = 'rented'
      THEN 'rented'
    ELSE 'not-listed'
  END AS "market_state",
  now()
FROM latest_listing
LEFT JOIN active_listing ON active_listing."property_id" = latest_listing."property_id"
ON CONFLICT ("property_id") DO UPDATE
  SET
    "has_active_listing" = EXCLUDED."has_active_listing",
    "has_completed_listing" = EXCLUDED."has_completed_listing",
    "market_state" = EXCLUDED."market_state",
    "updated_at" = now();--> statement-breakpoint

ANALYZE "property_tile_listing_facts";

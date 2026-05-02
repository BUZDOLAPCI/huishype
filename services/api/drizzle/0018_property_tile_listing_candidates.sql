CREATE TABLE IF NOT EXISTS "property_tile_listing_candidates" (
  "property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE cascade,
  "geometry" geometry(Point, 4326) NOT NULL,
  "official_valuation" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_geometry_gist_idx"
ON "property_tile_listing_candidates" USING gist ("geometry");--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_candidate(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_property_id IS NULL THEN
    RETURN;
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT
      p."id" AS "property_id",
      p."geometry",
      p."official_valuation"
    FROM "properties" p
    WHERE p."id" = target_property_id
      AND p."geometry" IS NOT NULL
      AND p."status" = 'active'
      AND EXISTS (
        SELECT 1
        FROM "canonical_listings" cl
        WHERE cl."property_id" = p."id"
          AND cl."verification_state" <> 'invalid'
          AND cl."status" IN ('active', 'sold', 'rented')
      )
  ),
  upserted AS (
    INSERT INTO "property_tile_listing_candidates" (
      "property_id",
      "geometry",
      "official_valuation",
      "updated_at"
    )
    SELECT
      "property_id",
      "geometry",
      "official_valuation",
      now()
    FROM candidate
    ON CONFLICT ("property_id") DO UPDATE
      SET
        "geometry" = EXCLUDED."geometry",
        "official_valuation" = EXCLUDED."official_valuation",
        "updated_at" = now()
    WHERE "property_tile_listing_candidates"."geometry" IS DISTINCT FROM EXCLUDED."geometry"
      OR "property_tile_listing_candidates"."official_valuation" IS DISTINCT FROM EXCLUDED."official_valuation"
    RETURNING 1
  )
  DELETE FROM "property_tile_listing_candidates"
  WHERE "property_id" = target_property_id
    AND NOT EXISTS (SELECT 1 FROM candidate);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_candidate_from_listing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_property_tile_listing_candidate(OLD."property_id");
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."property_id" IS DISTINCT FROM NEW."property_id" THEN
    PERFORM refresh_property_tile_listing_candidate(OLD."property_id");
  END IF;

  PERFORM refresh_property_tile_listing_candidate(NEW."property_id");
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_candidate_from_property()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "property_tile_listing_candidates"
    WHERE "property_id" = OLD."id";
    RETURN OLD;
  END IF;

  PERFORM refresh_property_tile_listing_candidate(NEW."id");
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_candidate_refresh"
ON "canonical_listings";--> statement-breakpoint
CREATE TRIGGER "canonical_listings_property_tile_listing_candidate_refresh"
AFTER INSERT OR DELETE OR UPDATE OF "property_id", "status", "verification_state"
ON "canonical_listings"
FOR EACH ROW
EXECUTE FUNCTION refresh_property_tile_listing_candidate_from_listing();--> statement-breakpoint

DROP TRIGGER IF EXISTS "properties_property_tile_listing_candidate_refresh"
ON "properties";--> statement-breakpoint
CREATE TRIGGER "properties_property_tile_listing_candidate_refresh"
AFTER DELETE OR UPDATE OF "status", "geometry", "official_valuation"
ON "properties"
FOR EACH ROW
EXECUTE FUNCTION refresh_property_tile_listing_candidate_from_property();--> statement-breakpoint

INSERT INTO "property_tile_listing_candidates" (
  "property_id",
  "geometry",
  "official_valuation",
  "updated_at"
)
SELECT
  p."id",
  p."geometry",
  p."official_valuation",
  now()
FROM "properties" p
WHERE p."geometry" IS NOT NULL
  AND p."status" = 'active'
  AND EXISTS (
    SELECT 1
    FROM "canonical_listings" cl
    WHERE cl."property_id" = p."id"
      AND cl."verification_state" <> 'invalid'
      AND cl."status" IN ('active', 'sold', 'rented')
  )
ON CONFLICT ("property_id") DO UPDATE
  SET
    "geometry" = EXCLUDED."geometry",
    "official_valuation" = EXCLUDED."official_valuation",
    "updated_at" = now();--> statement-breakpoint

ANALYZE "property_tile_listing_candidates";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "property_tile_candidate_source_current" c
    LEFT JOIN "property_tile_candidate_source_snapshots" s
      ON s."id" = c."snapshot_id"
     AND s."coverage_id" = c."coverage_id"
     AND s."filter_signature" = c."filter_signature"
     AND s."pyramid_kind" = c."pyramid_kind"
     AND s."status" = 'ready'
    WHERE s."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'existing candidate source current rows reference non-ready or mismatched snapshots';
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_candidate_source_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_snapshot "property_tile_candidate_source_snapshots"%ROWTYPE;
BEGIN
  SELECT *
    INTO referenced_snapshot
  FROM "property_tile_candidate_source_snapshots" s
  WHERE s."id" = NEW."snapshot_id";

  IF referenced_snapshot."id" IS NULL THEN
    RAISE EXCEPTION 'candidate source current snapshot % does not exist', NEW."snapshot_id";
  END IF;

  IF referenced_snapshot."status" <> 'ready'
    OR referenced_snapshot."coverage_id" IS DISTINCT FROM NEW."coverage_id"
    OR referenced_snapshot."filter_signature" IS DISTINCT FROM NEW."filter_signature"
    OR referenced_snapshot."pyramid_kind" IS DISTINCT FROM NEW."pyramid_kind"
  THEN
    RAISE EXCEPTION 'candidate source current snapshot % must be ready and match serving slot',
      NEW."snapshot_id";
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW."updated_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_candidate_source_current_guard"
ON "property_tile_candidate_source_current";--> statement-breakpoint

CREATE TRIGGER "property_tile_candidate_source_current_guard"
BEFORE INSERT OR UPDATE OF "coverage_id", "filter_signature", "pyramid_kind", "snapshot_id"
ON "property_tile_candidate_source_current"
FOR EACH ROW
EXECUTE FUNCTION property_tile_candidate_source_current_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_candidate_source_snapshots_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "property_tile_candidate_source_current" c
    WHERE c."snapshot_id" = OLD."id"
      AND (
        NEW."status" <> 'ready'
        OR NEW."coverage_id" IS DISTINCT FROM c."coverage_id"
        OR NEW."filter_signature" IS DISTINCT FROM c."filter_signature"
        OR NEW."pyramid_kind" IS DISTINCT FROM c."pyramid_kind"
      )
  ) THEN
    RAISE EXCEPTION 'candidate source snapshot % is current and must remain ready in its serving slot',
      OLD."id";
  END IF;

  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_candidate_source_snapshots_current_guard"
ON "property_tile_candidate_source_snapshots";--> statement-breakpoint

CREATE TRIGGER "property_tile_candidate_source_snapshots_current_guard"
BEFORE UPDATE OF "coverage_id", "filter_signature", "pyramid_kind", "status"
ON "property_tile_candidate_source_snapshots"
FOR EACH ROW
EXECUTE FUNCTION property_tile_candidate_source_snapshots_current_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_version "property_tile_pyramid_versions"%ROWTYPE;
  has_intent boolean;
BEGIN
  SELECT *
    INTO referenced_version
  FROM "property_tile_pyramid_versions" v
  WHERE v."id" = NEW."current_version_id"
    AND v."coverage_id" = NEW."coverage_id"
    AND v."filter_signature" = NEW."filter_signature"
    AND v."max_zoom" = NEW."max_zoom"
    AND v."pyramid_kind" = NEW."pyramid_kind";

  IF referenced_version."id" IS NULL THEN
    RAISE EXCEPTION 'current pyramid version % does not match serving slot', NEW."current_version_id";
  END IF;

  has_intent = property_tile_pyramid_has_promotion_intent(
    txid_current(),
    NEW."current_version_id",
    NEW."coverage_id",
    NEW."filter_signature",
    NEW."max_zoom",
    NEW."pyramid_kind"
  );

  IF referenced_version."status" <> 'promoted'
    AND NOT (
      referenced_version."status" = 'validated'
      AND has_intent
    )
  THEN
    RAISE EXCEPTION 'current pyramid version % must be promoted, got %',
      NEW."current_version_id",
      referenced_version."status";
  END IF;

  IF TG_OP = 'INSERT' AND NOT has_intent THEN
    RAISE EXCEPTION 'current pyramid pointer changes must use promote_property_tile_pyramid_version';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW."previous_version_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "property_tile_pyramid_current" c
      WHERE c."coverage_id" = NEW."coverage_id"
        AND c."filter_signature" = NEW."filter_signature"
        AND c."max_zoom" = NEW."max_zoom"
        AND c."pyramid_kind" = NEW."pyramid_kind"
    )
  THEN
    RAISE EXCEPTION 'initial current pointer insert must not declare a previous version';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."coverage_id" IS DISTINCT FROM OLD."coverage_id"
      OR NEW."filter_signature" IS DISTINCT FROM OLD."filter_signature"
      OR NEW."max_zoom" IS DISTINCT FROM OLD."max_zoom"
      OR NEW."pyramid_kind" IS DISTINCT FROM OLD."pyramid_kind"
    THEN
      RAISE EXCEPTION 'property tile pyramid current serving slot is immutable';
    END IF;

    IF (
      NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id"
      OR NEW."previous_version_id" IS DISTINCT FROM OLD."previous_version_id"
      OR NEW."current_promoted_at" IS DISTINCT FROM OLD."current_promoted_at"
      OR NEW."promotion_reason" IS DISTINCT FROM OLD."promotion_reason"
    ) AND NOT has_intent
    THEN
      RAISE EXCEPTION 'current pyramid pointer changes must use promote_property_tile_pyramid_version';
    END IF;

    IF NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id"
      AND NEW."previous_version_id" IS DISTINCT FROM OLD."current_version_id"
    THEN
      RAISE EXCEPTION 'current pointer updates must record the old current version as previous_version_id';
    END IF;

    NEW."updated_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    ALTER FUNCTION property_tile_candidate_source_current_guard() OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION property_tile_candidate_source_snapshots_current_guard() OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION property_tile_pyramid_current_guard() OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION property_tile_pyramid_assert_promotable(uuid, integer, integer)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;--> statement-breakpoint

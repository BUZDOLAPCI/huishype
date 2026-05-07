CREATE INDEX IF NOT EXISTS "property_tile_pyramid_tiles_promotion_invalid_idx"
ON "property_tile_pyramid_tiles" ("version_id")
WHERE "validation_status" <> 'validated'
  OR "tile_status" NOT IN ('valid_empty', 'valid_nodes', 'valid_encoded');--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_assert_promotable(
  p_target_version_id uuid,
  p_expected_tile_count integer DEFAULT NULL,
  p_validated_tile_count integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  expected_count integer;
  validated_count integer;
  manifest_count integer;
  promotable_manifest_count integer;
BEGIN
  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  expected_count = COALESCE(p_expected_tile_count, target_version."expected_tile_count");
  validated_count = COALESCE(p_validated_tile_count, target_version."validated_tile_count");

  IF expected_count <= 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % must declare expected tile coverage before promotion',
      p_target_version_id;
  END IF;

  IF validated_count <> expected_count THEN
    RAISE EXCEPTION 'property tile pyramid version % validated tile count % does not match expected tile count %',
      p_target_version_id,
      validated_count,
      expected_count;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE "validation_status" = 'validated'
        AND "tile_status" IN ('valid_empty', 'valid_nodes', 'valid_encoded')
    )::integer
    INTO manifest_count, promotable_manifest_count
  FROM "property_tile_pyramid_tiles"
  WHERE "version_id" = p_target_version_id;

  IF manifest_count <> expected_count THEN
    RAISE EXCEPTION 'property tile pyramid version % manifest coverage % does not match expected tile count %',
      p_target_version_id,
      manifest_count,
      expected_count;
  END IF;

  IF promotable_manifest_count <> expected_count THEN
    RAISE EXCEPTION 'property tile pyramid version % has unvalidated or invalid tile manifest rows',
      p_target_version_id;
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."coverage_id" IS DISTINCT FROM OLD."coverage_id"
      OR NEW."filter_signature" IS DISTINCT FROM OLD."filter_signature"
      OR NEW."max_zoom" IS DISTINCT FROM OLD."max_zoom"
      OR NEW."pyramid_kind" IS DISTINCT FROM OLD."pyramid_kind"
      OR NEW."config_hash" IS DISTINCT FROM OLD."config_hash"
      OR NEW."build_inputs_hash" IS DISTINCT FROM OLD."build_inputs_hash"
      OR NEW."source_watermark_hash" IS DISTINCT FROM OLD."source_watermark_hash"
      OR NEW."source_watermarks_json" IS DISTINCT FROM OLD."source_watermarks_json"
      OR NEW."coverage_snapshot_json" IS DISTINCT FROM OLD."coverage_snapshot_json"
      OR NEW."config_snapshot_json" IS DISTINCT FROM OLD."config_snapshot_json"
      OR NEW."grouping_constants_json" IS DISTINCT FROM OLD."grouping_constants_json"
    THEN
      RAISE EXCEPTION 'property tile pyramid build identity fields are immutable';
    END IF;

    IF OLD."status" IS DISTINCT FROM NEW."status" THEN
      IF NOT (
        OLD."status" = NEW."status"
        OR (OLD."status" = 'queued' AND NEW."status" IN ('building', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'building' AND NEW."status" IN ('validating', 'failed_retryable', 'failed_terminal'))
        OR (OLD."status" = 'validating' AND NEW."status" IN ('validated', 'failed_retryable', 'failed_terminal'))
        OR (OLD."status" = 'validated' AND NEW."status" IN ('promoted', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'failed_retryable' AND NEW."status" IN ('queued', 'building', 'failed_terminal', 'superseded'))
      ) THEN
        RAISE EXCEPTION 'illegal property tile pyramid status transition from % to %', OLD."status", NEW."status";
      END IF;
    END IF;

    IF OLD."status" IS DISTINCT FROM 'promoted' AND NEW."status" = 'promoted' THEN
      PERFORM property_tile_pyramid_assert_promotable(
        NEW."id",
        NEW."expected_tile_count",
        NEW."validated_tile_count"
      );
    END IF;

    NEW."updated_at" = now();
  END IF;

  IF NEW."status" = 'promoted' AND NEW."promoted_at" IS NULL THEN
    NEW."promoted_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_status "property_tile_pyramid_version_status";
BEGIN
  SELECT v."status"
    INTO referenced_status
  FROM "property_tile_pyramid_versions" v
  WHERE v."id" = NEW."current_version_id"
    AND v."coverage_id" = NEW."coverage_id"
    AND v."filter_signature" = NEW."filter_signature"
    AND v."max_zoom" = NEW."max_zoom"
    AND v."pyramid_kind" = NEW."pyramid_kind";

  IF referenced_status IS NULL THEN
    RAISE EXCEPTION 'current pyramid version % does not match serving slot', NEW."current_version_id";
  END IF;

  IF referenced_status <> 'promoted' THEN
    RAISE EXCEPTION 'current pyramid version % must be promoted, got %', NEW."current_version_id", referenced_status;
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

CREATE OR REPLACE FUNCTION promote_property_tile_pyramid_version(
  p_target_version_id uuid,
  p_expected_previous_version_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  pointer_updated integer;
BEGIN
  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id
  FOR UPDATE;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."status" <> 'validated' THEN
    RAISE EXCEPTION 'property tile pyramid version % must be validated before promotion, got %',
      p_target_version_id,
      target_version."status";
  END IF;

  PERFORM property_tile_pyramid_assert_promotable(p_target_version_id);

  UPDATE "property_tile_pyramid_versions"
  SET
    "status" = 'promoted',
    "promoted_at" = now(),
    "updated_at" = now()
  WHERE "id" = p_target_version_id;

  WITH upserted AS (
    INSERT INTO "property_tile_pyramid_current" (
      "coverage_id",
      "filter_signature",
      "max_zoom",
      "pyramid_kind",
      "current_version_id",
      "previous_version_id",
      "current_promoted_at",
      "promotion_reason",
      "updated_at"
    )
    VALUES (
      target_version."coverage_id",
      target_version."filter_signature",
      target_version."max_zoom",
      target_version."pyramid_kind",
      p_target_version_id,
      p_expected_previous_version_id,
      now(),
      p_reason,
      now()
    )
    ON CONFLICT ("coverage_id", "filter_signature", "max_zoom", "pyramid_kind")
    DO UPDATE SET
      "current_version_id" = EXCLUDED."current_version_id",
      "previous_version_id" = "property_tile_pyramid_current"."current_version_id",
      "current_promoted_at" = EXCLUDED."current_promoted_at",
      "promotion_reason" = EXCLUDED."promotion_reason",
      "updated_at" = now()
    WHERE "property_tile_pyramid_current"."current_version_id" IS NOT DISTINCT FROM p_expected_previous_version_id
    RETURNING 1
  )
  SELECT count(*) INTO pointer_updated FROM upserted;

  IF pointer_updated <> 1 THEN
    RAISE EXCEPTION 'property tile pyramid current pointer compare-and-swap failed for version %',
      p_target_version_id;
  END IF;

  INSERT INTO "property_tile_pyramid_audit" (
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "action",
    "actor",
    "from_status",
    "to_status",
    "previous_version_id",
    "current_version_id",
    "reason"
  )
  VALUES (
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    'promoted',
    COALESCE(p_actor, 'system'),
    'validated',
    'promoted',
    p_expected_previous_version_id,
    p_target_version_id,
    p_reason
  );
END;
$$;--> statement-breakpoint

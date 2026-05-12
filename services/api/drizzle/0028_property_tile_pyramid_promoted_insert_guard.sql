CREATE OR REPLACE FUNCTION property_tile_pyramid_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" = 'promoted' THEN
    RAISE EXCEPTION 'direct inserted promoted property tile pyramid versions are not allowed; use promote_property_tile_pyramid_version';
  END IF;

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
      IF current_setting('huishype.property_tile_pyramid_promotion_version_id', true) IS DISTINCT FROM NEW."id"::text THEN
        RAISE EXCEPTION 'direct promoted property tile pyramid version updates are not allowed; use promote_property_tile_pyramid_version';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM "property_tile_pyramid_current" c
        WHERE c."coverage_id" = NEW."coverage_id"
          AND c."filter_signature" = NEW."filter_signature"
          AND c."max_zoom" = NEW."max_zoom"
          AND c."pyramid_kind" = NEW."pyramid_kind"
          AND c."current_version_id" = NEW."id"
      ) THEN
        RAISE EXCEPTION 'promoted property tile pyramid version % must already be referenced by current pointer',
          NEW."id";
      END IF;

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

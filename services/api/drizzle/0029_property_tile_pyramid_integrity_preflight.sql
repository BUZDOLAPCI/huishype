CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_tile_pyramid_nodes_tile_fk'
      AND conrelid = 'property_tile_pyramid_nodes'::regclass
  ) THEN
    ALTER TABLE "property_tile_pyramid_nodes"
      ADD CONSTRAINT "property_tile_pyramid_nodes_tile_fk"
      FOREIGN KEY ("version_id", "z", "x", "y")
      REFERENCES "property_tile_pyramid_tiles" ("version_id", "z", "x", "y")
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;--> statement-breakpoint

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
  computed_expected_count integer;
  missing_manifest_count integer;
  extra_manifest_count integer;
  mismatched_node_count integer;
  inconsistent_empty_count integer;
  invalid_node_count integer;
  invalid_payload_count integer;
  retained_member_count bigint;
BEGIN
  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."config_hash" = ''
    OR target_version."build_inputs_hash" = ''
    OR target_version."source_watermark_hash" = ''
  THEN
    RAISE EXCEPTION 'property tile pyramid version % has invalid identity hash shape',
      p_target_version_id;
  END IF;

  IF jsonb_typeof(target_version."coverage_snapshot_json") <> 'object'
    OR jsonb_typeof(target_version."config_snapshot_json") <> 'object'
    OR jsonb_typeof(target_version."grouping_constants_json") <> 'object'
    OR jsonb_typeof(target_version."source_watermarks_json") <> 'object'
  THEN
    RAISE EXCEPTION 'property tile pyramid version % has invalid identity snapshot shape',
      p_target_version_id;
  END IF;

  IF target_version."config_snapshot_json" <> '{}'::jsonb AND (
    target_version."config_snapshot_json"->>'pipelineVersion' <> 'property-tile-pyramid:v1'
    OR target_version."config_snapshot_json"#>>'{servingSlot,coverageId}' IS DISTINCT FROM target_version."coverage_id"
    OR target_version."config_snapshot_json"#>>'{servingSlot,filterSignature}' IS DISTINCT FROM target_version."filter_signature"
    OR target_version."config_snapshot_json"#>>'{servingSlot,pyramidKind}' IS DISTINCT FROM target_version."pyramid_kind"::text
    OR NOT (target_version."config_snapshot_json"#>>'{servingSlot,maxZoom}' ~ '^\d+$')
    OR (target_version."config_snapshot_json"#>>'{servingSlot,maxZoom}')::integer IS DISTINCT FROM target_version."max_zoom"
    OR target_version."config_snapshot_json"#>>'{defaultFilter,signature}' IS DISTINCT FROM target_version."filter_signature"
    OR jsonb_typeof(target_version."config_snapshot_json"#>'{defaultFilter,filters}') <> 'object'
    OR target_version."config_snapshot_json"->>'coverageConfigHash' !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'property tile pyramid version % config snapshot does not match serving slot',
      p_target_version_id;
  END IF;

  IF target_version."coverage_snapshot_json" ? 'coverageId'
    AND target_version."coverage_snapshot_json"->>'coverageId' IS DISTINCT FROM target_version."coverage_id"
  THEN
    RAISE EXCEPTION 'property tile pyramid version % coverage snapshot does not match serving slot',
      p_target_version_id;
  END IF;

  IF target_version."coverage_snapshot_json" ? 'filterSignature'
    AND target_version."coverage_snapshot_json"->>'filterSignature' IS DISTINCT FROM target_version."filter_signature"
  THEN
    RAISE EXCEPTION 'property tile pyramid version % coverage snapshot does not match serving slot',
      p_target_version_id;
  END IF;

  IF target_version."coverage_snapshot_json"->>'maxZoom' IS NULL
    OR NOT (target_version."coverage_snapshot_json"->>'maxZoom' ~ '^\d+$')
    OR (target_version."coverage_snapshot_json"->>'maxZoom')::integer IS DISTINCT FROM target_version."max_zoom"
    OR jsonb_typeof(target_version."coverage_snapshot_json"->'bounds') <> 'object'
  THEN
    RAISE EXCEPTION 'property tile pyramid version % coverage snapshot does not match serving slot',
      p_target_version_id;
  END IF;

  IF target_version."grouping_constants_json" <> '{}'::jsonb AND (
    target_version."grouping_constants_json"->>'pipelineVersion' <> 'property-tile-pyramid:v1'
    OR target_version."grouping_constants_json"#>>'{canonicalGrouping,filterSignature}' IS DISTINCT FROM target_version."filter_signature"
    OR target_version."grouping_constants_json"#>>'{mvtEncoding,layerName}' IS DISTINCT FROM 'properties'
    OR NOT (target_version."grouping_constants_json"#>>'{mvtEncoding,extent}' ~ '^\d+$')
    OR (target_version."grouping_constants_json"#>>'{mvtEncoding,extent}')::integer <= 0
  ) THEN
    RAISE EXCEPTION 'property tile pyramid version % grouping constants do not match serving contract',
      p_target_version_id;
  END IF;

  IF target_version."source_watermarks_json" <> '{}'::jsonb
    AND target_version."source_watermarks_json" ? 'propertyTilePyramidRepair'
  THEN
    IF target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'property tile pyramid version % has invalid repair source watermark snapshot',
        p_target_version_id;
    END IF;
  ELSIF target_version."source_watermarks_json" <> '{}'::jsonb
    AND (
      jsonb_typeof(target_version."source_watermarks_json"->'sources') <> 'array'
      OR jsonb_array_length(target_version."source_watermarks_json"->'sources') = 0
    )
  THEN
    RAISE EXCEPTION 'property tile pyramid version % has no closed source watermark snapshot',
      p_target_version_id;
  END IF;

  IF target_version."pending_replacement_watermarks_json" <> '{}'::jsonb THEN
    RAISE EXCEPTION 'property tile pyramid version % has unclosed pending replacement watermarks',
      p_target_version_id;
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

  WITH bounds AS (
    SELECT
      (target_version."coverage_snapshot_json"->'bounds'->>'minLon')::double precision AS min_lon,
      (target_version."coverage_snapshot_json"->'bounds'->>'minLat')::double precision AS min_lat,
      (target_version."coverage_snapshot_json"->'bounds'->>'maxLon')::double precision AS max_lon,
      (target_version."coverage_snapshot_json"->'bounds'->>'maxLat')::double precision AS max_lat,
      COALESCE((target_version."coverage_snapshot_json"->>'minZoom')::integer, 0) AS min_zoom,
      COALESCE((target_version."coverage_snapshot_json"->>'maxZoom')::integer, target_version."max_zoom") AS max_zoom
  ),
  zoom_ranges AS (
    SELECT
      z,
      GREATEST(0, LEAST((1::bigint << z) - 1, floor(((min_lon + 180.0) / 360.0) * (1::bigint << z))::bigint))::integer AS min_x,
      GREATEST(0, LEAST((1::bigint << z) - 1, floor(((max_lon + 180.0) / 360.0) * (1::bigint << z))::bigint))::integer AS max_x,
      GREATEST(
        0,
        LEAST(
          (1::bigint << z) - 1,
          floor(
            (
              1.0 - ln(
                tan(radians(LEAST(85.05112878, GREATEST(-85.05112878, max_lat)))) +
                (1.0 / cos(radians(LEAST(85.05112878, GREATEST(-85.05112878, max_lat)))))
              ) / pi()
            ) / 2.0 * (1::bigint << z)
          )::bigint
        )
      )::integer AS min_y,
      GREATEST(
        0,
        LEAST(
          (1::bigint << z) - 1,
          floor(
            (
              1.0 - ln(
                tan(radians(LEAST(85.05112878, GREATEST(-85.05112878, min_lat)))) +
                (1.0 / cos(radians(LEAST(85.05112878, GREATEST(-85.05112878, min_lat)))))
              ) / pi()
            ) / 2.0 * (1::bigint << z)
          )::bigint
        )
      )::integer AS max_y
    FROM bounds
    CROSS JOIN generate_series(bounds.min_zoom, bounds.max_zoom) AS z
    WHERE bounds.min_lon < bounds.max_lon
      AND bounds.min_lat < bounds.max_lat
      AND bounds.min_zoom >= 0
      AND bounds.max_zoom = target_version."max_zoom"
      AND bounds.max_zoom BETWEEN 0 AND 22
  ),
  expected_tiles AS (
    SELECT z, x::integer AS x, y::integer AS y
    FROM zoom_ranges
    CROSS JOIN LATERAL generate_series(min_x, max_x) AS x
    CROSS JOIN LATERAL generate_series(min_y, max_y) AS y
  ),
  manifests AS (
    SELECT z, x, y
    FROM "property_tile_pyramid_tiles"
    WHERE "version_id" = p_target_version_id
  ),
  actual_nodes AS (
    SELECT z, x, y, count(*)::integer AS actual_node_count
    FROM "property_tile_pyramid_nodes"
    WHERE "version_id" = p_target_version_id
    GROUP BY z, x, y
  ),
  manifest_node_checks AS (
    SELECT
      t.z,
      t.x,
      t.y,
      t.tile_status,
      t.validation_status,
      t.node_count,
      COALESCE(n.actual_node_count, 0) AS actual_node_count,
      t.payload,
      t.payload_sha256,
      t.payload_generated_at
    FROM "property_tile_pyramid_tiles" t
    LEFT JOIN actual_nodes n
      ON n.z = t.z
     AND n.x = t.x
     AND n.y = t.y
    WHERE t."version_id" = p_target_version_id
  ),
  node_checks AS (
    SELECT n.*
    FROM "property_tile_pyramid_nodes" n
    WHERE n."version_id" = p_target_version_id
  )
  SELECT
    (SELECT count(*)::integer FROM expected_tiles),
    (SELECT count(*)::integer FROM expected_tiles e LEFT JOIN manifests m USING (z, x, y) WHERE m.z IS NULL),
    (SELECT count(*)::integer FROM manifests m LEFT JOIN expected_tiles e USING (z, x, y) WHERE e.z IS NULL),
    (
      SELECT count(*)::integer
      FROM manifest_node_checks
      WHERE node_count <> actual_node_count
    ),
    (
      SELECT count(*)::integer
      FROM manifest_node_checks
      WHERE (node_count = 0 AND tile_status <> 'valid_empty')
        OR (node_count > 0 AND tile_status NOT IN ('valid_nodes', 'valid_encoded'))
        OR (validation_status <> 'validated')
    ),
    (
      SELECT count(*)::integer
      FROM node_checks
      WHERE representative_property_id IS NULL
        OR preview_count <> cardinality(preview_property_ids)
        OR preview_count > LEAST(point_count, 30)
        OR (group_kind = 'single' AND (
          point_count <> 1
          OR preview_count <> 1
          OR preview_property_ids[1] IS DISTINCT FROM representative_property_id
        ))
        OR (group_kind = 'cluster' AND (
          point_count <= 1
          OR preview_count <= 0
        ))
    ),
    (
      SELECT count(*)::integer
      FROM manifest_node_checks
      WHERE (tile_status = 'valid_encoded' AND (
          payload IS NULL
          OR octet_length(payload) = 0
          OR payload_sha256 IS NULL
          OR payload_sha256 <> encode(digest(payload, 'sha256'), 'hex')
          OR payload_generated_at IS NULL
        ))
        OR (tile_status IN ('valid_empty', 'valid_nodes') AND payload IS NOT NULL)
    )
  INTO
    computed_expected_count,
    missing_manifest_count,
    extra_manifest_count,
    mismatched_node_count,
    inconsistent_empty_count,
    invalid_node_count,
    invalid_payload_count;

  IF computed_expected_count IS NULL OR computed_expected_count <> expected_count THEN
    RAISE EXCEPTION 'property tile pyramid version % computed coverage % does not match expected tile count %',
      p_target_version_id,
      computed_expected_count,
      expected_count;
  END IF;

  IF missing_manifest_count <> 0 OR extra_manifest_count <> 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % has missing % or extra % tile manifests',
      p_target_version_id,
      missing_manifest_count,
      extra_manifest_count;
  END IF;

  IF mismatched_node_count <> 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % has tile node_count values that do not match node rows',
      p_target_version_id;
  END IF;

  IF inconsistent_empty_count <> 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % has inconsistent empty/non-empty or validation tile statuses',
      p_target_version_id;
  END IF;

  IF invalid_node_count <> 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % has invalid node rows',
      p_target_version_id;
  END IF;

  IF invalid_payload_count <> 0 THEN
    RAISE EXCEPTION 'property tile pyramid version % has invalid encoded payload metadata',
      p_target_version_id;
  END IF;

  IF to_regclass('property_tile_pyramid_members') IS NULL THEN
    retained_member_count = 0;
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM "property_tile_pyramid_members" WHERE "version_id" = $1'
      INTO retained_member_count
      USING p_target_version_id;
  END IF;

  IF target_version."member_row_count" <> retained_member_count THEN
    RAISE EXCEPTION 'property tile pyramid version % member row count % does not match retained member rows %',
      p_target_version_id,
      target_version."member_row_count",
      retained_member_count;
  END IF;
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

  IF referenced_status <> 'promoted'
    AND NOT (
      referenced_status = 'validated'
      AND current_setting('huishype.property_tile_pyramid_promotion_version_id', true) = NEW."current_version_id"::text
    )
  THEN
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

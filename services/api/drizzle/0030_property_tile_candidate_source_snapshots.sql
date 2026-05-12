CREATE TABLE IF NOT EXISTS "property_tile_candidate_source_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coverage_id" text DEFAULT 'public_default_low_zoom' NOT NULL,
  "filter_signature" text DEFAULT 'default' NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "source_watermark_hash" text NOT NULL,
  "comparable_source_watermark_hash" text NOT NULL,
  "source_watermarks_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'building' NOT NULL,
  "candidate_row_count" bigint DEFAULT 0 NOT NULL,
  "fact_row_count" bigint DEFAULT 0 NOT NULL,
  "build_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "build_finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_candidate_source_snapshots_status_check"
    CHECK ("status" IN ('building', 'ready', 'failed', 'superseded')),
  CONSTRAINT "property_tile_candidate_source_snapshots_counts_check"
    CHECK ("candidate_row_count" >= 0 AND "fact_row_count" >= 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "property_tile_candidate_source_snapshots_ready_idx"
ON "property_tile_candidate_source_snapshots" (
  "coverage_id",
  "filter_signature",
  "pyramid_kind",
  "comparable_source_watermark_hash"
)
WHERE "status" = 'ready';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_candidate_source_snapshots_status_idx"
ON "property_tile_candidate_source_snapshots" (
  "coverage_id",
  "filter_signature",
  "pyramid_kind",
  "status",
  "created_at" DESC
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_candidate_source_current" (
  "coverage_id" text NOT NULL,
  "filter_signature" text NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE restrict,
  "promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_candidate_source_current_pk"
    PRIMARY KEY ("coverage_id", "filter_signature", "pyramid_kind")
);--> statement-breakpoint

ALTER TABLE "property_tile_listing_candidates"
  ADD COLUMN IF NOT EXISTS "snapshot_id" uuid;--> statement-breakpoint

ALTER TABLE "property_tile_listing_facts"
  ADD COLUMN IF NOT EXISTS "snapshot_id" uuid;--> statement-breakpoint

DO $$
DECLARE
  bootstrap_snapshot_id uuid;
  candidate_count bigint;
  fact_count bigint;
BEGIN
  SELECT "id"
    INTO bootstrap_snapshot_id
  FROM "property_tile_candidate_source_snapshots"
  WHERE "coverage_id" = 'public_default_low_zoom'
    AND "filter_signature" = 'default'
    AND "pyramid_kind" = 'public_default_low_zoom'
    AND "comparable_source_watermark_hash" = 'bootstrap'
    AND "status" = 'ready'
  LIMIT 1;

  IF bootstrap_snapshot_id IS NULL THEN
    INSERT INTO "property_tile_candidate_source_snapshots" (
      "source_watermark_hash",
      "comparable_source_watermark_hash",
      "source_watermarks_json",
      "status",
      "build_finished_at"
    )
    VALUES (
      'bootstrap',
      'bootstrap',
      jsonb_build_object('bootstrap', true, 'createdAt', now()::text),
      'ready',
      now()
    )
    RETURNING "id" INTO bootstrap_snapshot_id;
  END IF;

  UPDATE "property_tile_listing_candidates"
  SET "snapshot_id" = bootstrap_snapshot_id
  WHERE "snapshot_id" IS NULL;

  UPDATE "property_tile_listing_facts"
  SET "snapshot_id" = bootstrap_snapshot_id
  WHERE "snapshot_id" IS NULL;

  SELECT count(*) INTO candidate_count
  FROM "property_tile_listing_candidates"
  WHERE "snapshot_id" = bootstrap_snapshot_id;

  SELECT count(*) INTO fact_count
  FROM "property_tile_listing_facts"
  WHERE "snapshot_id" = bootstrap_snapshot_id;

  UPDATE "property_tile_candidate_source_snapshots"
  SET
    "candidate_row_count" = candidate_count,
    "fact_row_count" = fact_count,
    "updated_at" = now()
  WHERE "id" = bootstrap_snapshot_id;

  INSERT INTO "property_tile_candidate_source_current" (
    "coverage_id",
    "filter_signature",
    "pyramid_kind",
    "snapshot_id",
    "promoted_at",
    "updated_at"
  )
  VALUES (
    'public_default_low_zoom',
    'default',
    'public_default_low_zoom',
    bootstrap_snapshot_id,
    now(),
    now()
  )
  ON CONFLICT ("coverage_id", "filter_signature", "pyramid_kind")
  DO NOTHING;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_candidate_refresh"
ON "canonical_listings";--> statement-breakpoint
DROP TRIGGER IF EXISTS "properties_property_tile_listing_candidate_refresh"
ON "properties";--> statement-breakpoint
DROP TRIGGER IF EXISTS "canonical_listings_property_tile_listing_fact_refresh"
ON "canonical_listings";--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_candidate(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_property_tile_listing_fact(target_property_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN;
END;
$$;--> statement-breakpoint

ALTER TABLE "property_tile_listing_candidates"
  ALTER COLUMN "snapshot_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "property_tile_listing_facts"
  ALTER COLUMN "snapshot_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "property_tile_listing_candidates"
  DROP CONSTRAINT IF EXISTS "property_tile_listing_candidates_pkey";--> statement-breakpoint

ALTER TABLE "property_tile_listing_facts"
  DROP CONSTRAINT IF EXISTS "property_tile_listing_facts_pkey";--> statement-breakpoint

ALTER TABLE "property_tile_listing_candidates"
  ADD CONSTRAINT "property_tile_listing_candidates_pkey"
  PRIMARY KEY ("snapshot_id", "property_id");--> statement-breakpoint

ALTER TABLE "property_tile_listing_facts"
  ADD CONSTRAINT "property_tile_listing_facts_pkey"
  PRIMARY KEY ("snapshot_id", "property_id");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_tile_listing_candidates_snapshot_fk'
      AND conrelid = 'property_tile_listing_candidates'::regclass
  ) THEN
    ALTER TABLE "property_tile_listing_candidates"
      ADD CONSTRAINT "property_tile_listing_candidates_snapshot_fk"
      FOREIGN KEY ("snapshot_id")
      REFERENCES "property_tile_candidate_source_snapshots"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_tile_listing_facts_snapshot_fk'
      AND conrelid = 'property_tile_listing_facts'::regclass
  ) THEN
    ALTER TABLE "property_tile_listing_facts"
      ADD CONSTRAINT "property_tile_listing_facts_snapshot_fk"
      FOREIGN KEY ("snapshot_id")
      REFERENCES "property_tile_candidate_source_snapshots"("id")
      ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

DROP INDEX IF EXISTS "property_tile_listing_candidates_geometry_gist_idx";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_snapshot_geometry_gist_idx"
ON "property_tile_listing_candidates" USING gist ("geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_snapshot_id_idx"
ON "property_tile_listing_candidates" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_facts_snapshot_market_state_idx"
ON "property_tile_listing_facts" ("snapshot_id", "market_state");--> statement-breakpoint

ALTER TABLE "property_tile_pyramid_versions"
  ADD COLUMN IF NOT EXISTS "candidate_snapshot_id" uuid
  REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE restrict;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_versions_candidate_snapshot_idx"
ON "property_tile_pyramid_versions" ("candidate_snapshot_id");--> statement-breakpoint

DROP INDEX IF EXISTS "property_tile_pyramid_versions_build_identity_idx";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "property_tile_pyramid_versions_build_identity_idx"
ON "property_tile_pyramid_versions" (
  "coverage_id",
  "filter_signature",
  "max_zoom",
  "pyramid_kind",
  "build_inputs_hash",
  "source_watermark_hash"
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_promotion_intents" (
  "txid" bigint NOT NULL,
  "version_id" uuid NOT NULL REFERENCES "property_tile_pyramid_versions"("id") ON DELETE cascade,
  "coverage_id" text NOT NULL,
  "filter_signature" text NOT NULL,
  "max_zoom" integer NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "actor" text DEFAULT 'system' NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_promotion_intents_pk"
    PRIMARY KEY ("txid", "version_id")
);--> statement-breakpoint

REVOKE ALL ON TABLE "property_tile_pyramid_promotion_intents" FROM PUBLIC;--> statement-breakpoint
GRANT DELETE ON TABLE "property_tile_pyramid_promotion_intents" TO PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  CREATE ROLE huishype_pyramid_owner NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    GRANT USAGE ON SCHEMA public TO huishype_pyramid_owner;
    GRANT SELECT ON TABLE
      "property_tile_candidate_source_snapshots",
      "property_tile_pyramid_tiles",
      "property_tile_pyramid_nodes"
    TO huishype_pyramid_owner;
    GRANT SELECT, UPDATE ON TABLE "property_tile_pyramid_versions" TO huishype_pyramid_owner;
    GRANT SELECT, INSERT, UPDATE ON TABLE "property_tile_pyramid_current" TO huishype_pyramid_owner;
    GRANT INSERT ON TABLE "property_tile_pyramid_audit" TO huishype_pyramid_owner;
    IF to_regclass('property_tile_pyramid_members') IS NOT NULL THEN
      GRANT SELECT ON TABLE "property_tile_pyramid_members" TO huishype_pyramid_owner;
    END IF;
    ALTER TABLE "property_tile_pyramid_promotion_intents" OWNER TO huishype_pyramid_owner;
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_has_promotion_intent(
  p_txid bigint,
  p_version_id uuid,
  p_coverage_id text,
  p_filter_signature text,
  p_max_zoom integer,
  p_pyramid_kind "property_tile_pyramid_kind"
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "property_tile_pyramid_promotion_intents" i
    WHERE i."txid" = p_txid
      AND i."version_id" = p_version_id
      AND i."coverage_id" = p_coverage_id
      AND i."filter_signature" = p_filter_signature
      AND i."max_zoom" = p_max_zoom
      AND i."pyramid_kind" = p_pyramid_kind
  )
$$;--> statement-breakpoint

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
  candidate_snapshot "property_tile_candidate_source_snapshots"%ROWTYPE;
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

  IF target_version."coverage_id" = 'public_default_low_zoom'
    AND target_version."filter_signature" = 'default'
    AND target_version."pyramid_kind" = 'public_default_low_zoom'
    AND target_version."candidate_snapshot_id" IS NULL
  THEN
    RAISE EXCEPTION 'property tile pyramid version % has no candidate source snapshot', p_target_version_id;
  END IF;

  IF target_version."candidate_snapshot_id" IS NOT NULL THEN
    SELECT *
      INTO candidate_snapshot
    FROM "property_tile_candidate_source_snapshots"
    WHERE "id" = target_version."candidate_snapshot_id";

    IF candidate_snapshot."id" IS NULL OR candidate_snapshot."status" <> 'ready' THEN
      RAISE EXCEPTION 'property tile pyramid version % candidate source snapshot is not ready',
        p_target_version_id;
    END IF;

    IF candidate_snapshot."coverage_id" IS DISTINCT FROM target_version."coverage_id"
      OR candidate_snapshot."filter_signature" IS DISTINCT FROM target_version."filter_signature"
      OR candidate_snapshot."pyramid_kind" IS DISTINCT FROM target_version."pyramid_kind"
      OR candidate_snapshot."comparable_source_watermark_hash" IS DISTINCT FROM COALESCE(
        target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}',
        target_version."source_watermark_hash"
      )
    THEN
      RAISE EXCEPTION 'property tile pyramid version % candidate source snapshot does not match build source',
        p_target_version_id;
    END IF;
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
      OR (
        OLD."candidate_snapshot_id" IS NOT NULL
        AND NEW."candidate_snapshot_id" IS DISTINCT FROM OLD."candidate_snapshot_id"
      )
    THEN
      RAISE EXCEPTION 'property tile pyramid build identity fields are immutable';
    END IF;

    IF OLD."status" IS DISTINCT FROM NEW."status" THEN
      IF NOT (
        OLD."status" = NEW."status"
        OR (OLD."status" = 'queued' AND NEW."status" IN ('building', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'building' AND NEW."status" IN ('validating', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'validating' AND NEW."status" IN ('validated', 'failed_retryable', 'failed_terminal'))
        OR (OLD."status" = 'validated' AND NEW."status" IN ('promoted', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'failed_retryable' AND NEW."status" IN ('queued', 'building', 'failed_terminal', 'superseded'))
      ) THEN
        RAISE EXCEPTION 'illegal property tile pyramid status transition from % to %', OLD."status", NEW."status";
      END IF;
    END IF;

    IF OLD."status" IS DISTINCT FROM 'promoted' AND NEW."status" = 'promoted' THEN
      IF NOT property_tile_pyramid_has_promotion_intent(
        txid_current(),
        NEW."id",
        NEW."coverage_id",
        NEW."filter_signature",
        NEW."max_zoom",
        NEW."pyramid_kind"
      ) THEN
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

CREATE OR REPLACE FUNCTION property_tile_pyramid_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_version "property_tile_pyramid_versions"%ROWTYPE;
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

  IF referenced_version."status" <> 'promoted'
    AND NOT (
      referenced_version."status" = 'validated'
      AND property_tile_pyramid_has_promotion_intent(
        txid_current(),
        NEW."current_version_id",
        NEW."coverage_id",
        NEW."filter_signature",
        NEW."max_zoom",
        NEW."pyramid_kind"
      )
    )
  THEN
    RAISE EXCEPTION 'current pyramid version % must be promoted, got %',
      NEW."current_version_id",
      referenced_version."status";
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  pointer_updated integer;
  current_txid bigint;
BEGIN
  current_txid = txid_current();

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

  INSERT INTO "property_tile_pyramid_promotion_intents" (
    "txid",
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "actor",
    "reason"
  )
  VALUES (
    current_txid,
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    COALESCE(p_actor, 'system'),
    p_reason
  )
  ON CONFLICT ("txid", "version_id") DO NOTHING;

  PERFORM property_tile_pyramid_assert_promotable(p_target_version_id);

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

  UPDATE "property_tile_pyramid_versions"
  SET
    "status" = 'promoted',
    "promoted_at" = now(),
    "updated_at" = now()
  WHERE "id" = p_target_version_id;

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    ALTER FUNCTION property_tile_pyramid_has_promotion_intent(
      bigint,
      uuid,
      text,
      text,
      integer,
      "property_tile_pyramid_kind"
    ) OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION promote_property_tile_pyramid_version(uuid, uuid, text, text)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;

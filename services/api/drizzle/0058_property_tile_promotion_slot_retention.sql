CREATE OR REPLACE FUNCTION property_tile_generated_partition_retention_for_slot(
  p_coverage_id text,
  p_filter_signature text,
  p_max_zoom integer,
  p_pyramid_kind property_tile_pyramid_kind
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  version_record record;
  snapshot_record record;
  dropped_version_partition_count integer := 0;
  dropped_snapshot_partition_count integer := 0;
  deleted_version_count integer := 0;
  deleted_snapshot_count integer := 0;
  dropped_now integer;
BEGIN
  IF NOT property_tile_generated_storage_is_partitioned() THEN
    RETURN jsonb_build_object('partitioned', false);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.property_tile_retained_versions (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.property_tile_retained_versions;

  INSERT INTO pg_temp.property_tile_retained_versions (id)
  SELECT current_version_id
  FROM property_tile_pyramid_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
  UNION
  SELECT previous_version_id
  FROM property_tile_pyramid_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
    AND previous_version_id IS NOT NULL
  UNION
  SELECT id
  FROM property_tile_pyramid_versions
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
    AND (
      status IN ('queued', 'building', 'validating', 'validated')
      OR (lease_until IS NOT NULL AND lease_until > now())
    )
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.property_tile_retained_snapshots (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.property_tile_retained_snapshots;

  INSERT INTO pg_temp.property_tile_retained_snapshots (id)
  SELECT snapshot_id
  FROM property_tile_candidate_source_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND pyramid_kind = p_pyramid_kind
  UNION
  SELECT v.candidate_snapshot_id
  FROM property_tile_pyramid_versions v
  INNER JOIN pg_temp.property_tile_retained_versions rv ON rv.id = v.id
  WHERE v.candidate_snapshot_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  FOR version_record IN
    SELECT v.id
    FROM property_tile_pyramid_versions v
    LEFT JOIN pg_temp.property_tile_retained_versions rv ON rv.id = v.id
    WHERE v.coverage_id = p_coverage_id
      AND v.filter_signature = p_filter_signature
      AND v.max_zoom = p_max_zoom
      AND v.pyramid_kind = p_pyramid_kind
      AND rv.id IS NULL
      AND (v.lease_until IS NULL OR v.lease_until < now())
    ORDER BY COALESCE(v.updated_at, v.promoted_at, v.build_finished_at, v.superseded_at, v.created_at)
  LOOP
    dropped_now = drop_property_tile_pyramid_version_partitions(version_record.id);
    dropped_version_partition_count = dropped_version_partition_count + dropped_now;
    DELETE FROM property_tile_pyramid_versions v
    WHERE v.id = version_record.id
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_current c
        WHERE c.current_version_id = v.id OR c.previous_version_id = v.id
      )
      AND v.status NOT IN ('queued', 'building', 'validating', 'validated')
      AND (v.lease_until IS NULL OR v.lease_until < now());
    IF FOUND THEN
      deleted_version_count = deleted_version_count + 1;
    END IF;
  END LOOP;

  FOR snapshot_record IN
    SELECT s.id
    FROM property_tile_candidate_source_snapshots s
    LEFT JOIN pg_temp.property_tile_retained_snapshots rs ON rs.id = s.id
    WHERE s.coverage_id = p_coverage_id
      AND s.filter_signature = p_filter_signature
      AND s.pyramid_kind = p_pyramid_kind
      AND rs.id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_versions v
        WHERE v.candidate_snapshot_id = s.id
      )
    ORDER BY COALESCE(s.updated_at, s.build_finished_at, s.build_started_at, s.created_at)
  LOOP
    dropped_now = drop_property_tile_candidate_source_partitions(snapshot_record.id);
    dropped_snapshot_partition_count = dropped_snapshot_partition_count + dropped_now;
    DELETE FROM property_tile_candidate_source_snapshots s
    WHERE s.id = snapshot_record.id
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_candidate_source_current c
        WHERE c.snapshot_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_versions v
        WHERE v.candidate_snapshot_id = s.id
      );
    IF FOUND THEN
      deleted_snapshot_count = deleted_snapshot_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'partitioned', true,
    'slotScoped', true,
    'droppedVersionPartitions', dropped_version_partition_count,
    'droppedSnapshotPartitions', dropped_snapshot_partition_count,
    'deletedVersions', deleted_version_count,
    'deletedCandidateSourceSnapshots', deleted_snapshot_count
  );
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
  audit_action "property_tile_pyramid_audit_action";
BEGIN
  current_txid = txid_current();

  SELECT * INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id
  FOR UPDATE;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."status" NOT IN ('validated', 'promoted') THEN
    RAISE EXCEPTION 'property tile pyramid version % must be validated or promoted before pointer update, got %',
      p_target_version_id,
      target_version."status";
  END IF;

  audit_action = CASE
    WHEN target_version."status" = 'validated' THEN 'promoted'::property_tile_pyramid_audit_action
    ELSE 'rollback'::property_tile_pyramid_audit_action
  END;

  INSERT INTO "property_tile_pyramid_promotion_intents" (
    "txid", "version_id", "coverage_id", "filter_signature", "max_zoom", "pyramid_kind", "actor", "reason"
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

  PERFORM set_config('huishype.property_tile_pyramid_promotion_version_id', p_target_version_id::text, true);
  PERFORM property_tile_pyramid_assert_promotable(p_target_version_id);

  WITH upserted AS (
    INSERT INTO "property_tile_pyramid_current" (
      "coverage_id", "filter_signature", "max_zoom", "pyramid_kind",
      "current_version_id", "previous_version_id", "current_promoted_at", "promotion_reason", "updated_at"
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
    RAISE EXCEPTION 'property tile pyramid current pointer compare-and-swap failed for version %', p_target_version_id;
  END IF;

  UPDATE "property_tile_pyramid_versions"
  SET "status" = 'promoted', "promoted_at" = COALESCE("promoted_at", now()), "superseded_at" = NULL, "updated_at" = now()
  WHERE "id" = p_target_version_id
    AND "status" IN ('validated', 'promoted');

  UPDATE "property_tile_pyramid_versions"
  SET "superseded_at" = NULL, "updated_at" = now()
  WHERE "id" = p_expected_previous_version_id
    AND "status" = 'promoted';

  UPDATE "property_tile_pyramid_versions"
  SET
    "superseded_at" = COALESCE("superseded_at", now()),
    "validation_summary" = jsonb_set(
      COALESCE("validation_summary", '{}'::jsonb),
      '{superseded}',
      jsonb_build_object(
        'reason', 'promoted-version-no-longer-current-or-previous',
        'currentVersionId', p_target_version_id,
        'previousVersionId', p_expected_previous_version_id
      ),
      true
    ),
    "updated_at" = now()
  WHERE "coverage_id" = target_version."coverage_id"
    AND "filter_signature" = target_version."filter_signature"
    AND "max_zoom" = target_version."max_zoom"
    AND "pyramid_kind" = target_version."pyramid_kind"
    AND "status" = 'promoted'
    AND "id" IS DISTINCT FROM p_target_version_id
    AND "id" IS DISTINCT FROM p_expected_previous_version_id
    AND "superseded_at" IS NULL;

  INSERT INTO "property_tile_pyramid_audit" (
    "version_id", "coverage_id", "filter_signature", "max_zoom", "pyramid_kind",
    "action", "actor", "from_status", "to_status", "previous_version_id", "current_version_id", "reason"
  )
  VALUES (
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    audit_action,
    COALESCE(p_actor, 'system'),
    target_version."status",
    'promoted',
    p_expected_previous_version_id,
    p_target_version_id,
    p_reason
  );

  PERFORM property_tile_generated_partition_retention_for_slot(
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind"
  );
END;
$$;--> statement-breakpoint

DO $$
BEGIN
  EXECUTE format(
    'ALTER FUNCTION property_tile_generated_partition_retention_for_slot(text,text,integer,property_tile_pyramid_kind) OWNER TO %I',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    ALTER FUNCTION promote_property_tile_pyramid_version(uuid, uuid, text, text)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef(
    'property_tile_pyramid_assert_promotable(uuid,integer,integer)'::regprocedure
  )
    INTO function_sql;

  function_sql = regexp_replace(
    function_sql,
    '  IF target_version\."coverage_id" = ''public_default_low_zoom''[[:space:]]+AND target_version\."filter_signature" = ''default''[[:space:]]+AND target_version\."pyramid_kind" = ''public_default_low_zoom''[[:space:]]+AND target_version\."candidate_snapshot_id" IS NULL[[:space:]]+THEN[[:space:]]+RAISE EXCEPTION ''property tile pyramid version % has no candidate source snapshot'', p_target_version_id;[[:space:]]+END IF;[[:space:]]+',
    '',
    'm'
  );

  IF position('FROM "property_tile_candidate_source_current" c' IN function_sql) = 0 THEN
    function_sql = replace(
      function_sql,
      'IF target_version."candidate_snapshot_id" IS NOT NULL THEN',
      $new$
  IF target_version."candidate_snapshot_id" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "property_tile_candidate_source_current" c
      WHERE c."coverage_id" = target_version."coverage_id"
        AND c."filter_signature" = target_version."filter_signature"
        AND c."pyramid_kind" = target_version."pyramid_kind"
    )
  THEN
    RAISE EXCEPTION 'property tile pyramid version % has no candidate source snapshot', p_target_version_id;
  END IF;

  IF target_version."candidate_snapshot_id" IS NOT NULL THEN$new$
    );
  END IF;

  IF position('FROM "property_tile_candidate_source_current" c' IN function_sql) = 0 THEN
    RAISE EXCEPTION 'property_tile_pyramid_assert_promotable is missing the registered candidate source slot guard';
  END IF;

  EXECUTE function_sql;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    ALTER FUNCTION property_tile_pyramid_assert_promotable(uuid, integer, integer)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;--> statement-breakpoint

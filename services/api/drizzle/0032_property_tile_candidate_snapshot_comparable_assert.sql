DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef(
    'property_tile_pyramid_assert_promotable(uuid,integer,integer)'::regprocedure
  )
    INTO function_sql;

  function_sql = replace(
    function_sql,
    $old$
        target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}',
        target_version."source_watermark_hash"
    $old$,
    $new$
        target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseComparableSourceWatermarkHash}',
        target_version."source_watermarks_json"#>>'{comparableSourceWatermarkHash}',
        target_version."source_watermark_hash"
    $new$
  );

  IF position('baseComparableSourceWatermarkHash}'' !~' IN function_sql) = 0 THEN
    function_sql = replace(
      function_sql,
      $old$
    IF target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'property tile pyramid version % has invalid repair source watermark snapshot',
        p_target_version_id;
    END IF;
      $old$,
      $new$
    IF target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseSourceWatermarkHash}' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'property tile pyramid version % has invalid repair source watermark snapshot',
        p_target_version_id;
    END IF;
    IF target_version."source_watermarks_json"#>>'{propertyTilePyramidRepair,baseComparableSourceWatermarkHash}' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'property tile pyramid version % has invalid repair comparable source watermark snapshot',
        p_target_version_id;
    END IF;
      $new$
    );
  END IF;

  EXECUTE function_sql;
END $$;--> statement-breakpoint

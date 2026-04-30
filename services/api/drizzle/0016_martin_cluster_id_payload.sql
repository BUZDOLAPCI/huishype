DO $$
DECLARE
  function_name text;
  function_definition text;
  original_snippet text := $snippet$
      STRING_AGG(f.property_id::text, ',' ORDER BY f.property_id::text) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1:8], ',') AS preview_property_ids,
$snippet$;
  capped_snippet text := $snippet$
      ARRAY_TO_STRING(
        (ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[
          1:CASE WHEN COUNT(*) <= 30 THEN COUNT(*)::integer ELSE 8 END
        ],
        ','
      ) AS property_ids,
      ARRAY_TO_STRING((ARRAY_AGG(f.property_id::text ORDER BY f.property_id::text))[1:8], ',') AS preview_property_ids,
$snippet$;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'property_nodes',
    'read_property_nodes',
    'following_property_nodes'
  ]
  LOOP
    SELECT pg_get_functiondef(
      format('martin_tiles.%I(integer, integer, integer, json)', function_name)::regprocedure
    )
    INTO function_definition;

    IF POSITION(original_snippet IN function_definition) > 0 THEN
      EXECUTE replace(function_definition, original_snippet, capped_snippet);
    ELSIF POSITION(capped_snippet IN function_definition) = 0 THEN
      RAISE EXCEPTION 'Could not patch martin_tiles.% cluster property id payload', function_name;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

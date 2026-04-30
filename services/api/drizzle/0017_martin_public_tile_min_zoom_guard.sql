DO $$
DECLARE
  function_definition text;
  original_prefix text := $prefix$AS $function$
  WITH params AS ($prefix$;
  wrapped_prefix text := $prefix$AS $function$
BEGIN
  IF z < 7 THEN
    RETURN '\x'::bytea;
  END IF;

  RETURN (
  WITH params AS ($prefix$;
BEGIN
  SELECT pg_get_functiondef(
    'martin_tiles.property_nodes(integer, integer, integer, json)'::regprocedure
  )
  INTO function_definition;

  IF POSITION('IF z < 7 THEN' IN function_definition) > 0 THEN
    RETURN;
  END IF;

  IF POSITION(original_prefix IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Could not wrap martin_tiles.property_nodes with a low-zoom guard';
  END IF;

  function_definition := replace(function_definition, 'LANGUAGE sql', 'LANGUAGE plpgsql');
  function_definition := replace(function_definition, original_prefix, wrapped_prefix);
  function_definition := regexp_replace(
    function_definition,
    E'\\n\\$function\\$\\n?$',
    E'\n  );\nEND\n$function$\n'
  );

  EXECUTE function_definition;
END
$$;--> statement-breakpoint

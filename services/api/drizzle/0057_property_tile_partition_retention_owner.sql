DO $$
BEGIN
  EXECUTE format(
    'ALTER FUNCTION property_tile_generated_partition_retention() OWNER TO %I',
    current_user
  );
END $$;--> statement-breakpoint

ALTER FUNCTION property_tile_generated_partition_retention() SECURITY DEFINER;

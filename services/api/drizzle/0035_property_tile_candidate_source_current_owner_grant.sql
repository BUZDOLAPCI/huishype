DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    GRANT SELECT ON TABLE "property_tile_candidate_source_current" TO huishype_pyramid_owner;
  END IF;
END $$;--> statement-breakpoint

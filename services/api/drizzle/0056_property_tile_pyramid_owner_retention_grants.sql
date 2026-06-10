DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "property_tile_pyramid_versions",
      "property_tile_pyramid_current",
      "property_tile_pyramid_audit",
      "property_tile_pyramid_promotion_intents",
      "property_tile_candidate_source_snapshots",
      "property_tile_candidate_source_current"
    TO huishype_pyramid_owner;
  END IF;
END $$;

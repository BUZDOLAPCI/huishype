-- Offline maintenance reset for the generated property-tile pipeline.
--
-- Use before migration 0053 when legacy generated tables already contain rows.
-- This intentionally clears only rebuildable generated storage and pyramid
-- metadata. It does not touch property_tile_pyramid_source_watermarks.

BEGIN;

LOCK TABLE property_tile_pyramid_versions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE property_tile_candidate_source_snapshots IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  relation_names text[] := ARRAY[
    'property_tile_pyramid_members',
    'property_tile_pyramid_nodes',
    'property_tile_pyramid_tiles',
    'property_tile_grouping_facts',
    'property_tile_social_facts',
    'property_tile_listing_facts',
    'property_tile_listing_candidates'
  ];
  existing_relations text;
BEGIN
  SELECT string_agg(format('%I', relation_name), ', ')
    INTO existing_relations
  FROM unnest(relation_names) AS relation_name
  WHERE to_regclass('public.' || relation_name) IS NOT NULL;

  IF existing_relations IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || existing_relations;
  END IF;
END $$;

DELETE FROM property_tile_pyramid_current;
DELETE FROM property_tile_candidate_source_current;
DELETE FROM property_tile_pyramid_promotion_intents;
DELETE FROM property_tile_pyramid_versions;
DELETE FROM property_tile_candidate_source_snapshots;

COMMIT;

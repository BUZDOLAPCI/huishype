CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_visible_snapshot_geometry_gist_idx"
ON "property_tile_grouping_facts" USING gist ("snapshot_id", "geometry")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

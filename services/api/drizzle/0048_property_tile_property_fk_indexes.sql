CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_property_id_idx"
ON "property_tile_listing_candidates" ("property_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_facts_property_id_idx"
ON "property_tile_listing_facts" ("property_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_property_id_idx"
ON "property_tile_social_facts" ("property_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_property_id_idx"
ON "property_tile_grouping_facts" ("property_id");

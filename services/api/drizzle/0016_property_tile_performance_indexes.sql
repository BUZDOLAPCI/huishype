CREATE INDEX IF NOT EXISTS "properties_active_geometry_gist_idx"
ON "properties" USING gist ("geometry")
WHERE "status" = 'active' AND "geometry" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_latest_idx"
ON "canonical_listings" USING btree (
  "property_id",
  (COALESCE("last_reconciled_at", "last_mirror_seen_at", "last_user_seen_at", "last_seen_at", "updated_at", "created_at")) DESC,
  "created_at" DESC,
  "id" DESC
)
WHERE "verification_state" <> 'invalid';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_active_latest_idx"
ON "canonical_listings" USING btree (
  "property_id",
  (COALESCE("last_reconciled_at", "last_mirror_seen_at", "last_user_seen_at", "last_seen_at", "updated_at", "created_at")) DESC,
  "created_at" DESC,
  "id" DESC
)
WHERE "verification_state" <> 'invalid' AND "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "price_history_sold_latest_idx"
ON "price_history" USING btree (
  "property_id",
  "price_date" DESC,
  "created_at" DESC,
  "id" DESC
)
WHERE "event_type" = 'sold';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "price_history_rented_latest_idx"
ON "price_history" USING btree (
  "property_id",
  "price_date" DESC,
  "created_at" DESC,
  "id" DESC
)
WHERE "event_type" = 'rented';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "price_guesses_property_user_effective_at_idx"
ON "price_guesses" USING btree (
  "property_id",
  "user_id",
  (GREATEST("created_at", "updated_at")) DESC,
  "created_at" DESC,
  "id" DESC
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "comments_top_level_property_created_idx"
ON "comments" USING btree ("property_id", "created_at" DESC)
WHERE "parent_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "comments_replies_property_created_idx"
ON "comments" USING btree ("property_id", "created_at" DESC)
WHERE "parent_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "reactions_comment_like_target_created_idx"
ON "reactions" USING btree ("target_id", "created_at" DESC)
WHERE "target_type" = 'comment' AND "reaction_type" = 'like';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_views_property_identity_viewed_at_idx"
ON "property_views" USING btree (
  "property_id",
  (COALESCE("user_id"::text, "session_id")),
  "viewed_at" DESC
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_snapshots_coverage_filter_config_idx"
ON "property_tile_snapshots" USING btree (
  "coverage_id",
  "filter_signature",
  "snapshot_config_hash"
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_candidate_status_property_idx"
ON "canonical_listings" USING btree (
  "status",
  "property_id"
)
WHERE "verification_state" <> 'invalid' AND "status" IN ('active', 'sold', 'rented');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "canonical_listings_tile_thumbnail_idx"
ON "canonical_listings" USING btree (
  "property_id",
  (("status" = 'active')) DESC,
  (COALESCE("last_reconciled_at", "last_mirror_seen_at", "last_user_seen_at", "last_seen_at", "updated_at", "created_at")) DESC,
  "created_at" DESC,
  "id" DESC
)
INCLUDE ("thumbnail_url")
WHERE "verification_state" <> 'invalid' AND "thumbnail_url" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_snapshots_coverage_filter_config_due_idx"
ON "property_tile_snapshots" USING btree (
  "coverage_id",
  "filter_signature",
  "snapshot_config_hash"
)
INCLUDE (
  "z",
  "x",
  "y",
  "generated_at",
  "refreshed_at",
  "source_listing_watermark",
  "source_social_watermark",
  "source_property_watermark",
  "source_coverage_watermark"
);--> statement-breakpoint

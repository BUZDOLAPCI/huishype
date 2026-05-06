CREATE UNIQUE INDEX IF NOT EXISTS "listing_observations_source_url_evidence_idx"
ON "listing_observations" ("source_name", "source_url_canonical", "origin", "observed_at")
WHERE "source_listing_id" IS NULL
  AND "source_url_canonical" IS NOT NULL;--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

ALTER TABLE "property_tile_candidate_source_snapshots"
  ADD COLUMN IF NOT EXISTS "grouping_fact_row_count" bigint;--> statement-breakpoint

ALTER TABLE "property_tile_candidate_source_snapshots"
  DROP CONSTRAINT IF EXISTS "property_tile_candidate_source_snapshots_counts_check";--> statement-breakpoint

ALTER TABLE "property_tile_candidate_source_snapshots"
  ADD CONSTRAINT "property_tile_candidate_source_snapshots_counts_check"
  CHECK (
    "candidate_row_count" >= 0
    AND "fact_row_count" >= 0
    AND ("social_fact_row_count" IS NULL OR "social_fact_row_count" >= 0)
    AND ("grouping_fact_row_count" IS NULL OR "grouping_fact_row_count" >= 0)
  );--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_grouping_facts" (
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE cascade,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE cascade,
  "geometry" geometry(Point, 4326) NOT NULL,
  "official_valuation" bigint,
  "has_active_listing" boolean DEFAULT false NOT NULL,
  "has_completed_listing" boolean DEFAULT false NOT NULL,
  "market_state" varchar(20) DEFAULT 'not-listed' NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "social_score" double precision DEFAULT 0 NOT NULL,
  "recent_social_score" double precision DEFAULT 0 NOT NULL,
  "last_social_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_grouping_facts_pkey"
    PRIMARY KEY ("snapshot_id", "property_id"),
  CONSTRAINT "property_tile_grouping_facts_market_state_check"
    CHECK ("market_state" IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_id_idx"
ON "property_tile_grouping_facts" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_geometry_gist_idx"
ON "property_tile_grouping_facts" USING gist ("snapshot_id", "geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_market_state_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_last_social_at_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "last_social_at");--> statement-breakpoint

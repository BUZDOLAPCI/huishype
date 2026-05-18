ALTER TABLE "property_tile_candidate_source_snapshots"
  ADD COLUMN IF NOT EXISTS "social_fact_row_count" bigint;--> statement-breakpoint

ALTER TABLE "property_tile_candidate_source_snapshots"
  DROP CONSTRAINT IF EXISTS "property_tile_candidate_source_snapshots_counts_check";--> statement-breakpoint

ALTER TABLE "property_tile_candidate_source_snapshots"
  ADD CONSTRAINT "property_tile_candidate_source_snapshots_counts_check"
  CHECK (
    "candidate_row_count" >= 0
    AND "fact_row_count" >= 0
    AND ("social_fact_row_count" IS NULL OR "social_fact_row_count" >= 0)
  );--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_social_facts" (
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE cascade,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE cascade,
  "geometry" geometry(Point, 4326) NOT NULL,
  "official_valuation" bigint,
  "top_level_comment_count" integer DEFAULT 0 NOT NULL,
  "reply_count" integer DEFAULT 0 NOT NULL,
  "property_like_count" integer DEFAULT 0 NOT NULL,
  "comment_like_count" integer DEFAULT 0 NOT NULL,
  "guess_count" integer DEFAULT 0 NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "unique_viewer_count" integer DEFAULT 0 NOT NULL,
  "recent_top_level_comment_count" integer DEFAULT 0 NOT NULL,
  "recent_reply_count" integer DEFAULT 0 NOT NULL,
  "recent_property_like_count" integer DEFAULT 0 NOT NULL,
  "recent_comment_like_count" integer DEFAULT 0 NOT NULL,
  "recent_guess_count" integer DEFAULT 0 NOT NULL,
  "recent_view_count" integer DEFAULT 0 NOT NULL,
  "recent_unique_viewer_count" integer DEFAULT 0 NOT NULL,
  "social_score" double precision DEFAULT 0 NOT NULL,
  "recent_social_score" double precision DEFAULT 0 NOT NULL,
  "last_social_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_social_facts_pkey"
    PRIMARY KEY ("snapshot_id", "property_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_snapshot_id_idx"
ON "property_tile_social_facts" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_geometry_gist_idx"
ON "property_tile_social_facts" USING gist ("geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_snapshot_last_social_at_idx"
ON "property_tile_social_facts" ("snapshot_id", "last_social_at");--> statement-breakpoint

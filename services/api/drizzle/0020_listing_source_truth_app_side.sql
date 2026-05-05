DO $$
BEGIN
  CREATE TYPE "listing_diagnostic_status" AS ENUM (
    'blocked',
    'parser_error',
    'retryable_error',
    'unsupported',
    'invalid',
    'unknown',
    'mirror_unavailable'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "listing_candidate_handoff_state" AS ENUM (
    'pending',
    'queued',
    'delivered',
    'retryable_error',
    'dead_letter'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DROP TABLE IF EXISTS "mirror_listing_watches";--> statement-breakpoint
DROP INDEX IF EXISTS "listing_observations_validation_watch_idx";--> statement-breakpoint
ALTER TABLE "listing_observations"
  DROP COLUMN IF EXISTS "validation_watch_id";--> statement-breakpoint
DROP TYPE IF EXISTS "mirror_listing_watch_state";--> statement-breakpoint

ALTER TABLE "listing_observations"
  ALTER COLUMN "source_status" DROP DEFAULT,
  ALTER COLUMN "source_status" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "listing_replay_staging"
  ALTER COLUMN "source_status" DROP DEFAULT,
  ALTER COLUMN "source_status" DROP NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_scope_completions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "scope_key" varchar(255) NOT NULL,
  "listing_type" varchar(20) DEFAULT 'unknown' NOT NULL,
  "normalized_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_run_id" varchar(255),
  "source_run_started_at" timestamp with time zone,
  "source_run_completed_at" timestamp with time zone NOT NULL,
  "coverage_status" varchar(30) DEFAULT 'complete' NOT NULL,
  "observed_listing_count" integer DEFAULT 0 NOT NULL,
  "source_high_watermark" timestamp with time zone NOT NULL,
  "stale_for_projection" boolean DEFAULT false NOT NULL,
  "repair_mode" boolean DEFAULT false NOT NULL,
  "repair_reason" text,
  "ingest_batch_id" uuid REFERENCES "ingest_batches"("id") ON DELETE set null,
  "diagnostics" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DROP INDEX IF EXISTS "listing_scope_completions_idempotency_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listing_scope_completions_idempotency_idx"
ON "listing_scope_completions" (
  "source_name",
  "scope_key",
  "listing_type",
  COALESCE("source_run_id", ''),
  "source_high_watermark"
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_scope_completions_source_scope_idx"
ON "listing_scope_completions" ("source_name", "scope_key", "listing_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_scope_completions_batch_idx"
ON "listing_scope_completions" ("ingest_batch_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_source_scope_watermarks" (
  "source_name" varchar(50) NOT NULL,
  "scope_key" varchar(255) NOT NULL,
  "listing_type" varchar(20) DEFAULT 'unknown' NOT NULL,
  "source_high_watermark" timestamp with time zone NOT NULL,
  "ingest_batch_id" uuid REFERENCES "ingest_batches"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("source_name", "scope_key", "listing_type")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "listing_source_scope_watermarks_batch_idx"
ON "listing_source_scope_watermarks" ("ingest_batch_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_preview_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "source_url_raw" text NOT NULL,
  "source_url_canonical" text NOT NULL,
  "source_listing_id" varchar(255),
  "source_listing_id_kind" "listing_source_id_kind",
  "source_listing_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation_state" varchar(30) NOT NULL,
  "match_state" varchar(30) NOT NULL,
  "reason_code" varchar(100) NOT NULL,
  "property_match_kind" "listing_property_match_kind" DEFAULT 'user_selected' NOT NULL,
  "lifecycle_status" "listing_source_status",
  "diagnostic_status" "listing_diagnostic_status",
  "asking_price" bigint,
  "price_currency" varchar(3),
  "listing_type" varchar(20) DEFAULT 'unknown' NOT NULL,
  "title" text,
  "description" text,
  "image_url" text,
  "address_normalized" jsonb,
  "token_hash" varchar(128) UNIQUE NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_preview_results_idempotency_idx"
ON "listing_preview_results" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_preview_results_property_idx"
ON "listing_preview_results" ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_preview_results_source_url_idx"
ON "listing_preview_results" ("source_name", "source_url_canonical");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "listing_candidate_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "preview_result_id" uuid REFERENCES "listing_preview_results"("id") ON DELETE set null,
  "canonical_listing_id" uuid REFERENCES "canonical_listings"("id") ON DELETE cascade,
  "observation_id" uuid,
  "source_name" varchar(50) NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "source_url_raw" text NOT NULL,
  "source_url_canonical" text NOT NULL,
  "source_listing_id" varchar(255),
  "preview_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "match_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "state" "listing_candidate_handoff_state" DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "listing_candidate_handoffs_active_url_idx"
ON "listing_candidate_handoffs" ("source_name", "property_id", "source_url_canonical")
WHERE "state" IN ('pending', 'queued', 'retryable_error');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_candidate_handoffs_state_next_attempt_idx"
ON "listing_candidate_handoffs" ("state", "next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_candidate_handoffs_canonical_listing_idx"
ON "listing_candidate_handoffs" ("canonical_listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_candidate_handoffs_observation_idx"
ON "listing_candidate_handoffs" ("observation_id");--> statement-breakpoint

ALTER TABLE "listing_observations"
  ADD COLUMN IF NOT EXISTS "diagnostic_status" "listing_diagnostic_status",
  ADD COLUMN IF NOT EXISTS "scope_completion_id" uuid REFERENCES "listing_scope_completions"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "source_run_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "source_high_watermark" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "stale_for_projection" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "preview_result_id" uuid REFERENCES "listing_preview_results"("id") ON DELETE set null,
  ADD COLUMN IF NOT EXISTS "candidate_handoff_id" uuid;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "listing_observations_completion_idx"
ON "listing_observations" ("scope_completion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_stale_projection_idx"
ON "listing_observations" ("stale_for_projection");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_preview_idx"
ON "listing_observations" ("preview_result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_observations_candidate_handoff_idx"
ON "listing_observations" ("candidate_handoff_id");--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "listing_candidate_handoffs"
    ADD CONSTRAINT "listing_candidate_handoffs_observation_fk"
    FOREIGN KEY ("observation_id") REFERENCES "listing_observations"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "listing_observations"
    ADD CONSTRAINT "listing_observations_candidate_handoff_fk"
    FOREIGN KEY ("candidate_handoff_id") REFERENCES "listing_candidate_handoffs"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "listing_replay_staging"
  ADD COLUMN IF NOT EXISTS "diagnostic_status" "listing_diagnostic_status",
  ADD COLUMN IF NOT EXISTS "stale_for_projection" boolean DEFAULT false NOT NULL;--> statement-breakpoint

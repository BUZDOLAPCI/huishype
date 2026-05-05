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

DO $$
BEGIN
  ALTER TABLE "listing_preview_results"
    ADD CONSTRAINT "listing_preview_results_lifecycle_status_check"
    CHECK (
      "lifecycle_status" IS NULL
      OR "lifecycle_status"::text IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

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

UPDATE "listing_observations"
SET
  "diagnostic_status" = COALESCE(
    "diagnostic_status",
    "source_status"::text::"listing_diagnostic_status"
  ),
  "source_status" = NULL
WHERE "source_status"::text IN ('blocked', 'invalid', 'parser_error', 'unknown');--> statement-breakpoint

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
  IF to_regclass('public.mirror_listing_watches') IS NOT NULL THEN
    EXECUTE $migrate_watches$
      INSERT INTO "listing_candidate_handoffs" (
        "id",
        "canonical_listing_id",
        "observation_id",
        "source_name",
        "property_id",
        "submitted_by",
        "source_url_raw",
        "source_url_canonical",
        "source_listing_id",
        "preview_facts",
        "match_evidence",
        "state",
        "attempt_count",
        "last_attempt_at",
        "next_attempt_at",
        "last_error",
        "created_at",
        "updated_at"
      )
      SELECT
        watch."id",
        watch."canonical_listing_id",
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM "listing_observations" observation
            WHERE observation."id" = watch."last_validation_observation_id"
          )
          THEN watch."last_validation_observation_id"
          ELSE NULL
        END,
        watch."source_name",
        watch."property_id",
        watch."submitted_by",
        watch."source_url_raw",
        watch."source_url_canonical",
        watch."source_listing_id",
        jsonb_build_object('migratedFrom', 'mirror_listing_watches'),
        jsonb_strip_nulls(jsonb_build_object('stateReason', watch."state_reason")),
        CASE watch."state"::text
          WHEN 'pending' THEN 'pending'::"listing_candidate_handoff_state"
          WHEN 'queued' THEN 'queued'::"listing_candidate_handoff_state"
          WHEN 'fetching' THEN 'pending'::"listing_candidate_handoff_state"
          WHEN 'retryable_error' THEN 'retryable_error'::"listing_candidate_handoff_state"
          WHEN 'invalid' THEN 'dead_letter'::"listing_candidate_handoff_state"
          WHEN 'unsupported' THEN 'dead_letter'::"listing_candidate_handoff_state"
          ELSE 'delivered'::"listing_candidate_handoff_state"
        END,
        watch."attempt_count",
        watch."last_attempt_at",
        watch."next_attempt_at",
        COALESCE(watch."last_error", watch."state_reason"),
        watch."created_at",
        watch."updated_at"
      FROM "mirror_listing_watches" watch
      ON CONFLICT ("id") DO NOTHING
    $migrate_watches$;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.mirror_listing_watches') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'listing_observations'
         AND column_name = 'validation_watch_id'
     ) THEN
    EXECUTE $migrate_observation_watch_links$
      UPDATE "listing_observations" observation
      SET "candidate_handoff_id" = observation."validation_watch_id"
      WHERE observation."validation_watch_id" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "listing_candidate_handoffs" handoff
          WHERE handoff."id" = observation."validation_watch_id"
        )
    $migrate_observation_watch_links$;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  UPDATE "listing_candidate_handoffs" handoff
  SET "observation_id" = NULL
  WHERE handoff."observation_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "listing_observations" observation
      WHERE observation."id" = handoff."observation_id"
    );

  ALTER TABLE "listing_candidate_handoffs"
    ADD CONSTRAINT "listing_candidate_handoffs_observation_fk"
    FOREIGN KEY ("observation_id") REFERENCES "listing_observations"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DROP TABLE IF EXISTS "mirror_listing_watches";--> statement-breakpoint
DROP INDEX IF EXISTS "listing_observations_validation_watch_idx";--> statement-breakpoint
ALTER TABLE "listing_observations"
  DROP COLUMN IF EXISTS "validation_watch_id";--> statement-breakpoint
DROP TYPE IF EXISTS "mirror_listing_watch_state";--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "listing_observations"
    ADD CONSTRAINT "listing_observations_candidate_handoff_fk"
    FOREIGN KEY ("candidate_handoff_id") REFERENCES "listing_candidate_handoffs"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "listing_observations"
    ADD CONSTRAINT "listing_observations_source_status_lifecycle_check"
    CHECK (
      "source_status" IS NULL
      OR "source_status"::text IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "listing_replay_staging"
  ADD COLUMN IF NOT EXISTS "diagnostic_status" "listing_diagnostic_status",
  ADD COLUMN IF NOT EXISTS "stale_for_projection" boolean DEFAULT false NOT NULL;--> statement-breakpoint

UPDATE "listing_replay_staging"
SET
  "diagnostic_status" = COALESCE(
    "diagnostic_status",
    "source_status"::text::"listing_diagnostic_status"
  ),
  "source_status" = NULL
WHERE "source_status"::text IN ('blocked', 'invalid', 'parser_error', 'unknown');--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "listing_replay_staging"
    ADD CONSTRAINT "listing_replay_staging_source_status_lifecycle_check"
    CHECK (
      "source_status" IS NULL
      OR "source_status"::text IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "public"."ingest_run_status" AS ENUM('in_progress', 'failed', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE TYPE "public"."ingest_batch_status" AS ENUM('accepted', 'queued', 'processing', 'completed', 'retryable', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingest_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" varchar(50) NOT NULL,
  "upstream_run_key" varchar(255) NOT NULL,
  "upstream_cursor_start" text,
  "upstream_cursor_end" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "status" "ingest_run_status" DEFAULT 'in_progress' NOT NULL,
  "processed_batch_count" integer DEFAULT 0 NOT NULL,
  "error_summary" jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingest_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "source_name" varchar(50) NOT NULL,
  "batch_sequence" integer NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "cursor_start" text,
  "cursor_end" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "status" "ingest_batch_status" DEFAULT 'accepted' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "ingested_count" integer DEFAULT 0 NOT NULL,
  "updated_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "error_json" jsonb,
  "last_error_at" timestamp with time zone,
  "maintenance_requested_at" timestamp with time zone,
  "maintenance_completed_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ingest_sources" (
  "source_name" varchar(50) PRIMARY KEY NOT NULL,
  "last_committed_cursor" text,
  "last_committed_changed_at" timestamp with time zone,
  "last_committed_listing_key" text,
  "last_batch_id" uuid,
  "last_run_started_at" timestamp with time zone,
  "last_run_completed_at" timestamp with time zone,
  "last_run_status" "ingest_run_status"
);--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "ingest_batches"
    ADD CONSTRAINT "ingest_batches_run_id_ingest_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."ingest_runs"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "ingest_sources"
    ADD CONSTRAINT "ingest_sources_last_batch_id_ingest_batches_id_fk"
    FOREIGN KEY ("last_batch_id") REFERENCES "public"."ingest_batches"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ingest_runs_source_upstream_key_idx"
  ON "ingest_runs" USING btree ("source_name", "upstream_run_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_runs_source_started_idx"
  ON "ingest_runs" USING btree ("source_name", "started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_runs_status_idx"
  ON "ingest_runs" USING btree ("status");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ingest_batches_source_idempotency_idx"
  ON "ingest_batches" USING btree ("source_name", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingest_batches_run_sequence_idx"
  ON "ingest_batches" USING btree ("run_id", "batch_sequence")
  WHERE run_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_batches_source_status_received_idx"
  ON "ingest_batches" USING btree ("source_name", "status", "received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_batches_source_cursor_status_idx"
  ON "ingest_batches" USING btree ("source_name", "cursor_start", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_batches_completed_idx"
  ON "ingest_batches" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_batches_maintenance_pending_idx"
  ON "ingest_batches" USING btree ("maintenance_requested_at", "maintenance_completed_at")
  WHERE maintenance_requested_at IS NOT NULL AND maintenance_completed_at IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ingest_sources_last_batch_idx"
  ON "ingest_sources" USING btree ("last_batch_id");

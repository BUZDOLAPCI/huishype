ALTER TYPE "public"."ingest_batch_status"
  ADD VALUE IF NOT EXISTS 'superseded' BEFORE 'failed';--> statement-breakpoint

DROP INDEX IF EXISTS "listing_scope_completions_idempotency_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listing_scope_completions_idempotency_idx"
ON "listing_scope_completions" (
  "source_name",
  "scope_key",
  "listing_type",
  "normalized_filters",
  COALESCE("source_run_id", ''),
  "source_high_watermark"
);--> statement-breakpoint

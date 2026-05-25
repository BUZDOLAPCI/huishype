ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "adaptive_requests_per_minute" integer DEFAULT 60 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "adaptive_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "throttle_until" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "clean_success_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "clean_concurrency_window_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "recent_rate_limit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "last_observed_status" integer;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "last_observed_retry_after" text;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "last_observed_rate_limit_reset" text;

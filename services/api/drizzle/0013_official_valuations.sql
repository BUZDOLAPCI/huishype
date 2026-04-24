ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "official_valuation_year" integer;--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "official_valuation_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_official_valuations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL,
  "valuation" bigint NOT NULL,
  "valuation_year" integer NOT NULL,
  "reference_date" date,
  "source" varchar(50) NOT NULL,
  "source_record_id" varchar(100),
  "source_dataset_version" varchar(100),
  "source_url" text,
  "raw_payload" jsonb,
  "verified" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "origin" varchar(30) DEFAULT 'server_verified' NOT NULL,
  "submitted_by_user_id" uuid,
  "client_runtime" varchar(20),
  "source_request_fingerprint" varchar(128),
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_official_valuation_hydration_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL,
  "source" varchar(50) NOT NULL,
  "valuation_year" integer NOT NULL,
  "state" varchar(30) DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "official_valuation_source_states" (
  "source" varchar(50) PRIMARY KEY NOT NULL,
  "state" varchar(30) DEFAULT 'healthy' NOT NULL,
  "requests_in_current_minute" integer DEFAULT 0 NOT NULL,
  "minute_window_reset_at" timestamp with time zone,
  "requests_in_current_day" integer DEFAULT 0 NOT NULL,
  "day_window_reset_at" timestamp with time zone,
  "requests_in_flight" integer DEFAULT 0 NOT NULL,
  "requests_in_flight_lease_expires_at" timestamp with time zone,
  "circuit_opened_at" timestamp with time zone,
  "circuit_half_open_at" timestamp with time zone,
  "consecutive_failure_count" integer DEFAULT 0 NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_failure_at" timestamp with time zone,
  "last_rate_limit_at" timestamp with time zone,
  "last_error" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "requests_in_flight" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "official_valuation_source_states"
  ADD COLUMN IF NOT EXISTS "requests_in_flight_lease_expires_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "property_official_valuations"
    ADD CONSTRAINT "property_official_valuations_property_id_properties_id_fk"
    FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "property_official_valuations"
    ADD CONSTRAINT "property_official_valuations_submitted_by_user_id_users_id_fk"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "property_official_valuation_hydration_jobs"
    ADD CONSTRAINT "property_official_valuation_hydration_jobs_property_id_properties_id_fk"
    FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "property_official_valuations_unique_idx"
  ON "property_official_valuations" USING btree ("property_id", "valuation_year", "source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_official_valuations_property_year_idx"
  ON "property_official_valuations" USING btree ("property_id", "valuation_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_official_valuations_year_idx"
  ON "property_official_valuations" USING btree ("valuation_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_official_valuations_source_idx"
  ON "property_official_valuations" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "property_official_valuation_hydration_unique_idx"
  ON "property_official_valuation_hydration_jobs" USING btree ("property_id", "source", "valuation_year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "property_official_valuation_hydration_due_idx"
  ON "property_official_valuation_hydration_jobs" USING btree ("state", "next_attempt_at");

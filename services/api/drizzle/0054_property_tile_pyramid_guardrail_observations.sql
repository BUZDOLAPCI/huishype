CREATE TABLE IF NOT EXISTS "property_tile_pyramid_guardrail_observations" (
  "source" text PRIMARY KEY,
  "observed_at" timestamp with time zone NOT NULL,
  "root_filesystem_bytes" bigint NOT NULL,
  "root_filesystem_used_bytes" bigint NOT NULL,
  "root_filesystem_free_bytes" bigint NOT NULL,
  "root_filesystem_used_percent" numeric(6, 3) NOT NULL,
  "postgres_volume_bytes" bigint,
  "photon_volume_bytes" bigint,
  "docker_volumes_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_guardrail_observations_root_bytes_check"
    CHECK (
      "root_filesystem_bytes" > 0
      AND "root_filesystem_used_bytes" >= 0
      AND "root_filesystem_free_bytes" >= 0
      AND "root_filesystem_used_percent" >= 0
      AND "root_filesystem_used_percent" <= 100
    ),
  CONSTRAINT "property_tile_pyramid_guardrail_observations_volume_bytes_check"
    CHECK (
      ("postgres_volume_bytes" IS NULL OR "postgres_volume_bytes" >= 0)
      AND ("photon_volume_bytes" IS NULL OR "photon_volume_bytes" >= 0)
    )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_guardrail_observations_observed_at_idx"
ON "property_tile_pyramid_guardrail_observations" ("observed_at" DESC);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "property_tile_pyramid_guardrail_observations"
      TO huishype_pyramid_owner;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_kind') THEN
    CREATE TYPE "public"."property_tile_pyramid_kind" AS ENUM ('public_default_low_zoom');
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_version_status') THEN
    CREATE TYPE "public"."property_tile_pyramid_version_status" AS ENUM (
      'queued',
      'building',
      'validating',
      'validated',
      'promoted',
      'failed_retryable',
      'failed_terminal',
      'superseded'
    );
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_tile_status') THEN
    CREATE TYPE "public"."property_tile_pyramid_tile_status" AS ENUM (
      'pending',
      'valid_empty',
      'valid_nodes',
      'valid_encoded',
      'failed'
    );
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_tile_validation_status') THEN
    CREATE TYPE "public"."property_tile_pyramid_tile_validation_status" AS ENUM (
      'pending',
      'validated',
      'failed'
    );
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_node_class') THEN
    CREATE TYPE "public"."property_tile_pyramid_node_class" AS ENUM ('active', 'ghost');
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_group_kind') THEN
    CREATE TYPE "public"."property_tile_pyramid_group_kind" AS ENUM ('single', 'cluster');
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_watermark_scope') THEN
    CREATE TYPE "public"."property_tile_pyramid_watermark_scope" AS ENUM (
      'snapshot_watermarks',
      'ingest_source',
      'listing_source_scope',
      'listing_scope_completion',
      'listing_candidates',
      'listing_facts',
      'property_geometry',
      'property_status',
      'social_inputs',
      'official_valuations',
      'views_engagement',
      'rolling_social_window',
      'coverage'
    );
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_tile_pyramid_audit_action') THEN
    CREATE TYPE "public"."property_tile_pyramid_audit_action" AS ENUM (
      'created',
      'status_changed',
      'promoted',
      'rollback',
      'degraded',
      'validation_failed',
      'retention_deleted',
      'lease_acquired',
      'lease_released'
    );
  END IF;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coverage_id" text NOT NULL,
  "filter_signature" text NOT NULL,
  "max_zoom" integer NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "config_hash" text NOT NULL,
  "build_inputs_hash" text NOT NULL,
  "source_watermark_hash" text NOT NULL,
  "source_watermarks_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "coverage_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "config_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "grouping_constants_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "validation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "build_stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "property_tile_pyramid_version_status" DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "request_reason" text,
  "failure_category" text,
  "failure_message" text,
  "failure_stack_summary" text,
  "failed_stage" text,
  "failed_z" integer,
  "failed_x" integer,
  "failed_y" integer,
  "terminal_reason" text,
  "next_retry_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "lease_owner" text,
  "lease_token" text,
  "lease_until" timestamp with time zone,
  "pending_replacement_watermarks_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "expected_tile_count" integer DEFAULT 0 NOT NULL,
  "validated_tile_count" integer DEFAULT 0 NOT NULL,
  "non_empty_tile_count" integer DEFAULT 0 NOT NULL,
  "node_count" integer DEFAULT 0 NOT NULL,
  "member_row_count" bigint DEFAULT 0 NOT NULL,
  "encoded_payload_bytes" bigint DEFAULT 0 NOT NULL,
  "heap_bytes" bigint DEFAULT 0 NOT NULL,
  "index_bytes" bigint DEFAULT 0 NOT NULL,
  "wal_bytes" bigint DEFAULT 0 NOT NULL,
  "build_duration_ms" integer,
  "degraded_at" timestamp with time zone,
  "degraded_reason" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "build_started_at" timestamp with time zone,
  "build_finished_at" timestamp with time zone,
  "validated_at" timestamp with time zone,
  "promoted_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_versions_zoom_check"
    CHECK ("max_zoom" >= 0 AND "max_zoom" <= 22),
  CONSTRAINT "property_tile_pyramid_versions_counts_check"
    CHECK (
      "attempt_count" >= 0
      AND "max_attempts" > 0
      AND "expected_tile_count" >= 0
      AND "validated_tile_count" >= 0
      AND "non_empty_tile_count" >= 0
      AND "node_count" >= 0
      AND "member_row_count" >= 0
      AND "encoded_payload_bytes" >= 0
      AND "heap_bytes" >= 0
      AND "index_bytes" >= 0
      AND "wal_bytes" >= 0
      AND ("build_duration_ms" IS NULL OR "build_duration_ms" >= 0)
    ),
  CONSTRAINT "property_tile_pyramid_versions_status_timestamps_check"
    CHECK (
      ("status" = 'promoted') = ("promoted_at" IS NOT NULL)
      AND ("status" <> 'failed_terminal' OR "terminal_reason" IS NOT NULL)
    ),
  CONSTRAINT "property_tile_pyramid_versions_failed_tile_check"
    CHECK (
      ("failed_z" IS NULL AND "failed_x" IS NULL AND "failed_y" IS NULL)
      OR (
        "failed_z" IS NOT NULL
        AND "failed_x" IS NOT NULL
        AND "failed_y" IS NOT NULL
        AND "failed_z" >= 0
        AND "failed_z" <= 22
        AND "failed_x" >= 0
        AND "failed_y" >= 0
        AND "failed_x" < (1::bigint << "failed_z")
        AND "failed_y" < (1::bigint << "failed_z")
      )
    )
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "property_tile_pyramid_versions_build_identity_idx"
ON "property_tile_pyramid_versions" (
  "coverage_id",
  "filter_signature",
  "max_zoom",
  "pyramid_kind",
  "build_inputs_hash",
  "source_watermark_hash"
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "property_tile_pyramid_versions_current_fk_idx"
ON "property_tile_pyramid_versions" (
  "id",
  "coverage_id",
  "filter_signature",
  "max_zoom",
  "pyramid_kind"
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_versions_slot_status_idx"
ON "property_tile_pyramid_versions" (
  "coverage_id",
  "filter_signature",
  "max_zoom",
  "pyramid_kind",
  "status",
  "created_at" DESC
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_versions_eligible_idx"
ON "property_tile_pyramid_versions" ("status", "next_retry_at", "requested_at")
WHERE "status" IN ('queued', 'failed_retryable');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_versions_lease_idx"
ON "property_tile_pyramid_versions" ("lease_until", "status")
WHERE "lease_until" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_versions_retention_idx"
ON "property_tile_pyramid_versions" ("status", "promoted_at", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_current" (
  "coverage_id" text NOT NULL,
  "filter_signature" text NOT NULL,
  "max_zoom" integer NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "current_version_id" uuid NOT NULL,
  "previous_version_id" uuid REFERENCES "property_tile_pyramid_versions"("id") ON DELETE set null,
  "current_promoted_at" timestamp with time zone NOT NULL,
  "promotion_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_current_pk"
    PRIMARY KEY ("coverage_id", "filter_signature", "max_zoom", "pyramid_kind"),
  CONSTRAINT "property_tile_pyramid_current_version_fk"
    FOREIGN KEY (
      "current_version_id",
      "coverage_id",
      "filter_signature",
      "max_zoom",
      "pyramid_kind"
    )
    REFERENCES "property_tile_pyramid_versions" (
      "id",
      "coverage_id",
      "filter_signature",
      "max_zoom",
      "pyramid_kind"
    ),
  CONSTRAINT "property_tile_pyramid_current_zoom_check"
    CHECK ("max_zoom" >= 0 AND "max_zoom" <= 22)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_current_version_idx"
ON "property_tile_pyramid_current" ("current_version_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_current_previous_idx"
ON "property_tile_pyramid_current" ("previous_version_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_tiles" (
  "version_id" uuid NOT NULL REFERENCES "property_tile_pyramid_versions"("id") ON DELETE cascade,
  "z" integer NOT NULL,
  "x" integer NOT NULL,
  "y" integer NOT NULL,
  "tile_status" "property_tile_pyramid_tile_status" DEFAULT 'pending' NOT NULL,
  "validation_status" "property_tile_pyramid_tile_validation_status" DEFAULT 'pending' NOT NULL,
  "node_count" integer DEFAULT 0 NOT NULL,
  "etag" text,
  "payload" bytea,
  "payload_sha256" text,
  "payload_generated_at" timestamp with time zone,
  "validated_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_tiles_pk" PRIMARY KEY ("version_id", "z", "x", "y"),
  CONSTRAINT "property_tile_pyramid_tiles_coord_check"
    CHECK (
      "z" >= 0
      AND "z" <= 22
      AND "x" >= 0
      AND "y" >= 0
      AND "x" < (1::bigint << "z")
      AND "y" < (1::bigint << "z")
    ),
  CONSTRAINT "property_tile_pyramid_tiles_payload_check"
    CHECK (
      "node_count" >= 0
      AND (
        ("tile_status" = 'pending' AND "payload" IS NULL)
        OR (
          "tile_status" = 'valid_empty'
          AND "node_count" = 0
          AND "payload" IS NULL
          AND "etag" IS NOT NULL
        )
        OR (
          "tile_status" = 'valid_nodes'
          AND "node_count" > 0
          AND "payload" IS NULL
          AND "etag" IS NOT NULL
        )
        OR (
          "tile_status" = 'valid_encoded'
          AND "payload" IS NOT NULL
          AND octet_length("payload") > 0
          AND "etag" IS NOT NULL
          AND "payload_sha256" IS NOT NULL
          AND "payload_generated_at" IS NOT NULL
        )
        OR ("tile_status" = 'failed' AND "payload" IS NULL)
      )
    ),
  CONSTRAINT "property_tile_pyramid_tiles_validation_check"
    CHECK (
      ("validation_status" <> 'validated' OR "validated_at" IS NOT NULL)
      AND ("validation_status" <> 'failed' OR "last_error" IS NOT NULL)
    )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_tiles_status_idx"
ON "property_tile_pyramid_tiles" (
  "version_id",
  "tile_status",
  "validation_status",
  "z",
  "x",
  "y"
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_tiles_payload_missing_idx"
ON "property_tile_pyramid_tiles" ("version_id", "z", "x", "y")
WHERE "tile_status" = 'valid_nodes' AND "payload" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_tiles_payload_retention_idx"
ON "property_tile_pyramid_tiles" ("version_id", "payload_generated_at")
WHERE "payload" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_nodes" (
  "version_id" uuid NOT NULL REFERENCES "property_tile_pyramid_versions"("id") ON DELETE cascade,
  "node_id" text NOT NULL,
  "z" integer NOT NULL,
  "x" integer NOT NULL,
  "y" integer NOT NULL,
  "render_lon" double precision NOT NULL,
  "render_lat" double precision NOT NULL,
  "render_geometry" geometry(Point, 4326) NOT NULL,
  "anchor_world_x" double precision NOT NULL,
  "anchor_world_y" double precision NOT NULL,
  "node_class" "property_tile_pyramid_node_class" NOT NULL,
  "group_kind" "property_tile_pyramid_group_kind" NOT NULL,
  "point_count" integer NOT NULL,
  "representative_property_id" uuid,
  "preview_property_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
  "preview_count" integer DEFAULT 0 NOT NULL,
  "node_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "preview_properties_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "bbox_west" double precision,
  "bbox_south" double precision,
  "bbox_east" double precision,
  "bbox_north" double precision,
  "active_listing_count" integer DEFAULT 0 NOT NULL,
  "completed_listing_count" integer DEFAULT 0 NOT NULL,
  "social_count" integer DEFAULT 0 NOT NULL,
  "recent_social_count" integer DEFAULT 0 NOT NULL,
  "social_score_total" real DEFAULT 0 NOT NULL,
  "social_score_max" real DEFAULT 0 NOT NULL,
  "recent_social_score_total" real DEFAULT 0 NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "address" text,
  "city" text,
  "asking_price" bigint,
  "thumbnail_url" text,
  "has_active_listing" boolean,
  "market_state" varchar(20),
  "tap_radius_px" real,
  "tap_priority_score" real DEFAULT 0 NOT NULL,
  "nearby_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_nodes_pk" PRIMARY KEY ("version_id", "node_id"),
  CONSTRAINT "property_tile_pyramid_nodes_coord_check"
    CHECK (
      "z" >= 0
      AND "z" <= 22
      AND "x" >= 0
      AND "y" >= 0
      AND "x" < (1::bigint << "z")
      AND "y" < (1::bigint << "z")
      AND "render_lon" >= -180
      AND "render_lon" <= 180
      AND "render_lat" >= -90
      AND "render_lat" <= 90
    ),
  CONSTRAINT "property_tile_pyramid_nodes_counts_check"
    CHECK (
      "point_count" > 0
      AND "preview_count" >= 0
      AND "preview_count" <= "point_count"
      AND "preview_count" = cardinality("preview_property_ids")
      AND "active_listing_count" >= 0
      AND "completed_listing_count" >= 0
      AND "social_count" >= 0
      AND "recent_social_count" >= 0
      AND "social_score_total" >= 0
      AND "social_score_max" >= 0
      AND "recent_social_score_total" >= 0
      AND "comment_count" >= 0
      AND ("tap_radius_px" IS NULL OR "tap_radius_px" >= 0)
      AND "tap_priority_score" >= 0
    ),
  CONSTRAINT "property_tile_pyramid_nodes_bbox_check"
    CHECK (
      (
        "bbox_west" IS NULL
        AND "bbox_south" IS NULL
        AND "bbox_east" IS NULL
        AND "bbox_north" IS NULL
      )
      OR (
        "bbox_west" IS NOT NULL
        AND "bbox_south" IS NOT NULL
        AND "bbox_east" IS NOT NULL
        AND "bbox_north" IS NOT NULL
        AND "bbox_west" <= "bbox_east"
        AND "bbox_south" <= "bbox_north"
        AND "bbox_west" >= -180
        AND "bbox_east" <= 180
        AND "bbox_south" >= -90
        AND "bbox_north" <= 90
      )
    ),
  CONSTRAINT "property_tile_pyramid_nodes_market_state_check"
    CHECK (
      "market_state" IS NULL
      OR "market_state" IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed')
    )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_nodes_tile_idx"
ON "property_tile_pyramid_nodes" ("version_id", "z", "x", "y");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_nodes_nearby_tile_idx"
ON "property_tile_pyramid_nodes" (
  "version_id",
  "z",
  "x",
  "y",
  "render_lon",
  "render_lat"
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_nodes_render_geometry_idx"
ON "property_tile_pyramid_nodes" USING gist ("render_geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_nodes_representative_idx"
ON "property_tile_pyramid_nodes" ("version_id", "representative_property_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_source_watermarks" (
  "scope" "property_tile_pyramid_watermark_scope" NOT NULL,
  "scope_key" text DEFAULT 'global' NOT NULL,
  "watermark_value" bigint DEFAULT 0 NOT NULL,
  "watermark_timestamp" timestamp with time zone,
  "watermark_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "pending_replacement_watermark_value" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_source_watermarks_pk" PRIMARY KEY ("scope", "scope_key"),
  CONSTRAINT "property_tile_pyramid_watermarks_value_check"
    CHECK (
      "watermark_value" >= 0
      AND (
        "pending_replacement_watermark_value" IS NULL
        OR "pending_replacement_watermark_value" >= "watermark_value"
      )
    )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_watermarks_updated_idx"
ON "property_tile_pyramid_source_watermarks" ("updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_pyramid_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version_id" uuid REFERENCES "property_tile_pyramid_versions"("id") ON DELETE set null,
  "coverage_id" text NOT NULL,
  "filter_signature" text NOT NULL,
  "max_zoom" integer NOT NULL,
  "pyramid_kind" "property_tile_pyramid_kind" DEFAULT 'public_default_low_zoom' NOT NULL,
  "action" "property_tile_pyramid_audit_action" NOT NULL,
  "actor" text DEFAULT 'system' NOT NULL,
  "from_status" "property_tile_pyramid_version_status",
  "to_status" "property_tile_pyramid_version_status",
  "previous_version_id" uuid,
  "current_version_id" uuid,
  "reason" text,
  "details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_pyramid_audit_zoom_check"
    CHECK ("max_zoom" >= 0 AND "max_zoom" <= 22)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_audit_version_idx"
ON "property_tile_pyramid_audit" ("version_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_audit_slot_idx"
ON "property_tile_pyramid_audit" (
  "coverage_id",
  "filter_signature",
  "max_zoom",
  "pyramid_kind",
  "created_at"
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."coverage_id" IS DISTINCT FROM OLD."coverage_id"
      OR NEW."filter_signature" IS DISTINCT FROM OLD."filter_signature"
      OR NEW."max_zoom" IS DISTINCT FROM OLD."max_zoom"
      OR NEW."pyramid_kind" IS DISTINCT FROM OLD."pyramid_kind"
      OR NEW."config_hash" IS DISTINCT FROM OLD."config_hash"
      OR NEW."build_inputs_hash" IS DISTINCT FROM OLD."build_inputs_hash"
      OR NEW."source_watermark_hash" IS DISTINCT FROM OLD."source_watermark_hash"
      OR NEW."source_watermarks_json" IS DISTINCT FROM OLD."source_watermarks_json"
      OR NEW."coverage_snapshot_json" IS DISTINCT FROM OLD."coverage_snapshot_json"
      OR NEW."config_snapshot_json" IS DISTINCT FROM OLD."config_snapshot_json"
      OR NEW."grouping_constants_json" IS DISTINCT FROM OLD."grouping_constants_json"
    THEN
      RAISE EXCEPTION 'property tile pyramid build identity fields are immutable';
    END IF;

    IF OLD."status" IS DISTINCT FROM NEW."status" THEN
      IF NOT (
        OLD."status" = NEW."status"
        OR (OLD."status" = 'queued' AND NEW."status" IN ('building', 'failed_retryable', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'building' AND NEW."status" IN ('validating', 'failed_retryable', 'failed_terminal'))
        OR (OLD."status" = 'validating' AND NEW."status" IN ('validated', 'failed_retryable', 'failed_terminal'))
        OR (OLD."status" = 'validated' AND NEW."status" IN ('promoted', 'failed_terminal', 'superseded'))
        OR (OLD."status" = 'failed_retryable' AND NEW."status" IN ('queued', 'building', 'failed_terminal', 'superseded'))
      ) THEN
        RAISE EXCEPTION 'illegal property tile pyramid status transition from % to %', OLD."status", NEW."status";
      END IF;
    END IF;

    NEW."updated_at" = now();
  END IF;

  IF NEW."status" = 'promoted' AND NEW."promoted_at" IS NULL THEN
    NEW."promoted_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_pyramid_versions_guard"
ON "property_tile_pyramid_versions";--> statement-breakpoint

CREATE TRIGGER "property_tile_pyramid_versions_guard"
BEFORE INSERT OR UPDATE
ON "property_tile_pyramid_versions"
FOR EACH ROW
EXECUTE FUNCTION property_tile_pyramid_versions_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_status "property_tile_pyramid_version_status";
BEGIN
  SELECT v."status"
    INTO referenced_status
  FROM "property_tile_pyramid_versions" v
  WHERE v."id" = NEW."current_version_id"
    AND v."coverage_id" = NEW."coverage_id"
    AND v."filter_signature" = NEW."filter_signature"
    AND v."max_zoom" = NEW."max_zoom"
    AND v."pyramid_kind" = NEW."pyramid_kind";

  IF referenced_status IS NULL THEN
    RAISE EXCEPTION 'current pyramid version % does not match serving slot', NEW."current_version_id";
  END IF;

  IF referenced_status <> 'promoted' THEN
    RAISE EXCEPTION 'current pyramid version % must be promoted, got %', NEW."current_version_id", referenced_status;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."previous_version_id" IS NOT NULL THEN
    RAISE EXCEPTION 'initial current pointer insert must not declare a previous version';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."coverage_id" IS DISTINCT FROM OLD."coverage_id"
      OR NEW."filter_signature" IS DISTINCT FROM OLD."filter_signature"
      OR NEW."max_zoom" IS DISTINCT FROM OLD."max_zoom"
      OR NEW."pyramid_kind" IS DISTINCT FROM OLD."pyramid_kind"
    THEN
      RAISE EXCEPTION 'property tile pyramid current serving slot is immutable';
    END IF;

    IF NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id"
      AND NEW."previous_version_id" IS DISTINCT FROM OLD."current_version_id"
    THEN
      RAISE EXCEPTION 'current pointer updates must record the old current version as previous_version_id';
    END IF;

    NEW."updated_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_pyramid_current_guard"
ON "property_tile_pyramid_current";--> statement-breakpoint

CREATE TRIGGER "property_tile_pyramid_current_guard"
BEFORE INSERT OR UPDATE
ON "property_tile_pyramid_current"
FOR EACH ROW
EXECUTE FUNCTION property_tile_pyramid_current_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_current_promoted_constraint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "property_tile_pyramid_versions" v
    WHERE v."id" = NEW."current_version_id"
      AND v."coverage_id" = NEW."coverage_id"
      AND v."filter_signature" = NEW."filter_signature"
      AND v."max_zoom" = NEW."max_zoom"
      AND v."pyramid_kind" = NEW."pyramid_kind"
      AND v."status" = 'promoted'
  ) THEN
    RAISE EXCEPTION 'current pyramid pointer must reference a promoted version';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_pyramid_current_promoted_constraint"
ON "property_tile_pyramid_current";--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "property_tile_pyramid_current_promoted_constraint"
AFTER INSERT OR UPDATE OF "current_version_id"
ON "property_tile_pyramid_current"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION property_tile_pyramid_current_promoted_constraint();--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_pyramid_source_watermarks_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."watermark_value" < OLD."watermark_value" THEN
      RAISE EXCEPTION 'property tile pyramid source watermarks are monotonic';
    END IF;

    IF OLD."watermark_timestamp" IS NOT NULL
      AND NEW."watermark_timestamp" IS NOT NULL
      AND NEW."watermark_timestamp" < OLD."watermark_timestamp"
    THEN
      RAISE EXCEPTION 'property tile pyramid source watermark timestamps are monotonic';
    END IF;

    NEW."updated_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "property_tile_pyramid_source_watermarks_guard"
ON "property_tile_pyramid_source_watermarks";--> statement-breakpoint

CREATE TRIGGER "property_tile_pyramid_source_watermarks_guard"
BEFORE UPDATE
ON "property_tile_pyramid_source_watermarks"
FOR EACH ROW
EXECUTE FUNCTION property_tile_pyramid_source_watermarks_guard();--> statement-breakpoint

CREATE OR REPLACE FUNCTION promote_property_tile_pyramid_version(
  p_target_version_id uuid,
  p_expected_previous_version_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  pointer_updated integer;
BEGIN
  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id
  FOR UPDATE;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."status" <> 'validated' THEN
    RAISE EXCEPTION 'property tile pyramid version % must be validated before promotion, got %',
      p_target_version_id,
      target_version."status";
  END IF;

  UPDATE "property_tile_pyramid_versions"
  SET
    "status" = 'promoted',
    "promoted_at" = now(),
    "updated_at" = now()
  WHERE "id" = p_target_version_id;

  WITH upserted AS (
    INSERT INTO "property_tile_pyramid_current" (
      "coverage_id",
      "filter_signature",
      "max_zoom",
      "pyramid_kind",
      "current_version_id",
      "previous_version_id",
      "current_promoted_at",
      "promotion_reason",
      "updated_at"
    )
    VALUES (
      target_version."coverage_id",
      target_version."filter_signature",
      target_version."max_zoom",
      target_version."pyramid_kind",
      p_target_version_id,
      p_expected_previous_version_id,
      now(),
      p_reason,
      now()
    )
    ON CONFLICT ("coverage_id", "filter_signature", "max_zoom", "pyramid_kind")
    DO UPDATE SET
      "current_version_id" = EXCLUDED."current_version_id",
      "previous_version_id" = "property_tile_pyramid_current"."current_version_id",
      "current_promoted_at" = EXCLUDED."current_promoted_at",
      "promotion_reason" = EXCLUDED."promotion_reason",
      "updated_at" = now()
    WHERE "property_tile_pyramid_current"."current_version_id" IS NOT DISTINCT FROM p_expected_previous_version_id
    RETURNING 1
  )
  SELECT count(*) INTO pointer_updated FROM upserted;

  IF pointer_updated <> 1 THEN
    RAISE EXCEPTION 'property tile pyramid current pointer compare-and-swap failed for version %',
      p_target_version_id;
  END IF;

  INSERT INTO "property_tile_pyramid_audit" (
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "action",
    "actor",
    "from_status",
    "to_status",
    "previous_version_id",
    "current_version_id",
    "reason"
  )
  VALUES (
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    'promoted',
    COALESCE(p_actor, 'system'),
    'validated',
    'promoted',
    p_expected_previous_version_id,
    p_target_version_id,
    p_reason
  );
END;
$$;--> statement-breakpoint

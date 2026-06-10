CREATE OR REPLACE FUNCTION property_tile_generated_table_is_partitioned(p_relation_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT c.relkind = 'p'
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = p_relation_name
  ), false);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_generated_storage_is_partitioned()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT bool_and(property_tile_generated_table_is_partitioned(relation_name))
  FROM (
    VALUES
      ('property_tile_listing_candidates'),
      ('property_tile_listing_facts'),
      ('property_tile_social_facts'),
      ('property_tile_grouping_facts'),
      ('property_tile_pyramid_tiles'),
      ('property_tile_pyramid_nodes')
  ) AS generated(relation_name);
$$;--> statement-breakpoint

DO $$
DECLARE
  relation_name text;
  has_rows boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'property_tile_pyramid_nodes',
    'property_tile_pyramid_tiles',
    'property_tile_grouping_facts',
    'property_tile_social_facts',
    'property_tile_listing_facts',
    'property_tile_listing_candidates'
  ]
  LOOP
    IF to_regclass('public.' || relation_name) IS NOT NULL
      AND NOT property_tile_generated_table_is_partitioned(relation_name)
    THEN
      EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', relation_name);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I LIMIT 1)', relation_name)
        INTO has_rows;

      IF has_rows THEN
        RAISE EXCEPTION
          'generated table %.% is not partitioned and contains rows; run services/api/scripts/offline-reset-property-tile-generated-pipeline.sql before migration 0053',
          'public',
          relation_name;
      END IF;

      EXECUTE format('DROP TABLE %I CASCADE', relation_name);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_listing_candidates" (
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE cascade,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE cascade,
  "geometry" geometry(Point, 4326) NOT NULL,
  "official_valuation" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_listing_candidates_pkey" PRIMARY KEY ("snapshot_id", "property_id")
) PARTITION BY LIST ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_snapshot_geometry_gist_idx"
ON "property_tile_listing_candidates" USING gist ("geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_snapshot_id_idx"
ON "property_tile_listing_candidates" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_candidates_property_id_idx"
ON "property_tile_listing_candidates" ("property_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_listing_facts" (
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE cascade,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE cascade,
  "has_active_listing" boolean NOT NULL,
  "has_completed_listing" boolean NOT NULL,
  "market_state" varchar(20) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_listing_facts_pkey" PRIMARY KEY ("snapshot_id", "property_id"),
  CONSTRAINT "property_tile_listing_facts_market_state_check"
    CHECK ("market_state" IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed'))
) PARTITION BY LIST ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_facts_snapshot_market_state_idx"
ON "property_tile_listing_facts" ("snapshot_id", "market_state");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_listing_facts_property_id_idx"
ON "property_tile_listing_facts" ("property_id");--> statement-breakpoint

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
  CONSTRAINT "property_tile_social_facts_pkey" PRIMARY KEY ("snapshot_id", "property_id")
) PARTITION BY LIST ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_snapshot_id_idx"
ON "property_tile_social_facts" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_geometry_gist_idx"
ON "property_tile_social_facts" USING gist ("geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_snapshot_last_social_at_idx"
ON "property_tile_social_facts" ("snapshot_id", "last_social_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_social_facts_property_id_idx"
ON "property_tile_social_facts" ("property_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_tile_grouping_facts" (
  "snapshot_id" uuid NOT NULL REFERENCES "property_tile_candidate_source_snapshots"("id") ON DELETE cascade,
  "property_id" uuid REFERENCES "properties"("id") ON DELETE cascade,
  "geometry" geometry(Point, 4326) NOT NULL,
  "official_valuation" bigint,
  "country_code" varchar(2),
  "city" varchar(100),
  "region" varchar(255),
  "postal_code" varchar(10),
  "street" varchar(255),
  "house_number" integer,
  "house_number_addition" varchar(50),
  "official_valuation_year" integer,
  "asking_price" bigint,
  "thumbnail_url" text,
  "city_token" text,
  "region_token" text,
  "postal_code_norm" text,
  "street_token" text,
  "sale_effective_price" bigint,
  "rent_effective_price" bigint,
  "has_active_listing" boolean DEFAULT false NOT NULL,
  "has_completed_listing" boolean DEFAULT false NOT NULL,
  "market_state" varchar(20) DEFAULT 'not-listed' NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "social_score" double precision DEFAULT 0 NOT NULL,
  "recent_social_score" double precision DEFAULT 0 NOT NULL,
  "last_social_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_tile_grouping_facts_pkey" PRIMARY KEY ("snapshot_id", "property_id"),
  CONSTRAINT "property_tile_grouping_facts_market_state_check"
    CHECK ("market_state" IN ('for-sale', 'for-rent', 'sold', 'rented', 'not-listed'))
) PARTITION BY LIST ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_id_idx"
ON "property_tile_grouping_facts" ("snapshot_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_geometry_gist_idx"
ON "property_tile_grouping_facts" USING gist ("snapshot_id", "geometry");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_visible_snapshot_geometry_gist_idx"
ON "property_tile_grouping_facts" USING gist ("snapshot_id", "geometry")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_city_token_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "city_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_region_token_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "region_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_postal_norm_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "postal_code_norm")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_country_street_city_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "country_code", "street_token", "city_token")
WHERE "has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_sale_price_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state", "sale_effective_price")
WHERE ("has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75)
  AND "sale_effective_price" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_vis_rent_price_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state", "rent_effective_price")
WHERE ("has_active_listing" OR "has_completed_listing" OR "social_score" >= 0.75)
  AND "rent_effective_price" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_market_state_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "market_state");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_snapshot_last_social_at_idx"
ON "property_tile_grouping_facts" ("snapshot_id", "last_social_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "property_tile_grouping_facts_property_id_idx"
ON "property_tile_grouping_facts" ("property_id");--> statement-breakpoint

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
) PARTITION BY LIST ("version_id");--> statement-breakpoint

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

CREATE INDEX IF NOT EXISTS "property_tile_pyramid_tiles_promotion_invalid_idx"
ON "property_tile_pyramid_tiles" ("version_id")
WHERE "validation_status" <> 'validated'
  OR "tile_status" NOT IN ('valid_empty', 'valid_nodes', 'valid_encoded');--> statement-breakpoint

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
  CONSTRAINT "property_tile_pyramid_nodes_tile_fk"
    FOREIGN KEY ("version_id", "z", "x", "y")
    REFERENCES "property_tile_pyramid_tiles" ("version_id", "z", "x", "y")
    ON DELETE cascade,
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
) PARTITION BY LIST ("version_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_property_tile_pyramid_nodes_tile_fk()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_tile_pyramid_nodes_tile_fk'
      AND conrelid = 'property_tile_pyramid_nodes'::regclass
  ) THEN
    ALTER TABLE "property_tile_pyramid_nodes"
      ADD CONSTRAINT "property_tile_pyramid_nodes_tile_fk"
      FOREIGN KEY ("version_id", "z", "x", "y")
      REFERENCES "property_tile_pyramid_tiles" ("version_id", "z", "x", "y")
      ON DELETE cascade;
  END IF;
END;
$$;--> statement-breakpoint

SELECT ensure_property_tile_pyramid_nodes_tile_fk();--> statement-breakpoint

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

CREATE OR REPLACE FUNCTION property_tile_partition_suffix(p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT substr(md5(p_id::text), 1, 32);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION grant_property_tile_generated_partition_access(p_partition_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I TO huishype_pyramid_owner',
      p_partition_name
    );
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_property_tile_candidate_source_partitions(p_snapshot_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  suffix text;
BEGIN
  IF p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'snapshot id is required for generated candidate source partitions';
  END IF;

  suffix = property_tile_partition_suffix(p_snapshot_id);

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_listing_candidates FOR VALUES IN (%L)',
    'ptlc_p_' || suffix,
    p_snapshot_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptlc_p_' || suffix);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_listing_facts FOR VALUES IN (%L)',
    'ptlf_p_' || suffix,
    p_snapshot_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptlf_p_' || suffix);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_social_facts FOR VALUES IN (%L)',
    'ptsf_p_' || suffix,
    p_snapshot_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptsf_p_' || suffix);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_grouping_facts FOR VALUES IN (%L)',
    'ptgf_p_' || suffix,
    p_snapshot_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptgf_p_' || suffix);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_property_tile_pyramid_version_partitions(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  suffix text;
BEGIN
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'version id is required for generated pyramid partitions';
  END IF;

  suffix = property_tile_partition_suffix(p_version_id);

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_pyramid_tiles FOR VALUES IN (%L)',
    'ptpt_p_' || suffix,
    p_version_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptpt_p_' || suffix);
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_pyramid_nodes FOR VALUES IN (%L)',
    'ptpn_p_' || suffix,
    p_version_id::text
  );
  PERFORM grant_property_tile_generated_partition_access('ptpn_p_' || suffix);

  IF to_regclass('public.property_tile_pyramid_members') IS NOT NULL
    AND property_tile_generated_table_is_partitioned('property_tile_pyramid_members')
  THEN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF property_tile_pyramid_members FOR VALUES IN (%L)',
      'ptpm_p_' || suffix,
      p_version_id::text
    );
    PERFORM grant_property_tile_generated_partition_access('ptpm_p_' || suffix);
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION drop_property_tile_pyramid_version_partitions(p_version_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  suffix text;
  dropped_count integer := 0;
  partition_name text;
BEGIN
  IF p_version_id IS NULL THEN
    RETURN 0;
  END IF;

  suffix = property_tile_partition_suffix(p_version_id);

  IF to_regclass('public.ptpt_p_' || suffix) IS NOT NULL THEN
    ALTER TABLE "property_tile_pyramid_nodes"
      DROP CONSTRAINT IF EXISTS "property_tile_pyramid_nodes_tile_fk";
  END IF;

  FOREACH partition_name IN ARRAY ARRAY[
    'ptpm_p_' || suffix,
    'ptpn_p_' || suffix,
    'ptpt_p_' || suffix
  ]
  LOOP
    IF to_regclass('public.' || partition_name) IS NOT NULL THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
      dropped_count = dropped_count + 1;
    END IF;
  END LOOP;

  PERFORM ensure_property_tile_pyramid_nodes_tile_fk();

  RETURN dropped_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION drop_property_tile_candidate_source_partitions(p_snapshot_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  suffix text;
  dropped_count integer := 0;
  partition_name text;
BEGIN
  IF p_snapshot_id IS NULL THEN
    RETURN 0;
  END IF;

  suffix = property_tile_partition_suffix(p_snapshot_id);

  FOREACH partition_name IN ARRAY ARRAY[
    'ptgf_p_' || suffix,
    'ptsf_p_' || suffix,
    'ptlf_p_' || suffix,
    'ptlc_p_' || suffix
  ]
  LOOP
    IF to_regclass('public.' || partition_name) IS NOT NULL THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', partition_name);
      dropped_count = dropped_count + 1;
    END IF;
  END LOOP;

  RETURN dropped_count;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION property_tile_generated_partition_retention()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  version_record record;
  snapshot_record record;
  dropped_version_partition_count integer := 0;
  dropped_snapshot_partition_count integer := 0;
  deleted_version_count integer := 0;
  deleted_snapshot_count integer := 0;
  dropped_now integer;
BEGIN
  IF NOT property_tile_generated_storage_is_partitioned() THEN
    RETURN jsonb_build_object('partitioned', false);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.property_tile_retained_versions (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.property_tile_retained_versions;

  INSERT INTO pg_temp.property_tile_retained_versions (id)
  SELECT current_version_id FROM property_tile_pyramid_current
  UNION
  SELECT previous_version_id FROM property_tile_pyramid_current WHERE previous_version_id IS NOT NULL
  UNION
  SELECT id FROM property_tile_pyramid_versions
  WHERE status IN ('queued', 'building', 'validating', 'validated')
     OR (lease_until IS NOT NULL AND lease_until > now())
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.property_tile_retained_snapshots (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.property_tile_retained_snapshots;

  INSERT INTO pg_temp.property_tile_retained_snapshots (id)
  SELECT snapshot_id FROM property_tile_candidate_source_current
  UNION
  SELECT v.candidate_snapshot_id
  FROM property_tile_pyramid_versions v
  INNER JOIN pg_temp.property_tile_retained_versions rv ON rv.id = v.id
  WHERE v.candidate_snapshot_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  FOR version_record IN
    SELECT v.id
    FROM property_tile_pyramid_versions v
    LEFT JOIN pg_temp.property_tile_retained_versions rv ON rv.id = v.id
    WHERE rv.id IS NULL
      AND (v.lease_until IS NULL OR v.lease_until < now())
    ORDER BY COALESCE(v.updated_at, v.promoted_at, v.build_finished_at, v.superseded_at, v.created_at)
  LOOP
    dropped_now = drop_property_tile_pyramid_version_partitions(version_record.id);
    dropped_version_partition_count = dropped_version_partition_count + dropped_now;
    DELETE FROM property_tile_pyramid_versions v
    WHERE v.id = version_record.id
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_current c
        WHERE c.current_version_id = v.id OR c.previous_version_id = v.id
      )
      AND v.status NOT IN ('queued', 'building', 'validating', 'validated')
      AND (v.lease_until IS NULL OR v.lease_until < now());
    IF FOUND THEN
      deleted_version_count = deleted_version_count + 1;
    END IF;
  END LOOP;

  FOR snapshot_record IN
    SELECT s.id
    FROM property_tile_candidate_source_snapshots s
    LEFT JOIN pg_temp.property_tile_retained_snapshots rs ON rs.id = s.id
    WHERE rs.id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_versions v
        WHERE v.candidate_snapshot_id = s.id
      )
    ORDER BY COALESCE(s.updated_at, s.build_finished_at, s.build_started_at, s.created_at)
  LOOP
    dropped_now = drop_property_tile_candidate_source_partitions(snapshot_record.id);
    dropped_snapshot_partition_count = dropped_snapshot_partition_count + dropped_now;
    DELETE FROM property_tile_candidate_source_snapshots s
    WHERE s.id = snapshot_record.id
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_candidate_source_current c
        WHERE c.snapshot_id = s.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM property_tile_pyramid_versions v
        WHERE v.candidate_snapshot_id = s.id
      );
    IF FOUND THEN
      deleted_snapshot_count = deleted_snapshot_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'partitioned', true,
    'droppedVersionPartitions', dropped_version_partition_count,
    'droppedSnapshotPartitions', dropped_snapshot_partition_count,
    'deletedVersions', deleted_version_count,
    'deletedCandidateSourceSnapshots', deleted_snapshot_count
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION promote_property_tile_pyramid_version(
  p_target_version_id uuid,
  p_expected_previous_version_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  pointer_updated integer;
  current_txid bigint;
  audit_action "property_tile_pyramid_audit_action";
BEGIN
  current_txid = txid_current();

  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id
  FOR UPDATE;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."status" NOT IN ('validated', 'promoted') THEN
    RAISE EXCEPTION 'property tile pyramid version % must be validated or promoted before pointer update, got %',
      p_target_version_id,
      target_version."status";
  END IF;

  audit_action = CASE
    WHEN target_version."status" = 'validated' THEN 'promoted'::property_tile_pyramid_audit_action
    ELSE 'rollback'::property_tile_pyramid_audit_action
  END;

  INSERT INTO "property_tile_pyramid_promotion_intents" (
    "txid",
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "actor",
    "reason"
  )
  VALUES (
    current_txid,
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    COALESCE(p_actor, 'system'),
    p_reason
  )
  ON CONFLICT ("txid", "version_id") DO NOTHING;

  PERFORM set_config(
    'huishype.property_tile_pyramid_promotion_version_id',
    p_target_version_id::text,
    true
  );

  PERFORM property_tile_pyramid_assert_promotable(p_target_version_id);

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

  UPDATE "property_tile_pyramid_versions"
  SET
    "status" = 'promoted',
    "promoted_at" = COALESCE("promoted_at", now()),
    "superseded_at" = NULL,
    "updated_at" = now()
  WHERE "id" = p_target_version_id
    AND "status" IN ('validated', 'promoted');

  UPDATE "property_tile_pyramid_versions"
  SET
    "superseded_at" = NULL,
    "updated_at" = now()
  WHERE "id" = p_expected_previous_version_id
    AND "status" = 'promoted';

  UPDATE "property_tile_pyramid_versions"
  SET
    "superseded_at" = COALESCE("superseded_at", now()),
    "validation_summary" = jsonb_set(
      COALESCE("validation_summary", '{}'::jsonb),
      '{superseded}',
      jsonb_build_object(
        'reason', 'promoted-version-no-longer-current-or-previous',
        'currentVersionId', p_target_version_id,
        'previousVersionId', p_expected_previous_version_id
      ),
      true
    ),
    "updated_at" = now()
  WHERE "coverage_id" = target_version."coverage_id"
    AND "filter_signature" = target_version."filter_signature"
    AND "max_zoom" = target_version."max_zoom"
    AND "pyramid_kind" = target_version."pyramid_kind"
    AND "status" = 'promoted'
    AND "id" IS DISTINCT FROM p_target_version_id
    AND "id" IS DISTINCT FROM p_expected_previous_version_id
    AND "superseded_at" IS NULL;

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
    audit_action,
    COALESCE(p_actor, 'system'),
    target_version."status",
    'promoted',
    p_expected_previous_version_id,
    p_target_version_id,
    p_reason
  );
END;
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
      "property_tile_listing_candidates",
      "property_tile_listing_facts",
      "property_tile_social_facts",
      "property_tile_grouping_facts",
      "property_tile_pyramid_tiles",
      "property_tile_pyramid_nodes"
    TO huishype_pyramid_owner;

    IF to_regclass('public.property_tile_pyramid_members') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON TABLE "property_tile_pyramid_members"
        TO huishype_pyramid_owner;
    END IF;

    ALTER FUNCTION promote_property_tile_pyramid_version(uuid, uuid, text, text)
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION property_tile_generated_partition_retention()
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION ensure_property_tile_pyramid_nodes_tile_fk()
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION grant_property_tile_generated_partition_access(text)
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION ensure_property_tile_candidate_source_partitions(uuid)
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION ensure_property_tile_pyramid_version_partitions(uuid)
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION drop_property_tile_candidate_source_partitions(uuid)
      OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION drop_property_tile_pyramid_version_partitions(uuid)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;

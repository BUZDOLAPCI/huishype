CREATE TABLE property_tile_snapshots (
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  filter_signature text NOT NULL,
  coverage_id text NOT NULL,
  payload bytea,
  status_code integer NOT NULL,
  etag text NOT NULL,
  generated_at timestamptz NOT NULL,
  source_listing_watermark bigint NOT NULL,
  source_social_watermark bigint NOT NULL,
  source_property_watermark bigint NOT NULL,
  source_coverage_watermark bigint NOT NULL,
  snapshot_config_hash text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (z, x, y, filter_signature),
  CONSTRAINT property_tile_snapshots_status_code_check
    CHECK (status_code IN (200, 204)),
  CONSTRAINT property_tile_snapshots_payload_check
    CHECK (
      (status_code = 200 AND payload IS NOT NULL AND octet_length(payload) > 0)
      OR (status_code = 204 AND payload IS NULL)
    )
);
--> statement-breakpoint
CREATE INDEX property_tile_snapshots_generated_at_idx
ON property_tile_snapshots (generated_at);
--> statement-breakpoint
CREATE INDEX property_tile_snapshots_coverage_idx
ON property_tile_snapshots (coverage_id, snapshot_config_hash);
--> statement-breakpoint
CREATE TABLE property_tile_snapshot_coverage (
  coverage_id text PRIMARY KEY,
  bounds_source text NOT NULL,
  min_lon double precision NOT NULL,
  min_lat double precision NOT NULL,
  max_lon double precision NOT NULL,
  max_lat double precision NOT NULL,
  countries text[] NOT NULL,
  data_sources text[] NOT NULL,
  max_zoom integer NOT NULL,
  filter_signature text NOT NULL,
  coverage_watermark bigint NOT NULL DEFAULT 0,
  snapshot_config_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_tile_snapshot_coverage_bounds_check
    CHECK (min_lon < max_lon AND min_lat < max_lat),
  CONSTRAINT property_tile_snapshot_coverage_zoom_check
    CHECK (max_zoom >= 0 AND max_zoom <= 22)
);
--> statement-breakpoint
CREATE TABLE property_tile_snapshot_watermarks (
  key text PRIMARY KEY,
  listing_watermark bigint NOT NULL DEFAULT 0,
  social_watermark bigint NOT NULL DEFAULT 0,
  property_watermark bigint NOT NULL DEFAULT 0,
  coverage_watermark bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE property_tile_snapshot_refresh_state (
  key text PRIMARY KEY,
  requested_at timestamptz,
  request_reason text,
  requested_listing_watermark bigint NOT NULL DEFAULT 0,
  requested_social_watermark bigint NOT NULL DEFAULT 0,
  requested_property_watermark bigint NOT NULL DEFAULT 0,
  requested_coverage_watermark bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  applied_listing_watermark bigint NOT NULL DEFAULT 0,
  applied_social_watermark bigint NOT NULL DEFAULT 0,
  applied_property_watermark bigint NOT NULL DEFAULT 0,
  applied_coverage_watermark bigint NOT NULL DEFAULT 0,
  coverage_id text,
  snapshot_config_hash text,
  expected_tile_count integer,
  refreshed_tile_count integer NOT NULL DEFAULT 0,
  failed_tile_count integer NOT NULL DEFAULT 0,
  last_window_refresh_at timestamptz
);
--> statement-breakpoint
INSERT INTO property_tile_snapshot_watermarks (key)
VALUES ('public_default_low_zoom')
ON CONFLICT (key) DO NOTHING;

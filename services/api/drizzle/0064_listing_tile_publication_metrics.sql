-- Retain completed publication latency by minute. Queue rows are reusable work
-- state and cannot preserve a slow completion after later, faster publications.
CREATE TABLE listing_tile_publication_metrics (
  bucket_start timestamptz PRIMARY KEY,
  publication_count bigint NOT NULL,
  total_latency_ms bigint NOT NULL,
  max_latency_ms bigint NOT NULL,
  last_latency_ms bigint NOT NULL,
  last_published_at timestamptz NOT NULL,
  last_requested_at timestamptz NOT NULL,
  CONSTRAINT listing_tile_publication_metrics_values_check CHECK (
    publication_count > 0 AND total_latency_ms >= 0 AND max_latency_ms >= 0 AND last_latency_ms >= 0
  )
);
--> statement-breakpoint
-- Coalescing updates must preserve when the first unpublished change arrived.
CREATE OR REPLACE FUNCTION enqueue_listing_tile_property_update(target_property_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('listing_tile_publication',0));
  INSERT INTO listing_tile_property_updates(property_id,geometry,revision,requested_at)
  SELECT id,geometry,nextval('listing_tile_update_revision_seq'),clock_timestamp()
  FROM properties WHERE id = target_property_id AND geometry IS NOT NULL
  ON CONFLICT(property_id) DO UPDATE SET
    geometry = EXCLUDED.geometry,
    revision = EXCLUDED.revision,
    requested_at = LEAST(listing_tile_property_updates.requested_at,EXCLUDED.requested_at);
END;
$$;

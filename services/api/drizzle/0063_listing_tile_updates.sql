-- Listing changes are durable tile work, independent of the daily base pyramid.
CREATE SEQUENCE listing_tile_update_revision_seq;
--> statement-breakpoint
CREATE TABLE listing_tile_property_updates (
  property_id uuid PRIMARY KEY,
  geometry geometry(Point,4326) NOT NULL,
  revision bigint NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX listing_tile_property_updates_geometry_idx ON listing_tile_property_updates USING gist(geometry);
CREATE INDEX listing_tile_property_updates_revision_idx ON listing_tile_property_updates(revision);
--> statement-breakpoint
CREATE TABLE listing_tile_updates (
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  requested_revision bigint NOT NULL,
  published_revision bigint NOT NULL DEFAULT 0,
  published_version_id uuid REFERENCES property_tile_pyramid_versions(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  claimed_revision bigint,
  lease_token uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error text,
  PRIMARY KEY(z,x,y),
  CONSTRAINT listing_tile_updates_coordinates_check CHECK (z BETWEEN 0 AND 22 AND x >= 0 AND y >= 0 AND x < power(2,z) AND y < power(2,z)),
  CONSTRAINT listing_tile_updates_revisions_check CHECK (requested_revision >= published_revision AND published_revision >= 0)
);
CREATE INDEX listing_tile_updates_due_idx ON listing_tile_updates(next_attempt_at, requested_at);
CREATE INDEX listing_tile_updates_version_idx ON listing_tile_updates(published_version_id);
ALTER TABLE property_tile_pyramid_tiles ADD COLUMN listing_revision bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE FUNCTION enqueue_listing_tile_property_update(target_property_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('listing_tile_publication',0));
  INSERT INTO listing_tile_property_updates(property_id,geometry,revision,requested_at)
  SELECT id,geometry,nextval('listing_tile_update_revision_seq'),clock_timestamp()
  FROM properties WHERE id = target_property_id AND geometry IS NOT NULL
  ON CONFLICT(property_id) DO UPDATE SET
    geometry = EXCLUDED.geometry,
    revision = EXCLUDED.revision,
    requested_at = EXCLUDED.requested_at;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION queue_canonical_listing_tile_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Confirmation timestamps and grace renewal alone do not change a tile.
  -- Compare eligibility at observation time as well, so a new observation can
  -- restore eligibility even if the expiry sweep has not run yet.
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.property_id,OLD.source_name,OLD.status,OLD.active_eligible,
    COALESCE(OLD.active_eligible AND OLD.availability_expires_at > statement_timestamp(),false),
    OLD.verification_state,OLD.origin_summary,OLD.submitted_by,
    OLD.asking_price,OLD.price_type,OLD.price_period,OLD.price_unit,OLD.price_condition,OLD.thumbnail_url,OLD.living_area_m2,
    OLD.listed_at,OLD.first_seen_at,OLD.sold_at,OLD.rented_at,OLD.withdrawn_at
  ) IS NOT DISTINCT FROM ROW(
    NEW.property_id,NEW.source_name,NEW.status,NEW.active_eligible,
    COALESCE(NEW.active_eligible AND NEW.availability_expires_at > statement_timestamp(),false),
    NEW.verification_state,NEW.origin_summary,NEW.submitted_by,
    NEW.asking_price,NEW.price_type,NEW.price_period,NEW.price_unit,NEW.price_condition,NEW.thumbnail_url,NEW.living_area_m2,
    NEW.listed_at,NEW.first_seen_at,NEW.sold_at,NEW.rented_at,NEW.withdrawn_at
  ) THEN RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM enqueue_listing_tile_property_update(OLD.property_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
    PERFORM enqueue_listing_tile_property_update(NEW.property_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER canonical_listing_tile_update
AFTER INSERT OR UPDATE OR DELETE ON canonical_listings
FOR EACH ROW EXECUTE FUNCTION queue_canonical_listing_tile_update();
--> statement-breakpoint
-- Catch existing visible projections at cutover, including eligibility repairs
-- performed by earlier migrations. Expansion coalesces these into whole tiles.
INSERT INTO listing_tile_property_updates(property_id,geometry,revision,requested_at)
SELECT p.id,p.geometry,nextval('listing_tile_update_revision_seq'),clock_timestamp()
FROM properties p JOIN (SELECT DISTINCT property_id FROM canonical_listings) l ON l.property_id=p.id
WHERE p.geometry IS NOT NULL;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION property_tile_generated_partition_retention_for_slot(
  p_coverage_id text,
  p_filter_signature text,
  p_max_zoom integer,
  p_pyramid_kind property_tile_pyramid_kind
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  SELECT current_version_id
  FROM property_tile_pyramid_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
  UNION
  SELECT previous_version_id
  FROM property_tile_pyramid_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
    AND previous_version_id IS NOT NULL
  UNION
  SELECT id
  FROM property_tile_pyramid_versions
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND max_zoom = p_max_zoom
    AND pyramid_kind = p_pyramid_kind
    AND (
      status IN ('queued', 'building', 'validating', 'validated')
      OR (lease_until IS NOT NULL AND lease_until > now())
    )
  UNION
  SELECT published_version_id FROM listing_tile_updates
  WHERE published_version_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.property_tile_retained_snapshots (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.property_tile_retained_snapshots;

  INSERT INTO pg_temp.property_tile_retained_snapshots (id)
  SELECT snapshot_id
  FROM property_tile_candidate_source_current
  WHERE coverage_id = p_coverage_id
    AND filter_signature = p_filter_signature
    AND pyramid_kind = p_pyramid_kind
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
    WHERE v.coverage_id = p_coverage_id
      AND v.filter_signature = p_filter_signature
      AND v.max_zoom = p_max_zoom
      AND v.pyramid_kind = p_pyramid_kind
      AND rv.id IS NULL
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
    WHERE s.coverage_id = p_coverage_id
      AND s.filter_signature = p_filter_signature
      AND s.pyramid_kind = p_pyramid_kind
      AND rs.id IS NULL
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
    'slotScoped', true,
    'droppedVersionPartitions', dropped_version_partition_count,
    'droppedSnapshotPartitions', dropped_snapshot_partition_count,
    'deletedVersions', deleted_version_count,
    'deletedCandidateSourceSnapshots', deleted_snapshot_count
  );
END;
$$;

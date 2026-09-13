CREATE TABLE ingest_writer_generations (
  source_name varchar(50) PRIMARY KEY,
  generation bigint NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingest_writer_generations_nonnegative CHECK (generation >= 0 AND last_sequence >= 0)
);
--> statement-breakpoint
CREATE TABLE source_listing_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(50) NOT NULL,
  primary_id text NOT NULL,
  primary_id_type varchar(50) NOT NULL,
  canonical_listing_id uuid REFERENCES canonical_listings(id) ON DELETE SET NULL,
  facts_json jsonb NOT NULL DEFAULT '{}',
  field_evidence jsonb NOT NULL DEFAULT '{}',
  last_positive_observed_at timestamptz,
  last_status_observed_at timestamptz,
  quarantined_at timestamptz,
  quarantine_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX source_listing_identities_primary_idx ON source_listing_identities(source_name, primary_id_type, primary_id);
CREATE UNIQUE INDEX source_listing_identities_id_source_idx ON source_listing_identities(id, source_name);
CREATE UNIQUE INDEX source_listing_identities_canonical_idx ON source_listing_identities(canonical_listing_id) WHERE canonical_listing_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE source_listing_aliases (
  source_name varchar(50) NOT NULL,
  kind varchar(50) NOT NULL,
  value text NOT NULL,
  identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, kind, value),
  CONSTRAINT source_listing_aliases_identity_fk FOREIGN KEY (identity_id, source_name) REFERENCES source_listing_identities(id, source_name) ON DELETE CASCADE
);
CREATE INDEX source_listing_aliases_identity_idx ON source_listing_aliases(identity_id);
--> statement-breakpoint
CREATE TABLE ingest_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(50) NOT NULL,
  event_id text NOT NULL,
  generation bigint NOT NULL,
  sequence bigint NOT NULL,
  identity_id uuid NOT NULL,
  kind varchar(20) NOT NULL,
  observed_at timestamptz NOT NULL,
  collector varchar(50) NOT NULL,
  manifest_ref jsonb,
  payload_json jsonb NOT NULL,
  payload_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingest_evidence_identity_fk FOREIGN KEY (identity_id, source_name) REFERENCES source_listing_identities(id, source_name) ON DELETE RESTRICT,
  CONSTRAINT ingest_evidence_kind_check CHECK (kind IN ('facts', 'sighting', 'absence')),
  CONSTRAINT ingest_evidence_sequence_check CHECK (generation >= 0 AND sequence > 0)
);
CREATE UNIQUE INDEX ingest_evidence_event_idx ON ingest_evidence(source_name, event_id);
CREATE UNIQUE INDEX ingest_evidence_sequence_idx ON ingest_evidence(source_name, generation, sequence);
CREATE INDEX ingest_evidence_identity_observed_idx ON ingest_evidence(identity_id, observed_at);
--> statement-breakpoint
CREATE TABLE source_identity_quarantines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(50) NOT NULL,
  reason text NOT NULL,
  identity_ids jsonb NOT NULL,
  listing_ids jsonb NOT NULL,
  aliases_json jsonb NOT NULL,
  details_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_identity_quarantines_source_idx ON source_identity_quarantines(source_name, created_at);
--> statement-breakpoint
CREATE TABLE source_identity_reconciliations (
  listing_table varchar(30) NOT NULL,
  listing_id uuid NOT NULL,
  source_name varchar(50) NOT NULL,
  survivor_listing_id uuid,
  identity_id uuid NOT NULL REFERENCES source_listing_identities(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  details_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_table, listing_id),
  CONSTRAINT source_identity_reconciliations_table_check CHECK (listing_table IN ('canonical_listings', 'listings'))
);
CREATE INDEX source_identity_reconciliations_identity_idx ON source_identity_reconciliations(identity_id);
--> statement-breakpoint
-- Cutover fences legacy Funda generation zero. No acquisition timestamp is fabricated.
INSERT INTO ingest_writer_generations(source_name, generation, last_sequence) VALUES ('funda', 1, 0);
--> statement-breakpoint
-- Durable retirement prevents queued legacy batches from crossing the writer cutover.
-- Fresh installs run all migrations in one transaction, including the historical
-- enum extension. Delay resolving that new enum value unless legacy rows exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ingest_batches WHERE source_name = 'funda'
      AND status::text IN ('accepted', 'queued', 'retryable', 'processing')) THEN
    UPDATE ingest_batches SET status = 'superseded',
      error_json = COALESCE(error_json, '{}'::jsonb) || '{"retirementReason":"funda_v2_writer_cutover","retiredGeneration":0}'::jsonb
    WHERE source_name = 'funda' AND status::text IN ('accepted', 'queued', 'retryable', 'processing');
  END IF;
END $$;
UPDATE ingest_sources SET last_committed_cursor = NULL, last_committed_changed_at = NULL,
  last_committed_listing_key = NULL, last_batch_id = NULL WHERE source_name = 'funda';
--> statement-breakpoint
-- A reused URL is not proof that a newly identified listing is the old listing.
DROP INDEX canonical_listings_source_url_idx;
CREATE UNIQUE INDEX canonical_listings_source_url_idx ON canonical_listings(source_name, canonical_url)
  WHERE canonical_url IS NOT NULL AND primary_source_listing_id IS NULL;
CREATE INDEX canonical_listings_source_url_lookup_idx ON canonical_listings(source_name, canonical_url);

--> statement-breakpoint
ALTER TABLE canonical_listings ADD COLUMN price_period varchar(10), ADD COLUMN price_unit varchar(10), ADD COLUMN price_condition varchar(20);
--> statement-breakpoint
ALTER TABLE canonical_listings ADD CONSTRAINT canonical_listings_price_period_check CHECK (price_period IS NULL OR price_period IN ('month','week','day','year','total','unknown')),
ADD CONSTRAINT canonical_listings_price_unit_check CHECK (price_unit IS NULL OR price_unit IN ('listing','m2','unknown')),
ADD CONSTRAINT canonical_listings_price_condition_check CHECK (price_condition IS NULL OR price_condition IN ('asking','on_request','auction','unknown'));

CREATE TABLE ingest_retired_sequences (
  source_name varchar(50) NOT NULL,
  generation bigint NOT NULL,
  retired_sequence bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_name, generation),
  CONSTRAINT ingest_retired_sequences_nonnegative CHECK (generation >= 0 AND retired_sequence >= 0)
);
--> statement-breakpoint
CREATE TABLE source_identity_business_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(50) NOT NULL,
  identity_id uuid NOT NULL,
  field_path varchar(100) NOT NULL,
  value_json jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  sample_key varchar(64) NOT NULL,
  collector varchar(50) NOT NULL,
  evidence_strength varchar(20) NOT NULL,
  evidence_kind varchar(20) NOT NULL,
  provenance_json jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  confirmations_compacted boolean NOT NULL DEFAULT false,
  CONSTRAINT source_identity_business_history_identity_fk FOREIGN KEY (identity_id, source_name)
    REFERENCES source_listing_identities(id, source_name) ON DELETE RESTRICT,
  CONSTRAINT source_identity_business_history_strength_check CHECK (evidence_strength IN ('inventory', 'detail')),
  CONSTRAINT source_identity_business_history_collector_check CHECK (collector IN ('direct', 'realtyapi')),
  CONSTRAINT source_identity_business_history_kind_check CHECK (evidence_kind IN ('facts', 'sighting'))
);
CREATE UNIQUE INDEX source_identity_business_history_sample_idx
  ON source_identity_business_history(identity_id, field_path, sample_key);
CREATE INDEX source_identity_business_history_observed_idx
  ON source_identity_business_history(identity_id, field_path, observed_at, sample_key);
CREATE INDEX source_identity_business_history_recorded_idx
  ON source_identity_business_history(source_name, recorded_at, id);
--> statement-breakpoint
-- Existing v1 audit rows remain unchanged. Existing v2 data is backfilled by the
-- bounded service from its real normalized envelope and retained event ledger.
-- A timestamp alone is never sufficient proof of business-history extraction.
ALTER TABLE ingest_batches
  ADD COLUMN writer_generation bigint,
  ADD COLUMN first_sequence bigint,
  ADD COLUMN last_sequence bigint,
  ADD COLUMN payload_hash varchar(64),
  ADD COLUMN business_history_completed_at timestamptz,
  ADD COLUMN payload_compacted_at timestamptz;
CREATE INDEX ingest_batches_retention_idx
  ON ingest_batches(source_name, writer_generation, first_sequence, last_sequence)
  WHERE writer_generation IS NOT NULL AND payload_compacted_at IS NULL;
CREATE INDEX ingest_batches_compacted_range_idx
  ON ingest_batches(source_name, writer_generation, last_sequence, first_sequence)
  WHERE payload_compacted_at IS NOT NULL;
CREATE INDEX ingest_batches_legacy_v2_metadata_idx
  ON ingest_batches(source_name)
  WHERE writer_generation IS NULL AND payload_compacted_at IS NULL AND payload_json->>'ingestVersion' = '2';

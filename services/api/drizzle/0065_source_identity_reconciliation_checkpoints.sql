CREATE TABLE source_identity_reconciliation_checkpoints (
  source_name varchar(50) NOT NULL,
  reconciliation_version varchar(100) NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  report_json jsonb NOT NULL,
  CONSTRAINT source_identity_reconciliation_checkpoints_pkey
    PRIMARY KEY (source_name, reconciliation_version),
  CONSTRAINT source_identity_reconciliation_checkpoint_keys
    CHECK (btrim(source_name) <> '' AND btrim(reconciliation_version) <> ''),
  CONSTRAINT source_identity_reconciliation_checkpoint_report
    CHECK (jsonb_typeof(report_json) = 'object' AND octet_length(report_json::text) <= 4096)
);

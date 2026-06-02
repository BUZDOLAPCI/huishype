CREATE INDEX IF NOT EXISTS "ingest_batches_source_completed_cursor_bound_order_idx"
  ON "ingest_batches" USING btree (
    "source_name",
    "received_at",
    "batch_sequence",
    "id"
  )
  WHERE status = 'completed'
    AND cursor_start IS NOT NULL
    AND NOT (payload_json ? 'requestedBy')
    AND COALESCE(payload_json->>'scopeKey', '') <> 'candidate';

# Funda ingest version 2

The source service posts authenticated batches to `POST /api/ingest/listings` with
`x-api-key`. The executable contract is
`services/api/src/services/ingest/v2-contracts.ts`, composed into
`ingestBatchRequestSchema` in `contracts.ts`.

The envelope carries `ingestVersion: 2`, `sourceName: "funda"`, a monotonic
`writerGeneration`, an immutable `idempotencyKey`, `batchSequence`, opaque
`cursorStart`/`cursorEnd`, and `records`. Each record has a stable `eventId`, a
contiguous generation-scoped `sequence` starting at one, its actual `observedAt`,
`collector` (`direct` or `realtyapi`), `evidenceStrength` (`inventory` or `detail`),
and typed source identity and aliases. Delivery is ordered: send the next batch
only after the previous batch is completed.

HTTP 202 acknowledges durable receipt. Poll `GET /api/ingest/batches/:id` using the
same API key until `status` is `completed`. Failed or superseded batches require
operator attention. `GET /api/ingest/watermark?source=funda` reports the committed
cursor plus `writerGeneration` and `lastSequence`. Cursor encoding remains
base64url JSON `{changedAt,listingKey}`; the source uses a stable generation epoch
and a 20-digit zero-padded sequence key. Migration 0060 retires legacy generation
zero and resets its cursor before activating generation one.

`facts` contains only present fields. Omission retains previous knowledge; JSON
null explicitly clears an optional fact. Address components merge independently.
A newer observation wins over an older observation; equal-time detail evidence
wins over inventory, followed by a deterministic event ID tie-break. Lifecycle
ordering separately gives equal-time terminal evidence precedence. Asking prices
are whole currency units, with explicit `pricePeriod`, `priceUnit`, and
`priceCondition`; neither arrival time nor missing period implies monthly rent.

`sighting` supplies available/conditional confirmation without creating changed
facts, price history or unread activity. `absence` records a completed verified
inventory manifest and never implies sold, rented, withdrawn or positive
availability. Positive records may retain `inventoryManifestId` for unfinished or
failed inventories; this identifier carries no completeness claim. Absence
requires the full verified completed manifest, with observation time at completion
or within five minutes. All evidence clocks are bounded to five minutes ahead of
the receiver clock.

Records may carry optional UUID `sourceCandidateId` and `previewResultId` to
complete durable user handoffs, including unchanged sightings and terminal facts.
These IDs correlate delivery; they do not prove identity or property ownership.
Attaching a provisional listing requires the exact unambiguous source address and
an observed source URL matching the handoff. A contradictory user hint is audited
and rejected without quarantining a separately proven listing. User preview or
submission time never supplies positive availability evidence.

Source identities and all evidence survive incomplete or unmatched addresses.
Projection requires exactly one complete address match; coordinates alone never
link a property. Contradictory address/alias/property evidence is quarantined with
an audit record, preserving factual status and history. Reused URLs do not merge
distinct identified listings. The operator reconciliation command is:

```
pnpm --filter @huishype/api exec tsx src/scripts/reconcile-source-identities.ts --source funda
```

Add `--execute` to apply the audited plan. Dry run and execution report before and
after row, duplicate and quarantine counts, graph profiling counts, and bounded
conflict samples. The command opens its own PostgreSQL connection and requires
only `DATABASE_URL`; it does not initialize API configuration or Redis.

After database migrations, API and worker startup must pass this gate:

```
pnpm --filter @huishype/api exec tsx src/scripts/reconcile-source-identities.ts --source funda --execute --once
```

The built runtime equivalent is `node dist/scripts/reconcile-source-identities.js
--source funda --execute --once` from the API package directory. `--once` requires
`--execute`. Migration 0065 provides the durable
`source_identity_reconciliation_checkpoints` table keyed by source and algorithm
version. Version `source-identities-v1` is checked under the same source advisory
transaction lock used by ingestion. Reconciliation and its completion checkpoint
commit together; a failed run exits nonzero and leaves neither partial changes
nor a checkpoint. Concurrent startup attempts serialize, and later attempts for
the same version skip graph preparation entirely. An explicit manual `--execute`
reruns reconciliation and refreshes the checkpoint.

Startup prints bounded JSON with `sourceName`, `reconciliationVersion`, `status`
(`completed` or `already_completed`), `completedAt`, and aggregate `report` counts.
The report includes graph parent bytes, edge batch limit, edges read, maximum
component rows, graph preparation and total reconciliation milliseconds, and
counts of fresh components and legacy rows processed in bulk; no conflict examples or
listing payloads are stored in the checkpoint. Dry runs return `dry_run` and do
not create a checkpoint. Bump the algorithm version only when existing sources
must be reconciled again.

Reconciliation reduces observation history to distinct identity metadata inside
PostgreSQL. Graph union keeps four bytes per listing row in Node, reads numeric
edges and component metadata in pages of 5,000 rows, and retains only the current
component plus its page. PostgreSQL sorts can spill according to its configured
`work_mem`; history payloads never enter the application heap. Full before rows
and observation, price and handoff references are recorded server-side for rows
being reconciled. Their audit envelope marks `snapshotFormat: "postgres_row_v1"`
because these snapshots use database column names.

Fresh components with at most one canonical listing can be created in bulk only
when property and stable identity evidence agree, none of their aliases is shared
with another component, and no identity, alias owner or prior reconciliation
already exists. Bulk creation preserves full legacy audit rows and changes no
canonical facts or history. Every other component uses the same conflict checks
and audited reference moves as the individual resolver. Both paths run under the
source advisory lock shared with live ingestion.

Writer generation rotation is
an operator transaction through `activateIngestWriterGeneration`; generation
numbers never decrease.

Pararius retains permanent v1 support through the contract normalizer. Its mirror
export completions are marked as unverified remote coverage and never generate
absence or withdrawal. The known residential v1 exporter reports whole-listing
sale amounts or monthly rent; only that explicit exporter contract supplies its
price-unit normalization.

Funda initialization also uses the source's ordered export authority. Configure
`FUNDA_SOURCE_SERVICE_URL`, `FUNDA_SOURCE_SERVICE_API_KEY`, and the intended app API
with `HUISHYPE_SEED_APP_API_URL` or `--app-api-url`, then run:

```
pnpm --filter @huishype/api db:seed-listings -- --source funda --app-api-url http://localhost:3100 --dry-run
pnpm --filter @huishype/api db:seed-listings -- --source funda --app-api-url http://localhost:3100
```

The CLI verifies the source exporter targets that exact app environment before
submitting a durable replay of all retained source evidence. It prints the request
ID and status URL; `--request-id UUID` resumes idempotently, and `--wait-ms 60000`
waits for acknowledged delivery. Original observation and field evidence times
remain intact. Funda initialization never allocates local source sequences or
uses the retired v1 mirror path. Pararius keeps the existing v1 mirror replay and
scoped repair options under `--source pararius`.

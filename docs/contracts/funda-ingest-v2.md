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
after row, duplicate, alias and quarantine counts. Writer generation rotation is
an operator transaction through `activateIngestWriterGeneration`; generation
numbers never decrease.

Pararius retains permanent v1 support through the contract normalizer. Its mirror
export completions are marked as unverified remote coverage and never generate
absence or withdrawal. The known residential v1 exporter reports whole-listing
sale amounts or monthly rent; only that explicit exporter contract supplies its
price-unit normalization.

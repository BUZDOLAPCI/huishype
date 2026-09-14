# App evidence retention and delivery proof

Migration 0066 separates real listing history from repeated transport evidence.
The app retains full v2 batch bodies and exact event payloads for at least seven
days. Batch-body eligibility uses the actual completion time; raw event deletion
also requires seven days since the event's receipt (`created_at`), not its source
observation time. It permanently retains compact batch receipts, source identity
heads, typed aliases, actual business samples, and the existing canonical, price,
observation, candidate and reconciliation audit records. V1 records are unchanged.

## Delivery contract

A compact receipt remains the original `ingest_batches` row: its ID,
idempotency key, normalized payload SHA-256, source, writer generation, sequence
bounds, original cursors, timestamps, outcomes, error and references survive.
Only its full payload becomes a small version/generation marker, preserving any
optional `batchKind` and `scopeKey` needed by existing run finalization. Existing
business-history foreign keys keep their original targets. Receipt polling reads
only response columns, without fetching a full payload.

An exact known POST retry returns the original receipt even after seven days or
writer-generation rotation. JSON object order and omitted contract defaults do
not change its hash. Reusing that key with different evidence still conflicts.
GET returns the original completion time and counts; compaction never invents
an acknowledgement, processing result or latency from a cursor watermark.

A source/generation retirement frontier advances atomically with deletion of a
contiguous raw event prefix. A new, unknown batch whose range starts at or below
that frontier receives HTTP 409 `EVIDENCE_RETIRED`, including mixed old/new
ranges. It creates no batch, run, event or identity state. Exact known receipts
are checked before that guard and before the active writer fence. Recent event
UUID/content conflicts remain exact; arbitrary old event UUID reuse at a new
sequence is not claimed detectable forever after the raw event has retired.
The source's work leases and server-owned replay operation instances control
new sequence allocation. Historical replay uses fresh transport identity and
actual original observation clocks.

The replay CLI requires the server's `operationInstanceId` and `createdAt`.
It pins the instance returned by the actual execute POST and rejects a different
instance on any subsequent GET. A dry-run instance may be ephemeral, and reuse
of an expired caller request UUID can legitimately create a new operation; the
CLI reports that actual instance rather than attributing it to the expired run.

## Business history

Every meaningful v2 facts field is recorded by stable source identity before
address matching or projection. Incomplete addresses, quarantined associations,
late prices, explicit nulls and sparse patches therefore survive even when no
canonical property can yet be linked. Positive sightings provide actual source
status confirmations. Inventory absence does not become permanent business
history or a withdrawal fact.

The identity history stores per-field actual samples with source time,
collector, strength and original event/sequence provenance. Logical sample
identity excludes delivery UUID, generation and sequence, so controlled replay
of the same observation does not duplicate the business sample. Existing
canonical and price histories are never rewritten by this reduction.

Equal-value confirmation runs retain actual first and last samples. While raw
evidence remains, their business endpoints are provisional: a late differing
sample restores the real adjacent raw confirmations before reducing the run.
After the seven-day raw window closes, the retained endpoints and any later
supplied historical samples remain truthful samples, not a claim of continuous
value validity or a reconstruction of discarded confirmations. For example,
500 at Jan 1 and Jan 3 plus a late 600 at Jan 2 retains those actual samples;
it never invents a restoration at Jan 2.5. Equal-time contradictory values
remain separately recorded. Current per-field clocks, freshness and terminal
barriers continue to use the original actual observations.

## Bounded maintenance

The worker checks every 30 seconds. Each transaction uses the same source
advisory lock as ingestion and yields immediately when that source is busy.
It compacts at most 100 history-ready receipt bodies and backfills at most one
older receipt's business history per source/generation pass. A separate bounded
raw-prefix operation deletes at most 100,000 events. Source selection rotates;
a blocked generation cannot permanently hide later sources.

A recent, unfinished, failed, superseded, maintenance-pending, candidate-pending
or metadata-incomplete receipt pins its raw interval. Overlapping receipts are
handled in two phases so even a component larger than the body limit can make
progress without dropping proof. Every sequence in the retiring prefix must
exist and be covered by completed compact receipts. Missing evidence rolls the
transaction back. Original v1 terminal failures are retained, including the
three historical Funda batches; the nine records without proven later coverage
remain an explicit source-planner verification task, not imported truth.

Partial indexes cover raw receipts, compact receipt ranges and older v2 rows
that need metadata backfill. The ordinary sweep does not scan the permanent
receipt archive or full v1 payloads. PostgreSQL vacuum and disk monitoring remain
necessary: replacing/deleting rows creates WAL and dead tuples before space is
reused; the measurements below do not treat live row counts as physical peak
usage.

## Measured capacity

Measurements use isolated local PostgreSQL tables with the real app schema and
all indexes, followed by `VACUUM ANALYZE`. Source-shaped raw payload sizing reads
5,000 identities from a local restored snapshot without changing the source.
Only sanitized aggregates are retained in `app-evidence-retention-capacity.json`.
No production or provider requests are part of these measurements.

The snapshot has 299,977 identities and 122,211 positives. The routine sizing
model combines a 20-hour refresh with modeled boundary-query overhead using a
500-result-leaf scenario, yielding 183,416.4 positive observations/day. This
overhead is not a measurement of national partition geometry. Each positive facts
result currently emits facts plus a sighting, so the model includes 366,832.8
events/day and 1,834.164 batches/day at
200 records/batch. A recovery stress case uses 213,206.4 observations/day; this
is a capacity stress scenario, not permission to exceed the provider budget.

| Storage | Routine sizing |
|---|---:|
| Unbounded full event and batch duplication | 193.38 GiB/year |
| Merely blanking JSON while keeping every event row | 59.25 GiB/year |
| Seven-day full event/batch working window | 3.71 GiB |
| Permanent compact receipts, final indexes included | 0.645 GiB/year |
| Current identity heads and typed aliases, 299,977 identities | 0.543 GiB |
| Business endpoints, 300,000 identities × 19 fields × 2 samples | 10.19 GiB |

The final 10,000-receipt cohort occupies 10,338,304 bytes including indexes,
about 1,034 bytes/receipt. This small durable delivery proof is retained rather
than expiring a lost acknowledgement. The seven-day raw working window is
4.31 GiB in the recovery stress model. These figures exclude genuine business
changes, existing historical data, WAL, dead tuples and operational headroom.

A 200-record, 19-field repeated-identity fixture retains 38 actual field samples
(16,790 live tuple bytes), rather than 3,800 cadence samples; it takes about
4.6 seconds including real raw-neighbor recovery and creates roughly 5.9 MB of
heap/index churn before vacuum. A 200-distinct-identity first-observation cohort
records 3,800 samples in 2.8 seconds. A larger committed cohort of 5,000
identities × 19 fields × two endpoints occupies 182,394,880 bytes after vacuum,
including all four indexes: 36,479 bytes/identity, or 10.19 GiB for 300,000. Two
tail-replacement and ordinary-vacuum cycles retain the same live sample count
but project 14.60 and 12.40 GiB of allocated storage. Budget for that physical
churn and WAL instead of equating live rows with disk consumption. Real
price, status and address changes remain durable business growth, so no fixed
history size or compression ratio is promised for an arbitrarily changing
market.

The measured production app database was 78.86 GiB, with about 148 GiB free after
removing a verified temporary backup archive. The old unbounded routine cadence
alone could consume that free space in about 279 days. A temporary isolated
restore is separate from product growth. The new policy bounds raw cadence and
keeps modest delivery proof without moving the scraper's debug history onto the
app host.

## Processor throughput and replay admission

A real PostgreSQL processor run used 1,000 synthetic identities, half linked to
exact properties and half unresolved, with distinct typed aliases. It ingested
5,000 records in 25 batches of 200, covering two historical field groups,
renewed full facts, unchanged full facts and unchanged sightings. It took
65.54 seconds and 91,650 driver SQL calls. The maximum batch was 3.644 seconds.
Both unchanged phases produced no projection changes and kept 38,000 business
samples and 1,500 compatibility observations unchanged.

The two historical groups took 26.167 seconds per 1,000 identities, extrapolating
to 2.18 hours for 300,000 identities. Same-state full facts took 15.031 seconds
per 1,000 records; sightings took 10.118 seconds. At the routine mix of 183,416.4
facts plus the same number of sightings per day, that is about 1.28 hours/day of
processor work. These are local synthetic extrapolations, not production service
level guarantees. The measurements include actual processor SQL and batch
savepoints inside an outer rollback, excluding durable commit/fsync, HTTP,
queue delay, source packing and background view/tile maintenance.

Source replay admission is separately bounded: pages contain at most 100
listings, and production pauses at 1,000 pending events, checking each listing's
actual event count before appending. Runtime byte/reserve limits also apply.
It does not allocate all 300,000 listings' sequences ahead of live acquisition.
The final composed gate must check those source limits and priority behavior;
a fast individual app batch alone does not prove end-to-end freshness.

The two measurement scripts in this directory reproduce the synthetic capacity
and processor cohorts on an explicitly opted-in local database ending in
`_test`, already migrated through 0066. Run them from the repository root with
`DATABASE_URL` set to that isolated database:

```bash
HISTORY_CAPACITY_MEASUREMENT=1 node docs/releases/2026-09-13-funda-hybrid/measure-app-history-capacity.mjs
NODE_ENV=test HISTORY_E2E_MEASUREMENT=1 HISTORY_REPO_ROOT="$PWD" pnpm --filter @huishype/api exec tsx ../../docs/releases/2026-09-13-funda-hybrid/measure-app-history-throughput.mjs
```

The second command pins `HISTORY_REPO_ROOT` because pnpm changes the child
working directory. The capacity script creates and
removes its own schema; the processor script rolls back every fixture. Both emit
only aggregate synthetic measurements and never call source providers.

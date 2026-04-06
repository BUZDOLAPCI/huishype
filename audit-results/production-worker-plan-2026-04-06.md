# Production Worker Plan — Durable Internal Ingest

Date: 2026-04-06

## 1. Decision

HuisHype should introduce a real internal worker service now.

The first production-critical scope should be:

1. Durable async ingest processing
2. Durable maintenance refresh work required by ingest
3. Upstream sync contract fixes in the scraper repos where required

Do not ship downstream stale-listing reconciliation yet under the current changed-only sync contract.

That work only becomes correct after the upstream scraper repos are updated to provide deterministic seen-state semantics such as:

- explicit tombstones / terminal status pushes
- full-seen manifests for a run
- or a true run snapshot contract keyed by seen-state rather than changed-state

The rest of the originally claimed worker scope should still be deferred for now:

- notifications
- scoring / FMV
- moderation

Those are valid future worker domains, but they are not the current production bottleneck. The current bottleneck is that mirror sync is already worker-driven upstream, while HuisHype still performs downstream ingest synchronously inside the API request path.

## 2. Codebase-Verified Current State

### 2.1 What exists today

- External scraper repos already own scrape, schedule, mirror storage, and sync submission into HuisHype.
  - [`/home/caslan/dev/git_repos/hh/huishype-funda-scraper/scraper/sync.py`](/home/caslan/dev/git_repos/hh/huishype-funda-scraper/scraper/sync.py)
  - [`/home/caslan/dev/git_repos/hh/huishype-pararius-scraper/scraper/sync.py`](/home/caslan/dev/git_repos/hh/huishype-pararius-scraper/scraper/sync.py)
- This repo already exposes internal ingest endpoints specifically for sync workers.
  - [`services/api/src/routes/listings.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/listings.ts)
- This repo already provisions Redis in production and development and has a stub worker workspace.
  - [`docker-compose.prod.yml`](/home/caslan/dev/git_repos/hh/huishype/docker-compose.prod.yml)
  - [`docker-compose.yml`](/home/caslan/dev/git_repos/hh/huishype/docker-compose.yml)
  - [`services/worker/package.json`](/home/caslan/dev/git_repos/hh/huishype/services/worker/package.json)
  - [`services/worker/src/index.ts`](/home/caslan/dev/git_repos/hh/huishype/services/worker/src/index.ts)

### 2.2 What the API ingest route does inline today

`POST /api/ingest/listings` currently does all of the following in-process inside the HTTP request:

- API-key auth
- address canonicalization
- exact property matching
- spatial fallback matching
- chunked listing upserts
- chunked price-history inserts
- fire-and-forget materialized-view refresh

Source:

- [`services/api/src/routes/listings.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/listings.ts)
- [`services/api/src/services/listings-view.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/listings-view.ts)

### 2.3 Why the current inline path is not production-grade

- The ingest request is not atomic. It performs separate chunked reads and writes with no end-to-end transaction boundary.
- `price_history` inserts are built from matched rows, not confirmed successful listing upserts.
- `price_history.listing_id` is not populated even though the schema supports it.
- Chunk failures are folded into a `200` response body instead of a durable job lifecycle.
- The watermark is derived from `MAX(listings.mirror_last_changed_at)`, which is not a durable checkpoint.
- The upstream cursor contract is timestamp-only and can skip rows sharing the same timestamp.
- `mv_latest_active_listings` refresh is fire-and-forget and process-local.
- Ingest coverage is thin: the integration tests only cover auth rejection, not real ingest correctness or recovery behavior.

Source:

- [`services/api/src/routes/listings.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/listings.ts)
- [`services/api/src/services/listings-view.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/listings-view.ts)
- [`services/api/src/__tests__/integration/listings.integration.test.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/__tests__/integration/listings.integration.test.ts)
- [`services/api/src/db/schema.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts)

### 2.4 Why cleanup is not safe to implement downstream yet

The schema already stores `mirror_last_seen_at` and has an active-only index for it.

However, the current upstream sync contract is changed-only, not seen-state complete:

- the scrapers page on `last_changed_at > watermark`
- they do not submit every listing seen during a run
- they update upstream `last_seen_at` even when nothing changed

That means a downstream rule like "not seen in the completed run => withdrawn" would incorrectly withdraw unchanged active listings.

Source:

- [`services/api/src/db/schema.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts)
- [`/home/caslan/dev/git_repos/hh/huishype-funda-scraper/scraper/sync.py`](/home/caslan/dev/git_repos/hh/huishype-funda-scraper/scraper/sync.py)
- [`/home/caslan/dev/git_repos/hh/huishype-pararius-scraper/scraper/sync.py`](/home/caslan/dev/git_repos/hh/huishype-pararius-scraper/scraper/sync.py)

## 3. Target Production Architecture

### 3.1 High-level shape

Keep the external scraper repos as upstream systems.

Their responsibility remains:

- crawl source sites
- maintain mirror state
- detect source changes
- submit batches into HuisHype

Move downstream ingest responsibility inside HuisHype onto a real internal worker service backed by Redis + BullMQ.

The API should stop doing heavy ingest work inline. It should become:

1. auth + schema validation
2. durable batch persistence into Postgres
3. best-effort queue enqueue into Redis
4. `202 Accepted` job response

The worker should become:

1. durable batch processor
2. durable checkpoint owner
3. maintenance refresh executor
4. recovery executor for accepted-but-not-enqueued or retryable work

### 3.2 Queue and persistence choice

Use:

- `BullMQ`
- `ioredis`
- existing Redis service
- Postgres as the source of truth for business state and ingest audit state

Do not use Postgres as the primary queue.

Reason:

- Redis is already provisioned in dev and prod.
- [`agent-rules/software-stack.md`](/home/caslan/dev/git_repos/hh/huishype/agent-rules/software-stack.md) already locks Redis and queue-based workers into the architecture.
- Postgres is already the hot geospatial OLTP store and should not also carry queue locking and scheduling load.

Important constraint:

- Postgres must remain the authoritative ingest ledger.
- Redis is execution transport, not the durable source of accepted work.
- The design must include an outbox/recovery path so DB success + enqueue failure cannot strand accepted batches.

## 4. Needed Worker Scope Now

There should be one `services/worker` deployable service.

### 4.1 Worker A: Ingest Processor

This is the most critical worker and should land first.

Objective:

- take a persisted ingest batch
- process it transactionally
- update durable progress
- never let HTTP request lifetime define ingest correctness

Responsibilities:

- load one persisted ingest batch
- canonicalize addresses
- perform exact and spatial matching
- upsert listings
- insert price history only for successful listing writes
- populate `price_history.listing_id` when the listing write succeeds
- record per-batch counters and errors
- advance the durable source checkpoint only after successful contiguous progress
- enqueue downstream maintenance work

Must own:

- batch transaction boundary
- checkpoint advancement
- idempotent retry behavior

Should not own:

- scraping
- mirror crawling
- source scheduling logic inside external scraper repos

### 4.2 Worker B: Maintenance Refresh

This should exist immediately, but as a low-priority queue within the same worker service rather than as a separate product domain.

Objective:

- move refresh work out of API fire-and-forget hooks

Responsibilities:

- refresh `mv_latest_active_listings` after successful ingest batches
- coalesce duplicate refresh requests
- retry refresh work independently from ingest

This is not a standalone product worker. It is a dependency of ingest correctness.

### 4.3 Worker C: Recovery / Dispatch Sweep

This should exist immediately as internal worker infrastructure.

Objective:

- ensure accepted work cannot be lost between Postgres persistence and Redis execution

Responsibilities:

- find persisted batches still in `pending` / `accepted` / `retryable` state
- enqueue or re-enqueue them safely
- make worker restarts and transient Redis failures recoverable

This is not a separate product domain. It is part of the reliability model.

## 5. Work To Defer

Defer these until a concrete product feature requires them:

- downstream stale-listing reconciliation in this repo
- notification dispatch workers
- scoring / FMV workers
- moderation workers

Reason:

- none of these fix the current ingest reliability gap by themselves
- downstream reconciliation is not correct until upstream contract changes are made
- all of them add operational surface area without addressing the main failure mode in the repo today

## 6. Data Model And Contract Changes

### 6.1 New database tables

Add durable ingest state tables in [`services/api/src/db/schema.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts):

### `ingest_sources`

One row per source, for example `funda`, `pararius`.

Fields:

- `source_name`
- `last_committed_cursor`
- `last_committed_changed_at`
- `last_committed_listing_key`
- `last_batch_id`
- `last_run_started_at`
- `last_run_completed_at`
- `last_run_status`

Purpose:

- this replaces `MAX(listings.mirror_last_changed_at)` as the system checkpoint
- `last_committed_cursor` is the authoritative resume token
- `last_committed_changed_at` is informational only and must not be the sole resume key

### `ingest_runs`

One row per upstream sync run when the upstream contract explicitly provides a run identity.

Fields:

- `id`
- `source_name`
- `upstream_cursor_start`
- `upstream_cursor_end`
- `started_at`
- `completed_at`
- `status`
- `processed_batch_count`
- `error_summary`

Purpose:

- audit and diagnostics
- optional future reconciliation support once upstream seen-state semantics exist

Important note:

- `expected_batch_count` should not be required because the current upstream syncs stream until exhaustion and do not know total batch count up front.

### `ingest_batches`

One row per submitted batch.

Fields:

- `id`
- `run_id` nullable
- `source_name`
- `batch_sequence`
- `idempotency_key`
- `cursor_start`
- `cursor_end`
- `payload_json`
- `status`
- `attempt_count`
- `received_at`
- `started_at`
- `completed_at`
- `ingested_count`
- `updated_count`
- `skipped_count`
- `error_json`
- `last_error_at`

Purpose:

- durable job input and auditable processing record
- recoverable dispatch source for BullMQ enqueue
- idempotency boundary for upstream submissions

### 6.2 Cursor and checkpoint contract

The new checkpoint must not be timestamp-only.

Use a stable opaque cursor, implemented from a deterministic ordering at minimum equivalent to:

- `mirror_last_changed_at`
- `mirror_listing_id` or other stable source-local unique key

Requirements:

- ordering must be stable
- pagination must be deterministic
- checkpoint advancement must be contiguous and run-safe
- a later successful batch must not allow the checkpoint to leap over an earlier uncommitted gap

### 6.3 Ingest payload contract fixes

Do not workerize the current payload unchanged.

The ingest payload should be expanded so exact matching can respect the actual property uniqueness model. Add at minimum:

- `countryCode`
- `street`
- existing postal code / house number / addition fields

Reason:

- the current API payload does not include `street` or `countryCode`
- current canonicalization defaults to `NL`
- current exact match ignores street and country even though the real uniqueness model includes both

This is a root-cause bug and should be fixed as part of the ingest redesign, not deferred.

### 6.4 API changes

Keep the ingest boundary in the API, but change the semantics.

### `POST /api/ingest/listings`

Change from:

- process immediately
- return `200 { ingested, updated, skipped, errors }`

Change to:

- validate request
- persist batch durably in Postgres
- attempt queue enqueue
- return `202 { batchId, runId?, acceptedAt }`

Important note:

- enqueue failure after persistence must not lose the batch
- the recovery sweep must be able to pick it up later

### `GET /api/ingest/watermark`

Change from:

- read `MAX(listings.mirror_last_changed_at)`

Change to:

- read `ingest_sources.last_committed_cursor`

The response may also include `lastCommittedChangedAt` for diagnostics, but the cursor is the authoritative resume token.

### Future finalize endpoint

Do not add a finalize endpoint yet unless the scraper repos are updated to provide deterministic seen-state semantics.

If the source repos are later updated to emit full-seen manifests or explicit tombstones, then add a run-finalization API such as:

- `POST /api/ingest/runs/:runId/complete`

But that endpoint is not correct under the current changed-only upstream contract.

## 7. Processing Model

### 7.1 Ingest flow

1. External scraper sync worker obtains the current opaque cursor from HuisHype.
2. It pages its source mirror using stable ordering compatible with that cursor.
3. It submits one or more batches to `POST /api/ingest/listings`.
4. API persists each batch durably.
5. API enqueues the batch, or leaves it recoverable for the dispatch sweep if enqueue fails.
6. Ingest worker processes one batch at a time per source partition.
7. Worker writes listing + price-history changes inside a transaction.
8. Worker updates batch status and source progress only after successful contiguous commit.
9. Maintenance queue refreshes `mv_latest_active_listings`.

### 7.2 Transaction boundary

The first production-safe transaction boundary should be:

- one source
- one batch
- listing upserts
- related price-history writes
- batch status update
- checkpoint advancement for that batch if and only if advancement is contiguous

If any part fails, the batch stays retryable and the checkpoint does not advance.

### 7.3 Idempotency

Idempotency should rely on:

- durable batch state in Postgres
- a source-provided or API-derived `idempotency_key`
- existing uniqueness constraints on `listings` and `price_history`

Important note:

- uniqueness constraints help, but they are not a substitute for batch-level idempotency

## 8. Required Cross-Repo Changes

The scraper repos are local forks and should be updated when needed as part of this rollout.

Source repos:

- [`/home/caslan/dev/git_repos/hh/huishype-funda-scraper`](/home/caslan/dev/git_repos/hh/huishype-funda-scraper)
- [`/home/caslan/dev/git_repos/hh/huishype-pararius-scraper`](/home/caslan/dev/git_repos/hh/huishype-pararius-scraper)

Required scraper-side updates for the worker rollout:

- switch from timestamp-only watermarking to the new opaque cursor contract
- preserve deterministic ordering compatible with the cursor
- send the expanded address identity fields required for exact matching
- handle `202 Accepted` ingest semantics instead of synchronous `200` counters
- send stable batch identity / idempotency metadata

Future scraper-side updates if reconciliation is later introduced:

- explicit tombstone/status events
- or full-seen manifests / run snapshots with deterministic completion semantics

## 9. Exact File And Package Scope

The first implementation pass will primarily affect:

- [`services/worker/package.json`](/home/caslan/dev/git_repos/hh/huishype/services/worker/package.json)
- [`services/worker/src/index.ts`](/home/caslan/dev/git_repos/hh/huishype/services/worker/src/index.ts)
- [`services/api/src/routes/listings.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/listings.ts)
- [`services/api/src/db/schema.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/db/schema.ts)
- [`services/api/src/services/listings-view.ts`](/home/caslan/dev/git_repos/hh/huishype/services/api/src/services/listings-view.ts)
- [`services/api/package.json`](/home/caslan/dev/git_repos/hh/huishype/services/api/package.json)
- [`packages/api-client/package.json`](/home/caslan/dev/git_repos/hh/huishype/packages/api-client/package.json)
- [`docker-compose.prod.yml`](/home/caslan/dev/git_repos/hh/huishype/docker-compose.prod.yml)

Potentially affected depending on implementation choices:

- [`docker-compose.yml`](/home/caslan/dev/git_repos/hh/huishype/docker-compose.yml) if local app-service composition is desired
- worker Dockerfile and startup wiring
- OpenAPI export and generated client artifacts

Likely new modules:

- `services/worker/src/queues/*`
- `services/worker/src/processors/*`
- `services/worker/src/lib/redis.ts`
- `services/worker/src/lib/health.ts`
- `services/api/src/services/ingest/*`
- `services/api/src/lib/redis.ts`

## 10. Rollout Plan

### Phase 1: Real worker foundation

- add BullMQ + Redis wiring
- turn `services/worker` into a real executable service
- add worker health logging and graceful shutdown
- add worker deployment in prod compose
- add local worker run path for development; only add it to `docker-compose.yml` if we explicitly want app services there

### Phase 2: Durable ingest ledger

- add `ingest_sources`, `ingest_runs`, `ingest_batches`
- implement persisted accepted-work states and recovery semantics
- change ingest API to persist-and-accept
- return `202` instead of inline counters

### Phase 3: Cursor and contract correction

- replace timestamp-only watermarking with an opaque stable cursor
- update scraper repos to use the new cursor contract
- update the ingest payload to include country-aware exact-match fields

### Phase 4: Batch processor

- extract current inline ingest logic from route code into shared service modules
- process each batch transactionally in the worker
- populate `price_history.listing_id` on successful writes
- update counters and checkpoint only after contiguous commit
- move MV refresh trigger to maintenance queue

### Phase 5: Hardening

- add source-level concurrency limits
- add dead-letter handling
- add structured ingest metrics
- add operator-visible job status and failure diagnostics
- add recovery sweep / re-dispatch monitoring

### Phase 6: Optional reconciliation, only after upstream contract change

- update scraper repos to emit deterministic seen-state semantics
- only then add run-finalization and stale-listing reconciliation in this repo
- only then add withdrawal-by-run behavior

## 11. Verification Plan

The current test surface is not enough. The worker rollout is not complete until the following tests exist and pass.

### API integration

- batch acceptance returns `202`
- invalid API key is rejected
- persisted batch is recoverably accepted even if enqueue fails
- watermark returns durable committed cursor, not destination-table max
- expanded ingest payload validates correctly

### Worker integration

- successful batch processes listings and price history in one transaction
- `price_history` rows are created only for successful listing writes
- `price_history.listing_id` is populated when appropriate
- failed batch does not advance checkpoint
- retried batch remains idempotent
- checkpoint advancement is contiguous and does not leap over gaps
- maintenance refresh is queued after successful ingest
- pending accepted batches are re-enqueued by the recovery sweep

### Contract integration

- scraper repos can resume from the new cursor without skipping same-timestamp rows
- scraper repos can submit batches using the new `202` contract
- OpenAPI export and generated client stay in sync

### Regression coverage

- feed still reads from `mv_latest_active_listings`
- active-only property/feed/map surfaces still use `status = 'active'`
- `/properties/:id/listings` still returns all listing statuses as intended
- map/tile/property behavior does not regress

### Future reconciliation tests

Only add these after the upstream contract is changed to seen-state complete:

- listings omitted from a completed seen-state run are marked `withdrawn`
- listings explicitly seen remain `active`
- withdrawn rows disappear from active feed/property/map queries

Suggested commands once implemented:

```bash
pnpm openapi:export
pnpm api-client:generate
pnpm --filter @huishype/api typecheck
pnpm --filter @huishype/worker typecheck
pnpm --filter @huishype/api test:integration
pnpm --filter @huishype/worker test
pnpm -C apps/app typecheck
pnpm -C apps/app test
pnpm lint
```

If user-visible listing lifecycle behavior changes, also run the impacted E2E suites required by repo policy.

## 12. Final Recommendation

Implement the internal worker now, but keep its initial scope narrow and production-critical:

1. durable async ingest processing
2. maintenance refresh work needed by ingest
3. cursor and ingest-contract fixes in this repo and the local scraper forks

Do not implement downstream stale-listing reconciliation yet unless the scraper repos are updated first to provide correct seen-state semantics.

That is the optimal production-grade path for this repo because:

- upstream scraping already has workers
- downstream ingest inside HuisHype is the current weak point
- the current checkpoint contract is lossy and should be corrected now
- the current ingest matcher contract is incomplete and should be corrected now
- notifications, scoring, and moderation do not solve the repo’s current reliability gap
- downstream-only cleanup under the current contract would be a workaround, not a root-cause fix

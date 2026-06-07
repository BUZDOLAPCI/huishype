# Property Tile Pipeline Hardening Plan

Date: 2026-05-01

## Context

Aggressive zoom-out currently causes expensive property tile generation to continue after the user zooms back in. The backend then keeps spending API and Postgres capacity on obsolete low-zoom work, so later lighter tile requests can queue behind stale work.

Evidence from local investigation:

- Public property tile route has an in-memory 300s route cache, ETag handling, same-key pending build coalescing, and expired-entry deletion. It has no stale retention and no abort-aware waiter/build cancellation.
- Read and following property overlay routes call tile builders directly. They are private/no-store and currently have no route-layer cache, coalescing, scheduling, or runtime budget.
- Logs showed z8-z14 property tile builds taking 28-85 seconds, followed by `premature close` errors, which means the client disconnected before the server finished.
- `services/api/src/services/property-grouping.ts` already has a lower-level canonical group cache/coalescer. Route-layer work must cooperate with that cache rather than replacing it.
- Current public default dynamic builds use the lower-level canonical coalescer, but read overlay builds call the unhydrated canonical builder path directly on cache miss. The implementation must either route read overlays through a shared unhydrated canonical coalescer or add an equivalent lower-level coalescer before relying on canonical reuse for read overlays.
- Candidate fetches already use Drizzle transactions and `SET LOCAL jit = off`, so tile-specific local statement budgets are feasible there. Other heavy SQL calls are not all transaction-wrapped today: read precheck, single-property hydration, read filtering, and final `ST_AsMVT`. JS grouping/serialization is not bounded by Postgres timeouts and needs its own runtime budget checks.
- Worker maintenance currently hardcodes listing maintenance in `services/worker/src/runtime.ts`. Adding job constants alone is insufficient, and snapshot refresh must not be placed inside the `refreshLatestListingsMaintenance` critical path.
- Current queue singleton behavior only covers worker-sweep jobs without a `batchId`, and completed jobs retain only the last 10 entries. Durable snapshot coalescing needs a worker job id plus a database/advisory-lock coordination mechanism.
- Running SQL is not guaranteed to be cancellable from Node once it has reached Postgres. Runtime cancellation must therefore prevent duplicate same-key work and keep database-slot accounting honest until the underlying SQL promise settles or the server-side statement timeout fires.
- Public default tiles include listing state and social signals such as property views, comments, reactions, and price guesses. Snapshot refresh cannot be driven by listing maintenance alone.
- Public default tile social scoring uses rolling time windows relative to `now()`. Even with no writes, low-zoom default snapshots need an age-based refresh policy so stale social scores eventually decay.
- Public tile generation reads canonical listing facts directly. Successful latest-listings maintenance is not an authoritative freshness watermark for public tile contents; snapshot freshness must track the canonical listing/property writes that feed tile SQL.
- Comment likes/reactions affect public comment/social scoring and are a separate write surface from comment creation/deletion. They must be included in invalidation and watermark handling rather than assuming `property_change_state` covers them.

Relevant files:

- `services/api/src/routes/tiles.ts`
- `services/api/src/services/property-grouping.ts`
- `services/api/src/services/property-read-state.ts`
- `services/api/src/db/index.ts`
- `services/api/src/db/schema.ts`
- `services/worker/src/runtime.ts`
- `services/api/src/services/ingest/queue.ts`
- `services/api/src/services/ingest/jobs.ts`
- `services/api/src/services/listings-view.ts`
- `services/api/src/services/property-queries.ts`
- `services/api/src/routes/views.ts`
- `services/api/src/routes/comments.ts`
- `services/api/src/routes/likes.ts`
- `services/api/src/routes/guesses.ts`
- `services/api/src/routes/listings.ts`
- `services/api/src/services/ingest/processor.ts`
- `services/worker/src/api-runtime.ts`
- `services/api/drizzle/`

## Decisions

- Implement the full pipeline, not just a timeout patch.
- Fallback behavior should prefer stale tiles for budget misses and known transient tile-generation failures. If no stale tile exists for those classified failures, return an empty tile (`204`).
- Do not convert validation, authentication, authorization, or programmer errors into `204`. Preserve existing route contracts, including public invalid tile `400`, read no viewer `400`, and following no auth `401`.
- Keep existing public endpoints and MapLibre layer contracts unchanged.
- First precompute scope is bounded before implementation: public default-filter property tiles only, within an explicit persisted tile-coverage definition, at `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM` default `10`, with configured refresh quotas and concurrency.
- Non-default filters, read overlays, and following overlays remain dynamic, but must be budgeted and protected by the same runtime safeguards.
- Public stale caching is intentionally limited to public tiles. Read and following overlays must use viewer-scoped scheduling/coalescing and no-store responses, but this work should not add persistent stale private payloads.
- A running same-key tile build that has reached uncancellable SQL must become detached/revivable when all current waiters abort, not immediately replaced by a duplicate build. It continues to count against runtime capacity until it finishes, times out, or cancellation is confirmed.
- Preserve the exact `getMapFilterSignature` behavior. Snapshot keys must use the same normalized route signature, especially the exact `default` value for default filters.
- For public default low-zoom lookup order, prefer the fastest valid payload source first: in-process fresh cache, then precomputed snapshot table, then dynamic safeguarded build with stale fallback for classified budget/transient failures.
- Snapshot refresh state must retain last-good payloads while a refresh is running or failed. A refresh failure must never replace a usable ready snapshot with an unusable `failed` placeholder.
- `property_change_state` is not a complete public snapshot watermark. It remains useful for read-state behavior, but public snapshots need explicit listing, social, property, coverage, and rolling-window watermarks.
- No TODOs or deferred follow-ups are allowed in this plan. If implementation discovers auxiliary systems that need changes to make this robust, include them in the branch scope and test them before marking the work complete.

## Target Behavior

- A zoomed-out burst must not keep blocking useful zoomed-in work after the viewport changes.
- Pending obsolete tile work should be dropped before it reaches Postgres.
- Running tile queries should have hard DB statement budgets.
- A same-key request should not start duplicate expensive SQL while an earlier same-key SQL statement is still running for that key. It should reattach to a viable detached build, serve public stale, or return timeout-empty according to route rules.
- Runtime concurrency metrics must reflect real outstanding DB work. A task whose HTTP waiters all disappeared still occupies capacity until the database work is actually finished or cancelled.
- JS grouping and serialization should have runtime elapsed-time and abort checks because Postgres timeouts do not cover JS work.
- Public low-zoom default tiles should usually be served from precomputed payloads.
- On timeout, queue drop, detached-build miss, or known transient DB/serialization failure:
  - return stale payload if available;
  - otherwise return non-cacheable `204`;
  - do not surface noisy MapLibre-visible `5xx` responses for normal budget misses.
- On validation/auth/programmer errors, keep the existing explicit error behavior and do not use stale or empty fallback.
- Tile logs must make it clear whether time was spent waiting in queue, generating SQL/MVT, using stale cache, serving a snapshot, or timing out.

## Implementation Plan

### 1. Add Tile Runtime Safeguards

Create a small API-side tile runtime service, likely under `services/api/src/services/property-tile-runtime.ts`.

Responsibilities:

- Bound concurrent property tile builds with `PROPERTY_TILE_MAX_CONCURRENCY`, default `3`.
- Bound pending queued work with `PROPERTY_TILE_QUEUE_LIMIT`, default `96`.
- Drop queued tasks when the HTTP request closes before work starts.
- Apply queue wait budget `PROPERTY_TILE_QUEUE_WAIT_MS`, default `750`.
- Prioritize newest and higher-zoom work over older low-zoom work.
- Preserve same-key route-layer coalescing for public dynamic final-MVT builds, and make waiters abort-aware.
- Keep a keyed registry of active route payload builds, including detached running builds that no longer have waiters.
- Track capacity at the underlying work level, not the waiter level. A running build keeps its runtime slot until its SQL/JS work settles or cancellation is confirmed.
- Return a typed result such as `fresh`, `stale`, `empty`, `timeout`, `aborted`, or `dropped`.

Integrate it into:

- `/tiles/properties/:z/:x/:y.pbf`
- `/tiles/properties/read/:z/:x/:y.pbf`
- `/tiles/following/properties/:z/:x/:y.pbf`

Do not apply this runtime to tree or building tiles in this pass unless the implementation naturally supports it without broad refactoring.

Abort and coalescing semantics:

- A runtime task key represents the final route payload for one route kind, tile coordinate, normalized filter signature, and viewer scope when applicable.
- Public route coalescing is for final MVT payloads only. It should still call into `property-grouping` normally so the lower-level canonical group cache/coalescer can serve shared canonical work.
- Read overlay builds must reuse a lower-level canonical group cache/coalescer where route context permits, but any route-layer cache/coalescing must be keyed by viewer and private route context. Following overlays are viewer-specific and must not use public cache entries.
- Read overlay route-layer coalescing must also include a read-state version or watermark in the key, or must invalidate/detach in-flight viewer work after read-state mutations such as `/properties/:id/view`. A viewer-keyed tile key alone is not enough because read-state writes can happen while a private overlay build is running.
- Because read overlay cache-miss behavior currently bypasses the existing canonical pending-build registry, add or refactor to a shared unhydrated canonical build helper that both public/default dynamic builds and read overlays can use. Do not claim read overlays are protected by the existing canonical coalescer until tests prove a read-overlay cache miss and a public/default canonical miss share the same underlying canonical work where route context permits.
- Each HTTP waiter has its own abort signal. If one waiter aborts while other same-key waiters remain, the shared build continues and only the aborted waiter is detached.
- If all waiters for a queued task abort before execution starts, remove the task and return no response work for those waiters.
- If all waiters for a running task abort before the task has entered an uncancellable SQL stage, mark the shared build cancelled, propagate a build-level abort signal into code that can observe it, and discard the result if it eventually returns. Do not write cancelled results into route caches or snapshot tables.
- If all waiters abort while uncancellable SQL is in flight, transition the task to `detached-draining` instead of starting replacement work. Keep it in the active keyed registry, keep its runtime slot occupied, and rely on per-query `statement_timeout` as the hard server-side stop.
- A new waiter for the same key may reattach to a `detached-draining` build if its route context still matches, the runtime budget has not already expired for that build, and the build has not observed cooperative cancellation. Reattachment makes the result publishable again only if at least one waiter is still attached when the build completes.
- If a detached build finishes with no waiters, discard its result and do not write route caches or snapshot tables. If it finishes after a successful reattachment, it may write the same cache/snapshot outputs as a normal build.
- Builders must return payload/status/metadata only. Route cache writes and snapshot writes happen after the runtime decides the result is publishable. This prevents detached or cancelled builds from writing fresh cache entries after all waiters have disappeared.
- Only start a new same-key build after the previous same-key build has settled, timed out, or confirmed cancellation. The exception is an implementation with proven driver-level SQL cancellation; in that case tests must prove the old DB work releases its slot before replacement starts.
- If the DB driver cannot cancel an already-running SQL statement, still stop JS grouping/serialization at cooperative abort checks after each awaited stage.
- Queue overflow should drop lower-priority queued work only. Do not evict running work except through the all-waiters-aborted path and statement/runtime budgets.

### 2. Add Stale-Aware Tile Cache

Replace the current public property tile cache shape with fresh and stale expiry plus bounded memory accounting.

Defaults:

- Fresh TTL: keep current `300s`.
- Stale TTL: `PROPERTY_TILE_STALE_TTL_SECONDS=86400`.
- Entry limit: keep an entry-count cap for safety, but add a byte cap such as `PROPERTY_TILE_CACHE_MAX_BYTES` with LRU pruning. The current cache stores full `Buffer` payloads and a 24h stale window must not grow only by entry count.

Behavior:

- Fresh hit: serve as today with `X-Tile-Cache: hit`.
- Stale hit during timeout, queue drop, detached-build miss, or known transient DB/serialization failure: serve stale with `X-Tile-Cache: stale`.
- Do not serve stale for invalid input, missing auth/viewer, permission failures, unexpected programmer errors, or invariant violations. Those should keep the appropriate route error behavior.
- Expired beyond stale TTL: remove.
- Pruning must account for both fresh and stale entries by payload byte size, and must prefer removing oldest stale entries before fresh entries.
- Public cache remains viewer-agnostic.
- Read/following routes use viewer-keyed in-flight coalescing only. Do not add stale persistence for private overlays in this work; on private budget misses, return non-cacheable timeout-empty `204` after preserving validation/auth behavior.
- Add tests that prove no private route can serve public stale payloads or another viewer's in-flight/private payload.
- Timeout-empty `204` responses are not cacheable and must not be written to the route cache or snapshot table. They must also emit response headers that prevent proxy/browser caching.

Add headers:

- `X-Tile-Cache: hit | miss | stale | precomputed | timeout-empty`
- `X-Tile-Coalesced: true | false`
- `X-Tile-Queue-Time: <n>ms`
- `X-Tile-Budget-Ms: <n>`

Keep existing `X-Tile-Generation-Time`.

Header semantics:

- `X-Tile-Cache` describes the payload source, not whether the request joined another in-flight build. A same-key waiter that receives the result of a newly generated build should still report `X-Tile-Cache: miss` and `X-Tile-Coalesced: true`.
- A fresh in-process cache hit reports `X-Tile-Cache: hit` and `X-Tile-Coalesced: false`.
- Reattaching to a detached-draining build reports the eventual payload source in `X-Tile-Cache` and `X-Tile-Coalesced: true`.

Public tile header and ETag behavior:

- Fresh route-cache hit: keep existing public cache headers and ETag behavior, with `X-Tile-Cache: hit`.
- Newly generated public `200`: compute/store payload ETag, return it, and use the same public cache headers as today, with `X-Tile-Cache: miss`.
- Newly generated public `204` from a successful empty tile: use the current intended public empty-tile cache semantics only if it is a real successful empty tile, not a budget fallback.
- Stale fallback `200`: return the stale payload's stored ETag, include `X-Tile-Cache: stale`, and set conservative cache headers so intermediaries do not treat the stale fallback as fresh beyond the response. Do not refresh the fresh TTL from a stale fallback.
- Precomputed snapshot `200`: return the snapshot ETag, `X-Tile-Cache: precomputed`, and public cache headers appropriate for generated snapshot payloads. It may also populate the in-process fresh cache with the same payload.
- Precomputed snapshot `204`: return `X-Tile-Cache: precomputed`, the snapshot ETag if stored for conditional requests, and public cache headers appropriate for generated snapshot payloads.
- Timeout-empty `204`: return `X-Tile-Cache: timeout-empty`, omit ETag, set `Cache-Control: no-store, max-age=0`, and do not satisfy future conditional requests from this response.
- Conditional requests must be evaluated for every successful public payload source that has an ETag: fresh route-cache hit, stale fallback, precomputed snapshot, newly generated `200`, and successful generated/snapshot `204` where an ETag is stored. If `If-None-Match` matches, return `304` with the same cache/source headers that would have described the matched source, without a body. Never return `304` for timeout-empty fallback responses.

### 3. Add Tile-Specific DB Statement Budgets

Thread tile build options through `property-grouping`.

Suggested API:

```ts
type PropertyTileBuildOptions = {
  statementTimeoutMs?: number;
  runtimeBudgetMs?: number;
  signal?: AbortSignal;
};
```

Apply this to:

- candidate fetch queries;
- read precheck queries;
- single-property detail hydration;
- read filtering queries;
- final `ST_AsMVT` query.

Because existing heavy candidate fetches already use `db.transaction`, set:

```sql
SET LOCAL jit = off;
SELECT set_config('statement_timeout', '<budget_ms>ms', true);
```

Use `set_config('statement_timeout', value, true)` through parameterized/sanitized raw SQL, with `value` formatted from a validated integer budget such as `3000ms`. Do not interpolate unsanitized environment values. Keep `SET LOCAL jit = off` where it already exists.

For heavy tile SQL not currently inside a transaction, wrap only the tile-specific query in a transaction when a statement timeout is provided. This includes read precheck, single-property hydration, read filtering, and final `ST_AsMVT`. Avoid widening unrelated transaction scopes.

Postgres statement budgets do not cover JS grouping, GeoJSON/MVT object preparation, serialization, cache writes, or response writes. Add runtime elapsed-time checks and abort checks between JS stages so a request can still become a budget miss even after SQL returns.

CPU-stage budget requirements:

- Add explicit checkpoints before and after candidate clustering, detail hydration mapping, read/following filtering, GeoJSON feature construction, `JSON.stringify`, MVT serialization, route-cache writes, and snapshot writes.
- Any loop over candidates, groups, features, or snapshot tile coordinates that can exceed a few hundred items must check elapsed time and abort state periodically, not just before and after the whole loop.
- If a CPU-stage budget miss occurs after SQL has completed, classify it as a normal tile budget miss for stale/timeout-empty behavior, but do not write partial payloads to route cache or snapshot tables.

Runtime accounting requirement:

- The tile runtime must treat a build as active until all DB promises and JS stages have settled. Do not release a concurrency slot merely because all HTTP waiters disconnected.
- If cooperative cancellation is observed before SQL starts, release the slot when the build promise settles and report `client_aborted` or `dropped`.
- If cancellation is requested during SQL and the driver cannot cancel the query, keep the slot occupied until the transaction exits through success, statement timeout, or a classified transient error.
- Snapshot precompute must use the same statement-timeout helper and should use a separate lower budget/concurrency profile so worker refresh cannot starve live tile traffic.
- Snapshot refresh must write each completed tile atomically, or through a staging table followed by an atomic publish, so partial/failed refreshes never corrupt last-good rows.

Classify Postgres cancellation SQLSTATE `57014` carefully. Treat it as a tile statement-timeout budget miss only when the error message/context indicates `statement timeout`, such as `canceling statement due to statement timeout`. Do not classify admin shutdown, user cancel, or other cancellation contexts as normal tile budget misses.

Known budget misses and transient failures should trigger stale fallback or timeout-empty `204`. Validation, auth, and programmer errors must not be swallowed.

Default budgets:

- `PROPERTY_TILE_PUBLIC_BUDGET_MS=3000`
- `PROPERTY_TILE_PRIVATE_BUDGET_MS=2000`

### 4. Precompute Public Low-Zoom Default Tiles

Add a migration-backed table for precomputed property MVT payloads.

Required table shape:

```sql
CREATE TABLE property_tile_snapshots (
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  filter_signature text NOT NULL,
  coverage_id text NOT NULL,
  payload bytea,
  status_code integer NOT NULL,
  etag text NOT NULL,
  generated_at timestamptz NOT NULL,
  source_listing_watermark bigint NOT NULL,
  source_social_watermark bigint NOT NULL,
  source_property_watermark bigint NOT NULL,
  source_coverage_watermark bigint NOT NULL,
  snapshot_config_hash text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (z, x, y, filter_signature),
  CONSTRAINT property_tile_snapshots_status_code_check
    CHECK (status_code IN (200, 204)),
  CONSTRAINT property_tile_snapshots_payload_check
    CHECK (
      (status_code = 200 AND payload IS NOT NULL AND octet_length(payload) > 0)
      OR (status_code = 204 AND payload IS NULL)
    )
);

CREATE INDEX property_tile_snapshots_generated_at_idx
ON property_tile_snapshots (generated_at);

CREATE INDEX property_tile_snapshots_coverage_idx
ON property_tile_snapshots (coverage_id, snapshot_config_hash);
```

Do not encode `refreshing` or `failed` as replacement snapshot rows. A tile snapshot row represents the last ready payload for that tile. Running/failed refresh metadata belongs in the refresh-state table so the route can continue serving the last-good payload while a refresh is in progress or after a failed attempt.

Add a migration-backed coverage table. It must make the supported precompute bounds explicit because the current country config does not define tile bounds.

Required table shape:

```sql
CREATE TABLE property_tile_snapshot_coverage (
  coverage_id text PRIMARY KEY,
  bounds_source text NOT NULL,
  min_lon double precision NOT NULL,
  min_lat double precision NOT NULL,
  max_lon double precision NOT NULL,
  max_lat double precision NOT NULL,
  countries text[] NOT NULL,
  data_sources text[] NOT NULL,
  max_zoom integer NOT NULL,
  filter_signature text NOT NULL,
  coverage_watermark bigint NOT NULL DEFAULT 0,
  snapshot_config_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_tile_snapshot_coverage_bounds_check
    CHECK (min_lon < max_lon AND min_lat < max_lat),
  CONSTRAINT property_tile_snapshot_coverage_zoom_check
    CHECK (max_zoom >= 0 AND max_zoom <= 22)
);
```

`snapshot_config_hash` must be derived from max zoom, default filter signature, bounds, country/source set, and any grouping constants that affect output.

Add a migration-backed source watermark table so write paths can advance durable inputs without reading or rewriting the refresh-state lease row directly:

```sql
CREATE TABLE property_tile_snapshot_watermarks (
  key text PRIMARY KEY,
  listing_watermark bigint NOT NULL DEFAULT 0,
  social_watermark bigint NOT NULL DEFAULT 0,
  property_watermark bigint NOT NULL DEFAULT 0,
  coverage_watermark bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Advance watermarks monotonically inside the same transaction as the user-visible mutation when possible, or immediately after a successful commit when the route currently cannot share the transaction. The refresh request copies current source watermarks into the refresh-state `requested_*` fields and the successful refresh copies them into `applied_*`.

Use atomic increments on the single `public_default_low_zoom` watermark row for the affected dimensions. Do not derive freshness from wall-clock timestamps alone; timestamps can be retained for observability, but source/applied comparison must use monotonic watermark values.

Add a migration-backed refresh-state row for durable coalescing, leases, input-watermark tracking, and coverage identity. This can be a separate table keyed by a constant name such as `public_default_low_zoom`:

```sql
CREATE TABLE property_tile_snapshot_refresh_state (
  key text PRIMARY KEY,
  requested_at timestamptz,
  request_reason text,
  requested_listing_watermark bigint NOT NULL DEFAULT 0,
  requested_social_watermark bigint NOT NULL DEFAULT 0,
  requested_property_watermark bigint NOT NULL DEFAULT 0,
  requested_coverage_watermark bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  applied_listing_watermark bigint NOT NULL DEFAULT 0,
  applied_social_watermark bigint NOT NULL DEFAULT 0,
  applied_property_watermark bigint NOT NULL DEFAULT 0,
  applied_coverage_watermark bigint NOT NULL DEFAULT 0,
  coverage_id text,
  snapshot_config_hash text,
  expected_tile_count integer,
  refreshed_tile_count integer NOT NULL DEFAULT 0,
  failed_tile_count integer NOT NULL DEFAULT 0,
  last_window_refresh_at timestamptz
);
```

Update both the SQL migration and `services/api/src/db/schema.ts`, because Drizzle config uses that schema file. Keep migration and schema constraints aligned.

Use the existing `getMapFilterSignature` output exactly. Default-filter snapshot rows and route lookups must use the normalized `default` signature; non-default serialized signatures must bypass snapshot lookup and use the dynamic safeguarded path.

Define precompute bounds before implementation:

- Scope: public property tiles only. Do not precompute read/following or other viewer-specific payloads.
- Filter signatures: `default` only for the first implementation.
- Zooms: `0 <= z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`, default `10`.
- Coordinates: compute the `z/x/y` set from the persisted coverage definition, not from implicit world bounds and not from the current `CountryConfig` alone.
- Quotas: add `PROPERTY_TILE_PRECOMPUTE_MAX_TILES_PER_RUN` and `PROPERTY_TILE_PRECOMPUTE_MAX_SECONDS_PER_RUN` so recovery cannot monopolize the worker.
- Concurrency: default `PROPERTY_TILE_PRECOMPUTE_CONCURRENCY=1`; keep live API traffic protected.
- Ordering: rebuild stale/missing low-zoom tiles first, then higher zooms within quota.

Snapshot freshness inputs:

- Listing state: successful commits to canonical listing/property listing facts used by public tile SQL. Latest-listings maintenance success may enqueue a refresh, but it is not the source watermark.
- Social state: writes that affect public map social scoring/counts, including property views, comment creation/deletion if deletion is added, comment likes/reactions, property likes/reactions, price guesses, and any property activity aggregation used by `property-grouping`.
- Property visibility/state: imports or maintenance paths that change property geometry, active status, country/data coverage, listing-backed visibility, or other fields used by public tile SQL.
- Rolling social window: a max-age/periodic refresh input because recent view/comment/reaction/guess scoring decays as time advances even without new writes.
- The refresh service must expose a small invalidation API, for example `requestPropertyTileSnapshotRefresh({ reason })`, and all relevant write paths must call it after their database transaction commits.
- Invalidation should enqueue/coalesce refresh work; it must not synchronously rebuild snapshots on request/response paths.
- The worker startup/recovery check must compare snapshot coverage and refresh-state watermarks to these inputs so snapshots are refreshed after social-only changes as well as listing maintenance.
- Do not assume `property_change_state` is a complete public snapshot watermark. Use `property_tile_snapshot_watermarks` as the durable source of social/property/listing/coverage watermarks, and make the affected write paths update those watermarks after commit before enqueueing refresh work.
- Property view writes can be high volume. Do not enqueue one full snapshot refresh per view. Update a durable social watermark and coalesce/throttle refresh requests using a minimum interval or worker-side requested-watermark batching, while still ensuring snapshots refresh within the configured max age.
- If a write path cannot be wrapped in a single transaction today, add the smallest transaction boundary needed so invalidation and watermark updates happen only after the user-visible mutation commits successfully.
- For property likes/comment likes, resolve the affected property id before updating snapshot watermarks. Comment reactions use generic reaction target ids and need an explicit lookup through `comments.property_id`.
- For listing submission and validation/ingest paths, ensure the listing/property write and watermark/request update are transactionally ordered or otherwise impossible to commit visibly without a corresponding watermark/request.

Route behavior:

- For public default-filter requests at `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`, read the in-process fresh route cache first, then the snapshot table, then the dynamic safeguarded path.
- If a valid last-good snapshot row is found for the current coverage/config/filter identity, serve it with `X-Tile-Cache: precomputed`. Treat missing, coverage/config-mismatched, or constraint-invalid rows as unavailable and use the dynamic safeguarded path.
- Because snapshot rows are last-good only, refresh-state `lease` or `last_error` metadata must not make a valid snapshot unavailable. Unavailability is based on missing row, payload/check constraint failure, coverage/config mismatch, or route/filter mismatch.
- If missing, fall back to the dynamic safeguarded path and populate the in-process fresh cache for successfully generated `200` payloads and real successful empty tiles. Never cache timeout-empty fallback responses.

The precomputed path must emit the same MVT layer name and feature properties as the current dynamic public tile path.

### 5. Worker Refresh Integration

Extend the existing worker with a separate snapshot job path rather than adding snapshot refresh to the listing maintenance critical path. Use a separate BullMQ queue and worker for tile snapshot refresh so listing maintenance and ingest jobs cannot be starved by snapshot refresh.

Add job support in:

- `services/api/src/services/ingest/jobs.ts`
- `services/api/src/services/ingest/queue.ts`
- `services/worker/src/runtime.ts`
- `services/worker/src/api-runtime.ts`

Add a service, likely `services/api/src/services/property-tile-snapshots.ts`, that can:

- compute the low-zoom tile coordinate set from the persisted coverage definition;
- rebuild default-filter public tiles up to `PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`;
- upsert rows into `property_tile_snapshots`;
- coalesce refreshes durably so repeated maintenance/social/property events do not stack;
- maintain the `property_tile_snapshot_refresh_state` lease, request reason, source/requested/applied watermarks, coverage identity, and rolling-window refresh state.

Trigger refresh:

- after canonical listing/property listing facts commit changes used by public tile SQL. Existing listing maintenance success can also enqueue a separate singleton snapshot refresh job, but do not treat maintenance success as the only freshness input.
- after social write paths commit changes that affect public map scoring or counts: property views, comment create/delete if deletion exists or is added, comment likes/reactions, property reactions/likes, price guesses, and any property activity aggregation write used by `property-grouping`.
- after property/import maintenance paths commit changes that affect public map membership: property active status, geometry, country bounds/data coverage, latest-listing-backed visibility, or `property_change_state`.
- on a rolling max-age schedule for default public snapshots so time-windowed social scores decay even without writes.
- during worker startup/recovery stale checks if snapshots are absent, stale, incomplete, behind the refresh-state watermarks, or the last refresh failed.

Keep refresh concurrency low, default `1`, to avoid competing with live API traffic.

Required worker/runtime behavior:

- Add explicit job-name dispatch in `services/worker/src/runtime.ts` for snapshot refresh; job constants alone are not sufficient.
- Add the loader/interface wiring in `services/worker/src/api-runtime.ts` so worker runtime tests and production dynamic imports can reach the new API service.
- Use a deterministic BullMQ singleton job id for snapshot refresh, but do not rely on completed job retention for durability.
- Use the refresh-state lease row and/or an advisory lock around refresh execution so two workers, restarts, or retained-job expiration cannot run duplicate full refreshes.
- Startup/recovery checks should log why a refresh was enqueued or skipped: absent snapshots, stale snapshots, incomplete coverage, last refresh failed, behind listing/social/property/coverage watermark, existing lease, existing queued job, or quota satisfied.
- Emit metrics/log fields for snapshot refresh counts, duration, rows upserted, tiles skipped by quota, failures, and coalesced enqueue attempts.

### 6. Logging And Observability

Add structured logs for tile outcomes:

- route kind: `public`, `read`, `following`;
- tile id: `z`, `x`, `y`;
- filter signature;
- queue wait time;
- generation time;
- budget;
- cache state;
- result: `fresh`, `stale`, `precomputed`, `timeout-empty`, `aborted`, `dropped`, `detached-draining`, `reattached`;
- error classification: `budget_timeout`, `queue_timeout`, `client_aborted`, `transient_db`, `serialization_failure`, `validation`, `auth`, `programmer`, when applicable;
- viewer id only for following/read logs when already available, and do not log session ids.

Keep slow tile warnings, but include queue and timeout context so they distinguish DB slowness from scheduler pressure.

## Tests

Add or update tests in the smallest suites that already cover this surface:

- `services/api/src/__tests__/integration/tiles.integration.test.ts`
- `services/api/src/services/property-grouping.test.ts`
- worker config/runtime tests under `services/worker/src/`
- queue tests under `services/api/src/services/ingest/`

Required scenarios:

- Public property tiles still serve `200` or `204` and keep existing cache semantics on fresh hit.
- Concurrent identical public tile requests still coalesce. Use controlled promises, spies, or instrumentation around the underlying builder/SQL boundary to prove only one underlying build starts; do not rely only on response headers.
- Same-key public coalescing detaches one aborted waiter while serving remaining waiters.
- Same-key queued work is removed when all waiters abort before start.
- Same-key running work before SQL is marked cancelled when all waiters abort, does not write route cache/snapshot output, and later same-key requests can start a new build after cancellation settles.
- Same-key running work during uncancellable SQL becomes `detached-draining`, keeps the runtime slot occupied, and does not start duplicate same-key SQL. Use a held promise or fake DB executor so the test proves the slot remains occupied while SQL is unresolved.
- A new waiter can reattach to a viable `detached-draining` same-key build and receive/cache the result if it is still attached at completion.
- A detached build that completes with no waiters discards its result and does not write route cache/snapshot output.
- Runtime concurrency slots are released only after underlying SQL/JS work settles or cancellation is confirmed.
- A timed-out public tile serves stale payload when stale exists.
- A timed-out public tile with no stale payload returns `204` and `X-Tile-Cache: timeout-empty`.
- Timeout-empty `204` has `Cache-Control: no-store, max-age=0`, no ETag, and does not poison route or proxy caches.
- Validation/auth errors are preserved: invalid public tile returns `400`, read overlay without viewer returns `400`, following overlay without auth returns `401`.
- Stale fallback is limited to budget misses and known transient DB/serialization failures; validation/auth/programmer errors do not serve stale.
- SQLSTATE `57014` is classified as statement timeout only when message/context indicates statement timeout; admin/user cancels are not treated as normal budget misses.
- Read/following overlay tiles remain private and viewer-specific.
- Read/following tiles use budgeted dynamic work, viewer-keyed in-flight coalescing only, and never reuse public stale payloads.
- Read overlay in-flight keys include a read-state version/watermark or are invalidated on viewer read-state mutation. A `/properties/:id/view` mutation must not let an older in-flight read overlay publish as if it reflected the new read state.
- `/tiles/properties/read.json` receives the same budget/timeout protection needed for its current direct read-state SQL path.
- Private read/following budget misses return no-store timeout-empty `204` without writing stale/private route-cache payloads.
- Two different viewers requesting the same read/following tile do not share private in-flight payloads.
- Read overlay reuses the lower-level canonical group cache/coalescer where appropriate without exposing public route-cache payloads. Include a regression test for the current miss path: a read-overlay cache miss must not start duplicate unhydrated canonical work when equivalent public/default canonical work is already pending.
- Read precheck, single-property hydration, read filtering, candidate fetches, and final `ST_AsMVT` all receive local statement budgets in transaction scope.
- JS grouping/serialization budget checks convert over-budget work into classified budget misses.
- Low-zoom default public tile serves from the in-process fresh cache before consulting `property_tile_snapshots`; snapshot lookup is only used when the fresh route cache misses or is beyond fresh TTL.
- Low-zoom non-default filtered tile bypasses snapshots and uses dynamic safeguards.
- Snapshot lookup preserves exact `getMapFilterSignature` behavior, including normalized `default`.
- Snapshot table migration and Drizzle schema both include last-good payload rows, status-code and payload check constraints, coverage/config identity, and source watermark fields.
- Snapshot coverage and source watermark migrations and Drizzle schema match the required table shapes, including monotonic source watermark updates.
- Snapshot refresh state migration and Drizzle schema include requested/applied listing, social, property, coverage watermarks; lease fields; coverage/config identity; expected/refreshed/failed tile counts; and rolling-window refresh timestamp.
- Snapshot refresh failure preserves the last-good snapshot row and records failure metadata only in refresh state.
- Snapshot coverage computation uses the persisted coverage definition and refuses to silently fall back to world bounds when coverage is missing.
- Tile runtime enforces concurrency, drops aborted queued work, and prioritizes newer/higher-zoom tasks.
- Public tile headers/ETags are correct for fresh hit, newly generated, stale fallback, precomputed, successful empty, timeout-empty, coalesced waiter, and reattached detached-draining paths.
- Public conditional `If-None-Match` behavior returns correct `304` responses for fresh cache, stale fallback, precomputed snapshot, newly generated payloads, and successful stored empty tiles, and never returns `304` for timeout-empty fallbacks.
- Worker runtime dispatches the snapshot job by name.
- Worker API-runtime dynamic import wiring exposes the snapshot refresh service to the worker.
- Worker startup/recovery enqueues snapshot refresh when snapshots are absent/stale/incomplete, behind listing/social/property/coverage watermarks, or the last refresh failed.
- Canonical listing/property listing writes update listing/property watermarks. Listing maintenance success enqueues/coalesces snapshot refresh without running it inside the listing maintenance critical path, but is not the only freshness input.
- Property views, comment create/delete where supported, comment like/reaction, property reaction/like, price-guess, and property/import maintenance write paths update the relevant watermark and request/coalesce snapshot refresh after commit.
- Property view invalidation is throttled/coalesced so high-volume views cannot enqueue an unbounded number of full snapshot jobs, while still satisfying snapshot max-age.
- Comment reaction invalidation resolves the owning property id through `comments.property_id`.
- Worker snapshot refresh coalesces with singleton job id plus refresh-state lease/advisory lock.
- Rolling time-window refresh enqueues snapshots when max age is exceeded even if no write watermark changed.
- Snapshot coverage/config hash changes trigger refresh and prevent mismatched snapshot rows from being served as current.
- Snapshot refresh failure is logged and does not block or fail listing maintenance.
- Snapshot enqueue/skip decisions and refresh results emit logs/metrics.

Verification gate:

```bash
pnpm test
pnpm test:e2e:visual
pnpm test:e2e:flows
```

## Rollout Notes

- Ship runtime safeguards first in the implementation branch, then add precompute and refresh integration in the same branch. This keeps the review sequence clear while still landing the complete behavior together.
- After deployment, watch API logs for tile `timeout-empty`, stale hit rate, queue wait p95, and Postgres `57014` counts.
- If precompute refresh is too expensive during rollout, lower configured bounds/quotas such as `PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`, max tiles per run, or max seconds per run before changing endpoint behavior.
- If users see missing nodes after timeout, prefer increasing precompute coverage or stale TTL before increasing live query budgets.
- Do not leave deferred TODOs in implementation notes or active product surfaces. Any scope needed for correctness in runtime, queueing, schema, or worker recovery belongs in this work.

## Fresh-Agent Starting Points

Start by reading:

1. `agent-rules/software-stack.md`
2. `agent-rules/main-spec.md`
3. `services/api/src/routes/tiles.ts`
4. `services/api/src/services/property-grouping.ts`
5. `services/api/src/services/property-queries.ts`
6. `services/worker/src/runtime.ts`
7. `services/worker/src/api-runtime.ts`
8. `services/api/src/routes/views.ts`
9. `services/api/src/routes/comments.ts`
10. `services/api/src/routes/likes.ts`
11. `services/api/src/routes/guesses.ts`

Then implement in this order:

1. Runtime safeguards and stale fallback for dynamic routes.
2. Statement timeout and runtime-budget plumbing in `property-grouping`.
3. Snapshot, coverage, and refresh-state tables, Drizzle schema update, and public low-zoom route lookup.
4. Worker refresh job, durable coalescing, startup/recovery checks, and write-path invalidation.
5. Tests and full verification.

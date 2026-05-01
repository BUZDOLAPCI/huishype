# Property Tile Pipeline Hardening Plan

Date: 2026-05-01

## Context

Aggressive zoom-out currently causes expensive property tile generation to continue after the user zooms back in. The backend then keeps spending API and Postgres capacity on obsolete low-zoom work, so later lighter tile requests can queue behind stale work.

Evidence from local investigation:

- Public property tile route has an in-memory 300s route cache, ETag handling, same-key pending build coalescing, and expired-entry deletion. It has no stale retention and no abort-aware waiter/build cancellation.
- Read and following property overlay routes call tile builders directly. They are private/no-store and currently have no route-layer cache, coalescing, scheduling, or runtime budget.
- Logs showed z8-z14 property tile builds taking 28-85 seconds, followed by `premature close` errors, which means the client disconnected before the server finished.
- `services/api/src/services/property-grouping.ts` already has a lower-level canonical group cache/coalescer. Route-layer work must cooperate with that cache rather than replacing it.
- Candidate fetches already use Drizzle transactions and `SET LOCAL jit = off`, so tile-specific local statement budgets are feasible there. Other heavy SQL calls are not all transaction-wrapped today: read precheck, single-property hydration, read filtering, and final `ST_AsMVT`. JS grouping/serialization is not bounded by Postgres timeouts and needs its own runtime budget checks.
- Worker maintenance currently hardcodes listing maintenance in `services/worker/src/runtime.ts`. Adding job constants alone is insufficient, and snapshot refresh must not be placed inside the `refreshLatestListingsMaintenance` critical path.
- Current queue singleton behavior only covers worker-sweep jobs without a `batchId`, and completed jobs retain only the last 10 entries. Durable snapshot coalescing needs a worker job id plus a database/advisory-lock coordination mechanism.

Relevant files:

- `services/api/src/routes/tiles.ts`
- `services/api/src/services/property-grouping.ts`
- `services/api/src/db/index.ts`
- `services/api/src/db/schema.ts`
- `services/worker/src/runtime.ts`
- `services/api/src/services/ingest/queue.ts`
- `services/api/src/services/ingest/jobs.ts`
- `services/api/src/services/listings-view.ts`
- `services/api/drizzle/`

## Decisions

- Implement the full pipeline, not just a timeout patch.
- Fallback behavior should prefer stale tiles for budget misses and known transient tile-generation failures. If no stale tile exists for those classified failures, return an empty tile (`204`).
- Do not convert validation, authentication, authorization, or programmer errors into `204`. Preserve existing route contracts, including public invalid tile `400`, read no viewer `400`, and following no auth `401`.
- Keep existing public endpoints and MapLibre layer contracts unchanged.
- First precompute scope is bounded before implementation: public default-filter property tiles only, within explicit country/data tile bounds, at `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM` default `10`, with configured refresh quotas and concurrency.
- Non-default filters, read overlays, and following overlays remain dynamic, but must be budgeted and protected by the same runtime safeguards.
- Preserve the exact `getMapFilterSignature` behavior. Snapshot keys must use the same normalized route signature, especially the exact `default` value for default filters.
- No TODOs or deferred follow-ups are allowed in this plan. If implementation discovers auxiliary systems that need changes to make this robust, include them in the branch scope and test them before marking the work complete.

## Target Behavior

- A zoomed-out burst must not keep blocking useful zoomed-in work after the viewport changes.
- Pending obsolete tile work should be dropped before it reaches Postgres.
- Running tile queries should have hard DB statement budgets.
- JS grouping and serialization should have runtime elapsed-time and abort checks because Postgres timeouts do not cover JS work.
- Public low-zoom default tiles should usually be served from precomputed payloads.
- On timeout, queue drop, all-waiters-aborted replacement, or known transient DB/serialization failure:
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
- Return a typed result such as `fresh`, `stale`, `empty`, `timeout`, `aborted`, or `dropped`.

Integrate it into:

- `/tiles/properties/:z/:x/:y.pbf`
- `/tiles/properties/read/:z/:x/:y.pbf`
- `/tiles/following/properties/:z/:x/:y.pbf`

Do not apply this runtime to tree or building tiles in this pass unless the implementation naturally supports it without broad refactoring.

Abort and coalescing semantics:

- A runtime task key represents the final route payload for one route kind, tile coordinate, normalized filter signature, and viewer scope when applicable.
- Public route coalescing is for final MVT payloads only. It should still call into `property-grouping` normally so the lower-level canonical group cache/coalescer can serve shared canonical work.
- Read overlay builds may reuse the lower-level canonical group cache/coalescer, but any route-layer cache/coalescing must be keyed by viewer and private route context. Following overlays are viewer-specific and must not use public cache entries.
- Each HTTP waiter has its own abort signal. If one waiter aborts while other same-key waiters remain, the shared build continues and only the aborted waiter is detached.
- If all waiters for a queued task abort before execution starts, remove the task and return no response work for those waiters.
- If all waiters for a running task abort, mark the shared build cancelled, propagate a build-level abort signal into any code that can observe it, and discard the result if it eventually returns. Do not write cancelled results into route caches or snapshot tables.
- If the DB driver cannot cancel an already-running SQL statement, rely on per-query `statement_timeout` as the hard server-side stop, but still stop JS grouping/serialization at cooperative abort checks after each awaited stage.
- A new waiter for the same key may attach to an existing build only if that build has not been marked all-waiters-aborted. Otherwise enqueue/start a new build.
- Queue overflow should drop lower-priority queued work only. Do not evict running work except through the all-waiters-aborted path and statement/runtime budgets.

### 2. Add Stale-Aware Tile Cache

Replace the current public property tile cache shape with fresh and stale expiry.

Defaults:

- Fresh TTL: keep current `300s`.
- Stale TTL: `PROPERTY_TILE_STALE_TTL_SECONDS=86400`.

Behavior:

- Fresh hit: serve as today with `X-Tile-Cache: hit`.
- Stale hit during timeout, queue drop, all-waiters-aborted replacement, or known transient DB/serialization failure: serve stale with `X-Tile-Cache: stale`.
- Do not serve stale for invalid input, missing auth/viewer, permission failures, unexpected programmer errors, or invariant violations. Those should keep the appropriate route error behavior.
- Expired beyond stale TTL: remove.
- Public cache remains viewer-agnostic.
- Private read/following route caches, if added, must be viewer-keyed, short-lived, and `no-store` externally. They must never reuse public payloads.
- Timeout-empty `204` responses are not cacheable and must not be written to the route cache or snapshot table. They must also emit response headers that prevent proxy/browser caching.

Add headers:

- `X-Tile-Cache: hit | miss | stale | precomputed | timeout-empty`
- `X-Tile-Queue-Time: <n>ms`
- `X-Tile-Budget-Ms: <n>`

Keep existing `X-Tile-Generation-Time`.

Public tile header and ETag behavior:

- Fresh route-cache hit: keep existing public cache headers and ETag behavior, with `X-Tile-Cache: hit`.
- Newly generated public `200`: compute/store payload ETag, return it, and use the same public cache headers as today, with `X-Tile-Cache: miss`.
- Newly generated public `204` from a successful empty tile: use the current intended public empty-tile cache semantics only if it is a real successful empty tile, not a budget fallback.
- Stale fallback `200`: return the stale payload's stored ETag, include `X-Tile-Cache: stale`, and set conservative cache headers so intermediaries do not treat the stale fallback as fresh beyond the response. Do not refresh the fresh TTL from a stale fallback.
- Precomputed snapshot `200`: return the snapshot ETag, `X-Tile-Cache: precomputed`, and public cache headers appropriate for generated snapshot payloads. It may also populate the in-process fresh cache with the same payload.
- Precomputed snapshot `204`: return `X-Tile-Cache: precomputed`, the snapshot ETag if stored for conditional requests, and public cache headers appropriate for generated snapshot payloads.
- Timeout-empty `204`: return `X-Tile-Cache: timeout-empty`, omit ETag, set `Cache-Control: no-store, max-age=0`, and do not satisfy future conditional requests from this response.

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

Classify Postgres cancellation SQLSTATE `57014` carefully. Treat it as a tile statement-timeout budget miss only when the error message/context indicates `statement timeout`, such as `canceling statement due to statement timeout`. Do not classify admin shutdown, user cancel, or other cancellation contexts as normal tile budget misses.

Known budget misses and transient failures should trigger stale fallback or timeout-empty `204`. Validation, auth, and programmer errors must not be swallowed.

Default budgets:

- `PROPERTY_TILE_PUBLIC_BUDGET_MS=3000`
- `PROPERTY_TILE_PRIVATE_BUDGET_MS=2000`

### 4. Precompute Public Low-Zoom Default Tiles

Add a migration-backed table for precomputed property MVT payloads.

Suggested table:

```sql
CREATE TABLE property_tile_snapshots (
  z integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  filter_signature text NOT NULL,
  payload bytea,
  status_code integer,
  etag text,
  status text NOT NULL DEFAULT 'ready',
  generated_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  PRIMARY KEY (z, x, y, filter_signature),
  CONSTRAINT property_tile_snapshots_status_code_check
    CHECK (status_code IS NULL OR status_code IN (200, 204)),
  CONSTRAINT property_tile_snapshots_status_check
    CHECK (status IN ('ready', 'refreshing', 'failed')),
  CONSTRAINT property_tile_snapshots_payload_check
    CHECK (
      (status = 'ready' AND status_code = 200 AND payload IS NOT NULL AND octet_length(payload) > 0 AND etag IS NOT NULL)
      OR (status = 'ready' AND status_code = 204 AND payload IS NULL AND etag IS NOT NULL)
      OR (status IN ('refreshing', 'failed') AND status_code IS NULL AND payload IS NULL)
    )
);

CREATE INDEX property_tile_snapshots_generated_at_idx
ON property_tile_snapshots (generated_at);
```

Update both the SQL migration and `services/api/src/db/schema.ts`, because Drizzle config uses that schema file. Keep migration and schema constraints aligned.

Use the existing `getMapFilterSignature` output exactly. Default-filter snapshot rows and route lookups must use the normalized `default` signature; non-default serialized signatures must bypass snapshot lookup and use the dynamic safeguarded path.

Define precompute bounds before implementation:

- Scope: public property tiles only. Do not precompute read/following or other viewer-specific payloads.
- Filter signatures: `default` only for the first implementation.
- Zooms: `0 <= z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`, default `10`.
- Coordinates: compute the `z/x/y` set from configured supported country/data bounds, not the entire world if that would exceed the quota.
- Quotas: add `PROPERTY_TILE_PRECOMPUTE_MAX_TILES_PER_RUN` and `PROPERTY_TILE_PRECOMPUTE_MAX_SECONDS_PER_RUN` so recovery cannot monopolize the worker.
- Concurrency: default `PROPERTY_TILE_PRECOMPUTE_CONCURRENCY=1`; keep live API traffic protected.
- Ordering: rebuild stale/missing low-zoom tiles first, then higher zooms within quota.

Route behavior:

- For public default-filter requests at `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`, read the snapshot table first.
- If a `ready` snapshot row is found, serve it with `X-Tile-Cache: precomputed`. Treat `refreshing`, `failed`, missing, or constraint-invalid rows as unavailable and use the dynamic safeguarded path.
- If missing, fall back to the dynamic safeguarded path and populate the in-process fresh cache for successfully generated `200` payloads and real successful empty tiles. Never cache timeout-empty fallback responses.

The precomputed path must emit the same MVT layer name and feature properties as the current dynamic public tile path.

### 5. Worker Refresh Integration

Extend the existing worker with a separate snapshot job path rather than adding snapshot refresh to the listing maintenance critical path.

Add job support in:

- `services/api/src/services/ingest/jobs.ts`
- `services/api/src/services/ingest/queue.ts`
- `services/worker/src/runtime.ts`

Add a service, likely `services/api/src/services/property-tile-snapshots.ts`, that can:

- compute the low-zoom tile coordinate set for configured countries/data bounds;
- rebuild default-filter public tiles up to `PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`;
- upsert rows into `property_tile_snapshots`;
- coalesce refreshes durably so repeated maintenance events do not stack.

Trigger refresh:

- after existing listing maintenance refreshes succeed, by enqueueing a separate singleton snapshot refresh job. Do not run snapshot refresh inside `refreshLatestListingsMaintenance`, and do not allow snapshot failures to fail listing maintenance.
- during worker startup/recovery stale checks if snapshots are absent, stale, failed, or incomplete;

Keep refresh concurrency low, default `1`, to avoid competing with live API traffic.

Required worker/runtime behavior:

- Add explicit job-name dispatch in `services/worker/src/runtime.ts` for snapshot refresh; job constants alone are not sufficient.
- Use a deterministic BullMQ singleton job id for snapshot refresh, but do not rely on completed job retention for durability.
- Add an advisory lock or a small database ledger/lease row around refresh execution so two workers, restarts, or retained-job expiration cannot run duplicate full refreshes.
- Startup/recovery checks should log why a refresh was enqueued or skipped: absent snapshots, stale snapshots, failed snapshots, existing lease, existing queued job, or quota satisfied.
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
- result: `fresh`, `stale`, `precomputed`, `timeout-empty`, `aborted`, `dropped`;
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
- Concurrent identical public tile requests still coalesce.
- Same-key public coalescing detaches one aborted waiter while serving remaining waiters.
- Same-key queued work is removed when all waiters abort before start.
- Same-key running work is marked cancelled when all waiters abort, does not write route cache/snapshot output, and later same-key requests can start a new build.
- A timed-out public tile serves stale payload when stale exists.
- A timed-out public tile with no stale payload returns `204` and `X-Tile-Cache: timeout-empty`.
- Timeout-empty `204` has `Cache-Control: no-store, max-age=0`, no ETag, and does not poison route or proxy caches.
- Validation/auth errors are preserved: invalid public tile returns `400`, read overlay without viewer returns `400`, following overlay without auth returns `401`.
- Stale fallback is limited to budget misses and known transient DB/serialization failures; validation/auth/programmer errors do not serve stale.
- SQLSTATE `57014` is classified as statement timeout only when message/context indicates statement timeout; admin/user cancels are not treated as normal budget misses.
- Read/following overlay tiles remain private and viewer-specific.
- Read/following tiles use budgeted dynamic work and never reuse public stale payloads.
- Read overlay reuses the lower-level canonical group cache/coalescer where appropriate without exposing public route-cache payloads.
- Read precheck, single-property hydration, read filtering, candidate fetches, and final `ST_AsMVT` all receive local statement budgets in transaction scope.
- JS grouping/serialization budget checks convert over-budget work into classified budget misses.
- Low-zoom default public tile serves from `property_tile_snapshots` when present.
- Low-zoom non-default filtered tile bypasses snapshots and uses dynamic safeguards.
- Snapshot lookup preserves exact `getMapFilterSignature` behavior, including normalized `default`.
- Snapshot table migration and Drizzle schema both include status-code, status, and payload check constraints.
- Tile runtime enforces concurrency, drops aborted queued work, and prioritizes newer/higher-zoom tasks.
- Public tile headers/ETags are correct for fresh hit, newly generated, stale fallback, precomputed, successful empty, and timeout-empty paths.
- Worker runtime dispatches the snapshot job by name.
- Worker startup/recovery enqueues snapshot refresh when snapshots are absent/stale/failed/incomplete.
- Worker snapshot refresh coalesces with singleton job id plus advisory lock or DB ledger/lease.
- Snapshot refresh failure is logged and does not block or fail listing maintenance.
- Snapshot enqueue/skip decisions and refresh results emit logs/metrics.

Verification gate:

```bash
pnpm test
pnpm test:e2e:visual
pnpm test:e2e:flows
```

## Rollout Notes

- Ship runtime safeguards first in the implementation branch, then add precompute. This keeps the branch reviewable and gives immediate protection even if snapshot refresh needs tuning.
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
5. `services/worker/src/runtime.ts`

Then implement in this order:

1. Runtime safeguards and stale fallback for dynamic routes.
2. Statement timeout and runtime-budget plumbing in `property-grouping`.
3. Snapshot table, Drizzle schema update, and public low-zoom route lookup.
4. Worker refresh job, durable coalescing, and startup/recovery checks.
5. Tests and full verification.

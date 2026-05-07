# Property Tile Materialized Pyramid Plan

Date: 2026-05-06

## Purpose

Replace low-zoom public default property tile snapshot generation with a
versioned, materialized tile pyramid: compact precomputed rendered nodes that
can be encoded to MVT cheaply and served deterministically.

This is the intended production fix for low-zoom public tile instability. It is
not a timeout increase, stack-size increase, or retry-policy patch. The complete
target state is in scope: public default low-zoom requests must not fall back to
raw low-zoom grouping, encoded caches must be tied to the promoted pyramid
version, app/API contracts must stop depending on uncapped low-zoom membership,
and the remaining dynamic paths must be hardened because they remain supported.

## Current Repo Facts

- `services/api/src/routes/tiles.ts` currently checks in-process cache and
  `property_tile_snapshots` for default low-zoom public tiles, requests refresh
  on snapshot miss, then falls through into dynamic
  `propertyTileRuntime.run()` / `buildMvtForTile()` behavior.
- `services/api/src/db/schema.ts` defines `property_tile_snapshots` keyed by
  `(z, x, y, filter_signature)`. It has coverage/config/filter indexes, but no
  version identity, no atomic promotion pointer, and no last-known-good version
  semantics.
- `services/api/src/services/property-tile-snapshots.ts` serves any matching
  snapshot row for the requested coverage/config/filter and writes per-tile
  rows during a refresh run before the overall run succeeds.
- Current invalidation uses global watermarks. The repo does not have durable
  dirty-tile ranges that would make incremental low-zoom pyramid rebuilds
  correct.
- Current refresh/recovery can request snapshot work for absent snapshots,
  incomplete coverage, last-error states, stale watermarks, and recovery
  candidates. Per-tile refresh failures can be recorded as a failed refresh
  result without necessarily making BullMQ treat the job itself as failed, so
  durable retry/terminal state cannot live only in the queue.
- `services/api/src/services/property-grouping.ts` still has spread-based
  aggregate patterns such as `Math.min(...candidates.map(...))`,
  `Math.max(...candidates.map(...))`, and `socialScoreMax` over `members`.
  Those can crash for very large aggregate arrays.
- Existing grouping semantics are zoom-local and owner-tile filtered. Low zoom
  already uses source-first tables such as `property_tile_listing_candidates`
  and `property_tile_listing_facts`.
- Current MVT encoding writes `property_ids` and `preview_property_ids` as
  comma-joined text scalars. The app parses those strings.
- `GET /properties/nearby` currently returns a schema that requires
  `propertyIds` and `previewPropertyIds`; the route computes `isRead` by
  checking all `result.propertyIds`. The native app uses this route as a tap
  fallback.
- The web custom tile protocol already handles 204 empty tile responses and
  retries only the existing timeout-empty semantics identified by
  `X-Tile-Cache: timeout-empty`. Returning 503 for pyramid misses would require
  app/client protocol changes.
- Existing app interaction code can fall back from empty `previewPropertyIds`
  to full `propertyIds` for cluster previews.

## Operational Evidence

These observations motivated the plan, but they are production evidence rather
than code-verified repo facts:

- Public default low-zoom snapshot recovery was observed unhealthy on
  2026-05-06.
- Requests such as `GET /tiles/properties/0/0/0.pbf` were observed returning a
  `RangeError: Maximum call stack size exceeded`.
- Worker state was observed retrying a partial low-zoom refresh set instead of
  converging to a stable published result.

## Target Architecture

Create a database-backed public default tile pyramid for
`z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`.

- `property_tile_pyramid_versions`: immutable build identity, coverage id,
  config hash, default filter signature, max zoom, source watermarks, build
  inputs hash, status, attempt count, retry timestamps, terminal failure
  reason, validation summary, promoted timestamp, and build timestamps. The row
  also stores immutable snapshots of the full coverage/config definition used
  by the build: bounds, countries, data-source selection, max zoom, filter
  signature, grouping constants, and the resolved config hash. Config and
  source changes create new candidate versions; they do not change the logical
  pointer identity or mutate an already promoted version's build inputs.
- `property_tile_pyramid_source_watermarks`: monotonic input freshness records
  for listing facts, property geometry/status/import coverage, social inputs,
  official valuations, views/engagement counters, and rolling social-window
  buckets. Pyramid versions copy the concrete watermark values into
  `source_watermarks_json` plus a normalized `source_watermark_hash`.
  `source_watermarks_json` is not an opaque blob: it records named
  `property_tile_snapshot_watermarks` counters for the
  `public_default_low_zoom` slot (`listing_watermark`, `social_watermark`,
  `property_watermark`, and `coverage_watermark`), `ingest_sources`,
  `listing_source_scope_watermarks`, `listing_scope_completions`, derived
  fingerprints for `property_tile_listing_candidates` and
  `property_tile_listing_facts` (`count(*)`, `max(updated_at)`), and the
  rolling social-window bucket id.
- `property_tile_pyramid_current`: one logical pointer per stable serving slot
  `(coverage_id, filter_signature, max_zoom, pyramid_kind)` that references the
  currently promoted version. The pointer key must not include `config_hash` or
  any other mutable build input, because that would discard last-known-good
  serving whenever configuration changes before a replacement version is
  validated. It has primary key
  `(coverage_id, filter_signature, max_zoom, pyramid_kind)` and a composite
  foreign key `(current_version_id, coverage_id, filter_signature, max_zoom,
  pyramid_kind)` to a unique key on `property_tile_pyramid_versions`
  `(id, coverage_id, filter_signature, max_zoom, pyramid_kind)`. Promotion is a
  single guarded database transaction after validation succeeds, and SQL
  constraints/triggers must require the referenced current version to have
  status `promoted`.
- `property_tile_pyramid_nodes`: one row per rendered node per version and
  owner tile, storing tile coordinate, a `node_id` that is globally unique
  within the version, render coordinate, node class, group kind, point count,
  representative property id, capped preview ids, bbox, listing/social
  aggregates, score aggregates, comment counts, and stable nearby/tap metadata.
  The grouping algorithm can remain tile-local; persisted node identity cannot.
- `property_tile_pyramid_tiles`: one mandatory tile manifest/status row per
  covered `(version_id, z, x, y)`, including empty/non-empty status, node count,
  validation status, version-scoped ETag, optional encoded MVT payload bytes,
  and payload timestamps. The row distinguishes a valid promoted empty tile
  from a missing/corrupt tile. Encoded bytes are disposable acceleration data
  and never outlive their logical pyramid version.
- `property_tile_pyramid_members`: conditional version/node keyed paged
  membership keyed by `(version_id, node_id, ordinal)`, with `property_id`
  stored on every row and a uniqueness constraint on
  `(version_id, node_id, property_id)`, for server-side audited flows only. It
  is not exposed in public low-zoom MVT. Create and backfill it only if the
  preflight sizing and launch-path audit prove complete low-zoom membership is
  needed; otherwise capped previews and node summaries are the durable contract.

Required schema constraints and lookup indexes:

- Update `services/api/src/db/schema.ts` and add a numbered SQL migration under
  `services/api/drizzle/` using the existing statement-breakpoint style. Use raw
  SQL where Drizzle schema helpers cannot express the composite foreign keys,
  constraint triggers, and guarded promotion/current-pointer constraints.
- Check constraints are limited to row-local invariants: tile coordinate ranges,
  enum/status labels, non-negative counts, and payload/ETag consistency.
  Old-vs-new and cross-row invariants are enforced by guarded promotion SQL and
  constraint triggers: legal status transitions, immutable fields after
  promotion, current pointer compare-and-swap, and "current version must be
  promoted".
- `property_tile_pyramid_versions` has a unique immutable build identity on
  `(coverage_id, filter_signature, max_zoom, pyramid_kind, build_inputs_hash,
  source_watermark_hash)` so duplicate worker dispatches coalesce to one
  candidate version for a serving slot. `coverage_id` is part of the database
  key even though the coverage JSON also contributes to `build_inputs_hash`.
  `build_inputs_hash` covers coverage bounds, country/source set, min/max zoom,
  default filter signature, grouping constants, code/schema pipeline version,
  and other immutable build inputs, but excludes source watermark values. Source
  watermark values live in `source_watermarks_json` and
  `source_watermark_hash`.
- `property_tile_pyramid_versions` also has a unique key on
  `(id, coverage_id, filter_signature, max_zoom, pyramid_kind)` for the current
  pointer composite foreign key.
- `property_tile_pyramid_current` has exactly one row per
  `(coverage_id, filter_signature, max_zoom, pyramid_kind)` and the composite
  foreign key described above. Promotion updates this row only inside the
  validation transaction.
- `property_tile_pyramid_tiles` has primary key
  `(version_id, z, x, y)`, stores every expected tile including valid empty
  tiles, and has no lookup path that omits `version_id`.
- `property_tile_pyramid_nodes` has lookup index `(version_id, z, x, y)`, unique
  `(version_id, node_id)`, and a spatial or tile-coordinate lookup that supports
  nearby matching without scanning an entire version.
- If retained, `property_tile_pyramid_members` has primary key
  `(version_id, node_id, ordinal)`, unique
  `(version_id, node_id, property_id)`, and foreign-key ownership through the
  version/node identity.
- Health, build-request, and failure/retry state uses Postgres uniqueness keyed
  by the immutable build identity
  `(coverage_id, filter_signature, max_zoom, pyramid_kind, build_inputs_hash,
  source_watermark_hash)` so API requests, worker recovery, ingest completion,
  and user/social mutations cannot enqueue duplicate active builds.

The existing `property_tile_snapshots` table is removed from public default
low-zoom serving. No public default
`z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM` route may read it for serving,
last-known-good fallback, or refresh recovery. Other routes may continue using
that table only when their request shape is outside the pyramid-covered public
default scope and tests prove the public default low-zoom path cannot reach it.
The same implementation disables or removes public-default low-zoom snapshot
refresh enqueue, recovery sweeps, worker writes, and startup refresh logic for
the pyramid-covered serving slot. No `property_tile_snapshots` producer remains
active for public default low zoom as a transitional fallback or cleanup item.

## Version Promotion

Pyramid builds are copy-on-write and version-scoped.

1. Insert a new `property_tile_pyramid_versions` row with status `building`.
2. Build the complete pyramid for all covered public default tiles
   `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM` under that `version_id`.
3. Write all nodes, conditional paged members when retained, and tile
   manifest/status rows under the same `version_id`. Pre-encode payload bytes
   where practical, but payload bytes are acceleration data; tile
   manifest/status coverage is the durable contract.
4. Validate coverage, tile manifest counts, node counts, empty-tile
   expectations, decoded MVT contract for encoded or regenerated payloads,
   candidate closed source watermarks, `source_watermark_hash`, config hash,
   and default filter signature.
5. Change the version status to `validated`.
6. In a single transaction, update the stable
   `property_tile_pyramid_current` serving-slot row from the previous promoted
   version to the validated version and mark the new version `promoted`. The
   update is guarded by the expected previous `current_version_id` so concurrent
   builders cannot overwrite a newer promotion.

There is no partial publication. Candidate version rows are invisible to the
public route until the pointer transaction commits. If a build fails before
promotion, the previous current pointer remains active. Mutations during a
build update `pending_replacement_watermark` and may enqueue the next
candidate, but they do not invalidate or supersede the active candidate before
validation/promotion. Validation compares against the candidate's closed source
watermarks. If current source watermarks exceed the freshness SLA at promotion
time, promote the valid candidate as last-known-good and immediately request a
successor built from the newer closed watermark snapshot.

Encoded tile payloads are version-scoped. The route only reads
`property_tile_pyramid_tiles` through the current version pointer, and the tile
manifest/status row must exist for every covered tile before promotion. A
missing optional payload on an existing valid tile row is normal and triggers
regeneration from promoted nodes; a missing tile manifest/status row is a
version health failure. Cache cleanup deletes payloads, nodes, and members by
retired `version_id` according to a defined retention policy implemented with
this change. Retention runs daily at 03:20 UTC under
`pg_try_advisory_lock(hashtext('property_tile_pyramid_retention'))`, keeps the
current promoted version and one previous promoted version per serving slot,
never deletes a current-referenced version, deletes failed or superseded
candidate payloads after 24 hours, and deletes nodes/members/payloads in
10,000-row chunks with `FOR UPDATE SKIP LOCKED`. Retention skips active leases
and unfinished audit rows. Initial backfill and first promotion run under
`pg_try_advisory_lock(hashtext('property_tile_pyramid_backfill'))`, with one
full build per serving slot active. An encoded MVT payload cannot be reused
across versions, even when `(z, x, y)` matches.

## Build Model

Build a full new pyramid for every public default replacement.

This plan deliberately does not use incremental dirty-tile rebuilds. The repo
currently has only global source watermarks, while low-zoom output depends on
listing facts, property geometry, social aggregates, time windows, coverage,
config, grouping radius, owner-tile filtering, and preview ordering. Without
durable dirty tile ranges for every dependency, an incremental pyramid could
publish stale or inconsistent low-zoom nodes. Full version builds are simpler,
auditable, and aligned with copy-on-write promotion.

Builder inputs and semantics:

- Reuse the current low-zoom source-first facts/candidates where appropriate,
  including `property_tile_listing_candidates` and
  `property_tile_listing_facts`.
- Compute the exact covered `z/x/y` universe from the immutable coverage/config
  snapshot stored on the version. Persist and validate that manifest, including
  tiles with zero nodes, before promotion.
- Build tiles in deterministic zoom/tile order and derive stable `node_id`
  values within a version from owner tile plus deterministic group ordering.
  IDs must not depend on worker chunking, retry order, database row arrival
  order, or JavaScript object iteration order.
- The builder must not reuse the existing request/runtime canonical grouping
  cache unless that cache is explicitly version-partitioned and build-owned.
  Any current in-flight or request-coalescing cache keyed only by tile/filter
  can contaminate a materialized version with stale or partial dynamic results.
  Extract a pure grouping/build path or disable those caches for pyramid builds.
- Preserve the current visual semantics by materializing per-zoom, per-tile
  rendered nodes using the existing zoom-local grouping rules, radius
  calculations, node class behavior, active/ghost grouping, source priority,
  preview ordering, and owner-tile filtering.
- For each tile, collect candidates from the same buffered query extent used by
  the current encoder so edge rendering remains stable. Store and serve only
  nodes whose owner tile is the requested `(z, x, y)`; use the MVT buffer only
  for geometry encoding/clipping, not as permission to duplicate owner nodes in
  neighboring tiles.
- Use iterative aggregate computation for bbox, score max, totals, counts, and
  previews. Do not create huge JS argument lists or retain uncapped low-zoom
  arrays for MVT-facing rows.
- Store capped preview IDs and node summaries on nodes. Full membership storage
  is conditional on the preflight sizing check before initial backfill. Estimate
  `sum(point_count)`, largest nodes, bytes per row including indexes, and the
  retention multiplier for current plus previous plus active candidate
  versions. If no launch path needs audited complete low-zoom membership, do
  not create/backfill `property_tile_pyramid_members`; keep capped previews and
  node summaries only. If full membership is kept, store it paged by
  `(version_id, node_id, ordinal)` and implement partition/delete by
  `version_id` with retention.
- Store source watermark semantics explicitly. Each version records the raw
  source/ingest watermark values that define data freshness, the existing
  property-tile derived watermark/counter values needed for compatibility with
  current invalidation code, and a normalized `source_watermark_hash` used in
  build identity. Validation compares both the raw values and the hash so a
  promoted version is auditable after underlying mutable source tables advance.

Full-build sizing and resource requirements are part of the implementation, not
an operational afterthought. The default Europe bounds with max zoom 10 cover
32,505 tiles across z0-z10: z0=1, z1=2, z2=4, z3=6, z4=12, z5=35, z6=117,
z7=408, z8=1,584, z9=6,144, and z10=24,192. Preflight must estimate candidate
rows with `EXPLAIN (ANALYZE, BUFFERS)` for z0, z6, dense z9, and dense z10
using the same candidate CTEs as `buildGroupingCandidateScopeCtes()`. Estimate
members as `SUM(point_count)` and reject a plan where z<=10 accidentally
includes all active/ghost properties; ghost reveal is z17, so public max z10
remains source-first listing/social scoped.

The builder records estimated and observed tile count, non-empty tile count,
node count, member row count when retained, encoded payload bytes, heap bytes,
index bytes, WAL bytes, candidate rows per tile, wall-clock duration, and peak
chunk memory in `validation_summary`. Budget estimates use 350 bytes per member row
including indexes, 600 bytes per node row including indexes, 250 bytes per tile
manifest plus payload bytes, and WAL at 2.5x heap plus index bytes. If
estimated members exceed 5M rows or estimated WAL exceeds 10GB for one build,
stop before promotion and require a plan revision or more batching/index work.
Build execution is chunked and lease renewed from Postgres so the worker can
resume or mark failure deterministically without publishing partial results.

Resource controls are explicit build inputs and appear in health output:
`WORKER_PROPERTY_TILE_PYRAMID_CONCURRENCY=1`,
`PROPERTY_TILE_PYRAMID_CHUNK_TILE_LIMIT=128`,
`PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE=5000`,
`PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS=30000`,
`PROPERTY_TILE_PYRAMID_LEASE_SECONDS=900`,
`PROPERTY_TILE_PYRAMID_MAX_HEAP_MB=1024`, and
`PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK=1073741824`. Exceeding these
limits marks the candidate `failed_retryable` with category `resource_limit`,
releases the lease, and publishes no partial result.

This chooses visual parity with the current zoom-local grouping over a new
stable global hierarchy. A global hierarchy would change tile boundary behavior,
cluster drilldown, and preview ordering; those changes are not needed to solve
the low-zoom serving problem.

## Serving Model

Scope: public default-filter property tiles only,
`z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`.

Public default low-zoom route order becomes:

1. Resolve the current promoted pyramid version for the stable serving slot:
   coverage/default filter/max zoom/pyramid kind. The resolved version records
   the config hash that produced it.
2. Check in-process cache keyed by `(version_id, z, x, y)`. Old non-versioned
   cache keys are ignored for this path.
3. Check `property_tile_pyramid_tiles` keyed by `(version_id, z, x, y)`.
   A present manifest/status row with `node_count = 0` is a valid promoted
   empty tile, not a miss.
4. When a valid manifest/status row exists but payload bytes are absent, encode
   from `property_tile_pyramid_nodes` for that same `version_id`, then populate
   in-process and database encoded caches under that version.
5. If no current version exists, record or reuse a durable Postgres build
   request subject to worker backoff and return the controlled empty-tile
   contract below. If the manifest/status row is missing from an already
   promoted current version, or regeneration from promoted nodes fails, treat it
   as a validation/health failure for that version, record the failure durably,
   request a replacement version through the same Postgres backoff gate, and
   return the controlled empty-tile contract. The route must not perform ad hoc
   per-tile rebuilds, call `buildMvtForTile()`, or call raw grouping for
   pyramid-covered public default requests.

Successful tile responses use a version-scoped ETag that includes
`version_id` or the build hash. Conditional requests must never return `304`
for a retired version or for bytes produced by an old non-versioned cache key.
Promoted empty tiles are first-class successful tile results: they return the
normal successful empty-tile cache contract, the version-scoped ETag, no build
request, and no `X-HuisHype-Tile-Status` unavailability header.

Miss contract: return `204 No Content` for public default low-zoom pyramid
unavailable/missing states, with explicit headers such as
`X-HuisHype-Tile-Status: pyramid-unavailable`, `pyramid-missing`,
`pyramid-build-active`, or `pyramid-build-enqueued`, plus short/no-store cache
headers. Reuse the existing retryable empty-tile header
`X-Tile-Cache: timeout-empty` only when the tile is expected to become
available inside the current web retry budget. A full pyramid build will not
fit that retry window, so ordinary queued/building states return
non-retryable `204` unless the encoded tile is already being regenerated from a
promoted version or another bounded sub-second/seconds operation is in flight.
Terminal, no-current-version, and long-running build states return
non-retryable `204` with `Cache-Control: no-store`, the explicit
`X-HuisHype-Tile-Status`, and no `X-Tile-Cache: timeout-empty`. This keeps the
response compatible with current clients: existing web retries remain limited
to the timeout-empty header, while native map continuity still receives a 204
empty tile. Do not use 503 for this path.

The retry behavior is intentionally API-driven because the custom retry protocol
exists only on web. Native uses the normal tile URL path and must receive a
complete response contract from the API without relying on client-side retry or
exhaustion events. Valid empty promoted tiles keep the existing cacheable empty
tile behavior. Pyramid unavailable, missing, terminal, or long-running build
states use the explicit `X-HuisHype-Tile-Status` value plus no-store caching so
empty unavailability is never cached as a valid promoted empty tile.
`X-Tile-Cache: timeout-empty` is forbidden for `pyramid-unavailable`,
`pyramid-missing`, `pyramid-build-enqueued`, terminal failures, and full-version
builds. It is allowed only for bounded regeneration from an already promoted
version that is expected to finish inside the existing web retry window. Client
tests prove that a `204` without `X-Tile-Cache: timeout-empty` returns an empty
tile without retrying or dispatching the timeout-exhausted reload event.

Non-default filters, read overlays, following overlays, and higher zooms remain
dynamic. They keep using the existing dynamic route/runtime, with the aggregate
hardening described below.

## Worker Failure Handling

Pyramid build state is durable and backoff-aware.

- Status values: `queued`, `building`, `validating`, `validated`, `promoted`,
  `failed_retryable`, `failed_terminal`, and `superseded`.
- Each failed candidate records failure category, message, stack summary,
  failed stage, affected tile if known, attempt count, next retry timestamp,
  and terminal reason when applicable.
- Retryable failures use exponential backoff with jitter and a maximum attempt
  threshold per immutable build input identity, represented by
  `(coverage_id, filter_signature, max_zoom, pyramid_kind, build_inputs_hash,
  source_watermark_hash)`. Backoff state is stored in Postgres on the candidate
  version; BullMQ jobs are dispatch signals only and cannot be the source of
  truth for retry eligibility or terminality.
- Deterministic validation failures, unsupported config, schema mismatch, or
  repeated identical crashes become `failed_terminal`. Recovery sweeps do not
  re-enqueue terminal versions.
- A newer input identity can supersede older queued or retryable candidates
  that have not started. It does not invalidate or supersede an active
  candidate before validation/promotion; active candidates are bound to closed
  source watermarks.
- Failed, terminal, or superseded candidate versions never alter
  `property_tile_pyramid_current`.
- A promoted version is marked degraded when its manifest is missing, decoded
  MVT validation fails, regeneration failures reach 25 tiles or 1% of requests
  in 5 minutes, or pyramid-missing/unavailable responses exceed 100 in
  5 minutes. A degraded promoted version does not trigger ad hoc route
  rollback. The pointer keeps serving unaffected tiles while affected requests
  return the controlled 204 miss contract and a replacement version is
  requested.
- Rollback is an operator action:
  `pnpm --filter @huishype/api pyramid:rollback -- --slot <coverage/filter/maxZoom/kind> --to previous --reason <text>`.
  The command validates the retained previous version, updates the pointer in a
  guarded transaction, records an audit row, and does not read snapshots or
  invoke dynamic grouping.

Every current path that can make public default low-zoom tiles stale must be
migrated from snapshot refresh requests to pyramid build requests in the same
change. This includes tile misses, ingest completion, worker recovery sweeps,
listing submission/import changes, comments, likes/reactions, property views,
official valuation updates, price guesses, canonical listing/property-listing
fact writes, property geometry/status/coverage/import changes, comment
reactions, property likes/reactions, rolling social-window expiry, and any
source-watermark maintenance path that currently calls into
`property_tile_snapshots` refresh logic. Watermarks update only after the source
mutation commits. Source watermark snapshots are closed at candidate creation:
later mutations update `pending_replacement_watermark` and may enqueue the next
candidate, but they do not mutate or supersede the active candidate before it
can validate and promote. Validation compares output to the candidate's closed
watermarks. If current watermarks have advanced beyond the freshness SLA at
promotion time, promote the valid candidate as last-known-good and immediately
request a successor. Request paths may enqueue or reuse a build request but
must not synchronously rebuild. API-side request creation and worker dispatch
both consult the same Postgres build-request row, so repeated callers coalesce
instead of creating independent retry loops.

Default coalescing policy is part of the implementation and emitted in health
output. Listing/property/coverage/official-valuation/canonical listing fact
changes coalesce for 60 seconds with a 15 minute maximum freshness lag.
Comments, reactions, and price guesses coalesce for 5 minutes with a 15 minute
maximum lag. Views keep the existing 5 minute floor and request a build when
15 minutes have elapsed or 10,000 mutations have accumulated. Rolling
social-window expiry is scheduled hourly by bucket.

The pyramid job uses a separate BullMQ queue/job path from listing maintenance,
wired through `services/api/src/services/ingest/jobs.ts`,
`services/api/src/services/ingest/queue.ts`,
`services/worker/src/runtime.ts`, and `services/worker/src/api-runtime.ts`.
Workers acquire an eligible version row through a Postgres lease/advisory lock,
renew the lease per chunk, and use deterministic singleton job IDs per serving
slot plus input hash. BullMQ dispatches work only after Postgres says the
candidate is eligible.

Health checks expose current promoted version, source watermark lag, active
candidate build, retryable failure due time, terminal failures, encoded cache
coverage, and last successful promotion.

Authenticated `GET /ops/property-tile-pyramid` exposes current version,
previous retained version, active candidate, candidate status/stage,
closed/current watermark lag seconds, next retry, terminal failures, degraded
reason, manifest coverage, encoded payload coverage, node counts, member counts
when retained, build duration, lease owner/age, chunk progress, observed WAL
bytes, and the last promotion/rollback audit entry. `/health` stays lightweight, but returns
degraded when no current promoted pyramid exists after enablement or the
current version is degraded.

Metrics and alerts use stable names:

- `property_tile_pyramid_build_duration_seconds`: alert when build duration
  exceeds the recorded p95 by 2x.
- `property_tile_pyramid_build_failures_total{category}`: alert when terminal
  failures are greater than zero.
- `property_tile_pyramid_current_watermark_lag_seconds`: alert when lag exceeds
  30 minutes.
- `property_tile_pyramid_tile_status_total{status}`: counts served promoted,
  empty, unavailable, missing, retryable, and terminal tile states.
- `property_tile_pyramid_manifest_missing_total`: alert when nonzero for a
  current promoted version.
- `property_tile_pyramid_encoded_coverage_ratio`: alert when encoded coverage
  remains below 95% after 30 minutes.
- `property_tile_pyramid_candidate_rows_per_tile`: alert when observed counts
  exceed preflight estimates by 25%.
- `property_tile_pyramid_member_rows`: alert when observed counts exceed the
  retained-membership budget.
- `property_tile_pyramid_wal_bytes`: alert above 10GB for a single build.
- `property_tile_pyramid_lease_age_seconds`: alert when an active lease exceeds
  2x `PROPERTY_TILE_PYRAMID_LEASE_SECONDS`.
- `property_tile_pyramid_promotions_total`: audit counter for successful
  promotions.
- `property_tile_pyramid_rollbacks_total`: audit counter for operator
  rollbacks.

Alert when no current version exists after enablement, the current version is
degraded for more than 5 minutes, watermark lag exceeds 30 minutes, an active
lease age exceeds 2x the lease duration, terminal failures are present, encoded
coverage is below 95% after 30 minutes, or build duration exceeds the recorded
p95 by 2x.

## MVT Payload Contract

MVT remains scalar encoded because Mapbox Vector Tile properties do not carry
arrays directly and the current app already parses scalar text fields.

- Preserve `preview_property_ids` as a capped comma-joined text scalar.
  The cap is `PROPERTY_PREVIEW_MEMBER_LIMIT`, shared by builder, MVT, nearby,
  mocks, API tests, and app expectations, while preserving existing preview
  ordering.
- For low-zoom cluster features, omit `property_ids` or encode it as an empty
  string. It must not contain uncapped membership.
- For low-zoom singles, `property_ids` may contain the single primary id.
- Preserve existing scalar summary fields needed by the style and app:
  `primary_property_id`, `point_count`, `node_class`, `group_kind`, bbox fields,
  listing counts, social counts, `socialScoreTotal`, `socialScoreMax`,
  `recentSocialScoreTotal`, `commentCount`, and render coordinate fields.
- Add scalar pyramid metadata for diagnostics and nearby matching:
  `pyramid_version_id`, `pyramid_node_id`, `membership_complete`, and
  `read_state_coverage`.
  Encode `pyramid_version_id` and `pyramid_node_id` as text scalars, not
  numeric bigint properties, so MapLibre and JavaScript clients do not lose
  precision. App parsers and nearby requests treat both IDs as strings.

App parser changes are part of this work:

- Preserve the existing `normalizeRenderedPropertyGroup` tolerance for
  missing/empty `property_ids` when `primary_property_id` is present, and add
  explicit tests so that tolerance remains intentional.
- Cluster preview and tap handling must use `preview_property_ids` for low-zoom
  clusters and must not fall back to full `property_ids` when the pyramid
  feature has incomplete membership.
- Existing full-`propertyIds` preview fallback behavior is removed only for
  incomplete pyramid clusters. If `membershipComplete === false` or
  `readStateCoverage === 'partial'`, the app uses only `previewPropertyIds`;
  when those are empty it treats the feature as non-previewable and uses
  zoom/fly behavior or exact nearby lookup. Preserve fallback from
  `previewPropertyIds` to complete `propertyIds` for singles and dynamic
  complete groups.
- Tests cover comma-joined parsing, empty `property_ids`, capped previews, and
  preservation of full IDs only for singles or dynamic paths that still provide
  complete membership.

## Nearby API Contract

Public default low-zoom `GET /properties/nearby` is part of the pyramid
contract. It cannot remain on `resolveNearbyGroupedFeature()` for
`z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM`.

- Route selection: when filters are public/default and zoom is pyramid-covered,
  resolve against the current promoted pyramid version. Other filters,
  following mode, private overlays, and higher zooms remain dynamic.
- Matching: use the same tile coordinate, MVT extent, buffer, tap tolerance,
  radius, and owner-tile rules used by tile encoding so native tap fallback
  resolves the visible rendered node.
- Feature-originated fallback may pass query params `pyramidVersionId` and
  `pyramidNodeId`. The `/properties/nearby` query/schema accepts both fields,
  requires the pair for the exact-node path, and rejects or ignores partial
  pairs. Feature-originated app fallbacks must pass both whenever the rendered
  feature has `pyramid_version_id` and `pyramid_node_id`. When the pair is
  present, the API validates that the version is the current promoted version
  for the serving slot and resolves that exact node before coordinate/tolerance
  matching. Coordinate/tolerance matching is only for taps without a rendered
  pyramid feature or for dynamic paths.
- If a pyramid-covered public/default nearby request has no current promoted
  version, missing tile manifest coverage, or terminal pyramid state, return
  `200 null` with `X-HuisHype-Nearby-Status` describing the pyramid state,
  record or reuse the durable build request where applicable, and do not call
  `resolveNearbyGroupedFeature()`.
- Response for pyramid singles: `propertyIds` contains the single primary id,
  `previewPropertyIds` contains that id, `membershipComplete: true`, and
  `isRead` is calculated from that single id. Preserve the current single-result
  payload fields used by schemas and native preview cards: `address`, `city`,
  `askingPrice`, `thumbnailUrl`, `hasActiveListing`, `marketState`, plus the
  shared grouped fields listed below.
- Response for pyramid clusters: `propertyIds` is empty, `previewPropertyIds`
  is the capped preview list, `membershipComplete: false`,
  `readStateCoverage: 'partial'`, and the required `isRead: boolean` is present
  with value `false`. Do not omit or null `isRead`. Pyramid clusters do not
  derive read state from preview membership as if it were complete. Pyramid
  singles and dynamic complete groups return `membershipComplete: true`,
  `readStateCoverage: 'complete'`, and calculate `isRead` from complete
  membership. Pyramid clusters return only cluster summary fields and never
  populate single-listing fields such as `address`, `city`, `askingPrice`,
  `thumbnailUrl`, `hasActiveListing`, or `marketState`.
- Preserve the user-facing fields needed by the app: `primaryPropertyId`,
  `pointCount`, `nodeClass`, `groupKind`, `coordinate`, `distanceMeters`,
  `bbox`, listing/social summaries, score aggregates, and preview IDs.
- Update Zod schemas in `services/api/src/routes/properties.ts`, generated API
  client types, shared property types, mocks, native fallback handling in
  `apps/app/src/hooks/useMapInteraction.ts`, and nearby normalization/tests.
  These schemas, types, native fallback paths, and normalization helpers must
  preserve the single-result fields above for pyramid singles and must model
  pyramid clusters as cluster summaries when those single fields are absent.
- Update read-state calculation so it only calls `getReadPropertyIdSet()` when
  membership is complete. Pyramid clusters must not be marked read merely
  because all preview IDs are read.

## Dynamic Path Hardening

Dynamic paths remain valid for public non-default filters, read/following
overlays, and higher zooms. They must be hardened in the same change.

- Replace every spread-based aggregate over data-dependent arrays in
  `services/api/src/services/property-grouping.ts` with iterative aggregation
  helpers. The required repo scan after implementation is:
  `rg -n "Math\\.(min|max)\\(\\.\\.\\.|\\.map\\(|property_ids.*join|VALUES"
  services/api/src/services/property-grouping.ts`, and each remaining hit must
  be a reviewed bounded/static case or test fixture.
- Cover `serializeBbox`, `socialScoreMax`, `recentSocialScoreTotal`,
  `commentCount`, bbox min/max, score max/sum, preview collection, and any
  candidate/member loop that can operate on grouped property arrays.
- Cap or omit MVT-facing cluster membership in every shared dynamic path that
  can aggregate a large low-zoom group, including public non-default tiles,
  read tiles, following tiles, high-zoom public tiles, `property_ids` string
  serialization, and SQL `VALUES` construction for membership-shaped payloads.
  Dynamic routes may keep complete membership only where the existing contract
  requires it and the path is not exposed to unbounded low-zoom MVT
  serialization.
- Keep high-zoom and non-default dynamic behavior semantically unchanged while
  making large aggregate arrays safe.
- Add regression tests that build large synthetic groups beyond V8 argument
  limits and prove no `RangeError` occurs and no unbounded MVT membership
  string or `VALUES` payload is built for low-zoom clusters. Tests must
  exercise `/tiles/properties` with non-default filters, `/tiles/properties/read`,
  and `/tiles/following/properties` at low zoom.

## Implementation Scope

This is a single target-state implementation. There is no transition serving
mode, phased rollout, compatibility period for old public low-zoom fallback
behavior, deferred TODO, or partial production state.

1. Data model and migrations:
   add pyramid version, current pointer, rendered node, encoded tile cache,
   conditional paged member, and health/failure columns with constraints for
   version-scoped visibility, stable serving-slot current pointer uniqueness,
   and `node_id` uniqueness within each version. Include the concrete primary
   keys, uniqueness constraints, foreign keys, nearby lookup indexes, and
   build-request coalescing indexes listed above.
2. Builder core:
   create full-version public default pyramid builds using existing low-zoom
   facts/candidates and current zoom-local grouping semantics, with iterative
   aggregates and capped previews. Extract or isolate any grouping cache so the
   builder never consumes request-runtime cached groups from another build or
   from a stale dynamic request.
3. Version promotion:
   validate complete candidate versions and atomically publish by updating the
   current pointer only after the full replacement succeeds.
4. Cache integration:
   key in-process and database encoded tile caches by `version_id`; delete or
   ignore retired-version payloads so MVT bytes cannot outlive the logical
   pyramid version. Keep the mandatory tile manifest/status rows versioned and
   validate all covered tiles, including valid empty tiles.
5. Route integration:
   replace public default low-zoom snapshot/dynamic fallback with pyramid lookup
   and the 204 empty-tile miss contract. Preserve endpoint URLs, headers, ETags,
   and content type for successful tiles.
6. Worker integration:
   add full pyramid build dispatch, leases, coalescing, source watermark
   triggers, full-version rebuild scheduling, Postgres-owned durable failure
   state, backoff, terminal handling, and promotion logs. BullMQ must only
   dispatch work that Postgres says is eligible. Replace every existing
   snapshot refresh requester that affects public default low-zoom output with
   the pyramid build-request path.
7. Nearby integration:
   make public default low-zoom `GET /properties/nearby` resolve pyramid nodes
   and return the explicit complete/partial membership contract.
8. App/API contract:
   update MVT parsing, nearby parsing, cluster tapping, preview hydration, Zod
   schemas, generated types, shared types, mocks, and tests so low-zoom clusters
   use capped previews rather than uncapped membership.
9. Dynamic path hardening:
   fix spread-call aggregate crashes in remaining dynamic grouping paths and add
   large-array regression coverage.
10. Production enablement:
   build, validate, and promote the first full pyramid version as the release
   artifact. The release does not run a transition serving mode: the first
   production state after this change serves public default low zoom only
   through the promoted pyramid pointer. Decoded-MVT, route, nearby, worker,
   storage-size, wall-clock, memory, and visual comparisons are merge/deploy
   gates for this change.
11. Test rewrite:
   rewrite existing tests that assert public low-zoom snapshot fallback, raw
   grouping fallback, full cluster membership in MVT, or preview fallback from
   `previewPropertyIds` to `propertyIds`. Those expectations are replaced with
   pyramid serving, capped previews, partial membership, and no raw fallback.

## Acceptance Criteria

- `GET /tiles/properties/0/0/0.pbf` and every other public default
  `z <= PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM` tile route never executes raw
  candidate grouping on cache miss, pyramid miss, or build failure.
- Public default low-zoom serving never reads `property_tile_snapshots`, either
  as a normal cache or as a last-known-good fallback.
- `property_tile_pyramid_current` is keyed by stable serving slot and does not
  include `config_hash`; config changes build new versions behind the existing
  last-known-good pointer. Its primary key is
  `(coverage_id, filter_signature, max_zoom, pyramid_kind)`, and its composite
  foreign key can only reference a promoted version in that same slot.
- Promoted versions store immutable snapshots of coverage/config/build inputs;
  serving never depends on mutable coverage/config rows to explain what an
  existing version contains.
- Candidate identity includes
  `(coverage_id, filter_signature, max_zoom, pyramid_kind, build_inputs_hash,
  source_watermark_hash)`, with source watermark values excluded from
  `build_inputs_hash`.
- Complete low-zoom member storage is created/backfilled only if preflight
  sizing and launch-path audit justify it; otherwise capped previews and node
  summaries are sufficient.
- Pyramid builders cannot read or write request-runtime canonical grouping cache
  entries that are not partitioned by version and build identity.
- A missing/unavailable public default low-zoom pyramid returns the defined
  `204 No Content` contract and records or reuses a durable Postgres build
  request subject to Postgres-owned backoff.
- A complete candidate build is invisible until validation succeeds and
  `property_tile_pyramid_current` is atomically updated.
- Active candidates are validated against closed source watermarks. Later
  mutations enqueue/coalesce successors instead of mutating or invalidating the
  active candidate before validation/promotion.
- Failed builds leave the previous current version active; retryable failures
  back off; terminal failures are not re-enqueued by recovery sweeps.
- Resource limit exits mark the candidate `failed_retryable/resource_limit`,
  release the lease, and publish no partial result.
- Encoded tile payloads are read, cached, invalidated, and deleted by
  `version_id`.
- Valid promoted empty tiles are distinguishable from unavailable/missing
  pyramid states by headers and cache policy, and native does not depend on the
  web-only retry protocol.
- MVT `pyramid_version_id` and `pyramid_node_id` are string-valued scalars, and
  nearby accepts those string IDs for exact feature-originated fallback.
- All existing snapshot refresh requesters that affect public default low-zoom
  output create or coalesce pyramid build requests instead.
- Public default low-zoom `GET /properties/nearby` resolves from pyramid nodes,
  cannot invoke raw low-zoom grouping, and returns the explicit
  complete/partial membership contract. When no promoted pyramid is available,
  it returns the defined `200 null` nearby miss contract instead of falling back
  to dynamic grouping.
- Low-zoom MVT clusters contain capped `preview_property_ids` and no uncapped
  `property_ids` membership.
- App cluster previews and native tap fallback do not use full `propertyIds` as
  a preview fallback for incomplete pyramid clusters, while preserving that
  fallback for singles and dynamic complete groups.
- Read-state calculation does not treat capped preview IDs as complete cluster
  membership; pyramid clusters keep `isRead: false`,
  `membershipComplete: false`, and `readStateCoverage: 'partial'`.
- `/properties/nearby` accepts `pyramidVersionId` and `pyramidNodeId` as a pair
  for exact feature-originated fallback and rejects or ignores partial pairs.
- Existing tests that assumed old fallback/full-membership behavior are
  rewritten to assert the new contract.
- Remaining dynamic grouping paths use iterative aggregate computation and have
  large-array regression coverage across public non-default, read, following,
  and high-zoom public tile paths.
- Ops endpoints, health degradation, metrics, rollback command, retention, and
  first-backfill advisory locks are implemented with the thresholds in this
  plan.
- Existing canonical gate still applies before merge: `pnpm test`.

## Verification Plan

- API route tests prove public default low-zoom tile misses do not call
  `buildMvtForTile()`/`propertyTileRuntime.run()` and return the 204 miss
  contract.
- Tile route tests prove valid promoted empty tiles are cacheable successful
  empty results, while missing manifest rows or failed regeneration return the
  no-store pyramid miss contract.
- Version tests prove candidate rows are invisible before promotion, promotion
  is atomic, failed builds keep the previous current pointer, and terminal
  failures are not re-enqueued.
- Schema tests or migration assertions prove the concrete primary keys,
  uniqueness constraints, foreign keys, build-request coalescing keys, and
  nearby lookup indexes exist.
- Builder isolation tests prove pyramid builds bypass or version-partition
  request-runtime canonical grouping caches.
- Cache tests prove in-process and database MVT caches include `version_id` in
  keys and cannot serve retired-version payloads.
- Builder tests compare decoded MVT features against existing zoom-local
  grouping semantics for representative low-zoom tiles, including owner-tile
  filtering and buffered edge features.
- Nearby API tests cover pyramid singles, pyramid clusters with
  `membershipComplete: false`, `isRead: false`, read-state partial handling,
  Zod schema changes, `pyramidVersionId`/`pyramidNodeId` exact matching,
  partial pair rejection/ignore behavior, `200 null` unavailable behavior,
  generated client type expectations, and native tap fallback behavior.
- App tests cover comma-joined scalar parsing, missing/empty `property_ids`,
  capped `preview_property_ids`, removal of full-membership preview fallback
  only for incomplete pyramid clusters, preservation of fallback for singles
  and dynamic complete groups, and preview hydration. Decoded-MVT tests assert
  `pyramid_version_id` and `pyramid_node_id` are string-valued.
- Dynamic hardening tests create very large synthetic candidate/member arrays
  and verify bbox/max aggregation no longer throws `RangeError`. Route tests
  exercise `/tiles/properties` non-default filters, `/tiles/properties/read`,
  and `/tiles/following/properties` at low zoom and prove no unbounded
  `property_ids` or SQL `VALUES` payload is built.
- Integration tests cover worker build failure/backoff/terminal handling,
  successful full-version promotion, low-zoom tile serving from pyramid rows,
  and nearby resolution from pyramid nodes.
- Invalidation tests cover every migrated build-request source: tile miss,
  ingest completion, worker recovery, listing changes, comments,
  comment reactions, property likes/reactions, views, official valuation
  updates, price guesses, property geometry/status/coverage/import changes,
  rolling social-window expiry, canonical listing fact writes, and
  source-watermark maintenance.
- Build validation tests assert recorded tile counts, non-empty counts, node
  counts, optional member counts, encoded byte size, estimated/observed heap
  bytes, index bytes, WAL bytes, candidate rows per tile, wall-clock duration,
  and chunk/lease progress are present in `validation_summary`.
- Ops tests cover `GET /ops/property-tile-pyramid`, lightweight `/health`
  degradation, metric emission, rollback command guardrails, retention chunking,
  and backfill advisory lock behavior.
- Existing test rewrites are required in the same change: remove or invert
  tests that expect `property_tile_snapshots` fallback, raw public low-zoom
  grouping fallback, uncapped MVT `propertyIds` for clusters, old nearby schema
  requirements for complete cluster membership, read-state based on preview
  membership, or app preview fallback from `previewPropertyIds` to
  `propertyIds`.
- Run the canonical repo gate before merge: `pnpm test`.
- Because this changes tile serving, web client retry behavior, map rendering,
  and native tap fallback, merge verification also runs
  `pnpm test:e2e:visual`, `pnpm test:e2e:flows`, and
  `pnpm test:e2e:mobile`, or records the concrete unavailable harness blocker
  in the implementation report.

## References

- Local hardening predecessor:
  `docs/plans/2026-05-01-property-tile-pipeline-hardening-plan.md`.
- Current dynamic grouping and MVT serialization:
  `services/api/src/services/property-grouping.ts`.
- Current snapshot refresh worker path:
  `services/api/src/services/property-tile-snapshots.ts` and
  `services/worker/src/runtime.ts`.
- Current public property tile route:
  `services/api/src/routes/tiles.ts`.
- Current nearby route and schema:
  `services/api/src/routes/properties.ts`.
- Current app MVT/nearby parsing and tap handling:
  `apps/app/src/utils/api.ts` and `apps/app/src/hooks/useMapInteraction.ts`.
- Mapbox Vector Tile Specification, current version 2.1:
  https://mapbox.github.io/vector-tile-spec/
- PostGIS `ST_AsMVT` official docs:
  https://postgis.net/docs/ST_AsMVT.html
- PostGIS `ST_AsMVTGeom` official docs:
  https://postgis.net/docs/ST_AsMVTGeom.html

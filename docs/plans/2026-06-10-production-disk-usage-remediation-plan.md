# Production Disk Usage Remediation Plan

Date: 2026-06-10

## Context

Production app VM disk was effectively full before emergency remediation:

- Root filesystem: 301G total, about 288G used, about 3.5M free when
  emergency cleanup began.
- App Postgres Docker volume: about 190GiB by `du`, 188GB database size.
- Photon Docker volume: about 88GiB for the planet dump.
- Redis, Coolify, containers, and images are minor.
- Scraper VM is not under pressure: 38G disk, 15G used, largest scraper DB
  about 1.4GB.

The app has no meaningful userbase yet, and downtime/locking is acceptable.
Prefer a simple destructive maintenance path over complex online surgery.

## Remediation Status

Emergency remediation was completed on 2026-06-10.

Current production state as of 2026-06-10 13:21 UTC:

- Root filesystem: 301G total, 133G used, 156G free, 47% used.
- App Postgres Docker volume: about 80G.
- Photon Docker volume: about 44G after replacing the planet dump with the
  Europe regional dump.
- API, Postgres, Redis, and Photon are healthy.
- Property tile pyramid health is `ok`.
- Current pyramid version: `8218c45c-c518-438a-bcc1-7044f1e93005`.
- Previous pyramid version: `420471bf-4da8-4fc8-8826-b43513c4c906`.
- Active pyramid candidate: none.
- Worker is intentionally stopped until the rebuild-cadence bug is fixed.

Actions taken:

- Cleaned journald, apt cache, Docker build cache, and oversized logs. This
  freed about 1.4G, which was not enough for Postgres crash recovery.
- Stopped API, worker, and Photon before destructive maintenance.
- Deleted the old Photon planet data to create emergency headroom.
- Let Postgres complete crash recovery.
- Truncated generated property tile pipeline/cache tables with
  `TRUNCATE ... RESTART IDENTITY CASCADE`, then ran `ANALYZE`.
- Rebuilt and promoted fresh tile pyramid generations from canonical data.
- Removed an abandoned third build candidate after stopping the worker.
- Replaced Photon with the Europe regional dump:
  `https://download1.graphhopper.com/public/europe/photon-db-europe-1.0-latest.tar.bz2`.

## Main Finding

Pre-remediation expected large datasets:

- `properties` is 39GB for the multi-country property/address corpus.
- `osm_buildings` is 32GB for 3D building geometry.
- Photon was 88GiB for the planet geocoder index. Production now uses the
  Europe dump, about 44G extracted as of 2026-06-10.

Pre-remediation unexpected/suboptimal generated datasets:

- `property_tile_grouping_facts`: 59GB.
- `property_tile_listing_candidates`: 20GB.
- `property_tile_listing_facts`: 15GB.
- `property_tile_pyramid_tiles`: 11GB.
- `property_tile_pyramid_nodes`: 5.9GB.

These are generated tile-pipeline datasets. Before remediation, production had
hundreds of retained generations:

- 352 `ready` candidate source snapshots.
- 526 `promoted` tile pyramid versions, and 531 versions total.
- About 99.7% of candidate/fact rows are not the current snapshot.
- About 99.6% of pyramid rows are not current or previous version.

The worker recovery sweep does call the pyramid build request path regularly,
and the mutation/worker-recovery entry points do have per-scope
throttling/coalescing policies (listing 60s coalesce, social/views 5min
coalesce, all with 15min max lag). But throttling is not the root problem.
The build fingerprint's source watermarks include a time-derived input: the
rolling social window is bucketed by hour (`rolling_social_window` with
`bucketUnit: 'hour'` in
`services/api/src/services/property-tile-pyramid.ts`). The comparable source
watermark hash used for successor eligibility strips repair/projection
fingerprints but does not strip this rolling window bucket. As a result the
comparable hash changes every hour even when no canonical data changed,
successful promotion sees an "advanced" watermark and requests a successor,
and the pipeline chains roughly one full global low-zoom rebuild per hour
indefinitely — even on an idle database.

The worker recovery sweep is not the only build trigger. Public tile serving
can also request a rebuild for missing/unavailable/degraded pyramid cases
(`tile-miss`, `manifest-missing`, and payload regeneration/repair reasons),
and mutation paths request builds for listing, social, view, official
valuation, and ingest changes. There is no shared build eligibility layer
today: mutation paths, worker recovery, and the tile-route repair path are
three independent entry points with different gating, and the tile-route
repair path (`requestPyramidBuildForTileRoute` in
`services/api/src/routes/tiles.ts`) has no policy throttling at all — it
relies only on the `(build_inputs_hash, source_watermark_hash)` duplicate
constraint, which the hourly bucket drift defeats once per hour. The fix must
therefore create a new single shared eligibility gate and route every caller
through it; the gate does not exist yet and cannot be bolted onto worker
recovery alone.

This is now confirmed operationally: after the first fresh generation promoted,
production immediately started a second build, and after the second promoted it
started a third build. The worker remains stopped to prevent renewed generated
data growth until build eligibility/cadence is fixed.

Retention deletes in chunks and currently keeps current plus previous promoted
versions, with age guards for non-retained generated rows. In practice the
policy could not keep up by construction, not by tuning: retention is
triggered only inside the worker recovery sweep, at most once per UTC day
(default 03:20 UTC via
`WORKER_PROPERTY_TILE_PYRAMID_RETENTION_UTC_MINUTE_OF_DAY`), and each run is
capped at 25 chunks of 10,000 rows per table step. With roughly 24 chained
full builds per day, each writing on the order of millions of
candidate/fact/node/tile rows, a once-daily run capped at about 250K rows per
table is arithmetically incapable of bounding growth — old generated rows
were guaranteed to accumulate regardless of how the deletes were chunked.
Two further structural gaps: retention never runs while the worker is stopped
(acceptable in the current emergency only because builds are also stopped),
and bulk deletes do not return Postgres table files to the OS without a table
rewrite or table/partition drop.

## Root Cause Fix Decision

This is the single decided fix for the unbounded-growth bug. It is one
decision with three inseparable parts — fingerprint, gate, and promotion-time
retention. Implementing any one part without the others leaves the bug alive:
fixing the fingerprint without the gate leaves the unthrottled tile-route
path; adding the gate without fixing the fingerprint makes the gate fire a
full rebuild every cadence window even when nothing changed; doing both
without promotion-time retention still lets generations outrun a once-daily
sweep.

Decision: full global pyramid rebuilds become canonical-change-driven and
cadence-bounded, evaluated in exactly one shared eligibility gate, and every
successful promotion immediately re-establishes the generation cap.

1. Canonical-only comparable fingerprint (removes the chain driver). Coarsen
   the time-derived `rolling_social_window` watermark bucket from 1 hour to
   the configured full-rebuild cadence (new
   `PROPERTY_TILE_PYRAMID_FULL_REBUILD_CADENCE_MS`, default 24 hours), and
   exclude sub-cadence time-bucket drift from the comparable source watermark
   hash used by successor eligibility — the same hash family that already
   strips repair/projection fingerprints. After this, promotion can only
   request a successor when canonical sources (listing facts, property
   status, geometry, social/view content, official valuations, ingest)
   actually advanced, or when a full cadence window has elapsed. The
   cadence-elapsed rebuild is what keeps the rolling social window from going
   permanently stale, so freshness of the low-zoom overview degrades to at
   most one cadence period, never further.

2. One shared eligibility gate (removes the bypasses). Add a single
   `claimPropertyTilePyramidFullBuildEligibility()` choke point in the
   property tile pyramid service, called by every enqueue path before any
   build request row or queue job is created: mutation hooks (listing,
   social, views), worker recovery, successor-after-promotion, ingest
   maintenance and skipped-ingest recovery, official valuation hydration, and
   the tile-route repair reasons (`tile-miss`, `manifest-missing`, payload
   regeneration errors). The tile route loses its current direct, ungated
   call. Gate verdicts:
   - allow when canonical comparable watermarks advanced and the
     cadence/budget permits;
   - allow repair reasons only when the current generation is genuinely
     missing or corrupt (no usable current version), independent of watermark
     drift;
   - always allow an explicit operator override;
   - otherwise deny, recording the coalesced demand in
     `property_tile_pyramid_source_watermarks` pending state so it is honored
     at the next cadence boundary instead of being lost.

3. Promotion-time retention (removes the race). Implement the generated storage
   migration in the same pass so successful promotion synchronously enforces the
   retained-generation cap — current, previous, and active-build generations
   only — by dropping old generation tables/partitions. This must be a
   metadata-level table/partition drop path from the start, not a monolithic
   `DELETE` cleanup path on the current generated tables. The once-daily
   worker-recovery retention remains only as a backstop for crash windows; it is
   no longer the primary mechanism.

Resulting steady state: at most one full rebuild per cadence window plus
rebuilds driven by genuine canonical change, the duplicate-request constraint
becomes effective again because the hash no longer drifts hourly, and
generated tables can never hold more than three generations of data.

## Optimal Solution

### 1. Generated Tile Pipeline Storage

Problem: full-copy tile candidate/fact snapshots and pyramid versions are
generated too often and retained too long.

Solution: make generated tile data disposable and bounded without making
listing freshness globally worse.

- Keep the current and previous promoted pyramid versions for serving and
  rollback.
- Keep the current candidate source snapshot plus any snapshot referenced by an
  active or retained pyramid version. Do not delete a snapshot while a build can
  still reference it through `property_tile_pyramid_versions.candidate_snapshot_id`.
- When API/worker processes are stopped for destructive maintenance, it is
  acceptable to truncate all generated tile pipeline tables and rebuild from
  canonical data.
- Preserve immediate freshness in canonical listings, property detail/preview
  routes, search, and listing APIs.
- Stop rebuilding the full global low-zoom pyramid after every small listing
  watermark movement. Low-zoom tiles are an overview/indexing surface, not the
  source of truth.
- Update low-zoom precomputed tiles on an explicit bounded cadence or by
  operator request. If changed listings need immediate map visibility before the
  next full materialization, serve them from a small overlay/delta path instead
  of triggering a global pyramid rebuild.
- Treat tile candidate/fact tables and pyramid tables as generated cache, not
  historical truth. Historical truth remains in canonical listings, source
  observations, properties, and scraper mirrors.

Implementation shape:

- Add a hard retention policy that keeps only data referenced by the current
  version, previous version, or active builds, enforced synchronously at
  promotion per the Root Cause Fix Decision rather than waiting for the daily
  sweep. Because this remediation will be implemented in one pass with downtime,
  do not add an interim chunked-delete cleanup path for the current monolithic
  generated tables. Migrate generated storage to partition/table-per-build
  cleanup first, then wipe the old generated data offline and rebuild one fresh
  current generation. Promotion-time retention must release old generated data
  with table/partition drops so it returns disk space and avoids vacuum debt.
- Do not frame the worker recovery sweep as the sole bug. Keep recovery for
  stuck/failed work, but change build eligibility so small watermark changes do
  not continuously request full global pyramid successors while a valid current
  version exists. Concretely, this means the canonical-only comparable
  fingerprint from the Root Cause Fix Decision: the hourly
  `rolling_social_window` bucket must be coarsened to the rebuild cadence and
  excluded from successor-eligibility comparison.
- Route all request reasons and callers through the new single shared
  eligibility gate (`claimPropertyTilePyramidFullBuildEligibility()`):
  worker recovery, post-mutation calls, ingest maintenance/recovery, official
  valuation hydration, public tile misses, manifest repair, and payload
  regeneration errors. This gate is new code — no shared eligibility layer
  exists today, and the tile-route repair path currently calls the build
  request function directly with no policy throttling. Route-triggered repair
  may enqueue a rebuild only when the current generation is genuinely
  missing/corrupt or an operator override is supplied; ordinary watermark
  drift must wait for the configured cadence.
- Separate high-frequency canonical listing freshness from low-zoom tile
  materialization. Full low-zoom rebuilds should be manual or cadence-gated;
  source watermark drift alone must not chain successor builds after promotion.
- Keep audit metadata in compact version rows, not in full copied fact rows.

### 2. Reclaiming Existing Postgres Disk

Problem: deleting old rows would not have immediately shrunk the 188GiB Docker
volume.

Solution used: because downtime was acceptable, use offline destructive
maintenance instead of online bloat surgery.

- Put the app in maintenance/offline mode and stop API/worker processes that can
  read or write the generated tile tables.
- Back up required production state before destructive cleanup.
- Drop/truncate generated tile pipeline data either with explicit `CASCADE` or
  in child-to-parent dependency order. That includes pyramid current pointers,
  pyramid tile/node rows, optional legacy pyramid member rows if
  `to_regclass('property_tile_pyramid_members')` exists, pyramid version rows,
  candidate source current pointers, candidate/fact/social/grouping fact rows,
  candidate source snapshot rows, and legacy snapshot metadata/cache tables
  (`property_tile_snapshots`, `property_tile_snapshot_coverage`,
  `property_tile_snapshot_refresh_state`, and
  `property_tile_snapshot_watermarks`) when the goal is a fully clean generated
  tile-pipeline reset.
- `property_tile_pyramid_source_watermarks` is small invalidation/coalescing
  state, not a large generated fact table. It may be reset only during a fully
  offline destructive generated-pipeline reset where the next generation is
  rebuilt from scratch. Do not include it in ordinary retention, because doing
  so erases the coalescing state used to throttle rebuild requests.
- Rebuild only one current generation, then run `ANALYZE` on rebuilt tables.

Use `TRUNCATE` or table/partition drop for the generated cache tables whenever
possible. Plain `DELETE` is not enough for this emergency because it leaves
table files allocated. `VACUUM FULL`/online repack is less attractive at this
stage because it needs extra working space and the generated tables can be
reconstructed from canonical app data. Preserve source-of-truth tables such as
`properties`, `osm_buildings`, canonical listings, source observations, and
location/search datasets during this remediation.

This part is complete for the emergency incident. The Postgres Docker volume is
now about 80G, and the generated `property_tile_*` tables were rebuilt from
scratch.

### 3. Tile Pipeline Table Design

Problem: retention currently deletes millions of rows from large monolithic
tables.

Solution: partition or stage generated tables by generation key, with a hard cap
on retained generations.

- Partition candidate/fact tables by `snapshot_id`.
- Partition pyramid node/tile tables by `version_id`.
- If the implementation keeps `property_tile_pyramid_members` or reintroduces
  equivalent membership rows, partition/drop them by `version_id` as part of the
  same generation lifecycle.
- Retention should drop/detach old partitions rather than bulk-delete rows.
- A table-per-build staging flow is also acceptable: build into fresh staging
  tables, atomically promote pointers after validation, then drop the old
  generated tables/partitions.
- Keep only current, previous, and active-build generations. Build cadence must
  be bounded before partitioning/table-per-build is enabled so the database does
  not trade table bloat for catalog churn.
- Keep compact metadata rows for audit and health, but do not retain full
  candidate/fact/node/tile payload copies as historical records.

This makes cleanup predictable, fast, and avoids most vacuum debt from generated
data churn.

### 4. Photon Storage

Problem: the old Photon planet dump used 88GiB on the same root disk as
Postgres.

Emergency solution used: replace the planet dump with the Europe regional dump.
This reduced Photon to about 44G and aligned the geocoder with the app's
European product scope.

- Current production Photon source:
  `https://download1.graphhopper.com/public/europe/photon-db-europe-1.0-latest.tar.bz2`.
- The app still stores Photon on the app root disk.
- Keep Photon Europe-scoped on the app root disk for this plan.

Photon was not the root cause of the unbounded growth, but removing/replacing it
was the correct emergency headroom lever because Postgres could not complete
crash recovery while the root filesystem was full. The urgent product bug
remains the Postgres tile generation/rebuild/retention pattern.

### 5. Base Geospatial Data

Problem: `properties` and `osm_buildings` are large but core product datasets.

Solution: keep them in Postgres for now, but do not duplicate them into
long-lived generated fact snapshots.

- Leave `properties` and `osm_buildings` as authoritative geospatial serving
  datasets.
- Refresh table statistics after destructive generated-table cleanup and after
  rebuilding the current generated tile generation.
- Avoid adding broad duplicate indexes without measured query need.

### 6. Documentation Hygiene

Problem: repo documentation still contains stale statements that can mislead
future remediation work.

Solution: update docs that describe the materialized pyramid as deferred once
the cadence fix lands.

- `DEFERRED-GAPS.md` currently says the materialized property tile pyramid
  rollout is deferred on an old branch, while the current codebase contains live
  pyramid schema, routes, service code, and worker integration.
- Do not treat this docs drift as production remediation work, but clean it up
  with the implementation PR so future agents do not reason from stale state.

### 7. Operational Guardrails

Problem: disk filled before the issue was noticed.

Solution: add simple hard alerts and circuit breakers.

- Alert when root disk exceeds 75%, 85%, and 95% from host/node-level
  monitoring.
- Alert on generated table generation count greater than 3.
- Alert when any generated tile table exceeds a fixed size budget.
- Stop automatic full pyramid builds when Postgres-reported database size,
  generated relation sizes, or generated generation counts exceed configured
  safety thresholds. Do not rely on the API container alone to inspect host
  filesystem free space.
- Block automatic full rebuilds in the shared build request path before any
  worker, mutation hook, ingest task, official valuation task, or tile route can
  enqueue a global build beyond the configured cadence/budget.
- Expose current pyramid version age, queued/building version count, retained
  generation count, generated table sizes, and last retention/drop result in
  health/ops output.

## Target End State

- App root disk has clear headroom after a destructive maintenance rebuild.
- Postgres keeps durable source-of-truth data plus one active generated tile
  generation and one rollback generation.
- Full low-zoom pyramid rebuilds happen on a bounded cadence or manually.
- Old generated data is removed by partition drop/detach.
- Photon is Europe-scoped and smaller on the app root disk.
- Disk growth from generated data is observable and capped.
- Documentation no longer describes the materialized pyramid as merely deferred.

## Finalized Implementation Requirements

- Implement the Root Cause Fix Decision as one unit: canonical-only comparable
  fingerprint (hourly `rolling_social_window` bucket coarsened to the
  configured full-rebuild cadence and excluded from successor-eligibility
  comparison), a single shared
  `claimPropertyTilePyramidFullBuildEligibility()` gate, and synchronous
  promotion-time retention. Shipping a subset does not fix the bug.
- Build eligibility must prevent source watermark drift — in particular the
  time-derived rolling social window bucket — from chaining full global
  successor builds while a valid current pyramid exists.
- The shared eligibility gate is new code; no such layer exists today. Every
  build request caller must be routed through it, including ingest
  maintenance, skipped ingest recovery, official valuation hydration, and the
  tile-miss/manifest-missing/payload-regeneration repair paths. The tile-route
  repair path currently bypasses all policy throttling and must lose its
  direct call.
- Promotion must immediately and synchronously enforce the retained-generation
  cap for generated data: current, previous, and active-build generations only.
  In this one-pass remediation, that enforcement must use generation
  table/partition drops from the start, not long-running bulk deletes on the
  current monolithic generated tables. The once-daily, chunk-capped retention
  sweep is a backstop only — it is arithmetically unable to keep up with
  frequent full builds and never runs while the worker is stopped.
- Existing monolithic generated tile-pipeline data should be removed during the
  offline rebuild with `TRUNCATE`/drop, then regenerated into the new bounded
  storage layout. Do not carry the old generated rows forward and try to reclaim
  them with bulk deletes.
- `property_tile_pyramid_source_watermarks` must be preserved during ordinary
  retention and reset only during an explicitly offline full generated-pipeline
  rebuild.
- Cleanup scripts must handle optional legacy tables such as
  `property_tile_pyramid_members` with existence checks instead of assuming
  they are present in every schema.
- Operational guardrails must block automatic full rebuilds before generated
  data can grow beyond the configured budget.

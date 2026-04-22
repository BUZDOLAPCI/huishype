# Map Tile Performance Remediation Plan

Date: 2026-04-22
Status: Proposed

## Summary

The current branch introduced meaningful map/tile functionality, but the backend
tile miss path regressed badly versus `main` on broad city tiles. The main
problem is not warm-cache serving. The regression is concentrated in cold tile
generation, especially grouped public z13 tiles and the new private read overlay
path.

This plan is for a fresh swarm to restore acceptable cold-path performance
without giving up the new map behaviors.

## Related Context

- [Following Personalized Grouped Tiles Plan](/home/caslan/dev/git_repos/hh/huishype/docs/plans/2026-04-20-following-personalized-grouped-tiles-plan.md)
- [Viewed Property Read State Plan](/home/caslan/dev/git_repos/hh/huishype/docs/plans/2026-04-21-viewed-property-read-state-plan.md)

## Benchmark Notes

Side-by-side benchmark setup used isolated app processes and isolated database
clones:

- branch API on `3201` against `huishype_bench_branch`
- `main` API on `3202` against `huishype_bench_main`
- raw benchmark artifacts saved under `/tmp/huishype-bench-20260422`

Measured cold public tile misses with `autocannon -a 1 -c 1`:

- Eindhoven z13 `/tiles/properties/13/4220/2726.pbf`: branch `2907ms`, main `375ms` (`7.75x` slower)
- Amsterdam z13 `/tiles/properties/13/4207/2692.pbf`: branch `6433ms`, main `1329ms` (`4.84x` slower)
- Eindhoven z17 `/tiles/properties/17/67526/43622.pbf`: branch `68ms`, main `58ms`
- Amsterdam z17 `/tiles/properties/17/67315/43074.pbf`: branch `61ms`, main `47ms`

Important context:

- warm cached public tiles were fast on both branch and `main`
- payload size growth on the slow z13 tiles was modest, so transfer size does
  not explain the latency gap
- private read-overlay z13 requests on the branch were effectively as expensive
  as public cold misses even when they returned `204`

## What Must Be Fixed

1. Restore public grouped tile miss performance for broad city tiles.
2. Stop the private read overlay from paying near-full public tile cost on each request.
3. Remove obvious client-side invalidation and rendering churn introduced by the new read-state flow.
4. Eliminate remaining high-cost query patterns that compound tile and property endpoint work.

## Workstreams

### 1. Public Tile Cold Path

- Revisit the grouped property tile query shape for low-zoom city tiles.
- Reduce or remove per-property lateral fanout in the cold miss path.
- Preserve current public cache behavior once a tile is generated.
- Benchmark against `main` after each major query-shape change instead of relying
  on intuition.

### 2. Private Read Overlay

- Redesign the read overlay so it does not rebuild the full public grouping path
  on every request.
- Decide whether the overlay should be derived from cheaper precomputed state,
  a narrower query path, a short-lived private cache, or a combination.
- Keep public tiles viewer-agnostic and cache-friendly.
- Re-benchmark read tiles separately from public tiles.

### 3. Client Read-State Churn

- Remove redundant property-view writes and dedupe read-state updates across map
  preview and sheet entry points.
- Avoid invalidating map sources or rebuilding full map style state more often
  than necessary.
- Re-check native and web behavior after changes to ensure the read-state UI
  still feels immediate.

### 4. Web Map Update Loop

- Review the visible-feature read-state sync loop added on web.
- Reduce viewport-wide `queryRenderedFeatures` and per-feature `setFeatureState`
  churn where possible.
- Verify that any optimization preserves correct read/unread visuals while
  reducing CPU work during pan, zoom, and idle transitions.

### 5. Remaining Query Cleanup

- Remove repeated expensive join work in activity-filtered property endpoints.
- Fix obvious index-hostile predicate patterns where a new index was added but
  the query shape still blocks efficient use.
- Treat these as follow-up wins, but not as a substitute for fixing the tile
  cold path first.

## Priority Order

1. Public grouped tile cold path
2. Private read overlay cold path
3. Client read-state invalidation churn
4. Web feature-state sync loop
5. Secondary endpoint query cleanup

## Success Criteria

- Eindhoven and Amsterdam z13 public cold tiles are brought back near `main`, or
  the remaining delta is small and clearly justified by the new product behavior.
- Read-overlay cold requests are materially cheaper than public cold grouped
  tiles and no longer pay near-full regrouping cost when the response is empty.
- Warm public tile behavior remains fast and unchanged.
- The client no longer emits redundant view writes or excessive source/style
  invalidations for normal property viewing flows.
- No regression to `Following`, read-state visuals, or map interaction behavior.

## Validation

- Re-run side-by-side branch versus `main` benchmarks on the same Eindhoven and
  Amsterdam tiles.
- Benchmark both public and read-overlay paths after each major backend change.
- Capture before/after numbers in the swarm’s handoff notes.
- Run the canonical repo gate before landing: `pnpm test`.

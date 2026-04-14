# Density-Aware Node Grouping Redesign

## Summary

This document defines the implementation plan for replacing the current
hardcoded map node grouping behavior with a density-aware, visually grounded
system.

The redesign is not a backend-only clustering tweak. It is an atomic migration
across:

- backend tile generation
- nearby tap fallback semantics
- tile feature and nearby API contracts
- style layer contracts
- web/native interaction code
- shared types, OpenAPI, specs, and tests

The final system must:

- remove the current "stop grouping after `z17`" rule for active nodes
- keep grouping server-side for web/native parity
- base grouping on visual crowding in tile-local space, not degree-space grids
- keep ghost nodes on a separate grouping path from active nodes
- keep ghost reveal at the current threshold
- preserve deterministic, bounded performance
- avoid workarounds, temporary compatibility shims, and building-specific logic

## Hard Constraints

These are fixed.

- Do not add apartment, terrace, or building-type heuristics.
- Do not split behavior between web and native clients.
- Do not introduce a second grouping algorithm for nearby fallback.
- Do not keep legacy layer IDs or legacy fields as temporary aliases unless
  they remain part of the final intended contract.
- Do not defer contract cleanup to a follow-up. This migration includes the
  final contract shape.

## Current State

### Backend behavior today

The current backend has a hard split:

- below `z17`: active-only properties are clustered with `ST_SnapToGrid`
- at and above `z17`: clustering stops and individual points are returned,
  including ghost nodes

Relevant code:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts)
- [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts)

Important details:

- `tiles.ts` currently switches between `getClusteredMVT()` and
  `getIndividualPointsMVT()` at `z17`
- low-zoom grouping is based on `ST_SnapToGrid`, which is cheap but geographic,
  not visual
- `/properties/nearby` repeats the same high-zoom "no clustering" split
- runtime ghost classification is `NOT has_listing AND activity_score = 0`

### Frontend and style behavior today

The current layer set is:

- `property-clusters`
- `cluster-count`
- `single-active-points`
- `active-nodes`
- `ghost-nodes`

This is not just styling. It is part of the interaction contract:

- `single-active-points` acts as the low-zoom single bridge layer
- `active-nodes` and `ghost-nodes` assume the high-zoom split
- web and native both hardcode the queryable property layer IDs

Also relevant:

- the shared interaction hook already mostly treats `point_count > 1` as the
  cluster detector
- some renderer paths and camera moves still encode the old zoom split
- cluster labels currently force overlap and placement ignore behavior, which
  makes dense areas harder to read

### Current problems

- grouping disappears completely at high zoom even when singles still collide
- grouping strength is based on degree-space grids, not visual density
- tile rendering and nearby fallback do not have a shared grouping engine
- buffered tile-edge behavior is not defined, so any redesign risks duplicate
  or flickering edge groups without an ownership rule
- ghost semantics and reveal-threshold assumptions have already drifted across
  runtime, shared types, helpers, and tests

## Findings

### 1. The current failure is the binary `z17` split

The main issue is not clustering itself. It is the hard transition from:

- grouped active-only tiles below `z17`
- ungrouped active plus ghost singles at `z17+`

That is why grouping appears to stop abruptly.

### 2. `ST_SnapToGrid` is the wrong final primitive

`ST_SnapToGrid` is fast, but the current usage answers the wrong question. It
groups by a fixed geographic grid per zoom instead of asking:

"Would these nodes visually collide or feel too dense on screen?"

### 3. Ghosts are a separate visual system

Desired product behavior is:

- ghosts never cluster with active nodes
- ghosts only cluster with other ghosts
- active occupancy suppresses visually conflicting ghosts
- ghosts remain hidden below the current reveal threshold
- ghost grouping is weaker and lower-emphasis than active grouping

The canonical ghost classifier must remain:

- `NOT has_listing AND activity_score = 0`

### 4. Server-side parity is still the right architecture

Grouping should stay server-side because it gives:

- one source of truth for web and native
- one source of truth for rendering and fallback interaction
- bounded, measurable performance
- deterministic behavior for tests

### 5. Tile buffering requires ownership, not just extra fetch area

A buffered candidate query is necessary, but not sufficient. Without an
ownership rule, adjacent tiles can emit different or duplicate edge groups.

The final plan must define:

- how buffered candidates participate in grouping
- which tile is allowed to emit each final grouped feature
- how nearby fallback resolves groups near tile edges using the same rules

### 6. This is a contract migration, not an algorithm-only change

The implementation changes the meaning of:

- which layers exist
- what feature metadata is emitted
- how nearby fallback identifies singles vs clusters
- which fields app code depends on
- which tests and helpers are valid

The migration therefore must be atomic across backend, frontend, shared types,
OpenAPI, generated client surfaces, and tests.

## Final Product Decisions

These decisions are resolved and fixed:

- Active nodes may still group at any zoom if density requires it.
- Sparse active areas must naturally de-cluster without a hard zoom cutoff.
- Ghost reveal stays at the current threshold.
- Ghosts cluster only with ghosts.
- Ghost clusters show a subtle count.
- Active occupancy suppresses conflicting ghosts.
- Grouping stays general and visual-density-based.
- The implementation updates runtime, docs, shared types, OpenAPI, generated
  client surfaces, helpers, and tests in the same migration.

## Target Behavior

### Active nodes

- active nodes continue grouping whenever rendered singles would overlap or
  feel unreadably dense
- sparse areas naturally resolve to singles
- active grouping should feel less clumpy than today

### Ghost nodes

- ghosts remain hidden below `z17`
- at `z17+`, ghosts participate in a separate ghost-only grouping pass
- ghost grouping is intentionally weaker than active grouping
- ghost clusters show a subtle count
- ghosts inside active occupancy are omitted

### Mixed active and ghost areas

- active results take visual precedence
- ghosts never mix into active clusters
- active occupancy is computed before ghost grouping starts
- non-conflicting ghosts still render

### Interaction behavior

- cluster vs single behavior is driven by final feature metadata, not zoom
- clusters with `point_count <= 30` open preview
- clusters with `point_count > 30` zoom to bounds
- if a dense group still exists at max useful zoom, preview opens instead of
  forcing a dead-end zoom action

## Canonical Architecture

### 1. One backend grouping engine

Create one canonical backend grouping engine for property nodes. Both of these
surfaces must use it:

- vector tile generation
- `/properties/nearby` cluster fallback

This engine owns:

- candidate filtering
- projection into tile-local coordinates
- active and ghost grouping
- active occupancy suppression of ghosts
- representative-anchor selection
- preview member ordering
- bounds computation

`/properties/nearby` must not reimplement grouping with its own SQL rule set.

### 2. Tile-local grouping, not degree-space grouping

Grouping decisions must be made in tile-local units derived from visual
footprint, not in longitude/latitude grid size.

Required pipeline:

1. Fetch candidates for a tile plus edge buffer.
2. Project candidates into tile-local MVT extent coordinates.
3. Group in tile-local space using rendered-footprint-aware radii.
4. Emit only the groups owned by the current tile.

### 3. Buffered fetch plus deterministic tile ownership

The engine must fetch a buffered candidate set so edge neighborhoods are seen
consistently.

It must also apply a deterministic ownership rule so a final feature is emitted
by exactly one tile.

Required ownership rule:

- every final grouped feature chooses a representative anchor that is a real
  member point
- the tile that contains that representative anchor in its unbuffered bounds is
  the owning tile
- non-owning tiles must not emit that feature even if the feature was formed
  using their buffered candidates

Nearby fallback must respect the same rule. Because the nearest visible feature
may be owned by a neighboring tile, nearby resolution should evaluate the tap's
owning tile and the adjacent tile neighborhood at the same zoom, then select
from the emitted features produced by the shared engine.

### 4. Separate active and ghost passes

Use two passes in this order:

1. Active pass
2. Ghost pass

#### Active pass

- candidate set: everything that is not a ghost
- deterministic priority order:
  - higher activity first
  - listings before non-listings when activity ties
  - higher like count next
  - stable `id` tie-breaker last
- build active singles or active clusters
- reserve active occupancy from the final active result, not from raw input

#### Ghost pass

- candidate set: canonical ghosts only
- only runs at `z >= 17`
- first suppress ghosts that fall inside active occupancy plus ghost padding
- group the remaining ghosts only with other ghosts

### 5. Performance boundaries are part of the design

This plan does not allow an unbounded "load everything into Node and compare
everything to everything" implementation.

Required constraints:

- candidate fetches stay bounded to buffered tile extents only
- grouping complexity must be spatially bucketed or otherwise neighborhood
  bounded; no all-pairs scan over the candidate set
- the engine may project rows in SQL and group in application code, but the
  algorithm must be linear or near-linear in the buffered tile candidate set
- no second coarse fallback algorithm is allowed for dense tiles
- tile performance must be measured against the existing slow-tile logging path
  and validated in integration tests for dense fixtures

The grouping engine should therefore use a deterministic spatial index in
tile-local space, such as a fixed-size spatial hash keyed to grouping radius,
instead of global pairwise comparisons.

### 6. Visual footprint drives the grouping constants

The grouping radii must be derived from the final rendered marker footprints,
not from arbitrary standalone constants detached from the style.

Required rule:

- active grouping footprint is derived from the final active single and active
  cluster styling
- ghost grouping footprint is derived from the final ghost single and
  ghost-cluster styling
- ghost suppression uses the final active occupancy footprint plus explicit
  ghost padding

Do not hardcode one generic suppression radius that ignores the actual rendered
size of active singles vs active clusters.

### 7. Representative anchors and preview ordering must be deterministic

Do not use `ST_Centroid(ST_Collect(...))` as the displayed anchor.

Each final cluster must choose a real member point as its representative.

Required selection rules:

- representative anchor is chosen from actual member points
- selection is stable and deterministic
- selection prefers a point near the cluster's local center while also honoring
  priority ordering, so the anchor remains visually plausible and socially
  meaningful

Preview ordering must also be canonical across tiles and nearby fallback.

Required ordering rules:

- use one final priority order for preview members
- cap preview members at `30`
- do not let tiles order members by one rule and nearby fallback order by a
  different rule

### 8. Canonical group model first, transport encoding second

Define one canonical backend group model, then serialize it for each transport.

Canonical fields:

- `node_class: 'active' | 'ghost'`
- `group_kind: 'single' | 'cluster'`
- `primary_property_id`
- `point_count`
- `property_ids`
- `preview_property_ids`
- `bbox`
- cluster-level activity summary fields needed by styling
- single-property preview fields needed by interaction and property cards

Final contract rules:

- singles expose one canonical property identity via `primary_property_id`, and
  transport-specific encodings may also expose `id` where the existing consumer
  surface requires it
- clusters expose the full stable ordered membership list via `property_ids`
- clusters expose the preview-capped ordered subset via `preview_property_ids`
- bounds remain cluster-only data even if transport encoding flattens them into
  `bbox_*` fields
- tiles and nearby fallback must represent the same semantic model even if MVT
  encoding and JSON encoding differ at the transport layer

Transport rules:

- tiles may encode arrays or objects into transport-safe MVT properties at the
  serialization edge only
- nearby JSON should use the API's camelCase transport contract directly
  (`nodeClass`, `groupKind`, `primaryPropertyId`, `pointCount`,
  `propertyIds`, `previewPropertyIds`, `bbox`, etc.)
- app code should normalize both tile features and nearby JSON into one final
  client-side group model

Do not let current MVT serialization limitations dictate the final domain
contract.

### 9. Atomic layer and interaction contract migration

The old layer split must be replaced in one migration.

Final target layer set:

- `property-clusters` for active clusters
- `cluster-count` for active cluster counts
- `active-nodes` for active singles
- `ghost-clusters` for ghost-only clusters
- `ghost-cluster-count` for ghost cluster counts
- `ghost-nodes` for ghost singles

Remove:

- `single-active-points`

This is an atomic contract change because both web and native query explicit
layer IDs.

Required migration scope:

- backend style generation
- web query layer list
- native query layer list
- interaction logic
- visual helpers
- rendered-feature tests

Do not keep `single-active-points` as a compatibility bridge unless it remains
part of the final intended architecture.

### 10. Frontend interaction cleanup is targeted, not a rewrite

The shared interaction hook already mostly uses `point_count > 1`. The work is
to remove the remaining stale assumptions, not to redesign all interaction
logic.

Required cleanup:

- remove layer-specific assumptions that only low-zoom singles carry certain
  fields
- remove remaining camera assumptions tied to the old split
- ensure cluster expansion and preview logic operate on the final metadata
  contract
- keep web and native interaction semantics aligned

Search and camera follow-on cleanup is included in scope. Any hardcoded "fly to
17" or old cluster-expansion caps must be revisited against the final grouping
behavior and updated in the same migration.

### 11. Shared semantics cleanup is included

Ghost semantics and reveal-threshold assumptions must be made canonical across:

- runtime logic
- shared types
- OpenAPI
- docs
- helpers
- tests

Canonical ghost definition:

- low-emphasis properties present in the dataset with no listing and zero
  social activity
- exact classifier: `NOT has_listing AND activity_score = 0`

## Implementation Plan

### 1. Create the shared backend grouping module

Add one backend module that:

- accepts tile identity and buffered candidate input
- projects into tile-local coordinates
- runs active and ghost grouping with deterministic ownership
- returns canonical grouped results independent of transport

This module becomes the only grouping authority.

### 2. Integrate tiles with the shared engine

Refactor [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts) so it no longer switches between:

- `getClusteredMVT()` below `z17`
- `getIndividualPointsMVT()` at `z17+`

Instead:

- fetch buffered tile candidates
- run the shared grouping engine
- serialize the canonical group model into MVT
- emit only features owned by the current tile

### 3. Integrate nearby fallback with the shared engine

Refactor [services/api/src/routes/properties.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/properties.ts) so nearby fallback no longer duplicates grouping logic with a separate `ST_SnapToGrid` path.

Instead:

- derive the tap tile at the requested zoom
- evaluate the relevant tile neighborhood with the shared grouping engine
- choose the nearest emitted feature under the same semantics as rendering
- return the canonical nearby response shape

### 4. Finalize the emitted contract

Update the backend contract in one pass:

- tile feature metadata
- nearby JSON schema
- OpenAPI
- any generated client surfaces
- app normalization utilities
- shared comments and types

The implementation must name the final fields explicitly and remove stale
dependencies on legacy names unless they remain part of the final contract by
design.

### 5. Update the style and renderer contract

Update:

- [services/api/src/routes/tiles.ts](/home/caslan/dev/git_repos/hh/huishype/services/api/src/routes/tiles.ts)
- [apps/app/app/(tabs)/index.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.tsx)
- [apps/app/app/(tabs)/index.web.tsx](/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx)
- [apps/app/src/hooks/useMapInteraction.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/hooks/useMapInteraction.ts)
- [apps/app/src/utils/api.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/src/utils/api.ts)

Requirements:

- remove `single-active-points`
- add ghost cluster layers
- use final metadata fields for interaction decisions
- remove stale layer-specific and zoom-specific assumptions
- update camera behavior to match the new semantics
- keep label collision behavior readable instead of globally forced overlap

### 6. Update docs, shared types, and helpers

Revise:

- [agent-rules/main-spec.md](/home/caslan/dev/git_repos/hh/huishype/agent-rules/main-spec.md)
- [packages/shared/src/types/property.ts](/home/caslan/dev/git_repos/hh/huishype/packages/shared/src/types/property.ts)
- [apps/app/e2e/visual/helpers/map-layer-names.ts](/home/caslan/dev/git_repos/hh/huishype/apps/app/e2e/visual/helpers/map-layer-names.ts)

Requirements:

- use the canonical ghost definition everywhere
- remove stale threshold comments and helper constants
- document the final layer contract instead of the old zoom split

## Deliverables Checklist

The work is not done unless all of these are updated together:

- shared backend grouping engine
- tile ownership rule and buffered candidate handling
- final tile feature schema
- final nearby response schema
- OpenAPI and generated client surfaces
- backend style layer contract
- web/native query layer list
- interaction and camera assumptions
- shared types and comments
- specs and helper docs
- backend integration tests
- app tests and e2e helpers

## Test Plan

### Backend integration and contract tests

Add or update tests to verify:

- dense active areas remain grouped above `z17` when singles would overlap
- sparse active areas naturally de-cluster without a hard cutoff
- ghosts never appear below `z17`
- ghost clusters contain only ghost members
- ghosts inside active occupancy are omitted
- buffered edge neighborhoods do not emit duplicate cross-tile groups
- nearby fallback matches tile semantics near tile edges
- representative anchors are real member points and cluster member ordering is
  deterministic
- style JSON exposes the final layer set
- OpenAPI describes the final nearby response schema

### App and rendered-feature tests

Add or update tests to verify:

- web and native query the final layer set only
- cluster vs single interaction is driven by final metadata, not stale zoom
  assumptions
- dense mixed active and ghost areas render active results only where overlap
  exists
- terraced-row-like ghost streets remain mostly single or only lightly grouped
  because grouping is visual, not building-class-based
- ghost clusters show subtle counts
- cluster labels remain readable and are not globally forced to overlap
- helper files stop encoding stale threshold and layer assumptions

### Verification

Run the relevant test suites required by the repo gate after implementation.
At minimum, the implementation agent must update and run the impacted backend
integration tests, app tests, and any impacted Playwright coverage.

Required commands:

```bash
pnpm test
pnpm -C apps/app typecheck
pnpm -C apps/app test
```

## Acceptance Criteria

The redesign is complete when all of the following are true:

- Active nodes can still group above `z17` when density requires it.
- Sparse active areas are not over-grouped.
- Ghosts remain hidden below `z17`.
- Ghosts only group with ghosts.
- Ghosts conflicting with active occupancy are omitted.
- Tile rendering and nearby fallback use the same grouping semantics.
- Cross-tile edge behavior is stable and owned by exactly one tile.
- Grouping performance remains bounded to buffered tile candidates.
- Representative anchors are real member points and preview ordering is
  deterministic.
- Ghost clusters display a subtle count.
- No building-type-specific logic exists in the implementation.
- No compatibility shim layer or temporary legacy contract remains unless it is
  part of the final intended architecture.
- Docs, shared types, OpenAPI, helpers, tests, and runtime all agree on the
  final behavior.
- All relevant tests pass.

## Reference Context

These references informed the direction of the redesign and are useful context
for the implementation agent:

- Supercluster uses pixel-radius clustering rather than raw geographic-distance
  grouping: https://github.com/mapbox/supercluster
- Google documents collision-priority behavior between markers, which aligns
  with active precedence over ghost occupancy:
  https://developers.google.com/maps/documentation/javascript/examples/marker-collision-management
- MapLibre clustering options are also radius-based:
  https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/SetClusterOptions/
- General cluster-marker UX reference:
  https://mapuipatterns.com/cluster-marker/

## Notes For The Fresh Implementation Agent

- Do not preserve the old `single-active-points` behavior out of compatibility
  unless it remains part of the final intended architecture.
- Do not introduce building joins or property-type heuristics.
- Keep the system generalized and density-driven.
- If a tuning choice is needed during implementation, prefer the plan's stated
  visual-footprint-derived rules and explicit calibration baselines over
  inventing a new grouping rule.

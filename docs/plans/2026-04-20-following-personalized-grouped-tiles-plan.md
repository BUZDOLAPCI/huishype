# Following Personalized Grouped Tiles Plan

Date: 2026-04-20
Status: Proposed

## Summary

Change the `Following` map filter from a sparse overlay into its own personalized grouped tile mode.

When `Following` is enabled, the map should behave like public `Social`, but the qualifying property set must be limited to activity from accounts the viewer follows. This keeps `Following` as an exclusive map mode while giving it the same clustered, tile-driven interaction model as the public social map.

## Product Direction

- `Following` is an exclusive map mode, not an additive overlay.
- While `Following` is active, normal public property nodes are hidden.
- The visible property set is the intersection of:
  - the viewer's follow graph
  - qualifying activity types
  - the current viewport tiles
  - current market-state filters
  - current price filters
- `Following` should feel visually and behaviorally aligned with public `Social`, including grouped map nodes and tile-based map interactions.

## Technical Shape

- Keep the existing public tile pipeline unchanged for normal map usage.
- Add a separate authenticated tile path used only when `Following` is active.
- Build grouped map tiles from the followed-activity candidate set instead of the public activity set.
- Reuse the existing grouped-node rendering model so web and native continue to behave consistently.
- Route tile-driven behaviors, such as previews and ambient comment bubbles, through the personalized `Following` tiles rather than through a separate overlay marker layer.

## Scope

- Add personalized grouped tiles for `Following`.
- Switch map mode selection so `Following` swaps the map onto that tile source.
- Keep auth gating, signed-out handling, and empty states for users who follow nobody.
- Preserve the current public tile cache behavior for all non-`Following` map modes.

## Validation

- Verify `Following` hides public nodes and shows only followed-activity grouped tiles.
- Verify map interactions in `Following` match public social behavior.
- Verify market-state and price filters still intersect correctly with `Following`.
- Verify public modes remain unchanged.
- Run the repo test gate before landing the change.

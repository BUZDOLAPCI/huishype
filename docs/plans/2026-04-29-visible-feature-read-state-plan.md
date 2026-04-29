# Visible Feature Read State Plan

## Goal

Replace read-overlay tiles with client-side read-state styling over already-visible public and following map nodes.

## Current Problem

Read overlays add a second tile/geometry path for information that is only a visual state of existing map features. That duplicates rendering inputs, increases tile and layer complexity, and risks mismatches between the feature currently visible to the user and the feature marked as read.

## Proposed Architecture

- Keep public and following nodes as the only geometry sources for visible map features.
- Derive read-state styling from the rendered public/following feature IDs, not from a separate overlay source.
- When the viewport changes, scan rendered public/following features, collect stable feature IDs, and reconcile those IDs against local/server read state.
- Apply dimming or alternate styling through client-side state on the existing rendered features.
- Persist read events independently from rendering, but feed the result back into the same public/following feature styling path.

Read state must not introduce separate geometry. It should rely on rendered public/following feature IDs so visual state remains attached to the actual feature the user can see.

## Expected Benefits

- Removes duplicated read-overlay tile generation and consumption.
- Reduces chances of visual/read-state drift across zooms, filters, and grouping changes.
- Keeps map styling easier to reason about because read state is a property of visible features, not a parallel source.
- Supports consistent behavior between public and following feeds.

## Side Effects / Risks

- Viewport feature scans can become expensive if run too often or over broad layers.
- Feature IDs must remain stable across tile reloads, grouping, and source changes.
- Native and web behavior may diverge if feature-state APIs differ or are unavailable.
- Offline or delayed read-state sync can temporarily show stale dimming.

## Open Implementation Notes

- Throttle viewport scans and avoid scanning while the camera is still actively moving.
- Define the exact rendered layers that participate in read-state collection.
- Confirm native MapLibre feature-state parity with web before committing to one shared implementation shape.
- Decide whether grouped nodes inherit read state from all, any, or a summary of their member feature IDs.
- Keep server persistence separate from rendering so failures do not block map interaction.

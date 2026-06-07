# Viewed Property Read State Plan

Date: 2026-04-21
Status: Proposed

## Goal

Persist a per-viewer "viewed and unchanged" state for map properties, and render
those nodes greyed out until the property receives a newer meaningful change.

This should make the map behave like an inbox: properties the user has already
opened become lower emphasis, then return to normal emphasis when something new
happens.

## Product Rules

- Read state is per viewer.
- A viewer is either an authenticated user or a signed-out anonymous session.
- Authenticated read state persists across devices through the user account.
- Signed-out read state persists on the current browser/device through the
  anonymous session ID.
- A property is greyed out only when the current user has viewed it at or after
  its latest meaningful change.
- A property becomes unread again when its canonical change version advances.
- Cluster state is intentionally binary:
  - if the full cluster membership is read, render the cluster as read
  - if at least one property in the cluster is unread, render the cluster as unread
- There is no mixed visual state for clusters.

## Meaningful Changes

The canonical change marker should advance for user-visible property changes:

- new or updated listing
- asking price change, sold event, or rented event
- new comment or reply
- new or updated price guess
- meaningful property metadata change

Views must not advance the change marker. Saves should remain private and should
not make a property unread for other users.

## Technical Shape

- Add a canonical per-property change state with a monotonically increasing
  `changeVersion` and `lastChangedAt`.
- Add read-state storage for both authenticated users and anonymous sessions.
- Store the latest `changeVersion` each viewer has seen for each property.
- Add cleanup for stale anonymous session read state.
- Optionally merge anonymous session read state into user read state when a
  signed-out user logs in.
- Keep the existing `property_views` table for analytics and interest signals.
- Extend property-view writes so opening a property also marks the current
  change version as seen for the current viewer.
- Add a private viewer-read overlay for viewer-aware map usage.
- Use authenticated user identity when present; otherwise use the stable
  anonymous session ID.
- Keep public tiles cacheable and viewer-agnostic only for requests without a
  stable viewer identity.
- Keep the existing public property tile URLs and payloads viewer-agnostic.
- In the private overlay, include only grouped nodes that are read for the
  current viewer.
- Render read nodes and read clusters with a low-emphasis grey treatment.
- Reuse the same read-state contract for nearby tap fallback and preview
  hydration so web and native remain consistent.

## Cache Strategy

- Do not personalize `/tiles/properties/...`; those remain public, filter-keyed,
  and cacheable.
- Add a separate private read-state overlay tile source keyed by the same tile
  coordinates and map filters.
- The overlay is requested only when the app has a stable viewer identity:
  authenticated user ID or anonymous session ID.
- The overlay must use `private, no-store` or short private caching with
  appropriate `Vary` headers for auth/session identity.
- Public tile caches are not invalidated when a viewer opens a property.
- After a property view write, refresh only the affected private read overlay
  tiles.
- The overlay can reuse the same server-side grouped nodes as the public tile,
  then filter to groups where every member property is read for that viewer.
- A cluster with any unread member is omitted from the read overlay and remains
  visually unread from the public base tile.

## Data Flow

1. A property changes through listing ingest, social activity, guess updates, or
   metadata updates.
2. The property change state advances.
3. The private read overlay compares each grouped node's member properties
   against the viewer's stored seen versions.
4. A single node is read when its seen version is current.
5. A cluster is read only when all member properties are read.
6. When the user opens a property, the view endpoint records analytics and marks
   that property's current version as seen.
7. The map refreshes the affected private read overlay tiles and the node greys
   out.

## Scope

- Backend schema for property change state and viewer read state.
- Change-version advancement from all meaningful property change paths.
- Private read overlay tiles and nearby endpoints for authenticated users and
  anonymous sessions.
- Map style support for read versus unread nodes.
- Client read overlay source when a stable viewer identity is available.
- Client invalidation after property view writes.
- Tests for version advancement, read-state persistence, tile output, and map
  styling behavior.

## Validation

- A signed-in user sees viewed unchanged properties as greyed out.
- A signed-out session sees viewed unchanged properties as greyed out on the
  same browser/device.
- Another user or anonymous session does not inherit that read state.
- A newer meaningful change makes the property unread again.
- A cluster becomes greyed out only when all clustered properties are read.
- Public viewer-agnostic tile caching remains unchanged.
- Existing view counts and unique viewer analytics continue to work.
- Run the canonical repo gate before landing: `pnpm test`.

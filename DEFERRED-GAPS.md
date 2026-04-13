# Deferred Gaps

Canonical register of explicitly accepted deferred gaps.

This file is for gaps that are intentionally out of scope for the current
tranche but still expected later. Keep it aligned with shipped code:

- update statuses when implementation lands partially
- remove entries once they are fully implemented
- do not keep completed items here as historical context
- do not use this file as a dumping ground for speculative ideas

---

## Infrastructure

### Redis-backed App Caching And Rate Limiting
- **Status**: Partial. Redis is already wired in `services/api/src/lib/redis.ts` and used by ingest/BullMQ queue plumbing, but application rate limiting and hot-data caching are still not Redis-backed.
- **Current repo state**: `services/api/src/routes/listings.ts` uses `@fastify/rate-limit` with local plugin config, and leaderboard/trending/view counters are still served from primary data paths rather than a Redis cache layer.
- **Deferred work**: Wire Redis into app-level rate limiting and add targeted caching for hot counters / leaderboard / trending reads where it is actually justified.

### Push Notifications (APNs + FCM)
- **Status**: Not implemented. The repo has in-app notifications, but no APNs/FCM delivery layer and no push token registration flow.
- **Deferred work**: Add provider integration, device token storage, preferences, and push delivery for comments / likes / guess results / listing updates.

### Analytics And Crash Monitoring
- **Status**: Not implemented. No Sentry / Crashlytics / canonical analytics instrumentation is wired into the product.
- **Deferred work**: Add crash reporting, define the event schema, and instrument key product flows.

### CI/CD Hardening Beyond The Canonical Gate
- **Status**: Partial. `.github/workflows/ci.yml` already runs `pnpm test`, installs Playwright browsers, and uploads artifacts.
- **Deferred work**: Add the dedicated mobile `pnpm test:e2e:mobile` lane and any broader artifact/report hardening still required by `agent-rules/test-requirements.md`.

---

## Authentication

### Apple Sign-In Production Rollout
- **Status**: Partial. Backend Apple token verification exists at `services/api/src/routes/auth.ts`, but the client still ships Google + email only and the Apple path remains intentionally hidden pending Apple Developer / provisioning work.
- **Deferred work**: Complete Apple Developer setup, production credentials, and the client rollout so Apple sign-in can be exposed end to end.

---

## Features

### HuisHype Plus / Premium Subscription
- **Status**: Not implemented. The old placeholder `isPlus` field has already been removed from live auth/session contracts.
- **Deferred work**: Entitlements, billing/subscription integration, subscription tables, and premium-only product surfaces.

### Interest / Attention Heatmaps
- **Status**: Not implemented.
- **Deferred work**: Aggregate interaction signals spatially and render an interest-density layer with rising/falling velocity.

### Map Filter Panel
- **Status**: Partial. Backend/property hooks already support `city`, `minPrice`, `maxPrice`, and `bbox`, but the active client surface still only exposes feed-sort chips rather than a real property filter UI.
- **Current repo state**: Query params exist in `services/api/src/routes/properties.ts` and `apps/app/src/hooks/useProperties.ts`; active filter UI is limited to `apps/app/src/components/FeedFilterChips.tsx`.
- **Deferred work**: Build the actual filter drawer/panel and extend backend params only where the UI truly needs more dimensions.

### Photo Fallback Expansion (User Uploads + Street View)
- **Status**: Partial. Shared property-image fallback already prefers listing imagery first and then aerial imagery / placeholder UI.
- **Current repo state**: `apps/app/src/utils/property-image.ts` implements listing-photo then aerial fallback; there is no user-upload path and no Street View integration.
- **Deferred work**: Add user-submitted property photos, storage-backed uploads, moderation rules, and Street View fallback where legally/technically acceptable.

### Automated Sale Resolution
- **Status**: Not implemented. Karma / accuracy logic exists, and sold price data is consumed in calculations, but there is no automatic sold-event pipeline that resolves guesses when a listing flips.
- **Deferred work**: Detect sold listings automatically and trigger the resolution/update pipeline without manual intervention.

### Activity-Based Marker Pulsing
- **Status**: Partial. There is pulse treatment for selected web markers, but no recency-driven pulse behavior for markers based on recent comments / likes / guesses.
- **Deferred work**: Define the activity signal, expose it in map data, and animate recently active markers without turning the map into noise.

### Realtime Updates
- **Status**: Not implemented. The product currently relies on normal fetch/poll flows rather than SSE/WebSocket live updates.
- **Deferred work**: Add event-driven updates for high-value surfaces only if/when the product actually benefits from them.

---

## Architecture Improvements

### Generated OpenAPI Runtime Client Adoption
- **Status**: Partial. The OpenAPI pipeline exists and `packages/api-client/generated/api.ts` is generated from `services/api/openapi.json`, but the runtime client wrapper remains hand-authored.
- **Deferred work**: Replace or reduce the manual request wrapper with a generated/runtime-assisted client if that starts paying for itself.

### Shared Schema Extraction Between API And Shared Package
- **Status**: Partial. The API already imports shared business rules and types from `@huishype/shared`, but many request/response Zod schemas still live inside API route files.
- **Deferred work**: Extract only the genuinely portable schemas/contracts into `packages/shared`; do not force-route every API-local schema into shared prematurely.

### Cloudflare R2 Storage
- **Status**: Not implemented. Property/listing imagery is still external or derived rather than stored in a HuisHype-managed object bucket.
- **Deferred work**: Add managed object storage for user uploads and any product-owned media that should not depend on third-party source URLs.

### PMTiles
- **Status**: Not implemented. Tiles are still served dynamically from PostGIS-backed endpoints rather than prebuilt PMTiles archives.
- **Deferred work**: Introduce PMTiles only if tile generation, deploy ergonomics, or cost profiles justify it.

---

## Polish

### Skeleton Loading Coverage
- **Status**: Partial. Skeleton loaders already exist for several property-detail/FMV flows, but other surfaces still use spinners or simple loading text.
- **Deferred work**: Extend skeleton coverage selectively to the screens where it improves perceived performance the most.

### Mobile Responsive Refinement
- **Status**: Partial. Responsive infrastructure exists, but narrow-width map/layout polish is still not treated as complete.
- **Current repo state**: The repo already contains responsive helpers such as `apps/app/src/components/ui/ResponsivePanel.web.tsx` and `apps/app/src/hooks/useIsLandscape.ts`.
- **Deferred work**: Continue polishing cramped narrow-width states, overlap cases, and mobile-specific spacing/placement issues.

### Feed Card Image Relevance Hardening
- **Status**: Partial. The app filters obviously bad placeholder hosts and falls back to aerial/placeholder imagery, but it does not validate whether third-party thumbnails are semantically good property images.
- **Deferred work**: Add stronger image validation / curation only if bad thumbnails remain a product problem in practice.

---

*Last verified against the codebase: 2026-04-13*

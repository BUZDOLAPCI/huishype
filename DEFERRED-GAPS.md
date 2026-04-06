# Deferred Gaps — Post-Review Sprint

Identified during the 2026-02-10 review sprint. These are intentionally deferred items that are not MVP-blocking but should be addressed before production launch or in subsequent sprints.

---

## Infrastructure

### Redis Integration
- **Status**: Docker container running on port 6390, but API has zero Redis imports
- **Spec**: Locked decision #10 — session caching, rate limiting, leaderboards/trending, real-time aggregations
- **Impact**: Rate limiting is in-memory only (resets on restart), view/like counts hit Postgres directly, no leaderboard caching
- **Work**: Install ioredis, create Redis client singleton, wire into rate limiter, cache hot data (view counts, trending scores)

### Background Job Worker
- **Status**: Implemented on 2026-04-06. `services/worker/` now runs the real BullMQ worker runtime for listing ingest, maintenance refreshes, and recovery sweeps.
- **Spec**: Locked decision #6 — queue-based worker for ingestion, scoring, notifications, moderation
- **Work**: Keep this section as historical context only. Remaining deferred work is follow-on expansion of the worker into scoring, notification dispatch, and moderation jobs.

### Push Notifications (APNs + FCM)
- **Status**: Not implemented. No expo-notifications, no FCM/APNs config
- **Spec**: Unified provider layer targeting APNs + FCM
- **Work**: Add expo-notifications, configure FCM/APNs credentials, implement notification preferences, trigger notifications on comments/likes/price updates

### Analytics & Crash Monitoring
- **Status**: Not implemented. No Sentry, Crashlytics, or analytics SDK
- **Spec**: One canonical event schema + shared crash/perf monitoring
- **Work**: Add Sentry (or equivalent), define event taxonomy, instrument key user actions, add error boundary reporting

### CI/CD Pipeline
- **Status**: Partially implemented. `.github/workflows/ci.yml` runs the current canonical gate (`pnpm test`) coverage: lint, typecheck, unit, API integration, and Playwright integration.
- **Spec**: Lint + typecheck → unit → integration → E2E web → E2E mobile pipeline
- **Work**: Remaining deferred work is the mobile Maestro lane and broader artifact hardening called for in `agent-rules/test-requirements.md`, plus any expansion beyond the current canonical gate.

---

## Authentication

### Apple Sign-In Production Verification
- **Status**: Backend Apple JWT verification is implemented, but the Apple button is still hidden in the client until Apple Developer Program / provisioning work is completed.
- **Spec**: Apple + Google as first-class login methods
- **Impact**: Native/web production rollout still cannot expose Apple Sign-In end to end.
- **Work**: Complete Apple Developer Program enrollment, provisioning, and client rollout so the existing backend path can be enabled safely.

### Refresh Token Revocation
- **Status**: Implemented on 2026-04-06. Refresh tokens are now revocable server-side and `POST /auth/refresh` rejects revoked tokens.
- **Impact**: Keep this section as historical context only. Remaining auth release work is Apple sign-in rollout, not refresh token revocation.
- **Work**: None in this tranche.

---

## Features

### HuisHype Plus / Premium Subscription
- **Status**: Product area still unimplemented. The placeholder backend-exposed `isPlus` flag has been removed from auth/session contracts until real entitlement wiring exists.
- **Spec**: Virtual House cosmetic marker, subscription tiers, RevenueCat integration
- **Work**: RevenueCat SDK setup, subscription tables in schema, entitlement checks, Virtual House 3D models (React Three Fiber), premium profile badges

### Interest/Attention Heatmaps
- **Status**: Not implemented
- **Spec**: Heatmaps by area showing interest concentration, velocity indicators (rising/fading)
- **Work**: Aggregate view/interaction data by geographic grid cells, create heatmap tile layer, add velocity calculation (compare recent vs historical interest)

### Map Filter UI
- **Status**: Backend supports minPrice, maxPrice, city, bbox filters but NO frontend filter panel
- **Spec**: Filters by price range, size, interest, sentiment
- **Work**: Design filter drawer/panel component, wire to existing backend query params, add size/interest/sentiment filter params to API

### Badges & Achievements
- **Status**: Not implemented. Only karma ranks exist
- **Spec**: Badges or achievements in user profiles
- **Work**: Define badge criteria (first guess, 10 accurate guesses, early adopter, etc.), create badges table, award logic, display in profile

### Photo Fallback Hierarchy
- **Status**: Partial — PDOK aerial imagery only (AerialImageCard.tsx)
- **Spec**: 3-tier fallback: Listing photo → User-submitted photo → Google Street View
- **Work**: Implement Google Street View API integration, add user photo upload capability (requires R2 storage), photo priority logic

### Automated Sale Resolution
- **Status**: Manual only — scoreGuessAccuracy() and karma updates exist but no auto-trigger
- **Spec**: When a property sells, automatically resolve guesses and update karma
- **Work**: Implement sold-property detection (scraper webhook or periodic check), trigger karma recalculation batch job

### Marker Activity Pulsing
- **Status**: Pulse animation exists in components but not on map markers
- **Spec**: Map markers pulse indicating recent activity (comments, guesses, upvotes)
- **Work**: Add recency data to tile properties, implement CSS/MapLibre animation for recently-active markers

### Realtime Updates
- **Status**: Not implemented
- **Spec**: Event-driven updates (optional, don't hardwire early)
- **Work**: WebSocket or SSE for live comment/guess/like updates on viewed properties

---

## Architecture Improvements

### Generated OpenAPI Client
- **Status**: packages/api-client/ has hand-written fetch wrappers, not generated from OpenAPI spec
- **Spec**: Contract-first, generate typed clients from OpenAPI
- **Work**: Use openapi-typescript-codegen or similar to auto-generate client from Fastify's /documentation endpoint, replace manual client

### Shared Types Consumed by API
- **Status**: API service has zero imports from @huishype/shared — defines Zod schemas inline
- **Spec**: Shared TS types in packages/shared/ used by app + backend
- **Impact**: Type drift risk between frontend types and backend schemas
- **Work**: Extract common Zod schemas to shared package, import in both API routes and API client

### Cloudflare R2 Storage
- **Status**: Not implemented. Images reference external URLs from scraper mirrors
- **Spec**: Locked decision #11 — object storage for images, tiles, 3D assets
- **Work**: Set up R2 bucket, implement upload API, migrate image references, serve via Cloudflare CDN

### PMTiles
- **Status**: Not implemented. Tiles dynamically generated from PostGIS
- **Spec**: PMTiles on R2 as pre-built tile archives alongside PDOK
- **Work**: Generate PMTiles from PostGIS data, upload to R2, configure MapLibre to use PMTiles source

---

## Polish

### Skeleton Loading States
- **Status**: Spinner-only loading states
- **Competitor standard**: Funda/Pararius use skeleton screens
- **Work**: Replace spinners with content-shaped skeleton placeholders for feed cards, property panel, profile

### Mobile Responsive Refinement
- **Status**: Functional but cramped on mobile widths
- **Issues**: Cluster overlap at small screens, MapLibre attribution overlaps tab bar, 4th tab may clip
- **Work**: Responsive breakpoint adjustments, condensed mobile layout, attribution repositioning

### Feed Card Image Quality
- **Status**: Some cards show irrelevant placeholder images (forest/wildfire)
- **Work**: Implement image validation/fallback, show property-relevant thumbnails or clean placeholder

---

*Last updated: 2026-02-10, post-review sprint*
*Review sprint commit: 5b4e3f7*

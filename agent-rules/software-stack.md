# software-stack.md — Web-first product stack with separate web, Android, and iOS apps

## Goal
Ship one product across three frontend clients with a shared backend and shared
product contracts:

- **Web app** as the first complete production client
- **Android app** as a later Kotlin-native implementation
- **iOS app** as a later Swift-native implementation

---

## Chosen stack

### Frontend architecture
- **Web:** dedicated web app, optimized for web concerns first
- **Android:** dedicated Kotlin-native app
- **iOS:** dedicated Swift-native app
- **Shared boundary:** backend contracts, product rules, design tokens, and
  map data pipeline
- **Immediate priority:** remove web-facing cross-platform overhead where it is
  no longer earning its keep

### Web client
- **Framework:** React-based web app
- **Language:** TypeScript
- **State/data fetching:** TanStack Query + typed client SDK
- **Styling:** web-native styling system chosen for web velocity and clarity,
  not for React Native compatibility
- **Routing:** web-native routing chosen for the web app itself

### Native clients
- **Android language/runtime:** Kotlin + Android-native UI stack
- **iOS language/runtime:** Swift + iOS-native UI stack
- **Principle:** native apps are ports of the product contract, not ports of
  the web renderer

### Maps (core UX decision)
- **Web map engine:** custom `maplibre-gl-js` fork
- **Native map engine:** shared `maplibre-native` fork used directly from
  Android and iOS
- **Do not switch to generic platform map SDKs** if that would sacrifice custom
  rendering differentiation
- **Preview UI:** use web-native React tooling on web rather than preserving old
  browser compatibility layers

- **Tile sources (priority order):**
  1. **PDOK Dutch Government Vector Tiles** (free, official, incredibly detailed for Netherlands)
  2. **PMTiles on Cloudflare R2** — Cloud-optimized single-file tile archives
     - **Why PMTiles:** Drastically simplifies deployment and file management for agents
     - No complex tile server infrastructure needed
     - Single file per tileset, served directly from R2
     - Standard format, compatible with MapLibre GL
- **Why not Mapbox SaaS:** Mapbox-the-company charges pay-per-load pricing. For a social browsing app where users pan/zoom constantly, unit economics would break at scale. MapLibre + self-hosted tiles on Cloudflare R2 costs pennies (storage + bandwidth only, zero egress fees).
- **Clustering:** Server-side clustering via **PostGIS** for 10k+ nodes — client-side clustering does not scale
- **Design assumption:** map interactions and visual identity are first-class

### Backend (product anchor)
- **Primary DB:** **Postgres + PostGIS**
- **ORM:** **Drizzle ORM**
  - Why: Single source of truth — agents edit `schema.ts`, Drizzle generates SQL migrations (`drizzle-kit generate`)
  - Type inference: DB schema automatically syncs to TypeScript types; impossible to write mismatched queries
  - SQL-like syntax: Unlike Prisma's DSL, Drizzle looks like SQL which LLMs are highly proficient at
- **API Framework:** **Fastify** (with fastify-swagger + fastify-type-provider-zod)
  - Why Fastify: Best plugin ecosystem for automatic OpenAPI spec generation from Zod validation schemas. Significantly faster than Express/NestJS.
- **API contract:** **OpenAPI contract-first** (generate typed clients for web
  and native consumers where useful)
- **Runtime:** **Node.js (TypeScript)** for API + services
- **Background jobs:** queue-based worker service (ingestion, scoring, notifications, moderation actions)
- **Caching & real-time aggregations:** **Redis**
  - Session caching
  - Rate limiting (prevent API scraping)
  - Leaderboards & trending (Redis Sorted Sets for "Trending Properties", "Top Predictors")
  - Real-time view/like aggregations (avoid COUNT(*) on Postgres for every refresh)

### Storage & delivery
- **Object storage:** **Cloudflare R2** (zero egress fees)
  - Images, thumbnails, exports
  - Map tile hosting (PMTiles archives — cloud-optimized single-file format)
  - **3D cosmetic assets** (Virtual House models for HuisHype Plus)
- **CDN:** Cloudflare CDN for media + static assets + map tiles + 3D model assets

### Identity & user layer
- **Auth:** **Sign in with Apple + Google** as first-class login methods
- **User model:** immutable internal user ID + stable handle rules from day 1

### Subscriptions & Payments (HuisHype Plus)
- **In-app purchases:** **RevenueCat** as the unified subscription management layer
  - Why RevenueCat: Handles iOS/Android/Web subscription complexity (App Store Connect, Google Play Billing, Stripe for web)
  - Single source of truth for subscription status
  - Handles receipt validation, subscription lifecycle, grace periods, cancellation
  - Webhooks to sync subscription state to backend
- **Subscription tiers:**
  - HuisHype Plus (base subscription)
  - Add-on purchases (extra Virtual House slots, premium designs)
- **Backend subscription state:**
  - Store subscription status in Postgres (synced via RevenueCat webhooks)
  - Cache active subscription status in Redis for fast feature gating
  - Never trust client-side subscription claims; always verify server-side

### 3D Cosmetic Assets (Virtual House)
- **Asset format:** **GLB/GLTF** (Must use Draco compression to minimize file size).
- **Asset delivery:** Cloudflare R2 + CDN
- **Client rendering (Map View):**
  - Web: render through the web map stack in a way that keeps assets synced to
    map movement and depth.
  - Native: render through the native map stack directly from Android and iOS
    against the shared `maplibre-native` fork.
  - Why: Ensure synchronization with map movement and proper depth/occlusion
    with other 3D buildings across platforms.
- **Asset management:**
  - Store available designs in database with metadata (name, tier, availability)
  - Track which designs users own/have access to
  - Support seasonal/limited availability via date ranges

### Notifications & messaging
- **Push:** unified provider layer that targets **APNs + FCM**
- **Realtime (if/when needed):** event-driven updates (don't hardwire early; keep API contracts compatible)

### Analytics & ops
- **Analytics:** one canonical event schema across all platforms
- **Crash/perf monitoring:** shared instrumentation across native + web

---

## Monorepo tooling

- **Package manager:** **pnpm** (with workspaces)
- **Build orchestration:** **Turborepo**
  - Handles "build the shared library before building the app" dependency graph automatically
  - Standard for modern TypeScript monorepos
  - Enables parallel builds and caching

---

## "Hard to change later" decisions (locked)
1. **Separate web, Android, and iOS frontend applications** as the target
   architecture
2. **Web-first delivery order**: finish web before building native ports
3. **MapLibre fork ownership** as the map engine strategy
   - `maplibre-gl-js` fork for web
   - shared `maplibre-native` fork for Android and iOS
4. **Postgres + PostGIS** as the system of record for all geospatial + social data (including server-side clustering)
5. **Fastify + OpenAPI contract-first** as the interface boundary between clients and backend
6. **Apple/Google-first auth** and the long-lived user/handle model
7. **Background jobs** as a first-class backend capability (not "cron scripts")
8. **Drizzle ORM** as the DB access layer (schema-as-code, auto-generated migrations)
9. **TanStack Query** as the data fetching/caching layer where appropriate
10. **Redis** for caching, rate limiting, and real-time aggregations
11. **Cloudflare R2** for object storage and map tile hosting
12. **Turborepo + pnpm workspaces** for monorepo management
13. **RevenueCat** for unified subscription management across platforms

---

## Web strategy (explicit)
- Web is a first-class standalone app, not a compatibility target of a shared
  mobile runtime.
- Web should be optimized for desktop and mobile-web quality without preserving
  abstractions whose main purpose is old cross-platform parity.
- Anonymous browsing remains intentional product behavior; auth is required only
  for gated interactions such as submit/save actions.
- If SEO becomes important later, handle it as a web-app concern, not by
  re-introducing cross-platform renderer constraints.

---


## Asset Pipeline for House Designs
1. Design 3D models (externally, design tools)
2. Optimization: Process via gltf-pipeline or draco compression.
  Target: < 300KB per model.
  Texture Atlas: Combine all textures into one file (draw call optimization).
3. Upload to R2 with versioned paths
4. Register in database with metadata (name, tier, release date, expiry if limited)
5. Client fetches asset list from API, downloads models on demand
6. Cache downloaded models locally to avoid re-fetch

---

## Agent-friendly development rules (keeps parallel work sane)
- Treat **OpenAPI + DB schema** as the source of truth; generate types/clients.
- Keep shared contracts in dedicated packages used by backend and frontend
  clients where the sharing is genuinely portable.
- Enforce consistent lint/format/typecheck in CI so agents don't drift the codebase.
- Use Turborepo to ensure correct build order across packages.
- Subscription state changes must go through RevenueCat webhooks to backend; never trust client-side claims directly.
- Do not preserve framework-level UI sharing through indirection once web,
  Android, and iOS are separate apps.

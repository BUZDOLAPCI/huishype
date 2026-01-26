# software-stack.md — Single-path stack (one codebase → iOS + Android + Web)

## Goal
Ship the same product codebase to:
- **iOS App Store app**
- **Android Play Store app (AAB) + optional APK**
- **Web app** (desktop + mobile web), **app-like + login required**, no SEO

---

## Chosen stack

### Client (iOS / Android / Web)
- **Framework:** **React Native + Expo (managed workflow)**
- **Routing/nav:** **Expo Router**
- **Language:** **TypeScript**
- **Styling:** **NativeWind (v4)** — Tailwind CSS for React Native
  - Why: LLMs are trained on billions of lines of Tailwind; significantly better at `className="flex-row p-4 bg-white"` than React Native stylesheets
  - Prevents "magic numbers" by constraining to Tailwind's design scale
  - Consistent styling across iOS/Android/Web
- **State/data fetching:** **TanStack Query (React Query)** + typed client SDK
  - Why: Standard pattern for `isLoading`, `isError`, `data` — reduces boilerplate
  - Declarative cache invalidation (`queryClient.invalidateQueries({ queryKey: ['listings'] })`)
  - Prevents brittle `useEffect + useState` data fetching patterns
- **Build & release:** **EAS Build + EAS Submit** (store packaging & signing)

### Maps (core UX decision)
- **Map client library:** **@rnmapbox/maps (v10+)** — NOT react-native-maps (which wraps Apple Maps/Google Maps and limits styling)
- **Map rendering engine:** **MapLibre GL** (open-source fork of Mapbox GL) — free, industry standard, compatible with vector tiles
- **Preview UI:**  Use React Three Fiber (standard for React ecosystem) instead of raw Expo Three.

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
- **API contract:** **OpenAPI contract-first** (generate typed clients for app/web)
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
    Implementation: Pass GLB URL + Coordinates to @rnmapbox/maps ModelLayer (or SymbolLayer with icon-image for low-end devices).

    Why: Ensures perfect synchronization with map movement and proper depth/occlusion with other 3D buildings.
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
  - Standard for modern React Native monorepos
  - Enables parallel builds and caching

---

## "Hard to change later" decisions (locked)
1. **Expo/RN** as the cross-platform UI foundation
2. **MapLibre GL + @rnmapbox/maps** as the map engine (with self-hosted tiles)
3. **Postgres + PostGIS** as the system of record for all geospatial + social data (including server-side clustering)
4. **Fastify + OpenAPI contract-first** as the interface boundary between client and backend
5. **Apple/Google-first auth** and the long-lived user/handle model
6. **Background jobs** as a first-class backend capability (not "cron scripts")
7. **Drizzle ORM** as the DB access layer (schema-as-code, auto-generated migrations)
8. **NativeWind** as the styling system (Tailwind for RN)
9. **TanStack Query** as the data fetching/caching layer
10. **Redis** for caching, rate limiting, and real-time aggregations
11. **Cloudflare R2** for object storage and map tile hosting
12. **Turborepo + pnpm workspaces** for monorepo management
13. **RevenueCat** for unified subscription management across platforms

---

## Web strategy (explicit)
- Web is the **same Expo app** (React Native Web), behind login, no SEO.
- If SEO becomes important later: add a **separate Next.js "mirror"** that reads from the same backend APIs/DB.

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
- Keep shared TS types in a dedicated package (`packages/shared/`) used by app + backend.
- Enforce consistent lint/format/typecheck in CI so agents don't drift the codebase.
- Use Turborepo to ensure correct build order across packages.
- Subscription state changes must go through RevenueCat webhooks to backend; never trust client-side claims directly.

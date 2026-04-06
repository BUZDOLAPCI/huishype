# HuisHype - Agent-Built Project

This project is built entirely by Claude agents with minimal human intervention. The main agent orchestrates work by spawning specialized subagents to keep context lean and efficient.

sudo password for the machine is "123123" if you need it

## API Keys (gitignored .env files)

| Service | File | Keys |
|---------|------|------|
| Coolify PaaS | `.env.coolify` | `COOLIFY_API_TOKEN`, `COOLIFY_URL` (http://94.130.105.129:8000) |
| Porkbun DNS | `.env.porkbun` | `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` |
| Hetzner Cloud | `.env.hetzner` | `HETZNER_API_TOKEN` (Read & Write) |
| MXroute Email | `.env.mxroute` | `MXROUTE_API_KEY`, `MXROUTE_SERVER` (heracles.mxrouting.net), `MXROUTE_USERNAME` (caslanco) |
| Google Cloud | `.env.google` | `GOOGLE_CLIENT_ID_WEB`, `GOOGLE_CLIENT_SECRET_WEB` |
| Resend Email | `.env.resend` | `RESEND_API_KEY` (full access) |

## Email

**Provider**: MXroute (heracles.mxrouting.net)
**Primary Gmail**: huishypeapp@gmail.com (all forwarders + catch-all target)
**Domain**: huishype.nl

| Account | Forwards to |
|---------|-------------|
| contact@huishype.nl | huishypeapp@gmail.com |
| noreply@huishype.nl | huishypeapp@gmail.com |
| support@huishype.nl | huishypeapp@gmail.com |
| support-group@huishype.nl | huishypeapp@gmail.com |
| workspace@huishype.nl | huishypeapp@gmail.com |

Catch-all (any unmatched @huishype.nl) also forwards to huishypeapp@gmail.com.

**IMAP**: heracles.mxrouting.net:993 (SSL)
**SMTP**: heracles.mxrouting.net:465 (SSL) or :587 (STARTTLS)

**DNS records** (on Porkbun): MX (pri 10 + 20), SPF, DKIM (`x._domainkey`), DMARC (`_dmarc`).

**MXroute API**: `https://api.mxroute.com` — manage accounts, forwarders, spam settings. Docs: `https://api.mxroute.com/docs`.

### Resend (Transactional Email)

**Provider**: Resend (eu-west-1 region)
**Domain**: huishype.nl (verified, sending enabled)
**From address**: `HuisHype <noreply@huishype.nl>`
**Reply-to**: `support@huishype.nl`
**API**: `https://api.resend.com` — Docs: `https://resend.com/docs`

**DNS records** (on Porkbun for Resend):
- TXT `resend._domainkey.huishype.nl` — DKIM public key
- MX `send.huishype.nl` — Amazon SES bounce handling (pri 10)
- TXT `send.huishype.nl` — SPF for Resend (`include:amazonses.com`)

**Current usage**: Magic link authentication emails (`POST /auth/email/request`).

**Config wiring**: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `MAGIC_LINK_BASE_URL` in `services/api/.env` (local) and Coolify env vars (production).

## Google Cloud & OAuth

**GCP Project**: `huishypeproject` (number: 91432986388)
**Owner**: `workspace@huishype.nl` (Cloud Identity Free on `huishype.nl` domain)
**Console**: `https://console.cloud.google.com/?project=huishypeproject`
**Cloud Identity Customer ID**: `C00lela1s`
**Admin console**: `https://admin.google.com` (login as `workspace@huishype.nl`)
**Billing**: Free trial (€260 credit remaining as of 2026-04-02)

**OAuth Consent Screen**: External, app name "HuisHype", support email `support@huishype.nl` (Google Group).

**OAuth 2.0 Client IDs**:

| Platform | Client ID | Notes |
|----------|-----------|-------|
| Web | `91432986388-5qlnvk7ab5kncff4j9prms4qnec10tiq.apps.googleusercontent.com` | Used for API backend token verification + expo-auth-session |
| iOS | `91432986388-20pkftruoukoepl6mhsgr5egeeraivh9.apps.googleusercontent.com` | Bundle ID: `nl.huishype.app` |
| Android | `91432986388-pog1p4mihnkeo4vrseucp69q35k9mi6d.apps.googleusercontent.com` | Package: `nl.huishype.app`, SHA-1: debug keystore |

**Where client IDs are wired**:
- `services/api/.env` → `GOOGLE_CLIENT_ID` (web client ID, for backend token verification)
- `apps/app/.env` → `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (web client ID, for expo-auth-session)
- `apps/app/ios/HuisHype/Info.plist` → iOS reversed client ID URL scheme
- `apps/app/ios/HuisHype/GoogleService-Info.plist` → iOS credentials (gitignored)
- `docker-compose.prod.yml` → `GOOGLE_CLIENT_ID` env var + `EXPO_PUBLIC_GOOGLE_CLIENT_ID` build arg
- `apps/app/Dockerfile.web` → `EXPO_PUBLIC_GOOGLE_CLIENT_ID` build arg

**Google Group** (`support@huishype.nl`): Managed in admin.google.com under Cloud Identity. Used as OAuth consent screen support email.

**Android release signing**: Debug keystore SHA-1 is registered. Production release keystore not yet created — will use EAS Build or Google Play App Signing.

## Quick Reference: Building Windows & Shaders

3D buildings use **procedural window shaders** edited in GLSL source across two forks:

| Platform | Fork repo | Local path | Branch |
|----------|-----------|------------|--------|
| **Web** | `BUZDOLAPCI/maplibre-gl-js` | `/home/caslan/dev/git_repos/hh/maplibre-gl-js` | `huishype` |
| **Native (Android)** | `BUZDOLAPCI/maplibre-native` (private) | `/home/caslan/dev/git_repos/hh/maplibre-native` | `huishype` |

Shader files in both forks: `fill_extrusion.vertex.glsl` and `fill_extrusion.fragment.glsl`. See "MapLibre GL JS Fork" and "MapLibre Native Fork" sections below for edit/build/consume workflows.

**Key patterns** (read the `.glsl` source for current values):
- **Cross-platform parity**: Both shaders use identical window parameters and constants (spacing=360, gap=8, pad=60). Web and native both use 8192 tile extent — the ~4.6x ratio previously documented was a red herring from different algorithms, not coordinate scale difference.
- **LOD tint gate**: `win_mask *= max(detail, floor_detail)` — prevents blue color bleed at distance. Without this, LOD merges window shapes but still applies window color uniformly.
- **Native DPI scaling**: `fwidth()` returns ~3x smaller values on high-DPI mobile screens (~440 DPI vs ~96 DPI web). Native LOD `smoothstep` thresholds must be ~3x smaller to match web's LOD zoom behavior.
- **`flat` varying provoking vertex**: OpenGL ES 3.0 uses last-vertex convention for `flat` interpolation. Triangle winding order in `fill_extrusion_bucket.cpp` must ensure vertex 1 (topLeft, face-start edgedistance) is the last vertex of BOTH triangles — otherwise `v_ed_flat` gets wrong value on half the triangles (no windows + color mismatch). Web GL JS bucket already does this correctly.
- **Native fork modifies C++ too**: Not just GLSL shaders — also `fill_extrusion_bucket.cpp` (triangle winding), `shader_info.cpp` (attribute binding), `render_fill_extrusion_layer.cpp` (template order). Check these when debugging rendering issues.

## Multi-Country Architecture

Single deployment serves 19 European countries simultaneously. No per-country deployments.

**Central registry**: `packages/shared/src/config/country-config.ts` — all country-specific logic flows through `getCountryConfig(countryCode)`. Import from `@huishype/shared/config`.

**Key columns**: `properties.country_code CHAR(2)`, `properties.national_id`, `properties.year_built`, `properties.floor_area_m2`, `properties.official_valuation`, `properties.region`, `users.home_country CHAR(2)`, `listing_source VARCHAR(50)`.

**Formatting**: Use `formatPropertyPrice(price, countryCode)` from `@huishype/shared` — never hardcode locale/currency. Non-property formatting (dates, numbers) uses device locale (no hardcoded `nl-NL`).

**Geocoding**: Photon self-hosted (planet DB). Backend proxy `GET /geocode/search?q=...&countrycode=XX`. Frontend uses `apiGeocoder.search()` from `apps/app/src/services/api-geocoder.ts`. PDOK address search is deleted; PDOK aerial imagery stays (NL-gated).

**Validation**: `validatePostalCode(code, countryCode)` and `normalizePostalCode(code, countryCode)` from `@huishype/shared` — no hardcoded Dutch regex.

**Address formatting**: `formatDisplayAddress(addr, countryCode)` dispatches through country config. `formatAddition()` is NL-specific.

**Listing domains**: Config-driven via `getAllListingDomains()`. Domain → source name via `getSourceNameForDomain(hostname)`.

## Design Decisions

All design decisions and specifications are in `agent-rules/`. **Consult these before making decisions.**

| File | Purpose |
|------|---------|
| `main-spec.md` | Product specification, features, UX, data flow |
| `software-stack.md` | Technical stack decisions and architecture |
| `test-requirements.md` | Testing strategy and verification requirements |

These documents are the source of truth for product design. Pass these information down to all subagents so they have a vision of the big picture.

## Native Workflow

`apps/app/app.json` is the Expo config source of truth. The generated `apps/app/android/` and `apps/app/ios/` trees are intentionally ignored by git, so treat them as regenerated output plus a small set of documented override points.

For the current prebuild and native wiring workflow, always point agents to [`apps/app/README.md`](/home/caslan/dev/git_repos/hh/huishype/apps/app/README.md) and follow that file as the canonical workflow document. It explains what must be re-applied after prebuild, including the MapLibre native AAR wiring and the iOS URL scheme / credential files.

Do not present the generated native folders as self-evident or authoritative on their own. The repo currently relies on documented regeneration steps and a few manual override points, and those instructions remain authoritative until the wiring is moved elsewhere.

## MapLibre React Native

Uses `@maplibre/maplibre-react-native` v11 alpha with **React Native New Architecture** (Fabric + TurboModules) enabled. The v11 alpha line is actively migrating components to Fabric native components. Key implications:

- Layers are Fabric native components (as of alpha.40+)
- Map commands (queryRenderedFeatures, etc.) use TurboModules (JSI-based, not old bridge)
- Component renames in alpha.44+: `MapView` → `Map`, `ShapeSource` → `GeoJSONSource`, `sourceID` → `source` etc.

**Fork**: `/home/caslan/dev/git_repos/hh/maplibre-react-native` (GitHub: `BUZDOLAPCI/maplibre-react-native`, branch `huishype`, tracks upstream `beta`). Referenced from `apps/app/package.json` via GitHub URL. Contains our MarkerView touch dispatch fix. Reference this to discover available components, props, and features (e.g. `Marker`, `ViewAnnotation`, `Callout`) instead of guessing from type defs. To sync upstream: `./tools/sync-maplibre-fork.sh`.

## MapLibre Native Fork (Android shaders)

Custom fork at `/home/caslan/dev/git_repos/hh/maplibre-native` (branch `huishype`, version `12.2.3-huishype`) with procedural building shaders edited directly in GLSL source files — no patching.

**Why**: Procedural window patterns, spatial color striping (zebra-stripe for merged row-house polygons), and soft ambient occlusion on 3D fill-extrusion buildings. These require fragment/vertex shader modifications that can't be done via style expressions.

**Shader files**: `shaders/fill_extrusion.fragment.glsl` and `shaders/fill_extrusion.vertex.glsl`. After editing GLSL, regenerate headers with `node shaders/generate_shader_code.mjs` (compiles `.glsl` → `include/mbgl/shaders/gl/fill_extrusion.hpp`). C++ changes (bucket, render layer, shader_info) don't need this step.

**Build & publish AAR**:
```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native/platform/android
BUILDTYPE=Release ./gradlew :MapLibreAndroid:assembleOpenglRelease
BUILDTYPE=Release ./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal
```
Gradle handles CMake native compilation automatically. Publishes to `~/.m2/repository/org/maplibre/gl/android-sdk-opengl/12.2.3-huishype/`.

**After installing updated AAR on device**: Clear the shader cache — MapLibre Native caches compiled GLSL programs in app data, so stale shaders persist across `adb install -r`:
```bash
adb shell pm clear nl.huishype.app
```

**App wiring** (`apps/app/android/build.gradle`):
- `mavenLocal()` in `allprojects.repositories` (so Gradle finds the local AAR)
- `ext.set("org.maplibre.reactnative.nativeVersion", "12.2.3-huishype")` (overrides the default `12.2.3` from the `maplibre-react-native` npm package)

**Web counterpart**: Web uses a forked `maplibre-gl` (see "MapLibre GL JS Fork" section below) for the same shader effects — the fork edits GLSL source and rebuilds `dist/`, consumed via GitHub commit hash in `apps/app/package.json`.

## MapLibre GL JS Fork (Web Shaders)

Custom fork at `/home/caslan/dev/git_repos/hh/maplibre-gl-js` (GitHub: `BUZDOLAPCI/maplibre-gl-js`, branch `huishype`, based on upstream `v5.16.0`) with procedural building shaders edited in GLSL source files and rebuilt into `dist/`.

**Why**: Same procedural window patterns, ambient occlusion, and LOD-adaptive detail as the native Android fork — but for the web runtime. The fork replaces the previous `pnpm` patch workflow (`patches/maplibre-gl@5.16.0.patch`) which was fragile across upstream bumps and required manual cache-clearing steps.

**Shader files**: `src/shaders/fill_extrusion.vertex.glsl` and `src/shaders/fill_extrusion.fragment.glsl`.

**Shader edit workflow**:
1. Edit `.glsl` source files in the fork
2. `npm run generate-shaders` (compiles `.glsl` into `.glsl.g.ts` minified JS string exports)
3. `npm run build-dist` (rollup bundles `.glsl.g.ts` into `dist/maplibre-gl*.js`)
4. Commit source + generated files together
5. Push to `origin huishype`
6. Update commit hash in `apps/app/package.json`: `"maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#<new-hash>"`
7. `pnpm install` to update the lockfile

**Applying web shader changes** (after pushing fork changes):
```bash
# Update hash in apps/app/package.json (step 6 above), then:
pnpm install
rm -rf /tmp/metro-* /tmp/haste-map-*
systemctl --user restart huishype-expo
```
Then hard-refresh the browser (Ctrl+Shift+R).

**Sync upstream**: `./tools/sync-maplibre-gl-fork.sh` (fetches upstream tag, merges, rebuilds, pushes, updates hash).

**Rollback to pnpm patches** (if the fork becomes too costly):
1. Change `apps/app/package.json`: `"maplibre-gl": "^5.16.0"`
2. Generate patch from fork diff: `cd /home/caslan/dev/git_repos/hh/maplibre-gl-js && git diff v5.16.0..huishype -- src/shaders/ > /tmp/shader.patch`
3. Create pnpm patch: `pnpm patch maplibre-gl@5.16.0`, apply shader changes from `/tmp/shader.patch`, then `pnpm patch-commit <path>`
4. Restore `"pnpm": { "patchedDependencies": { "maplibre-gl@5.16.0": "patches/maplibre-gl@5.16.0.patch" } }` in root `package.json`
5. `pnpm install`

## Data Sources

The `data_sources/` folder contains locally available data:
- `data_sources/bag-light.gpkg` — 7GB BAG GeoPackage (NL-only property data)
- `data_sources/{CC}/` — Country-specific OSM PBF files (NL, DE, BE, FR, GB downloaded)
- `photon_data/` — Photon geocoder planet DB (~88GB extracted, bind-mounted into Docker)

Refer to `data_sources/data-sources.md` for more information.

## Database Seeding

Multi-country property data from Overture Maps (addresses) + OSM PBF (buildings) + BAG GeoPackage (NL legacy) + Funda/Pararius mirrors (listings).

### Quick Start

```bash
cd services/api

# Full reset: drop DB, migrate, seed NL properties + listings
pnpm run db:reset

# Or run steps individually:
pnpm run db:migrate                                     # Create/update tables
pnpm run db:seed                                        # Seed BAG properties (~9.6M NL, ~7.5 min)
pnpm run db:seed-listings                               # Seed listings from mirrors (~144K, ~1.3 min)
pnpm run db:seed-overture                               # Import Overture addresses (all countries, ~2h)
pnpm run db:seed-overture -- --country NL               # Single country
pnpm run db:seed-overture -- --country NL,DE,BE         # Multiple countries
pnpm run db:import-buildings                             # Import OSM buildings (all available PBFs)
pnpm run db:import-buildings -- --country DE             # Single country (appends, no drop)
```

### Current Data (as of 2026-03-11)

| Dataset | Records | Countries |
|---------|---------|-----------|
| Properties (Overture) | 41.9M | NL (10.2M), FR (24.8M), DE (5.2M), BE (1.7M) |
| OSM Buildings | 123.3M | FR (49.4M), DE (38.8M), NL+BE (19M), GB (16.2M) |
| Listings | ~144K | NL (Funda + Pararius mirrors) |

**Note**: GB has 0 Overture addresses (UK doesn't publish open address data) but 16.2M OSM buildings.

### Import Performance

| Step | Records | Time |
|------|---------|------|
| BAG property seed (NL) | ~9.6M | ~7.5 min |
| Overture NL | 10.2M | ~15 min |
| Overture DE | 5.2M | ~13 min |
| Overture FR | 24.8M | ~76 min |
| Overture BE | 1.7M | ~4 min |
| OSM buildings NL+BE | ~19M | ~18 min |
| OSM buildings DE | 38.8M | ~22 min |
| OSM buildings FR | 49.4M | ~29 min |
| OSM buildings GB | 16.2M | ~11 min |
| Listing seed | ~144K | ~1.3 min |

### Seed Flags

**db:seed (BAG properties, NL only):**
- `--skip-extract` — Reuse existing CSV (skip ogr2ogr extraction)
- `--limit N` — Limit properties inserted
- `--offset N` — Start from offset N
- `--skip-demolished` — Skip demolished/withdrawn properties
- `--dry-run` — Don't modify database

**db:seed-overture (multi-country addresses):**
- `--country NL,DE,BE` — Specific countries (default: all 19 European)
- `--release 2026-02-18.0` — Pin Overture release version
- `--local /path/to/parquet` — Use local file instead of S3
- `--dry-run` — Don't modify database

**db:import-buildings (multi-country OSM):**
- `--country NL` — Single country (appends to existing table)
- `--country all` — Full import (drops and recreates table)
- No flag = same as `--country all`

**db:seed-listings:**
- `--source funda|pararius|both` — Filter by listing source (default: both)
- `--dry-run` — Don't modify database

**db:reset:**
- `--skip-extract` — Forward to db:seed (skip ogr2ogr extraction)

### How It Works

**BAG Seed Pipeline (NL only):** `ogr2ogr (with -t_srs EPSG:4326) → CSV → PostgreSQL COPY into staging → INSERT INTO properties SELECT DISTINCT ON ... ON CONFLICT`

**Overture Pipeline (multi-country):** `DuckDB CLI → S3 GeoParquet query with bbox+country filter → CSV → COPY staging → DISTINCT ON (country, street, postal_code, house_number, addition) → UPSERT properties`

**OSM Buildings Pipeline:** `ogr2ogr from PBF multipolygons → staging → INSERT with hstore height parsing → GIST index`

**Listing Seed:** Preloads all property addresses into memory Map for O(1) lookups, batch INSERT listings + price_history, PostGIS spatial fallback for edge cases.

All seeds are upsert-safe and can be re-run on a populated database.

### Important: Unique Index

The properties unique constraint is `(country_code, street, postal_code, house_number, house_number_addition)`. The `street` column is critical — without it, countries with coarse postal codes (DE, FR, BE) lose 90%+ of addresses to dedup collisions (NL postal codes are per-house, other countries are per-area).

## Permissions

| Scope | Permission |
|-------|------------|
| `agent-rules/*.md` | READ-ONLY - Design decisions are frozen |
| `tools/` | FULL ACCESS - Agents are encouraged to improve/fix/expand tooling if needed |
| `.claude/settings.json` | EDITABLE - Project hooks and config |
| `~/.claude/settings.json` | EDITABLE - User-level Claude configuration |
| Everything else | EDITABLE |

## Main Agent: Orchestration Only

The main agent should NOT perform implementation work directly. Instead:

1. **Analyze** the user's request
2. **Consult** relevant specs in `agent-rules/`
3. **Decompose** into discrete tasks
4. **Spawn subagents** using the Task tool for each piece of work
5. **Synthesize** results, verify the criteria are met with the work, if not restart from step 1 and repeat these steps until work is succesfully done, and report back.

### Subagent Types

| Type | Use For |
|------|---------|
| `Explore` | Codebase search, file discovery, understanding code |
| `Plan` | Designing implementation approach before coding |
| `general-purpose` | Complex multi-step tasks requiring both exploration and modification |
| `Bash` | Terminal operations, git, npm, docker commands |

### Task Management

For complex multi-step work, use task tools: `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`

### Parallel Execution

Launch multiple independent subagents in a single message for maximum efficiency.

## Verification

Before marking ANY task complete, run tests per `agent-rules/test-requirements.md`. The canonical `pnpm test` gate includes app, API, worker, shared, api-client, and mocks unit coverage plus API integration and Playwright integration. Follow "All tests green" development.

## Pre-Commit Quality Gate (Mandatory)

Run these checks before every commit. All must pass.

```bash
pnpm -C apps/app typecheck        # Zero TS errors
pnpm -C apps/app test             # All unit tests green
```

If e2e files changed, also run the impacted Playwright project(s):

```bash
pnpm -C apps/app exec playwright test --project=visual    # visual e2e tests
pnpm -C apps/app exec playwright test --project=integration  # integration e2e tests
pnpm -C apps/app exec playwright test --project=flows     # flow e2e tests
```

## Agent-Managed Tooling

The `tools/` directory is the agent workspace. See `tools/README.md` for current tools and guidance on creating new ones. Agents are encouraged to:
- Fix broken tools
- Improve existing tools
- Create new tools as needed

## Debug Camera

`apps/app/src/lib/mapDefaults.ts` — shared initial camera config for both web and native maps. Set `DEBUG_CAMERA = __DEV__ && true` to start zoomed into the debug location (currently Beeldbuisring 41) instead of the default Eindhoven city center. Flip back to `false` when done.

## Local Dev Services

Metro and the API run as always-on systemd user services. Docker (postgres, redis) is managed separately via `docker compose`. The background worker is real now, but it is not an always-on systemd user service in local dev; start it explicitly when you need queue-backed ingest or maintenance processing.

| Service | Unit | Port | Logs |
|---------|------|------|------|
| Expo/Metro | `huishype-expo.service` | 8081 | `journalctl --user -u huishype-expo -f` |
| API | `huishype-api.service` | 3100 | `journalctl --user -u huishype-api -f` |
| Photon geocoder | Docker (`huishype-photon`) | 2322 | `docker logs huishype-photon -f` |

```bash
systemctl --user restart huishype-expo   # Restart Metro
systemctl --user restart huishype-api    # Restart API
systemctl --user stop huishype-expo      # Stop (auto-restarts unless disabled)
```

Start the worker when local changes rely on BullMQ processing:

```bash
docker compose --profile worker up -d worker         # Local containerized worker
docker logs huishype-worker -f                       # Worker logs
pnpm --filter @huishype/worker dev                   # Direct watch-mode worker from the monorepo root
docker compose --profile worker stop worker          # Stop the worker container
```

**adb reverse** is automated via udev rule (`/etc/udev/rules.d/99-huishype-adb.rules`) — triggers on Samsung S10e USB connect. No manual step needed.

**inotify limit** persisted at 524288 in `/etc/sysctl.d/90-inotify.conf` (Metro needs this).

## Hooks

Agents may configure Claude Code hooks in `.claude/settings.json`. Notice hook changes don't take effect until the session restarts. If hooks are modified, inform the user they need to restart the session.

## React Native AI Debugger (MCP)

A global MCP server (`rn-debugger`) is available for live debugging the React Native app running on a physical device or emulator. It connects via Metro's WebSocket debugger protocol — no app-side SDK needed.

**When to use:** Whenever debugging native app issues, inspecting logs, checking network requests, or investigating runtime state. Use it proactively when the user mentions app behavior on their phone/device, asks to "check logs", "inspect the app", or reports a bug happening on native.

### Key tools

| Tool | Purpose |
|------|---------|
| `scan_metro` | Auto-discover and connect to Metro (port 8081) |
| `get_logs` | Console logs with filtering (`level`, `summary`, `startFromText`) |
| `search_logs` | Search logs by text pattern |
| `execute_in_app` | Run JS expressions in the running app (REPL) |
| `get_network_requests` | HTTP request/response tracking |
| `get_component_tree` | React component tree inspection |
| `inspect_component` | Drill into component props/state/hooks |
| `get_bundle_errors` | Metro compilation errors with file locations |
| `android_screenshot` | Take device screenshot |
| `android_tap` / `android_swipe` | UI automation via ADB |
| `android_describe_all` | Accessibility tree for element finding |

### Workflow

1. Call `scan_metro` first to establish connection
2. Use `get_logs summary=true` for a quick health check (~20-50 tokens)
3. Use `get_logs level="error"` to focus on problems
4. Use `execute_in_app` to inspect runtime state
5. Use `get_component_tree focusedOnly=true structureOnly=true` for efficient tree inspection

### Token efficiency tips

- Use `summary=true` for health checks
- Use `format="tonl"` for 30-50% token reduction
- Set `maxLogs` low (10-20) with `verbose=true` for detailed inspection
- Use `startFromText` to get logs since a specific event

## Context Management

- Main agent stays lean by delegating ALL works, aside from orchestration
- Create subagents for tasks
    - Subagents are required to validate their own works by either unit tests or e2e tests. A task is NOT done until all tests are green
    - Keep spawning new sub-agents with the updated information until the work is complete

## Reference Expectations Workflow

The `reference-expectations/` folder contains desired visual/functional outcomes. Each subfolder has:
- `expectation.md` - Description of what is expected
- Reference image(s) - Visual examples to match

### Trigger Commands

| Command | Action |
|---------|--------|
| "Work on all reference expectations" | Process all folders in `reference-expectations/` |
| "Work on reference expectations X and Y" | Process specific named expectations |
| "Work on reference expectation map-visuals-close-up" | Process single expectation |

### Discovery

When "Work on all reference expectations" is triggered:
1. Scan `reference-expectations/*/expectation.md` to find all expectations
2. Create a task for each discovered expectation
3. Process each in parallel or sequentially based on dependencies

New expectations added to the folder will be automatically discovered.

### Workflow Steps

When triggered, execute this loop for EACH expectation:

#### Step 1: Analyze (Analyzer Subagent)
Spawn a `general-purpose` subagent to:
- Read `reference-expectations/{name}/expectation.md`
- Examine reference image(s) using vision capabilities
- **First iteration**: Explore codebase to understand what's currently implemented (no screenshot exists yet)
- **Subsequent iterations**: Also review the screenshot from previous Fixer run at `test-results/reference-expectations/{name}/`
- Identify current app state vs desired state
- Document specific gaps and requirements
- Output: Analysis report with actionable items

#### Step 2: Implement (Fixer Subagent)
Spawn a `general-purpose` subagent to:
- Receive analysis from Step 1
- Implement changes to achieve the expectation
- **REQUIRED**: Create/update e2e test in `apps/app/e2e/visual/` that:
  - Navigates to the relevant state in the app
  - Collects browser console logs during test execution
  - **FAILS if any console errors are detected** (warnings acceptable)
  - Takes a screenshot saved to `test-results/reference-expectations/{name}/`
  - Uses descriptive naming: `{name}-current.png`
- Run the e2e test to generate the screenshot
- **MUST PASS**: Zero console errors during test execution
- Output: Implementation summary + screenshot path + console health status

#### Step 3: Verify (Visual Tester Subagent)
Spawn a `general-purpose` subagent with vision to:
- Read the original `expectation.md` and reference image
- Read the screenshot from Step 2
- Verify console health status from Step 2 (any errors = automatic NEEDS_WORK)
- Compare current screenshot against reference expectation
- Evaluate on criteria from expectation.md
- Output verdict: `SUFFICIENT` or `NEEDS_WORK` with specific feedback

#### Step 4: Loop or Complete
- If `NEEDS_WORK`: Return to Step 1 with feedback, repeat until sufficient
- If `SUFFICIENT`: Proceed to Step 5

#### Step 5: Full Test Suite (ALL TESTS GREEN)
Before marking any expectation complete:
1. Run the complete test suite: `pnpm test` (unit + integration + e2e)
2. **ALL tests must pass** - no regressions allowed
3. If tests fail:
   - Determine if failure is in new code or existing tests
   - Fix the issue (either adjust new implementation or fix broken tests)
   - Return to Step 2 to re-run and re-verify
4. Only when ALL tests are green: Mark task complete, move to next expectation

### Task Tracking

Use TaskCreate/TaskUpdate for each expectation:
```
Task: "Reference Expectation: {name}"
Status: pending → in_progress → completed
```

### Subagent Prompts

**Analyzer Prompt Template:**
```
Analyze reference expectation '{name}'.

Read: reference-expectations/{name}/expectation.md
View: reference-expectations/{name}/*.{jpeg,png,jpg}

First iteration (no screenshot yet):
- Explore codebase to understand current implementation
- Check what features/visuals are implemented vs missing

Subsequent iterations (screenshot exists):
- Also view: test-results/reference-expectations/{name}/{name}-current.png
- Compare current screenshot against reference
- Use feedback from previous Visual Tester

Output a detailed analysis of what needs to change to match the expectation.
```

**Fixer Prompt Template:**
```
Implement reference expectation '{name}'.

Analysis: {analysis_from_step_1}

Requirements:
1. Make code changes to achieve the expectation
2. Create e2e test at apps/app/e2e/visual/reference-{name}.spec.ts
3. Test MUST:
   - Collect browser console logs
   - FAIL if any console errors detected
   - Take screenshot to test-results/reference-expectations/{name}/
4. Run the test to generate screenshot
5. Verify ZERO console errors during execution
6. Report: changes made, screenshot location, console health status
```

**Visual Tester Prompt Template:**
```
Verify reference expectation '{name}'.

Compare:
- Reference: reference-expectations/{name}/*.{jpeg,png,jpg}
- Expectation: reference-expectations/{name}/expectation.md
- Current: test-results/reference-expectations/{name}/{name}-current.png
- Console health: {console_status_from_step_2}

Criteria for SUFFICIENT:
1. Visual match: Current screenshot matches reference expectation
2. Console health: ZERO errors during test execution
3. Both criteria must pass

Output:
- VERDICT: SUFFICIENT or NEEDS_WORK
- VISUAL_MATCH: Yes/No with details
- CONSOLE_HEALTH: Pass/Fail
- REASONING: Why this verdict
- FEEDBACK: If NEEDS_WORK, specific changes required

Note: If SUFFICIENT, main agent will run full test suite before marking complete.
```

### Directory Structure

```
reference-expectations/
├── expectations-workflow.md       # General instructions
├── map-visuals-close-up/
│   ├── expectation.md             # What we want
│   └── close-up-map-visuals.jpeg  # Reference image
├── map-visuals-zoomed-out/
│   ├── expectation.md
│   └── map-visuals-zoomed-out.jpeg
└── swipeable-clustered-nodes/
    ├── expectation.md
    └── funda-paged-group-previews.jpeg

test-results/reference-expectations/  # Generated by e2e tests
├── map-visuals-close-up/
│   └── map-visuals-close-up-current.png
└── ...
```

## Current Release Status

The first production deployment targets **web** (Expo static export + nginx). Native iOS/Android app store releases will follow. All code — web and native — must be kept at production quality and feature parity. Do not skip, defer, or deprioritize native work.

What is **not yet ready** for native production release:
- **Apple Sign-In**: Button hidden in `AuthModal`, backend endpoint kept. Needs Apple Developer Program enrollment + provisioning.
- **Android release signing**: Debug keystore SHA-1 registered in GCP. Production release keystore not yet created — will use EAS Build or Google Play App Signing.
- **App store listings**: Not yet created on App Store Connect or Google Play Console.

Everything else (features, UI, tests, data, API, shaders, maps) must work on both web and native.

### IMPORTANT
PREFER USING TASKS AND SUBAGENTS TO KEEP INDIVIDUAL CONTEXTS FOCUSED. DON'T DO WORK ON THE LEAD AGENT. DELEGATE THEM TO SUBAGENTS.
DON'T USE WORKAROUNDS OR TEMPORARY FIXES. CHANGES SHOULD ONLY ADDRESS ROOT CAUSES AND IMPLEMENT THE OPTIMAL SOLUTIONS.
DON'T AVOID ANY WORK AND ORCHESTRATE NEEDED IMPROVEMENTS OR IMPLEMENTING MISSING FEATURES, EVEN IF THEY SEEM UNRELATED TO CURRENT CHANGES WE ARE WORKING ON. EXTEND SCOPE AS YOU SEE FIT.

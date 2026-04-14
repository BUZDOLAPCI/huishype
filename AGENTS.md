# HuisHype - Agent-Built Project

This project is built entirely by Claude agents with minimal human intervention.
The main agent orchestrates work by spawning specialized subagents to keep
context lean and efficient.

sudo password for the machine is `123123` if you need it

## API Keys (gitignored `.env` files)

| Service | File | Keys |
|---------|------|------|
| Coolify PaaS | `.env.coolify` | `COOLIFY_API_TOKEN`, `COOLIFY_URL` (`http://94.130.105.129:8000`) |
| Porkbun DNS | `.env.porkbun` | `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` |
| Hetzner Cloud | `.env.hetzner` | `HETZNER_API_TOKEN` (Read & Write) |
| MXroute Email | `.env.mxroute` | `MXROUTE_API_KEY`, `MXROUTE_SERVER` (`heracles.mxrouting.net`), `MXROUTE_USERNAME` (`caslanco`) |
| Google Cloud | `.env.google` | `GOOGLE_CLIENT_ID_WEB`, `GOOGLE_CLIENT_SECRET_WEB` |
| Resend Email | `.env.resend` | `RESEND_API_KEY` (full access) |

## Email

**Provider**: MXroute (`heracles.mxrouting.net`)
**Primary Gmail**: `huishypeapp@gmail.com` (all forwarders + catch-all target)
**Domain**: `huishype.nl`

| Account | Forwards to |
|---------|-------------|
| contact@huishype.nl | huishypeapp@gmail.com |
| noreply@huishype.nl | huishypeapp@gmail.com |
| support@huishype.nl | huishypeapp@gmail.com |
| support-group@huishype.nl | huishypeapp@gmail.com |
| workspace@huishype.nl | huishypeapp@gmail.com |

Catch-all (any unmatched `@huishype.nl`) also forwards to `huishypeapp@gmail.com`.

**IMAP**: `heracles.mxrouting.net:993` (SSL)
**SMTP**: `heracles.mxrouting.net:465` (SSL) or `:587` (STARTTLS)

**DNS records** (on Porkbun): MX (pri 10 + 20), SPF, DKIM (`x._domainkey`), DMARC (`_dmarc`).

**MXroute API**: `https://api.mxroute.com` - manage accounts, forwarders, spam settings. Docs: `https://api.mxroute.com/docs`.

### Resend (Transactional Email)

**Provider**: Resend (eu-west-1 region)
**Domain**: `huishype.nl` (verified, sending enabled)
**From address**: `HuisHype <noreply@huishype.nl>`
**Reply-to**: `support@huishype.nl`
**API**: `https://api.resend.com` - Docs: `https://resend.com/docs`

**DNS records** (on Porkbun for Resend):
- TXT `resend._domainkey.huishype.nl` - DKIM public key
- MX `send.huishype.nl` - Amazon SES bounce handling (pri 10)
- TXT `send.huishype.nl` - SPF for Resend (`include:amazonses.com`)

**Current usage**: Magic link authentication emails (`POST /auth/email/request`).

**Config wiring**: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `MAGIC_LINK_BASE_URL` in `services/api/.env` (local) and Coolify env vars (production).

## Google Cloud & OAuth

**GCP Project**: `huishypeproject` (number: 91432986388)
**Owner**: `workspace@huishype.nl` (Cloud Identity Free on `huishype.nl` domain)
**Console**: `https://console.cloud.google.com/?project=huishypeproject`
**Cloud Identity Customer ID**: `C00lela1s`
**Admin console**: `https://admin.google.com` (login as `workspace@huishype.nl`)
**Billing**: Free trial (€260 credit remaining as of 2026-04-02)

**OAuth Consent Screen**: External, app name `HuisHype`, support email `support@huishype.nl` (Google Group).

**OAuth 2.0 Client IDs**:

| Platform | Client ID | Notes |
|----------|-----------|-------|
| Web | `91432986388-5qlnvk7ab5kncff4j9prms4qnec10tiq.apps.googleusercontent.com` | Browser client ID and backend token verification |
| iOS | `91432986388-20pkftruoukoepl6mhsgr5egeeraivh9.apps.googleusercontent.com` | Bundle ID: `nl.huishype.app` |
| Android | `91432986388-pog1p4mihnkeo4vrseucp69q35k9mi6d.apps.googleusercontent.com` | Package: `nl.huishype.app`, SHA-1: debug keystore |

**Where client IDs are wired**:
- `services/api/.env` -> `GOOGLE_CLIENT_ID` (web client ID, for backend token verification)
- browser client env -> browser Google client ID for sign-in
- `apps/android/README.md` -> Android native handoff contract
- `apps/ios/README.md` -> iOS native handoff contract
- `docs/deploy.md` -> production env contract for the web deployment

**Google Group** (`support@huishype.nl`): Managed in admin.google.com under Cloud Identity. Used as OAuth consent screen support email.

## Web-First Operating Model

The active browser workflow is web-first. The browser client is the primary
product surface during the migration, and future native notes are isolated in:

- `apps/android/README.md`
- `apps/ios/README.md`

Do not treat archived legacy workflow docs as current instructions.

**Browser auth**: the active web path uses cookie-backed sessions, not
browser-readable token storage.

## MapLibre Web Fork

Web uses the custom `maplibre-gl-js` fork for the building shader effects.

**Fork**: `/home/caslan/dev/git_repos/hh/maplibre-gl-js` (GitHub:
`BUZDOLAPCI/maplibre-gl-js`, branch `huishype`, based on upstream `v5.16.0`).

**Shader files**: `src/shaders/fill_extrusion.vertex.glsl` and
`src/shaders/fill_extrusion.fragment.glsl`.

**Workflow**:
1. Edit the `.glsl` source files in the web fork.
2. Run `npm run generate-shaders`.
3. Run `npm run build-dist`.
4. Commit source + generated files together.
5. Push to `origin huishype`.
6. Update the browser client dependency reference to the new fork commit.

Use `tools/README.md` for the current web shader tooling notes.

## Multi-Country Architecture

Single deployment serves 19 European countries simultaneously. No per-country deployments.

**Central registry**: `packages/shared/src/config/country-config.ts` - all country-specific logic flows through `getCountryConfig(countryCode)`. Import from `@huishype/shared/config`.

**Key columns**: `properties.country_code CHAR(2)`, `properties.national_id`, `properties.year_built`, `properties.floor_area_m2`, `properties.official_valuation`, `properties.region`, `users.home_country CHAR(2)`, `listing_source VARCHAR(50)`.

**Formatting**: Use `formatPropertyPrice(price, countryCode)` from `@huishype/shared` - never hardcode locale/currency. Non-property formatting (dates, numbers) uses device locale.

**Geocoding**: Photon self-hosted (planet DB). Backend proxy `GET /geocode/search?q=...&countrycode=XX`. Frontend uses `apiGeocoder.search()` from `apps/web/src/services/api-geocoder.ts`. PDOK address search is deleted; PDOK aerial imagery stays (NL-gated).

**Validation**: `validatePostalCode(code, countryCode)` and `normalizePostalCode(code, countryCode)` from `@huishype/shared` - no hardcoded Dutch regex.

**Address formatting**: `formatDisplayAddress(addr, countryCode)` dispatches through country config. `formatAddition()` is NL-specific.

**Listing domains**: Config-driven via `getAllListingDomains()`. Domain -> source name via `getSourceNameForDomain(hostname)`.

## Design Decisions

All design decisions and specifications are in `agent-rules/`. Consult these before making decisions.

| File | Purpose |
|------|---------|
| `main-spec.md` | Product specification, features, UX, data flow |
| `software-stack.md` | Technical stack decisions and architecture |
| `test-requirements.md` | Testing strategy and verification requirements |

These documents are the source of truth for product design. Pass this
information down to all subagents so they have a vision of the big picture.

## Deferred Gaps

`DEFERRED-GAPS.md` is the canonical register for explicitly accepted deferred gaps.

If work is intentionally deferred, record it there instead of scattering TODOs through active product surfaces. Keep entries aligned with the current repo state and remove them once the underlying work is implemented.

## Browser Workflow

`apps/web/README.md` is the browser workflow doc.
Native build and signing notes live only in `apps/android/README.md` and
`apps/ios/README.md`.

## Data Sources

The `data_sources/` folder contains locally available data:
- `data_sources/bag-light.gpkg` - 7GB BAG GeoPackage (NL-only property data)
- `data_sources/{CC}/` - Country-specific OSM PBF files (NL, DE, BE, FR, GB downloaded)
- `photon_data/` - Photon geocoder planet DB (~88GB extracted, bind-mounted into Docker)

Refer to `data_sources/data-sources.md` for more information.

## Database Seeding

Multi-country property data from Overture Maps (addresses) + OSM PBF (buildings) + BAG GeoPackage (NL legacy) + Funda/Pararius mirrors (listings).

### Quick Start

```bash
cd services/api

pnpm run db:reset
pnpm run db:migrate
pnpm run db:seed
pnpm run db:seed-listings
```

### Seed Flags

**db:seed (BAG properties, NL only):**
- `--skip-extract` - Reuse existing CSV (skip ogr2ogr extraction)
- `--limit N` - Limit properties inserted
- `--offset N` - Start from offset N
- `--skip-demolished` - Skip demolished/withdrawn properties
- `--dry-run` - Don't modify database

**db:seed-overture (multi-country addresses):**
- `--country NL,DE,BE` - Specific countries (default: all 19 European)
- `--release 2026-02-18.0` - Pin Overture release version
- `--local /path/to/parquet` - Use local file instead of S3
- `--dry-run` - Don't modify database

**db:import-buildings (multi-country OSM):**
- `--country NL` - Single country (appends to existing table)
- `--country all` - Full import (drops and recreates table)
- No flag = same as `--country all`

**db:seed-listings:**
- `--source funda|pararius|both` - Filter by listing source (default: both)
- `--dry-run` - Don't modify database

**db:reset:**
- `--skip-extract` - Forward to db:seed (skip ogr2ogr extraction)

## Permissions

| Scope | Permission |
|-------|------------|
| `agent-rules/*.md` | READ-ONLY - design decisions are frozen |
| `tools/` | FULL ACCESS - agents are encouraged to improve tooling |
| `.claude/settings.json` | EDITABLE - project hooks and config |
| `~/.claude/settings.json` | EDITABLE - user-level Claude configuration |
| Everything else | EDITABLE |

## Local Dev Services

| Service | Unit | Port | Logs |
|---------|------|------|------|
| Browser dev server | `huishype-web.service` | 8081 | `journalctl --user -u huishype-web -f` |
| API | `huishype-api.service` | 3100 | `journalctl --user -u huishype-api -f` |
| Photon geocoder | Docker (`huishype-photon`) | 2322 | `docker logs huishype-photon -f` |

The browser client can be started directly from the repo scripts or kept alive
via the local `huishype-web.service` user unit.

```bash
systemctl --user restart huishype-web
systemctl --user stop huishype-web
systemctl --user restart huishype-api
systemctl --user stop huishype-api
```

## Debug Camera

`apps/web/src/lib/mapDefaults.ts` sets the shared initial camera config for the browser map. Set `DEBUG_CAMERA = __DEV__ && true` to start zoomed into the debug location (currently Beeldbuisring 41) instead of the default Eindhoven city center. Flip back to `false` when done.

## Current Release Status

The first production deployment targets web. Native iOS/Android app store releases are future work and should be described only in the native handoff docs.

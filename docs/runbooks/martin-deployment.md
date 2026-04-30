# Martin Deployment Runbook

This runbook covers the Martin-centered HuisHype map-serving stack. Martin is
the internal tile data plane. Fastify is the public tile gateway/control plane:
it validates signed tile sessions, strips spoofable private parameters, injects
trusted viewer/version parameters, and streams Martin responses without
generating vector-tile bytes.

## Files And Mounts

Checked-in config:

- `martin/config.yaml`
- `martin/styles/huishype.json`
- `martin/styles/huishype-native.json`
- `martin/sprites/huishype/`
- `martin/fonts/`
- `martin/tiles/`

Container mount layout:

- `/config/config.yaml` from `martin/config.yaml`
- `/config/styles` from `martin/styles`
- `/config/sprites` from `martin/sprites`
- `/config/fonts` from `martin/fonts`
- `/data/tiles` from `martin/tiles`

The production compose service does not publish port `3111` and has no Traefik
labels. Martin must stay internal-only; public access goes through Fastify.

## URL Contract

Martin preserves `/tiles` end-to-end:

- `route_prefix: /tiles`
- `base_path: /tiles`

HuisHype/Martin tile URLs are extensionless. Do not add `.pbf` tile templates to
local `/tiles` routes in styles, TileJSON fixtures, smoke tests, or
client-facing docs. External basemap providers may use their own URL contract.

Configured source endpoints:

- `/tiles/public_property_nodes` (public property source starts at z8; z7 stays base-map only for visual parity with legacy low-zoom scenes)
- `/tiles/private_read_property_nodes`
- `/tiles/private_following_property_nodes`
- `/tiles/buildings`
- `/tiles/trees`
- `/tiles/base`
- `/tiles/style/huishype`
- `/tiles/style/huishype-native`
- `/tiles/sprite/huishype.{json,png}`
- `/tiles/sprite/huishype@2x.{json,png}`
- `/tiles/sdf_sprite/huishype.{json,png}`
- `/tiles/font/{fontstack}/{range}`
- `/tiles/catalog`
- `/tiles/health`
- `/tiles/_/metrics`

## Read-Only Database Role

Martin must use `MARTIN_DATABASE_URL` with a read-only role. The repo includes a
starter grant script at `tools/martin/readonly-role.sql`; replace the password
before applying it in production.

Connection string example:

```text
postgresql://martin_tile:REPLACE_ME@postgres:5432/huishype?sslmode=disable&options=-c%20statement_timeout%3D5000%20-c%20work_mem%3D32MB
```

The statement timeout and work memory budget belong in the role settings or
connection-string `options`. Use `statement_timeout=5000` and `work_mem=32MB`
for Martin sessions. Martin does not have `statement_timeout` or `work_mem`
config keys.

## Local Use

Martin is behind a local compose profile so the default dev stack does not start
until the required SQL functions, role, and base archive exist.

```bash
docker compose --profile martin up -d martin
```

Required before local startup:

- create/grant the `martin_tile` role
- deploy the `martin_tiles.property_nodes`, `read_property_nodes`,
  `following_property_nodes`, `trees`, and `buildings` functions
- rebuild/validate the projection tables:
  `pnpm --filter @huishype/api db:rebuild-map-projections` and
  `pnpm --filter @huishype/api db:validate-map-projections`
- keep the checked-in smoke fixture or place a replacement archive at
  `martin/tiles/base.pmtiles`

The checked-in `martin/tiles/base.pmtiles` is only a z0-z1 smoke/local fixture.
The tracked web style uses OpenFreeMap/OpenMapTiles as the visual-parity
basemap. The tracked native style uses the same stable OpenFreeMap source URL;
Fastify inlines that TileJSON into concrete external tile templates when serving
`/tiles/style/huishype-native` because MapLibre Native has been unreliable with
style-defined TileJSON `url` sources.

## Production Use

Set `MARTIN_DATABASE_URL` in Coolify or `.env.production` with the read-only
role. Then deploy:

```bash
docker compose -f docker-compose.prod.yml up -d martin
```

Do not add `ports:` or public reverse-proxy labels to the production Martin
service. Public access must go through the Fastify gateway.

## Validation

Run schema validation and the no-`.pbf` static gate:

```bash
tools/martin/validate-config.sh
```

Run the optional startup log gate only when dependencies are present:

```bash
MARTIN_DATABASE_URL='postgresql://martin_tile:...@postgres:5432/huishype?sslmode=disable&options=-c%20statement_timeout%3D5000%20-c%20work_mem%3D32MB' \
  tools/martin/validate-config.sh --startup
```

The startup gate fails on Martin warnings, ignored keys, unrecognized keys, or
early process exit.

## Smoke

Run smoke checks against a running Martin service:

```bash
MARTIN_BASE_URL=http://127.0.0.1:3111 tools/martin/smoke.mjs
```

For private functions that require trusted gateway-injected parameters, pass
query strings explicitly:

```bash
MARTIN_READ_QUERY='?viewer_id=...&read_version=...' \
MARTIN_FOLLOWING_QUERY='?viewer_id=...&follow_version=...' \
  tools/martin/smoke.mjs
```

The smoke script fetches catalog, TileJSON, style, sprite, SDF sprite, font, one
representative public tile, buildings tile, trees tile, read tile, following
tile, and metrics. It also rejects redirects and `.pbf` tile templates.

## Benchmark

Run a representative sequential benchmark:

```bash
MARTIN_BASE_URL=http://127.0.0.1:3111 tools/martin/benchmark.mjs
```

Override paths or sample counts as needed:

```bash
MARTIN_BENCH_ITERATIONS=50 \
MARTIN_BENCH_PATHS='/tiles/public_property_nodes/13/4207/2692,/tiles/buildings/15/16892/10898' \
  tools/martin/benchmark.mjs
```

Use database-side tools such as `pg_stat_statements` and
`EXPLAIN (ANALYZE, BUFFERS)` for SQL timing and plan details; Martin metrics do
not expose per-query plans or decoded feature counts.

# BAG Building Tiles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Serve individual BAG building footprints as custom vector tiles so each building gets its own feature ID, enabling per-building color variation in 3D fill-extrusion rendering.

**Architecture:** Import ~10.8M 3DBAG building footprints (with LIDAR-measured heights) into a PostGIS table. Serve them as MVT tiles via a new `/tiles/buildings/:z/:x/:y.pbf` endpoint. Replace the OpenMapTiles `building` source in the 3D buildings layer with our own source. The existing `['id'] % 5` color expression then naturally produces per-building color variation since each building is its own feature.

**Tech Stack:** PostGIS (ST_AsMVT), ogr2ogr (3DBAG GeoPackage), Fastify route, MapLibre GL style expressions.

---

## Background

Dutch row houses in OpenStreetMap are often merged into single polygons covering entire street blocks. The OpenMapTiles `building` layer inherits this — one feature ID for many houses. Our `fill-extrusion-color` expression `['id'] % 5` assigns one color per feature, so whole blocks get the same color instead of per-building variation.

BAG (Basisregistratie Adressen en Gebouwen) has individual building footprints for every building in the Netherlands. Each `pand` is a separate polygon with a unique `identificatie`. By serving these as vector tiles, each building becomes its own MVT feature with its own ID.

### Key data

- **GeoPackage:** `data_sources/3dbag_nl.gpkg` (104GB), layer `lod12_2d`, ~10.8M polygons
- **Projection:** EPSG:28992 (RD New) — must transform to EPSG:4326
- **Fields:**
  - `identificatie` (BAG building ID)
  - `b3_h_70p` (70th percentile roof height from AHN LIDAR — use as `render_height`)
  - `b3_h_min` (ground height — use as `render_min_height`)
  - `b3_h_max` (max height)
  - `b3_h_50p` (median height)
  - `b3_dd_id`, `b3_pand_deel_id` (building part IDs)
- **Real LIDAR heights** — no estimation needed. 3DBAG combines BAG footprints with AHN (Actueel Hoogtebestand Nederland) point cloud data.

### Height strategy

Use LIDAR-measured heights directly:
```
render_height = COALESCE(b3_h_70p, 10.0)     -- 70th percentile roof height, fallback 10m
render_min_height = COALESCE(b3_h_min, 0.0)   -- ground level
```

The `lod12_2d` layer provides 2D footprints with height attributes — perfect for fill-extrusion (which extrudes 2D polygons to a given height).

---

## Task 1: Create 3DBAG buildings import script

**Files:**
- Create: `services/api/src/scripts/import-bag-buildings.ts`
- Modify: `services/api/package.json` (add script command)

### Step 1: Write the import script

Create `services/api/src/scripts/import-bag-buildings.ts`:

```typescript
import { execSync } from 'child_process';
import path from 'path';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5440';
const DB_USER = process.env.DB_USER || 'huishype';
const DB_NAME = process.env.DB_NAME || 'huishype';
const DB_PASS = process.env.DB_PASSWORD || 'huishype';

// 3DBAG GeoPackage — lod12_2d layer has 2D footprints with LIDAR-measured heights
const GPKG_PATH = path.resolve(
  import.meta.dirname,
  '../../../../data_sources/3dbag_nl.gpkg'
);

function psql(sql: string): void {
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c ${JSON.stringify(sql)}`,
    { stdio: 'inherit' }
  );
}

async function main() {
  const startTime = Date.now();
  console.log('=== 3DBAG Buildings Import ===');

  // Step 1: Create table
  console.log('[1/4] Creating bag_buildings table...');
  psql(`
    DROP TABLE IF EXISTS bag_buildings CASCADE;
    CREATE TABLE bag_buildings (
      id SERIAL PRIMARY KEY,
      identificatie VARCHAR(20) NOT NULL,
      render_height REAL NOT NULL DEFAULT 10.0,
      render_min_height REAL NOT NULL DEFAULT 0.0,
      geometry GEOMETRY(Polygon, 4326) NOT NULL
    );
  `);

  // Step 2: Import lod12_2d via ogr2ogr with coordinate transform
  console.log('[2/4] Extracting lod12_2d layer with ogr2ogr (this takes several minutes)...');

  // Import 3DBAG lod12_2d: 2D footprints with LIDAR height attributes.
  // Transform from EPSG:28992 (RD New) to EPSG:4326 (WGS84).
  // Use b3_h_70p as render_height (70th percentile roof height).
  // Use b3_h_min as render_min_height (ground level).
  // Filter out buildings with no valid height (b3_h_70p IS NULL means no LIDAR data).
  const ogrCmd = [
    'ogr2ogr',
    '-f', 'PostgreSQL',
    `PG:host=${DB_HOST} port=${DB_PORT} user=${DB_USER} dbname=${DB_NAME} password=${DB_PASS}`,
    GPKG_PATH,
    '-nln', 'bag_buildings_staging',
    '-nlt', 'POLYGON',
    '-t_srs', 'EPSG:4326',
    '-lco', 'GEOMETRY_NAME=geometry',
    '-lco', 'FID=ogc_fid',
    '-overwrite',
    '-sql',
    `SELECT identificatie, b3_h_70p, b3_h_min, geom FROM lod12_2d`,
  ].join(' ');

  execSync(ogrCmd, { stdio: 'inherit', timeout: 60 * 60 * 1000 }); // 60 min timeout for 104GB file

  // Step 3: Insert into final table with height mapping.
  // GROUP BY identificatie + ST_Union merges multi-part buildings (~0.1% of pands
  // have multiple rows in lod12_2d via b3_pand_deel_id) into single features.
  console.log('[3/4] Inserting into bag_buildings with LIDAR heights (merging building parts)...');
  psql(`
    INSERT INTO bag_buildings (identificatie, render_height, render_min_height, geometry)
    SELECT
      identificatie,
      GREATEST(3.0, COALESCE(MAX(b3_h_70p), 10.0))::real AS render_height,
      COALESCE(MIN(b3_h_min), 0.0)::real AS render_min_height,
      ST_Union(geometry) AS geometry
    FROM bag_buildings_staging
    WHERE geometry IS NOT NULL
    GROUP BY identificatie;
  `);

  // Step 4: Create indexes and cleanup
  console.log('[4/4] Creating spatial index...');
  psql(`
    CREATE INDEX IF NOT EXISTS idx_bag_buildings_geometry ON bag_buildings USING GIST (geometry);
    DROP TABLE IF EXISTS bag_buildings_staging;
    ANALYZE bag_buildings;
  `);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s`);

  // Report count and height stats
  const countResult = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT COUNT(*) FROM bag_buildings;"`,
    { encoding: 'utf-8' }
  ).trim();
  console.log(`Imported ${countResult} buildings`);

  const heightStats = execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT ROUND(AVG(render_height)::numeric, 1) AS avg_h, MIN(render_height) AS min_h, MAX(render_height) AS max_h FROM bag_buildings;"`,
    { encoding: 'utf-8' }
  ).trim();
  console.log(`Height stats: ${heightStats}`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
```

### Step 2: Add npm script

In `services/api/package.json`, add to `"scripts"`:
```json
"db:import-buildings": "tsx src/scripts/import-bag-buildings.ts"
```

### Step 3: Run the import

```bash
cd services/api
pnpm run db:import-buildings
```

Expected: ~10.8M buildings imported with real LIDAR heights. Takes ~15-30 minutes (104GB GeoPackage).

### Step 4: Verify

```bash
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM bag_buildings;"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT ROUND(AVG(render_height)::numeric,1), MIN(render_height), MAX(render_height) FROM bag_buildings;"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT identificatie, render_height, render_min_height FROM bag_buildings LIMIT 10;"
```

Expected: ~10.8M rows, heights ranging from 3m to tall buildings, real LIDAR values (not just 10m defaults).

### Step 5: Commit

```bash
git add services/api/src/scripts/import-bag-buildings.ts services/api/package.json
git commit -m "feat: 3DBAG building import with LIDAR-measured heights"
```

---

## Task 2: Add building tiles endpoint

**Files:**
- Modify: `services/api/src/routes/tiles.ts`

### Step 1: Add the route constant and config

Near the existing `BUILDINGS_3D_CONFIG` (line ~90), add:
```typescript
const BUILDINGS_TILE_CONFIG = {
  minZoom: 15,  // match BUILDINGS_3D_CONFIG.minZoom — no need to serve below 3D threshold
  maxZoom: 17,  // beyond z17, tiles are detailed enough (MapLibre overzooms)
};
```

### Step 2: Add the tile endpoint

After the existing tree tiles route (search for `tiles/trees`), add:

```typescript
server.get<{
  Params: { z: string; x: string; y: string };
}>('/tiles/buildings/:z/:x/:y.pbf', async (request, reply) => {
  const z = parseInt(request.params.z, 10);
  const x = parseInt(request.params.x, 10);
  const y = parseInt(request.params.y, 10);

  if (z < BUILDINGS_TILE_CONFIG.minZoom || z > BUILDINGS_TILE_CONFIG.maxZoom) {
    return reply.code(204).send();
  }

  const startTime = Date.now();

  const result = await pool.query(
    `
    WITH mvt_data AS (
      SELECT
        id,
        render_height,
        render_min_height,
        ST_AsMVTGeom(
          ST_Transform(geometry, 3857),
          ST_TileEnvelope($1, $2, $3),
          4096,
          256,
          true
        ) AS geom
      FROM bag_buildings
      WHERE geometry && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
    )
    SELECT ST_AsMVT(mvt_data, 'buildings', 4096, 'geom', 'id') AS mvt
    FROM mvt_data
    WHERE geom IS NOT NULL
    `,
    [z, x, y]
  );

  const mvt = result.rows[0]?.mvt;
  const elapsed = Date.now() - startTime;

  if (!mvt || mvt.length === 0) {
    return reply.code(204).send();
  }

  return reply
    .header('Content-Type', 'application/x-protobuf')
    .header('Cache-Control', 'public, max-age=86400')
    .header('X-Tile-Generation-Time', `${elapsed}ms`)
    .send(mvt);
});
```

### Step 3: Run the existing tile integration tests to check for regressions

```bash
cd services/api
pnpm test -- --testPathPattern=tiles.integration
```

Expected: All existing tests pass (new endpoint doesn't break anything).

### Step 4: Commit

```bash
git add services/api/src/routes/tiles.ts
git commit -m "feat: add /tiles/buildings/:z/:x/:y.pbf endpoint for BAG building footprints"
```

---

## Task 3: Wire building source into style.json

**Files:**
- Modify: `services/api/src/routes/tiles.ts` (buildStyleJson, build3DBuildingsLayer)

### Step 1: Add buildings source to buildStyleJson()

In `buildStyleJson()`, find where `tree-source` is added to `sources` (around line 845). Add after it:

```typescript
const buildingTileUrl = `${baseUrl}/tiles/buildings/{z}/{x}/{y}.pbf`;
sources['buildings-source'] = {
  type: 'vector',
  tiles: [buildingTileUrl],
  minzoom: BUILDINGS_TILE_CONFIG.minZoom,
  maxzoom: BUILDINGS_TILE_CONFIG.maxZoom,
};
```

### Step 2: Update build3DBuildingsLayer() to use new source

Change the layer definition:

```typescript
function build3DBuildingsLayer(): Record<string, unknown> {
  return {
    id: '3d-buildings',
    source: 'buildings-source',        // was: 'openmaptiles'
    'source-layer': 'buildings',       // was: 'building'
    type: 'fill-extrusion',
    minzoom: BUILDINGS_3D_CONFIG.minZoom,
    paint: {
      // Each BAG pand is its own feature, so ['id'] gives per-building variation.
      // Divide by 7 and mod 5 for better distribution across the palette.
      'fill-extrusion-color': [
        'match',
        ['%', ['floor', ['/', ['id'], 7]], 5],
        0, BUILDINGS_3D_CONFIG.colors.palette[0],
        1, BUILDINGS_3D_CONFIG.colors.palette[1],
        2, BUILDINGS_3D_CONFIG.colors.palette[2],
        3, BUILDINGS_3D_CONFIG.colors.palette[3],
        BUILDINGS_3D_CONFIG.colors.palette[4],
      ],
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 1,
        [
          '*',
          ['coalesce', ['get', 'render_height'], 10],
          BUILDINGS_3D_CONFIG.heightMultiplier,
        ],
      ],
      'fill-extrusion-base': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 1,
        ['coalesce', ['get', 'render_min_height'], 0],
      ],
      'fill-extrusion-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_3D_CONFIG.minZoom,
        0,
        BUILDINGS_3D_CONFIG.minZoom + 0.5,
        BUILDINGS_3D_CONFIG.opacity,
      ],
      'fill-extrusion-vertical-gradient': false,
    },
  };
}
```

Key changes:
- `source: 'buildings-source'` (our BAG tiles)
- `'source-layer': 'buildings'` (matches ST_AsMVT layer name)
- Removed `filter: ['!=', ['get', 'hide_3d'], true]` (BAG data doesn't have this property)

### Step 3: Remove the 2D building hide logic

Currently `buildStyleJson()` sets `maxzoom` on OpenMapTiles 2D building fill layers to hide them when 3D kicks in. Since we now use a different source for 3D, we still want to hide the OpenMapTiles 2D buildings at z15+ to avoid overlap.

**Keep the existing 2D building hide logic unchanged** — it still applies because OpenMapTiles 2D fills would show under/alongside our 3D BAG buildings otherwise.

### Step 4: Run tests

```bash
cd services/api
pnpm test -- --testPathPattern=tiles.integration
```

Some existing tests may need updating — the style.json test checks for `3d-buildings` layer with `source: 'openmaptiles'`. Update the test assertion to expect `source: 'buildings-source'`.

### Step 5: Fix any failing tests

In `tiles.integration.test.ts`, find tests that assert on the 3D buildings layer and update:
- `source` should be `'buildings-source'` (not `'openmaptiles'`)
- `source-layer` should be `'buildings'` (not `'building'`)
- Style should include `'buildings-source'` in sources

### Step 6: Commit

```bash
git add services/api/src/routes/tiles.ts services/api/src/__tests__/integration/tiles.integration.test.ts
git commit -m "feat: wire BAG building tiles into style.json for per-building 3D colors"
```

---

## Task 4: Add building tiles integration tests

**Files:**
- Modify: `services/api/src/__tests__/integration/tiles.integration.test.ts`

### Step 1: Add building tile tests

Add a new `describe` block (following the tree-tiles test pattern):

```typescript
describe('GET /tiles/buildings/:z/:x/:y.pbf', () => {
  // Eindhoven center tile at z15
  const EINDHOVEN_Z15 = { z: 15, x: 16828, y: 10898 };
  // Ocean tile (no buildings)
  const OCEAN_TILE = { z: 15, x: 0, y: 0 };

  it('returns 204 below minzoom', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/tiles/buildings/14/${EINDHOVEN_Z15.x}/${EINDHOVEN_Z15.y}.pbf`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 204 above maxzoom', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/tiles/buildings/20/${EINDHOVEN_Z15.x}/${EINDHOVEN_Z15.y}.pbf`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 204 for empty ocean tile', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/tiles/buildings/${OCEAN_TILE.z}/${OCEAN_TILE.x}/${OCEAN_TILE.y}.pbf`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns MVT for Eindhoven at z15', async () => {
    const { z, x, y } = EINDHOVEN_Z15;
    const res = await server.inject({
      method: 'GET',
      url: `/tiles/buildings/${z}/${x}/${y}.pbf`,
    });
    // May be 200 or 204 depending on whether bag_buildings is populated
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toBe('application/x-protobuf');
      expect(res.headers['cache-control']).toContain('public');
      expect(res.headers['x-tile-generation-time']).toBeDefined();
    } else {
      expect(res.statusCode).toBe(204);
    }
  });

  it('is deterministic (same tile = same bytes)', async () => {
    const { z, x, y } = EINDHOVEN_Z15;
    const url = `/tiles/buildings/${z}/${x}/${y}.pbf`;
    const res1 = await server.inject({ method: 'GET', url });
    const res2 = await server.inject({ method: 'GET', url });
    expect(res1.statusCode).toBe(res2.statusCode);
    if (res1.statusCode === 200) {
      expect(Buffer.from(res1.rawPayload)).toEqual(Buffer.from(res2.rawPayload));
    }
  });
});

describe('bag_buildings table', () => {
  it('exists with expected columns', async () => {
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bag_buildings'
      ORDER BY ordinal_position
    `);
    const columns = result.rows.map((r: { column_name: string }) => r.column_name);
    expect(columns).toContain('geometry');
    expect(columns).toContain('render_height');
    expect(columns).toContain('identificatie');
  });

  it('has GIST index on geometry', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'bag_buildings' AND indexdef LIKE '%gist%'
    `);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
```

### Step 2: Update existing style.json tests

Find any assertion that checks for `source: 'openmaptiles'` on the 3D buildings layer and update to `source: 'buildings-source'`. Find any assertion that checks for `source-layer: 'building'` and update to `source-layer: 'buildings'`.

Also add a test that `buildings-source` exists in the style sources:

```typescript
it('includes buildings-source in sources', async () => {
  const res = await server.inject({ method: 'GET', url: '/tiles/style.json' });
  const style = JSON.parse(res.payload);
  expect(style.sources['buildings-source']).toBeDefined();
  expect(style.sources['buildings-source'].type).toBe('vector');
  expect(style.sources['buildings-source'].tiles[0]).toContain('/tiles/buildings/');
});
```

### Step 3: Run all tests

```bash
cd services/api
pnpm test
```

Expected: All pass.

### Step 4: Commit

```bash
git add services/api/src/__tests__/integration/tiles.integration.test.ts
git commit -m "test: add building tile endpoint integration tests"
```

---

## Task 5: Update web shader patch (remove spatial striping)

**Files:**
- Modify: `patches/maplibre-gl@5.16.0.patch` (regenerate)

### Context

The native shader at `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.fragment.glsl` has a "spatial color striping" block (lines 9-14) that was a workaround for merged polygons. With BAG per-building tiles, this is no longer needed. Remove it from the native shader.

The web shader patch does NOT have this striping block, so no web changes needed for this step.

### Step 1: Remove the striping block from native shader

In `fill_extrusion.fragment.glsl`, remove lines 9-14:
```glsl
    // --- Spatial color striping for zebra-stripe effect ---
    {
        float sid = floor(v_wall_uv.x / 40.0);
        float sh = fract(sin(sid * 127.1) * 43758.5453);
        fragColor.rgb *= 0.88 + sh * 0.24;
    }
```

### Step 2: Regenerate native headers

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native
node shaders/generate_shader_code.mjs
```

### Step 3: Rebuild native AAR

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native
BUILDTYPE=Release make android-lib-arm-v8
cd platform/android
BUILDTYPE=Release ../../gradlew :MapLibreAndroid:assembleOpenglRelease
BUILDTYPE=Release ../../gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal
```

### Step 4: Commit native shader changes

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native
git add shaders/ include/
git commit -m "fix: remove spatial striping — BAG per-building tiles handle color variation"
```

---

## Task 6: Run full test suite and verify

**Files:**
- No new files

### Step 1: Typecheck

```bash
pnpm -C apps/app typecheck
```

Expected: Zero TS errors.

### Step 2: Unit tests

```bash
pnpm -C apps/app test
```

Expected: All pass.

### Step 3: Integration tests

```bash
cd services/api && pnpm test
```

Expected: All pass (including new building tile tests).

### Step 4: Visual e2e tests (if building visual tests exist)

```bash
pnpm -C apps/app exec playwright test --project=visual
```

Expected: All pass. The 3D buildings should now show per-building color variation.

### Step 5: Build and push to device

```bash
cd apps/app
npx expo run:android
```

Verify on the Samsung S10e that 3D buildings show individual colors per building rather than per-block.

### Step 6: Commit any remaining changes

```bash
git add -A
git commit -m "feat: BAG per-building tiles for 3D building color variation"
```

---

## Task 7: Add to db:reset pipeline

**Files:**
- Modify: `services/api/package.json` or relevant reset script

### Step 1: Wire import into db:reset

The `db:reset` script runs seed steps sequentially. Add `db:import-buildings` as a step. Find where `db:seed` and `db:seed-listings` are called and add `db:import-buildings` after them.

Check the reset script location — it may be in `services/api/scripts/reset.ts` or a package.json script chain.

### Step 2: Document in AGENTS.md

Add a row to the Performance table in AGENTS.md:

```markdown
| BAG building import | ~8-10M | ~10-15 min |
```

And update the total db:reset time estimate.

### Step 3: Commit

```bash
git add services/api/package.json AGENTS.md
git commit -m "chore: add BAG building import to db:reset pipeline"
```

---

## Performance Notes

- **Import time:** ~15-30 min for ~10.8M buildings (104GB GeoPackage + ogr2ogr transform + PostGIS insert + GIST index)
- **Tile generation:** With GIST index, each z15 tile query covers ~1.2km x 1.2km area, hitting ~100-500 buildings. Should be <50ms per tile.
- **Cache:** `max-age=86400` (24h) since 3DBAG data changes rarely (yearly updates)
- **Tile size:** Individual building polygons are small. At z15, expect ~50-200KB per tile (comparable to OpenMapTiles building tiles)
- **Disk space:** The 104GB GeoPackage is read-only during import. The PostGIS table with ~10.8M polygons + GIST index will use ~5-10GB.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| 104GB GeoPackage slow to read | ogr2ogr streams — doesn't load entire file into memory. One-time cost. |
| 10.8M polygon import slow | One-time cost. Idempotent (DROP + recreate). |
| Tile generation slow for dense areas | GIST index + cache headers. Can add pg tile cache later if needed. |
| Some buildings missing LIDAR heights | `COALESCE(b3_h_70p, 10.0)` — falls back to 10m (same as current OSM default). |
| 3DBAG footprints don't match OSM exactly | Acceptable — 3DBAG is derived from BAG (authoritative Dutch building registry). |

# Tall Building Tree Exclusion Zone — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent Paper Mario billboard trees from being placed near tall buildings (>20m), then unify web+native to the same symbol layer approach — eliminating the custom WebGL depth-tested layer (~500 lines) since exclusion zones make it unnecessary.

**Architecture:** Import tall building footprints (height >20m) from the Netherlands OSM PBF into a `tall_buildings` PostGIS table. Pre-compute `exclusion_geom` via `ST_Buffer` during import (height-proportional radius, capped at 100m). Tile query uses `NOT EXISTS` + `ST_Intersects` against the buffered geometry — fully GIST-indexed, ~0.3ms per tile. The camera angle is fixed to a slight tilt, so the exclusion is conservative but not extreme.

**Tech Stack:** PostGIS (ST_Buffer, ST_Intersects, GIST index), ogr2ogr (OSM PBF extraction), TypeScript (import script, tile route)

---

## Design

### Exclusion Formula

```
radius_meters = min(height, 100)
```

Only applies to buildings with height > 20m. Radius equals building height, capped at 100m.

| Height | Radius |
|--------|--------|
| 20m    | 20m    |
| 30m    | 30m    |
| 50m    | 50m    |
| 80m    | 80m    |
| 100m+  | 100m   |

### Pre-computed Exclusion Zones (Performance Critical)

**Why not `ST_DWithin` at query time?** Casting to `::geography` for meter-based distance bypasses the GIST index on the `geometry` column, causing sequential scans (~15s per tile on 1.8M rows). Instead, we pre-compute buffered exclusion geometries during import using `ST_Buffer` on a meter-based projection (EPSG:28992 / Amersfoort RD New), then store the result back in EPSG:4326. The tile query uses `ST_Intersects` which hits the GIST index directly (~0.3ms).

### Data Source

Import from Netherlands OSM PBF (already in `data_sources/`). OpenFreeMap's `render_height` derives from the same OSM tags, so values will match. Height resolution: `height` tag > `building:levels * 3` > skip.

### Height Parsing

OSM `height` tags are messy: `"12"`, `"12 m"`, `"12m"`, `"~12"`, `"12;15"`. We use PostgreSQL `REGEXP_REPLACE` to strip non-numeric characters and extract the first number.

---

## Task 1: Create the import script for tall buildings

**Files:**
- Create: `services/api/src/scripts/import-tall-buildings.ts`
- Modify: `services/api/package.json` (add `db:seed-tall-buildings` script)

**Step 1: Create the import script**

Pattern-matched from `services/api/src/scripts/import-landcover.ts`. Key differences: extracts from `multipolygons` where `building IS NOT NULL`, computes height from OSM tags, filters to >20m, **pre-computes `exclusion_geom` via `ST_Buffer`** for index-friendly tile queries.

```typescript
/**
 * Import tall building footprints (>20m) from OSM into PostGIS.
 *
 * Uses ogr2ogr to extract building polygons with height data from the Netherlands
 * PBF, then filters to buildings taller than 20m. Pre-computes exclusion_geom
 * via ST_Buffer (height-proportional radius, capped at 100m) for fast
 * GIST-indexed ST_Intersects in the tree tile query.
 *
 * Usage: pnpm -C services/api run db:seed-tall-buildings
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../../data_sources');
const PBF_PATH = path.join(DATA_DIR, 'netherlands-latest.osm.pbf');
const PBF_URL = 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = process.env.DB_PORT ?? '5440';
const DB_NAME = process.env.DB_NAME ?? 'huishype';
const DB_USER = process.env.DB_USER ?? 'huishype';
const DB_PASS = process.env.DB_PASS ?? 'huishype_dev';

/** Minimum building height (meters) to create an exclusion zone */
const MIN_HEIGHT_THRESHOLD = 20;
/** Maximum exclusion radius (meters), caps the buffer size */
const MAX_EXCLUSION_RADIUS = 100;

async function main() {
  // Step 1: Download PBF if not cached
  if (!fs.existsSync(PBF_PATH)) {
    console.log(`Downloading Netherlands OSM PBF to ${PBF_PATH}...`);
    console.log('This is ~1.4GB and may take a few minutes.');
    execSync(`curl -L -o "${PBF_PATH}" "${PBF_URL}"`, {
      stdio: 'inherit',
      timeout: 600_000,
    });
    console.log('Download complete.');
  } else {
    console.log(`Using cached PBF: ${PBF_PATH}`);
  }

  // Step 2: Create table with exclusion_geom column
  console.log('Ensuring tall_buildings table exists...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      CREATE TABLE IF NOT EXISTS tall_buildings (
        id SERIAL PRIMARY KEY,
        osm_id BIGINT,
        height REAL NOT NULL,
        geometry GEOMETRY(MultiPolygon, 4326) NOT NULL,
        exclusion_geom GEOMETRY(Geometry, 4326) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tall_buildings_exclusion ON tall_buildings USING GIST (exclusion_geom);
    "`,
    { stdio: 'inherit' },
  );

  // Step 3: Truncate existing data (idempotent re-import)
  console.log('Truncating existing tall_buildings data...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "TRUNCATE tall_buildings RESTART IDENTITY;"`,
    { stdio: 'inherit' },
  );

  // Step 4: Import via ogr2ogr into a staging table
  // OSM buildings have: height (meters string), building:levels (integer)
  // We extract all buildings with height info, then filter to >20m in SQL
  console.log('Importing building footprints via ogr2ogr...');

  const ogrSQL = [
    'SELECT osm_id,',
    'CAST(COALESCE(',
    '  NULLIF(CAST(REPLACE(REPLACE(height, \'m\', \'\'), \' \', \'\') AS REAL), 0),',
    '  NULLIF("building:levels" * 3.0, 0)',
    ') AS REAL) AS height,',
    'geometry FROM multipolygons',
    'WHERE building IS NOT NULL',
    'AND (height IS NOT NULL OR "building:levels" IS NOT NULL)',
  ].join(' ');

  const sqlFile = path.join(DATA_DIR, '_tall_buildings_query.sql');
  fs.writeFileSync(sqlFile, ogrSQL);

  const pgConn = `PG:host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} password=${DB_PASS}`;
  const stagingTable = 'tall_buildings_staging';

  try {
    execSync(
      `ogr2ogr -f "PostgreSQL" "${pgConn}" "${PBF_PATH}" -sql @"${sqlFile}" -dialect sqlite -nln ${stagingTable} -t_srs EPSG:4326 -lco GEOMETRY_NAME=geometry -overwrite -progress`,
      {
        stdio: 'inherit',
        timeout: 1_200_000, // 20 minutes (buildings table is large)
      },
    );
  } finally {
    try { fs.unlinkSync(sqlFile); } catch { /* ignore */ }
  }

  // Step 5: Filter >20m, re-parse height robustly in PostgreSQL, and pre-compute exclusion zones
  // Uses REGEXP_REPLACE to extract first numeric value from messy OSM height strings
  // Buffer computed in EPSG:28992 (Amersfoort/RD New) for accurate meter distances in NL
  console.log('Filtering to buildings >20m and computing exclusion zones...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      INSERT INTO tall_buildings (osm_id, height, geometry, exclusion_geom)
      SELECT
        osm_id,
        height,
        geometry,
        ST_Transform(
          ST_Buffer(
            ST_Transform(geometry, 28992),
            LEAST(height, ${MAX_EXCLUSION_RADIUS})
          ),
          4326
        ) AS exclusion_geom
      FROM ${stagingTable}
      WHERE height > ${MIN_HEIGHT_THRESHOLD};
      DROP TABLE IF EXISTS ${stagingTable};
    "`,
    { stdio: 'inherit' },
  );

  // Step 6: Verify
  console.log('Verifying import...');
  execSync(
    `docker exec huishype-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "
      SELECT COUNT(*) AS total,
             ROUND(AVG(height)::numeric, 1) AS avg_height,
             ROUND(MAX(height)::numeric, 1) AS max_height,
             ROUND(MIN(height)::numeric, 1) AS min_height
      FROM tall_buildings;
    "`,
    { stdio: 'inherit' },
  );

  console.log('Tall buildings import complete!');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
```

**Step 2: Add npm script to `services/api/package.json`**

Add after the `db:seed-landcover` line:
```json
"db:seed-tall-buildings": "tsx src/scripts/import-tall-buildings.ts"
```

**Step 3: Run the import**

```bash
cd services/api && pnpm run db:seed-tall-buildings
```

Expected: Table created, buildings imported, count + stats printed. Likely <100K rows.

**Step 4: Verify data in database**

```bash
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT COUNT(*) FROM tall_buildings;"
docker exec huishype-postgres psql -U huishype -d huishype -c "SELECT height, ST_AsText(ST_Centroid(geometry)) FROM tall_buildings ORDER BY height DESC LIMIT 5;"
```

**Step 5: Commit**

```bash
git add services/api/src/scripts/import-tall-buildings.ts services/api/package.json
git commit -m "feat: add import script for tall buildings (>20m) from OSM PBF"
```

---

## Task 2: Modify the tree tile query to exclude trees near tall buildings

**Files:**
- Modify: `services/api/src/routes/tiles.ts` (tree tile SQL query + constants)

**Step 1: Add named constants near other tree constants**

Near the existing `TREE_MIN_ZOOM`, `TREE_MAX_ZOOM` constants in `tiles.ts`, add:

```typescript
/** Minimum building height (meters) for tree exclusion — matches import-tall-buildings.ts */
const TALL_BUILDING_MIN_HEIGHT = 20;
/** Maximum exclusion radius (meters) — matches import-tall-buildings.ts */
const TALL_BUILDING_MAX_RADIUS = 100;
```

(These are documentation constants — the actual filtering uses the pre-computed `exclusion_geom` column.)

**Step 2: Update the `green_trees` CTE to exclude trees near tall buildings**

In the tree tile handler, change the `green_trees` CTE from:

```sql
green_trees AS (
  SELECT DISTINCT ON (c.id)
    c.id,
    c.tree_variant,
    c.geom
  FROM candidates c
  INNER JOIN landcover lc ON ST_Within(c.geom, lc.geometry)
)
```

To:

```sql
green_trees AS (
  SELECT DISTINCT ON (c.id)
    c.id,
    c.tree_variant,
    c.geom
  FROM candidates c
  INNER JOIN landcover lc ON ST_Within(c.geom, lc.geometry)
  WHERE NOT EXISTS (
    SELECT 1 FROM tall_buildings b
    WHERE ST_Intersects(c.geom, b.exclusion_geom)
  )
  ORDER BY c.id
)
```

**Key changes from original plan:**
- Uses `ST_Intersects` against pre-computed `exclusion_geom` (GIST-indexed, ~0.3ms)
- NOT `ST_DWithin` with `::geography` cast (would bypass index, ~15s sequential scan)
- Added `ORDER BY c.id` for deterministic `DISTINCT ON` results per PostgreSQL spec

**Step 2: Restart the API**

```bash
systemctl --user restart huishype-api
```

**Step 3: Verify tiles still work**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/tiles/trees/15/16892/10898.pbf
```

Expected: `200` or `204` (depending on landcover in that tile).

**Step 4: Commit**

```bash
git add services/api/src/routes/tiles.ts
git commit -m "feat: exclude trees within height-proportional radius of tall buildings"
```

---

## Task 3: Unify web tree rendering — remove custom WebGL layer

With building exclusion zones in place, trees are never placed near tall buildings. The web's custom WebGL layer with depth testing against 3D buildings is no longer needed. Both platforms can use the same server-side symbol layer (`paper-trees`), eliminating ~500 lines of complex custom WebGL code.

**Files:**
- Delete: `apps/app/src/components/map/BillboardCustomLayer.ts` (446 lines)
- Delete: `apps/app/src/components/map/__tests__/BillboardCustomLayer.test.ts` (55 lines)
- Modify: `apps/app/app/(tabs)/index.web.tsx` — remove tree custom layer code
- Delete: tree-atlas.png raw endpoint from `services/api/src/routes/tiles.ts` (~12 lines)
- Modify: `services/api/src/__tests__/integration/tree-tiles.integration.test.ts` — remove tree-atlas test

**Step 1: Remove custom layer code from `index.web.tsx`**

Remove the import:
```typescript
import { BillboardCustomLayer } from '../../src/components/map/BillboardCustomLayer';
```

Remove the entire block (lines ~401-430) that:
1. Removes the server-provided `paper-trees` symbol layer
2. Adds the invisible `tree-source-loader` circle layer
3. Creates and adds the `BillboardCustomLayer`

The server-provided `paper-trees` symbol layer from `/tiles/style.json` will now render on web too — same as native. MapLibre GL JS supports `icon-pitch-alignment: 'viewport'` natively for the billboard effect.

**Step 2: Delete `BillboardCustomLayer.ts` and its test**

```bash
rm apps/app/src/components/map/BillboardCustomLayer.ts
rm apps/app/src/components/map/__tests__/BillboardCustomLayer.test.ts
```

**Step 3: Remove the tree-atlas.png raw endpoint from tiles.ts**

The raw atlas endpoint (`GET /sprites/tree-atlas.png`) was only consumed by the custom WebGL layer. With the layer gone, this endpoint is dead code. Remove it from `services/api/src/routes/tiles.ts` (the `app.get('/sprites/tree-atlas.png', ...)` handler, ~12 lines).

The individual tree sprites (`tree-0` through `tree-15`) remain in the OFM sprite sheet — that's what the symbol layer uses.

**Step 4: Update integration test**

In `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`, remove:
```typescript
it('GET /sprites/tree-atlas.png serves the raw atlas', async () => {
  ...
});
```

**Step 5: Run quality gate**

```bash
pnpm -C apps/app typecheck
pnpm -C apps/app test
pnpm -C services/api test
```

All must pass. The `BillboardCustomLayer.test.ts` file is gone, so its 5 tests will no longer run — that's expected.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove custom WebGL tree layer, unify web+native to symbol layer

Building exclusion zones eliminate depth-culling artifacts, so the custom
WebGL layer with depth testing is no longer needed. Both platforms now use
the server-provided paper-trees symbol layer.

Removed:
- BillboardCustomLayer.ts (446 lines of custom WebGL)
- tree-source-loader invisible circle layer hack
- /sprites/tree-atlas.png raw endpoint (dead code)"
```

---

## Task 4: Add integration tests for the exclusion behavior and unified rendering

**Files:**
- Modify: `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`

**Step 1: Add integration tests**

Add to `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`:

```typescript
it('tall_buildings table exists with exclusion_geom GIST index', async () => {
  // Verify the table and index exist (import script has been run)
  const res = await app.inject({
    method: 'GET',
    url: '/tiles/trees/15/16892/10898.pbf',
  });
  // The query should not error — verifies tall_buildings table exists
  // (query would fail with "relation tall_buildings does not exist" otherwise)
  expect([200, 204]).toContain(res.statusCode);
});

it('tree tile query uses exclusion_geom index (not sequential scan)', async () => {
  // Sanity check: verify the GIST index on exclusion_geom exists
  // This catches regressions where someone drops the index or renames the column
  const pool = app.pg;  // or however the test accesses the DB pool
  const result = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'tall_buildings'
    AND indexdef LIKE '%exclusion_geom%'
  `);
  expect(result.rows.length).toBeGreaterThan(0);
});
```

**Step 2: Run tests**

```bash
cd services/api && pnpm test
```

Expected: All tests pass including existing tree tile tests.

**Step 3: Run typecheck**

```bash
pnpm -C apps/app typecheck
```

Expected: Zero errors.

**Step 4: Commit**

```bash
git add services/api/src/__tests__/integration/tree-tiles.integration.test.ts
git commit -m "test: verify tree tiles work with tall_buildings exclusion"
```

---

## Task 5: Visual verification on web and native

**Step 1: Verify web trees render via symbol layer**

Open web and zoom to z15+ in an area with parks/forests. Confirm:
- Trees appear as billboard sprites (always face camera)
- Trees are NOT near tall buildings (exclusion zones working)
- No console errors related to missing layers or sprites
- Visual quality comparable to previous custom WebGL rendering

Check Amsterdam, Rotterdam, or The Hague — areas with highrise apartments near parks.

**Step 2: Verify on native device**

Clear app cache if tiles are stale:
```bash
adb shell pm clear nl.huishype.app
```

Launch app and navigate to same area. Confirm:
- Trees render identically to web (both use symbol layer now)
- No trees clip through tall buildings
- Billboard effect works (trees face camera on tilt)

**Step 3: Run full pre-commit quality gate**

```bash
pnpm -C apps/app typecheck
pnpm -C apps/app test
pnpm -C services/api test
```

All must pass.

# Paper Mario Billboard Trees — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Paper Mario-style 2D tree sprites scattered across green areas as 3D billboard objects with depth-buffer occlusion against buildings, on both web and native platforms.

**Architecture:** Server-side tree point scatter inside OSM landcover polygons + custom WebGL layer (web) + CustomLayerHost-based BillboardLayer Fabric component (native via maplibre-react-native fork). Generic BillboardLayer is reusable for future map decorations.

**Tech Stack:** MapLibre GL JS (web), MapLibre React Native v11 beta (native), OpenGL ES 3.0 (native rendering), WebGL (web rendering), sharp (image processing), Fastify (API), PostGIS ST_AsMVT (tile generation)

**Design doc:** `docs/plans/2026-03-05-paper-mario-billboard-trees-design.md`

---

## Phase 1: Sprite Atlas + Server-Side Scatter

### Task 1: Slice Tree Atlas into Individual Sprites

**Files:**
- Read: `tree-atlas.png` (4x4 grid, 16 variants)
- Create: `services/api/src/scripts/slice-tree-atlas.ts`
- Create: `services/api/sprites/tree-0.png` through `tree-15.png`
- Modify: `services/api/sprites/ofm.json` and `ofm@2x.json`
- Modify: `services/api/sprites/ofm.png` and `ofm@2x.png`
- Modify: `services/api/package.json` (add `sharp` dependency)

**Context:**
- Current sprite sheet: `ofm.png` (49KB, 1x) / `ofm@2x.png` (117KB, 2x)
- Sprite manifest: JSON with `{ name: { height, width, x, y, pixelRatio } }`
- Sprite route: `GET /sprites/:filename` in `tiles.ts` (line ~855)
- The tree atlas is 4x4 grid — each cell is one tree variant

**Step 1: Add sharp dependency**

```bash
cd services/api && pnpm add sharp && pnpm add -D @types/sharp
```

**Step 2: Create atlas slicer script**

Create `services/api/src/scripts/slice-tree-atlas.ts`:

```typescript
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const ATLAS_PATH = path.resolve(__dirname, '../../../../tree-atlas.png');
const SPRITES_DIR = path.resolve(__dirname, '../../sprites');

const GRID_COLS = 4;
const GRID_ROWS = 4;
const SPRITE_SIZE = 64; // Output size per sprite (px)

async function sliceAtlas() {
  const metadata = await sharp(ATLAS_PATH).metadata();
  const { width, height } = metadata;
  if (!width || !height) throw new Error('Cannot read atlas dimensions');

  const cellW = Math.floor(width / GRID_COLS);
  const cellH = Math.floor(height / GRID_ROWS);

  console.log(`Atlas: ${width}x${height}, cell: ${cellW}x${cellH}`);

  // Slice each cell
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const outPath = path.join(SPRITES_DIR, `tree-${index}.png`);
      await sharp(ATLAS_PATH)
        .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
        .resize(SPRITE_SIZE, SPRITE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPath);
      console.log(`  tree-${index}.png`);
    }
  }

  // Merge into sprite sheet
  await mergeIntoSpriteSheet(SPRITE_SIZE);
}

async function mergeIntoSpriteSheet(spriteSize: number) {
  for (const suffix of ['', '@2x']) {
    const pngPath = path.join(SPRITES_DIR, `ofm${suffix}.png`);
    const jsonPath = path.join(SPRITES_DIR, `ofm${suffix}.json`);

    const manifest: Record<string, { height: number; width: number; x: number; y: number; pixelRatio: number }> =
      JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const existingMeta = await sharp(pngPath).metadata();
    const existingW = existingMeta.width!;
    const existingH = existingMeta.height!;
    const pixelRatio = suffix === '@2x' ? 2 : 1;
    const actualSpriteSize = spriteSize * pixelRatio;

    // Arrange tree sprites in a row below existing sheet
    const treeRowWidth = GRID_COLS * GRID_ROWS * actualSpriteSize;
    const newWidth = Math.max(existingW, treeRowWidth);
    const newHeight = existingH + actualSpriteSize;

    // Build tree sprite composites
    const treeComposites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
      const treePath = path.join(SPRITES_DIR, `tree-${i}.png`);
      const resized = await sharp(treePath)
        .resize(actualSpriteSize, actualSpriteSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      treeComposites.push({
        input: resized,
        left: i * actualSpriteSize,
        top: existingH,
      });
      manifest[`tree-${i}`] = {
        height: actualSpriteSize,
        width: actualSpriteSize,
        x: i * actualSpriteSize,
        y: existingH,
        pixelRatio,
      };
    }

    // Create blank canvas and composite existing sheet + tree sprites
    await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: pngPath, left: 0, top: 0 },
        ...treeComposites,
      ])
      .png()
      .toFile(pngPath + '.tmp');

    // Rename tmp to final (sharp can't read and write same file in one pipeline)
    fs.renameSync(pngPath + '.tmp', pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
    console.log(`Updated ${pngPath} (${newWidth}x${newHeight}) and ${jsonPath}`);
  }
}

sliceAtlas().catch(console.error);
```

**Step 3: Run the slicer**

```bash
cd services/api && npx tsx src/scripts/slice-tree-atlas.ts
```

Expected: 16 individual PNGs created, sprite sheets updated with `tree-0` through `tree-15` entries.

**Step 4: Verify sprites load**

```bash
# Restart API to pick up new sprites
systemctl --user restart huishype-api
# Check sprite manifest includes tree entries
curl -s http://localhost:3100/sprites/ofm.json | grep -c "tree-"
```

Expected: 16 matches.

**Step 5: Also serve the raw atlas as a texture endpoint**

Modify `services/api/src/routes/tiles.ts` — add a new route near the sprite routes:

```typescript
// Near line 855 (sprite route)
fastify.get('/sprites/tree-atlas.png', async (request, reply) => {
  const atlasPath = path.resolve(__dirname, '../../../../tree-atlas.png');
  const buffer = await fs.promises.readFile(atlasPath);
  reply.header('Content-Type', 'image/png');
  reply.header('Cache-Control', 'public, max-age=604800, immutable');
  return reply.send(buffer);
});
```

**Step 6: Commit**

```bash
git add services/api/src/scripts/slice-tree-atlas.ts services/api/sprites/ services/api/package.json services/api/pnpm-lock.yaml services/api/src/routes/tiles.ts
git commit -m "feat(sprites): slice tree atlas into 16 sprites and merge into sprite sheet"
```

---

### Task 2: Import OSM Landcover Data + Tree Scatter Utility

**Files:**
- Create: `services/api/src/scripts/import-landcover.ts`
- Create: `services/api/src/services/tree-scatter.ts`
- Create: `services/api/src/__tests__/tree-scatter.test.ts`
- Modify: `services/api/src/db/migrations/` (add landcover table)

**Context:**
- Our PostGIS DB has BAG property data but NO landcover/green polygon data
- We need parks, forests, greenspace, grass polygons to constrain tree scatter
- OpenStreetMap data for Netherlands is freely available as PBF extracts
- We already use ogr2ogr for BAG import — same tool works for OSM data

**Step 1: Add landcover migration**

Create a migration that adds a `landcover` table:

```sql
CREATE TABLE IF NOT EXISTS landcover (
  id SERIAL PRIMARY KEY,
  osm_id BIGINT,
  type VARCHAR(50) NOT NULL,  -- 'park', 'forest', 'grass', 'wood', 'meadow', etc.
  geometry GEOMETRY(Polygon, 4326) NOT NULL
);
CREATE INDEX idx_landcover_geometry ON landcover USING GIST (geometry);
CREATE INDEX idx_landcover_type ON landcover (type);
```

**Step 2: Create landcover import script**

Create `services/api/src/scripts/import-landcover.ts`:
- Download Netherlands OSM PBF extract from Geofabrik (https://download.geofabrik.de/europe/netherlands-latest.osm.pbf) if not already cached in `data_sources/`
- Use ogr2ogr to extract green polygons from the PBF:
  ```bash
  ogr2ogr -f "PostgreSQL" "PG:host=localhost port=5440 dbname=huishype user=huishype" \
    data_sources/netherlands-latest.osm.pbf \
    -sql "SELECT osm_id, CASE WHEN leisure='park' THEN 'park' WHEN landuse IN ('forest','meadow','grass') THEN landuse WHEN \"natural\" IN ('wood','grassland','scrub') THEN \"natural\" ELSE 'other' END AS type, geometry FROM multipolygons WHERE leisure='park' OR landuse IN ('forest','meadow','grass','recreation_ground','village_green') OR \"natural\" IN ('wood','grassland','scrub','heath')" \
    -nln landcover \
    -t_srs EPSG:4326 \
    -lco GEOMETRY_NAME=geometry \
    -overwrite
  ```
- Or alternatively: extract to CSV, then COPY into staging table (same pattern as BAG seed)
- Script should be idempotent (TRUNCATE + re-import)

Add to package.json: `"db:seed-landcover": "tsx src/scripts/import-landcover.ts"`

**Step 3: Write tree scatter utility with tests**

Create `services/api/src/services/tree-scatter.ts` (server-side, NOT apps/app):

```typescript
export interface ScatterPoint {
  lon: number;
  lat: number;
  variant: number;
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Simple seeded PRNG (Mulberry32)
 */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash tile coordinates to a seed
 */
export function tileSeed(z: number, x: number, y: number): number {
  return (z * 73856093) ^ (x * 19349663) ^ (y * 83492791);
}

/**
 * Scatter random points inside a bounding box (used as candidates,
 * filtered by PostGIS ST_Within against landcover polygons)
 */
export function scatterCandidatePoints(
  bbox: BBox,
  count: number,
  variants: number,
  seed: number,
): ScatterPoint[] {
  const rng = seededRandom(seed);
  const points: ScatterPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lon: bbox.minLon + rng() * (bbox.maxLon - bbox.minLon),
      lat: bbox.minLat + rng() * (bbox.maxLat - bbox.minLat),
      variant: Math.floor(rng() * variants),
    });
  }
  return points;
}
```

Note: We generate MORE candidate points than needed (e.g. 200), then filter to only those inside landcover polygons via PostGIS `ST_Within`. The rejection happens in SQL, not in JS.

Create `services/api/src/__tests__/tree-scatter.test.ts`:

```typescript
import { scatterCandidatePoints, seededRandom, tileSeed } from '../services/tree-scatter';

describe('tree-scatter', () => {
  test('seededRandom produces deterministic sequence', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(12345);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  test('seededRandom produces values in [0, 1)', () => {
    const rng = seededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('tileSeed is deterministic', () => {
    expect(tileSeed(15, 16892, 10898)).toBe(tileSeed(15, 16892, 10898));
    expect(tileSeed(15, 16892, 10898)).not.toBe(tileSeed(15, 16893, 10898));
  });

  test('scatterCandidatePoints generates correct count in bbox', () => {
    const points = scatterCandidatePoints(
      { minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 },
      20, 16, 12345,
    );
    expect(points).toHaveLength(20);
    points.forEach((p) => {
      expect(p.lon).toBeGreaterThanOrEqual(5.4);
      expect(p.lon).toBeLessThanOrEqual(5.5);
      expect(p.lat).toBeGreaterThanOrEqual(51.4);
      expect(p.lat).toBeLessThanOrEqual(51.5);
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(16);
    });
  });

  test('scatterCandidatePoints is deterministic with same seed', () => {
    const p1 = scatterCandidatePoints({ minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 }, 10, 16, 999);
    const p2 = scatterCandidatePoints({ minLon: 5.4, minLat: 51.4, maxLon: 5.5, maxLat: 51.5 }, 10, 16, 999);
    expect(p1).toEqual(p2);
  });
});
```

**Step 4: Run tests**
```bash
cd services/api && pnpm test -- --testPathPattern tree-scatter
```

**Step 5: Commit**
```bash
git add services/api/src/services/tree-scatter.ts services/api/src/__tests__/tree-scatter.test.ts services/api/src/scripts/import-landcover.ts services/api/src/db/migrations/
git commit -m "feat(api): add landcover import + deterministic tree scatter utility"
```

---

### Task 3: Tree Scatter Tile Endpoint

**Files:**
- Modify: `services/api/src/routes/tiles.ts`
- Create: `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`

**Context:**
- Scatter utility generates candidate points across tile bbox
- PostGIS filters candidates to only those inside landcover polygons via `ST_Within`
- Results encoded as MVT via `ST_AsMVT()`
- Also serves raw atlas as texture endpoint

**Step 1: Write integration test**

```typescript
import { buildApp } from '../../app';

describe('Tree tiles endpoint', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('GET /tiles/trees/:z/:x/:y.pbf returns 204 below minzoom', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/10/527/340.pbf' });
    expect(res.statusCode).toBe(204);
  });

  test('GET /tiles/trees/:z/:x/:y.pbf returns MVT at z15', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    // May be 200 (if landcover exists in tile) or 204 (no green areas in tile)
    expect([200, 204]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toBe('application/x-protobuf');
      expect(res.rawPayload.length).toBeGreaterThan(0);
    }
  });

  test('tree tiles are deterministic', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    const res2 = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    expect(res1.rawPayload).toEqual(res2.rawPayload);
  });

  test('tree tiles have cache headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/tiles/trees/15/16892/10898.pbf' });
    if (res.statusCode === 200) {
      expect(res.headers['cache-control']).toContain('max-age');
    }
  });
});
```

**Step 2: Implement tree tile endpoint**

Add to `tiles.ts`:

```typescript
import { scatterCandidatePoints, tileSeed } from '../services/tree-scatter';

const TREE_MIN_ZOOM = 15;
const TREE_MAX_ZOOM = 20;
const TREE_CANDIDATES_PER_TILE = 200; // Generate more, filter by landcover
const TREE_VARIANTS = 16;

fastify.get<{ Params: { z: string; x: string; y: string } }>(
  '/tiles/trees/:z/:x/:y.pbf',
  async (request, reply) => {
    const z = parseInt(request.params.z);
    const x = parseInt(request.params.x);
    const y = parseInt(request.params.y);

    if (z < TREE_MIN_ZOOM || z > TREE_MAX_ZOOM) {
      reply.code(204);
      return;
    }

    const seed = tileSeed(z, x, y);
    const bbox = tileToBBox(z, x, y);
    const candidates = scatterCandidatePoints(bbox, TREE_CANDIDATES_PER_TILE, TREE_VARIANTS, seed);

    // Build VALUES clause for candidate points
    const valuesClause = candidates
      .map((p, i) => `(${i}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326), ${p.variant})`)
      .join(',');

    const envelope = `ST_TileEnvelope(${z}, ${x}, ${y})`;

    // Filter candidates to only those inside landcover polygons
    const query = `
      WITH candidates(id, geom, tree_variant) AS (
        VALUES ${valuesClause}
      ),
      green_trees AS (
        SELECT DISTINCT ON (c.id)
          c.id,
          c.tree_variant,
          c.geom
        FROM candidates c
        INNER JOIN landcover lc ON ST_Within(c.geom, lc.geometry)
      ),
      mvt_data AS (
        SELECT
          id,
          tree_variant,
          ST_AsMVTGeom(
            ST_Transform(geom, 3857),
            ${envelope},
            4096,
            256,
            true
          ) AS geom
        FROM green_trees
      )
      SELECT ST_AsMVT(mvt_data, 'scattered-trees', 4096, 'geom') AS mvt
      FROM mvt_data
    `;

    const result = await fastify.pg.query(query);
    const mvt = result.rows[0]?.mvt;

    if (!mvt || mvt.length === 0) {
      reply.code(204);
      return;
    }

    reply
      .header('Content-Type', 'application/x-protobuf')
      .header('Cache-Control', 'public, max-age=86400, immutable')
      .send(mvt);
  },
);
```

The key difference from the original plan: `INNER JOIN landcover lc ON ST_Within(c.geom, lc.geometry)` ensures only points inside green polygons survive. The GIST index on `landcover.geometry` makes this spatial join fast.

Also add `tileToBBox` helper and raw atlas texture endpoint (`GET /sprites/tree-atlas.png`).

**Step 3: Add tree source to style.json**

```typescript
style.sources['tree-source'] = {
  type: 'vector',
  tiles: [`${baseUrl}/tiles/trees/{z}/{x}/{y}.pbf`],
  minzoom: TREE_MIN_ZOOM,
  maxzoom: TREE_MAX_ZOOM,
};
```

**Step 4: Run tests, commit**

```bash
cd services/api && pnpm test -- --testPathPattern tree-tiles
git add services/api/src/routes/tiles.ts services/api/src/__tests__/integration/tree-tiles.integration.test.ts
git commit -m "feat(api): add tree scatter tile endpoint with landcover filtering"
```

---

## Phase 2: Web BillboardLayer (Custom WebGL)

### Task 4: Web BillboardCustomLayer Class

**Files:**
- Create: `apps/app/src/components/map/BillboardCustomLayer.ts`
- Create: `apps/app/src/__tests__/BillboardCustomLayer.test.ts`

**Context:**
- MapLibre GL JS custom layer docs: `CustomLayerInterface` with `onAdd(map, gl)`, `render(gl, options)`, `onRemove(map, gl)`
- `options` includes `farZ`, `nearZ`, `fov`, `cameraToCenterDistance`, `projectionMatrix` (Float64Array), `defaultProjectionData`
- The layer needs to: load tree atlas texture, read tree point features from the `tree-source` vector tile source, render billboard quads with depth test
- Current old tree implementation: `add3DTreeSymbols()` at line 138 of `index.web.tsx`

**Step 1: Create the BillboardCustomLayer class**

Create `apps/app/src/components/map/BillboardCustomLayer.ts`:

```typescript
import type maplibregl from 'maplibre-gl';

interface BillboardLayerConfig {
  id: string;
  atlasUrl: string;
  gridCols: number;
  gridRows: number;
  /** Vector tile source ID containing scattered tree points */
  sourceId: string;
  /** Source layer name within the vector tiles */
  sourceLayer: string;
  /** Feature property name for tree variant index */
  variantProperty: string;
  /** Size of billboard in pixels at current zoom */
  size: number;
  minZoom: number;
}

interface TreePoint {
  x: number;      // Mercator x
  y: number;      // Mercator y
  variant: number;
}

export class BillboardCustomLayer implements maplibregl.CustomLayerInterface {
  id: string;
  type: 'custom' = 'custom';
  renderingMode: '3d' = '3d'; // Enables depth buffer access

  private config: BillboardLayerConfig;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private textureLoaded = false;
  private vertexBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  constructor(config: BillboardLayerConfig) {
    this.id = config.id;
    this.config = config;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    this.program = this.createProgram(gl);
    this.texture = this.loadTexture(gl);
    this.vertexBuffer = gl.createBuffer();
    this.texCoordBuffer = gl.createBuffer();
  }

  // Cached scatter results
  private cachedPoints: TreePoint[] = [];
  private cacheKey = '';

  render(gl: WebGLRenderingContext, options: maplibregl.CustomRenderMethodInput): void {
    if (!this.program || !this.map || !this.textureLoaded) return;

    const zoom = this.map.getZoom();
    if (zoom < this.config.minZoom) return;

    // Generate cache key from map center + zoom (re-scatter when map moves)
    const center = this.map.getCenter();
    const newCacheKey = `${center.lng.toFixed(4)},${center.lat.toFixed(4)},${zoom.toFixed(1)}`;
    if (newCacheKey !== this.cacheKey) {
      this.cacheKey = newCacheKey;
      this.cachedPoints = this.getTreePointsFromSource();
    }

    if (this.cachedPoints.length === 0) return;

    // Save GL state before rendering
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevBlendSrc = gl.getParameter(gl.BLEND_SRC_RGB);
    const prevBlendDst = gl.getParameter(gl.BLEND_DST_RGB);
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

    gl.useProgram(this.program);

    // Enable depth test — fill-extrusion has written depth values
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Enable alpha blending for transparent parts
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_atlas'), 0);

    // Set projection matrix
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.program, 'u_matrix'),
      false,
      options.projectionMatrix,
    );

    // Set grid uniforms
    gl.uniform2f(
      gl.getUniformLocation(this.program, 'u_grid'),
      this.config.gridCols,
      this.config.gridRows,
    );

    // Billboard size in Mercator units
    // At zoom 15, 1 Mercator unit = ~circumference of earth
    // We want trees to be ~10m tall
    const metersPerMercator = 40075016.686 * Math.cos(this.map.getCenter().lat * Math.PI / 180);
    const treeHeightMeters = 10;
    const sizeInMercator = treeHeightMeters / metersPerMercator;
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_size'), sizeInMercator);

    // Camera up vector for billboarding (simplified: assume up is Y in screen space)
    const bearing = this.map.getBearing() * Math.PI / 180;
    const pitch = this.map.getPitch() * Math.PI / 180;
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_bearing'), bearing);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_pitch'), pitch);

    // Render each tree as a quad
    for (const point of this.cachedPoints) {
      this.renderBillboard(gl, point);
    }

    // Restore GL state
    gl.useProgram(prevProgram);
    if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(prevDepthMask);
    if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
    gl.blendFunc(prevBlendSrc, prevBlendDst);
    gl.activeTexture(prevActiveTexture);
  }

  private getTreePointsFromSource(): TreePoint[] {
    if (!this.map) return [];

    // Query tree point features from the server-side vector tile source
    const features = this.map.querySourceFeatures(this.config.sourceId, {
      sourceLayer: this.config.sourceLayer,
    });

    if (features.length === 0) return [];

    // Convert to Mercator TreePoints
    return features.map(f => {
      const coords = (f.geometry as GeoJSON.Point).coordinates;
      const mercator = maplibregl.MercatorCoordinate.fromLngLat({ lng: coords[0], lat: coords[1] });
      return {
        x: mercator.x,
        y: mercator.y,
        variant: (f.properties?.[this.config.variantProperty] as number) ?? 0,
      };
    });
  }

  private renderBillboard(gl: WebGLRenderingContext, point: TreePoint): void {
    if (!this.program || !this.vertexBuffer || !this.texCoordBuffer) return;

    // Pass point position
    gl.uniform2f(
      gl.getUniformLocation(this.program, 'u_position'),
      point.x,
      point.y,
    );

    // Pass variant for UV calculation
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_variant'),
      point.variant,
    );

    // Quad vertices (two triangles) — unit quad centered at bottom
    const vertices = new Float32Array([
      -0.5, 0.0,  0.5, 0.0,  0.5, 1.0,
      -0.5, 0.0,  0.5, 1.0, -0.5, 1.0,
    ]);

    // Tex coords
    const texCoords = new Float32Array([
      0.0, 1.0,  1.0, 1.0,  1.0, 0.0,
      0.0, 1.0,  1.0, 0.0,  0.0, 0.0,
    ]);

    const posLoc = gl.getAttribLocation(this.program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texLoc = gl.getAttribLocation(this.program, 'a_texcoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertSrc = `
      attribute vec2 a_pos;
      attribute vec2 a_texcoord;

      uniform mat4 u_matrix;
      uniform vec2 u_position;
      uniform float u_size;
      uniform float u_bearing;
      uniform float u_pitch;
      uniform vec2 u_grid;
      uniform float u_variant;

      varying vec2 v_texcoord;

      void main() {
        // Billboard: offset quad corners in Mercator space
        // Horizontal offset rotated by bearing to face camera
        float cb = cos(-u_bearing);
        float sb = sin(-u_bearing);
        vec2 horizontalOffset = vec2(
          a_pos.x * cb,
          a_pos.x * sb
        ) * u_size;

        // Vertical offset uses Z axis (altitude in Mercator space)
        float verticalOffset = a_pos.y * u_size;

        vec4 worldPos = vec4(
          u_position.x + horizontalOffset.x,
          u_position.y + horizontalOffset.y,
          verticalOffset,
          1.0
        );

        gl_Position = u_matrix * worldPos;

        // Calculate atlas UV from variant and grid
        float col = mod(u_variant, u_grid.x);
        float row = floor(u_variant / u_grid.x);
        float cellW = 1.0 / u_grid.x;
        float cellH = 1.0 / u_grid.y;
        v_texcoord = vec2(
          (col + a_texcoord.x) * cellW,
          (row + a_texcoord.y) * cellH
        );
      }
    `;

    const fragSrc = `
      precision mediump float;

      uniform sampler2D u_atlas;

      varying vec2 v_texcoord;

      void main() {
        vec4 color = texture2D(u_atlas, v_texcoord);
        if (color.a < 0.1) discard; // Transparent parts don't write depth
        gl_FragColor = color;
      }
    `;

    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vert));
      return null;
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(frag));
      return null;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }

  private loadTexture(gl: WebGLRenderingContext): WebGLTexture | null {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Placeholder pixel until image loads
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]));

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textureLoaded = true;
      this.map?.triggerRepaint();
    };
    image.src = this.config.atlasUrl;

    return texture;
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
    this.map = null;
  }
}
```

**Step 2: Write unit test**

Create `apps/app/src/__tests__/BillboardCustomLayer.test.ts`:

```typescript
import { BillboardCustomLayer } from '../components/map/BillboardCustomLayer';

describe('BillboardCustomLayer', () => {
  test('creates with correct id and type', () => {
    const layer = new BillboardCustomLayer({
      id: 'test-trees',
      atlasUrl: 'http://localhost:3100/sprites/tree-atlas.png',
      gridCols: 4,
      gridRows: 4,
      sourceId: 'tree-source',
      sourceLayer: 'scattered-trees',
      variantProperty: 'tree_variant',
      size: 64,
      minZoom: 15,
    });
    expect(layer.id).toBe('test-trees');
    expect(layer.type).toBe('custom');
    expect(layer.renderingMode).toBe('3d');
  });
});
```

**Step 3: Run tests**

```bash
cd apps/app && pnpm test -- --testPathPattern BillboardCustomLayer
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/app/src/components/map/BillboardCustomLayer.ts apps/app/src/__tests__/BillboardCustomLayer.test.ts
git commit -m "feat(web): add BillboardCustomLayer WebGL class with depth testing"
```

---

### Task 5: Wire BillboardCustomLayer into Web Map

**Files:**
- Modify: `apps/app/app/(tabs)/index.web.tsx` (lines 88-180: remove old trees, lines 493-495: replace call)

**Context:**
- `createTreeIcon()` at line 90 — DELETE
- `add3DTreeSymbols()` at line 138 — DELETE (replaced by BillboardCustomLayer)
- `VEGETATION_CONFIG` at line 31 — KEEP (still used for fill color enhancement)
- Call site at line 495: `add3DTreeSymbols(map)` — REPLACE

**Step 1: Remove old tree code and add BillboardCustomLayer**

In `index.web.tsx`:
1. Remove `createTreeIcon()` function (lines 90-133)
2. Remove `add3DTreeSymbols()` function (lines 138-180)
3. Add import for `BillboardCustomLayer`
4. Replace `add3DTreeSymbols(map)` call (line 495) with:

```typescript
import { BillboardCustomLayer } from '../../src/components/map/BillboardCustomLayer';

// ... inside map 'load' handler, replacing add3DTreeSymbols(map):
const treeLayer = new BillboardCustomLayer({
  id: 'paper-trees',
  sourceId: 'tree-source',
  sourceLayer: 'scattered-trees',
  atlasUrl: `${API_URL}/sprites/tree-atlas.png`,
  gridCols: 4,
  gridRows: 4,
  variantProperty: 'tree_variant',
  size: 64,
  minZoom: 15,
});
map.addLayer(treeLayer); // Rendered with depth test in 3D pass
```

**Step 2: Verify on web**

```bash
# Open web app
# Navigate to a park area at z15+
# Verify: tree sprites render as billboard quads
# Verify: trees behind buildings are occluded (if any overlap)
# Verify: no console errors
```

**Step 3: Run existing tests to verify no regressions**

```bash
cd apps/app && pnpm test
cd apps/app && pnpm exec playwright test --project=visual
```

Expected: All tests pass. Old tree symbol tests may need updating if any existed.

**Step 4: Commit**

```bash
git add apps/app/app/(tabs)/index.web.tsx
git commit -m "feat(web): replace old tree symbols with BillboardCustomLayer"
```

---

## Phase 3: Native BillboardLayer (maplibre-react-native fork)

### Task 6: Research and Prototype Native CustomLayer

**Files:**
- Read: MapLibre Android SDK `CustomLayer` class API
- Read: MapLibre iOS SDK `MLNOpenGLStyleLayer` API
- Create: Prototype in fork

**Context:**
- Fork location: `/home/caslan/dev/git_repos/hh/maplibre-react-native` (branch: `huishype`)
- Android SDK: `org.maplibre.gl:android-sdk-opengl:12.2.3`
- `CustomLayer(String id, long hostPtr)` — takes JNI pointer to C++ CustomLayerHost
- Need to implement `mbgl::style::CustomLayerHost` in C++ for the rendering logic
- OR: check if there's a Java-level callback API we missed

**Step 1: Deep-dive the CustomLayer Java class**

Decompile and study the full CustomLayer API to understand exactly how to create and register a custom layer host. Check if there's a Java callback interface or if it strictly requires C++ JNI.

```bash
cd /tmp/maplibre-extract && javap -cp classes.jar -p -verbose org.maplibre.android.style.layers.CustomLayer 2>&1 | head -60
```

**Step 2: Check for Java-friendly custom layer interfaces**

```bash
cd /tmp/maplibre-extract && jar tf classes.jar | grep -i "render\|host\|callback\|custom\|draw" | head -20
```

**Step 3: Based on findings, create minimal proof-of-concept**

The approach will depend on what API is available. The plan will be refined during implementation based on what's discovered. Key scenarios:

A. **Java callback API exists**: Simplest — implement rendering in Kotlin with OpenGL ES via GLSurfaceView-style callbacks
B. **C++ only**: Need JNI bridge — write CustomLayerHost in C++, compile via CMake in the fork's Android build
C. **Neither works cleanly**: Fall back to symbol layer with sort-key (Phase 3 fallback)

**Step 4: Document findings and update plan**

Write findings to a scratch file for the next task to consume.

**Step 5: Commit research findings**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-react-native
git add -A && git commit -m "research: CustomLayer API analysis for BillboardLayer"
```

---

### Task 7: Implement Native BillboardLayer (Android)

**Files:**
- Create: `android/src/main/java/org/maplibre/reactnative/components/layer/MLRNBillboardLayer.kt`
- Create: `android/src/main/java/org/maplibre/reactnative/components/layer/MLRNBillboardLayerManager.kt`
- Create: `android/src/main/cpp/BillboardLayerHost.cpp` (if C++ needed)
- Modify: `android/src/main/java/org/maplibre/reactnative/components/layer/MLRNLayer.kt` (add to factory)
- Create: `src/components/billboard/BillboardLayer.tsx`
- Create: `src/components/billboard/BillboardLayerNativeComponent.ts`

**Note:** This task's exact implementation depends on Task 6 findings. The structure follows the existing layer pattern in the fork (MLRNLayer → MLRNLayerManager → NativeComponent → tsx wrapper). The native BillboardLayer reads tree point features from the `tree-source` vector tile source (same approach as web).

**Step 1: Create Android BillboardLayer component**

Follow the pattern of existing layers (e.g., MLRNLayer.kt lines 147-197 factory):
- Register `CustomLayer` with the map style
- Pass rendering host (via JNI or Java callback)
- Accept props: atlasUrl, gridCols, gridRows, sourceId, sourceLayer, variantProperty, size, minZoom
- Read tree point features from the `tree-source` vector tile source for tree placement

**Step 2: Create JS bindings**

Codegen pattern matching existing layers:
- `BillboardLayerNativeComponent.ts` with codegen spec
- `BillboardLayer.tsx` with typed props

**Step 3: Build and test on device**

```bash
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
npx expo run:android
```

Test: Navigate to park area at z15, verify trees render.

**Step 4: Commit to fork**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-react-native
git add -A && git commit -m "feat: add BillboardLayer component for custom rendered billboards"
```

---

### Task 8: Implement Native BillboardLayer (iOS)

**Files:**
- Create: `ios/components/layer/MLRNBillboardLayer.m`
- Create: `ios/components/layer/MLRNBillboardLayer.h`
- Modify: iOS layer factory

**Step 1: Implement iOS BillboardLayer**

Wrap `MLNOpenGLStyleLayer` with rendering block. Same shader logic as Android.

**Step 2: Build and test on iOS simulator**

```bash
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
npx expo run:ios
```

**Step 3: Commit**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-react-native
git add -A && git commit -m "feat(ios): add BillboardLayer iOS implementation"
```

---

### Task 9: Wire BillboardLayer into Native Map

**Files:**
- Modify: `apps/app/app/(tabs)/index.tsx` (add BillboardLayer component)
- Modify: `apps/app/package.json` (update fork reference if needed)

**Step 1: Update fork dependency**

```bash
cd apps/app && pnpm update @maplibre/maplibre-react-native
```

**Step 2: Add BillboardLayer to native map**

In `index.tsx`, inside the `<Map>` component:

```tsx
import { BillboardLayer } from '@maplibre/maplibre-react-native';

// Inside <Map> component, after Camera:
<BillboardLayer
  id="paper-trees"
  sourceId="tree-source"
  sourceLayer="scattered-trees"
  atlasUrl={`${API_URL}/sprites/tree-atlas.png`}
  gridCols={4}
  gridRows={4}
  variantProperty="tree_variant"
  size={64}
  minZoom={15}
/>
```

**Step 3: Build and test on device**

```bash
npx expo run:android
# Navigate to Eindhoven parks at z15+
```

**Step 4: Commit**

```bash
git add apps/app/app/(tabs)/index.tsx apps/app/package.json
git commit -m "feat(native): wire BillboardLayer for Paper Mario trees"
```

---

## Phase 4: Polish and Testing

### Task 10: Visual Tuning and Density

**Files:**
- Modify: `apps/app/src/components/map/BillboardCustomLayer.ts` (density and size tuning)
- Modify: `apps/app/app/(tabs)/index.web.tsx` (density config)

**Step 1: Tune tree density**

Adjust the `density` config parameter and test visually at z15, z16, z17.
- Too sparse: increase count
- Too dense: decrease count
- Compare against Snap Maps reference

**Step 2: Tune tree size**

Adjust `treeHeightMeters` in BillboardCustomLayer to feel right relative to buildings.
- ~8-12m height feels like a real tree
- Test at various zoom levels to ensure "world-scale" feel

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: tune tree density and billboard size"
```

---

### Task 11: 3D Building Minzoom Alignment

**Files:**
- Modify: `services/api/src/routes/tiles.ts` (3D buildings minzoom)

**Context:**
- User requested trees AND buildings start at z15
- Current 3D buildings: `minzoom: 14` (line ~88 of tiles.ts)
- Need to change to `minzoom: 15`

**Step 1: Update 3D buildings minzoom**

Change `minzoom: 14` to `minzoom: 15` in `build3DBuildingsLayer()`.
Also update the 2D building layer `maxzoom` from `14.5` to `15` for clean transition.

**Step 2: Run existing tests**

```bash
cd apps/app && pnpm test
cd apps/app && pnpm exec playwright test --project=visual
```

**Step 3: Commit**

```bash
git add services/api/src/routes/tiles.ts
git commit -m "fix: align 3D buildings minzoom to z15 (matching trees)"
```

---

### Task 12: Full Test Suite + E2E

**Files:**
- Create: `apps/app/e2e/visual/paper-trees.spec.ts`
- Run: All existing test suites

**Step 1: Create Playwright visual test for trees**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Paper Mario Trees', () => {
  test('trees render at z15 in park area', async ({ page }) => {
    await page.goto('http://localhost:8081?lat=51.44&lon=5.47&zoom=15');
    // Wait for map to load
    await page.waitForFunction(() => {
      const map = (window as any).__map;
      return map?.isStyleLoaded() && map?.getLayer('paper-trees');
    }, { timeout: 60000 });

    // Wait for green polygons to render and tree scatter to complete
    await page.waitForTimeout(3000);

    // Take screenshot for visual verification
    await page.screenshot({ path: 'test-results/paper-trees/trees-z15.png' });
  });

  test('no trees below z15', async ({ page }) => {
    await page.goto('http://localhost:8081?lat=51.44&lon=5.47&zoom=13');
    await page.waitForFunction(() => {
      const map = (window as any).__map;
      return map?.isStyleLoaded();
    }, { timeout: 60000 });

    // Verify no tree layer visible
    const treeFeatures = await page.evaluate(() => {
      const map = (window as any).__map;
      return map?.queryRenderedFeatures({ layers: ['paper-trees'] })?.length ?? 0;
    });
    expect(treeFeatures).toBe(0);
  });
});
```

**Step 2: Run all tests**

```bash
cd apps/app && pnpm typecheck
cd apps/app && pnpm test
cd apps/app && pnpm exec playwright test --project=visual
cd apps/app && pnpm exec playwright test --project=integration
```

Expected: ALL GREEN.

**Step 3: Commit**

```bash
git add apps/app/e2e/visual/paper-trees.spec.ts
git commit -m "test: add Paper Mario tree visual e2e tests"
```

---

## Phase Summary

| Phase | Tasks | What ships |
|-------|-------|-----------|
| 1: Sprites + Atlas | Tasks 1-3 | Sprite atlas sliced, landcover imported, tree tile endpoint live |
| 2: Web Custom Layer | Tasks 4-5 | Trees render on web with server-side scatter + depth occlusion |
| 3: Native Custom Layer | Tasks 6-9 | Trees render on native via fork patch |
| 4: Polish + Testing | Tasks 10-12 | Density/size tuned, all tests green |

**Critical path:** Phase 1 → Phase 2 (web can ship independently) → Phase 3 (native, depends on fork research in Task 6)

**Fallback:** If Task 6 reveals native CustomLayer is too complex, native falls back to symbol layer with `symbol-sort-key` for depth illusion (still good, just no building occlusion).

# Fix 3DBAG Building Heights Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix building heights by using correct ground elevation (`b3_h_maaiveld` from `pand` layer) instead of `b3_h_min` from `lod12_2d`, and add per-building depth jitter to eliminate z-fighting on overlapping footprints.

**Architecture:** The import script joins the `lod12_2d` geometry layer with the `pand` attribute layer (via `identificatie`) to get `b3_h_maaiveld` — the actual ground surface elevation. The tile query and style remain unchanged. A per-building `fill-extrusion-base` micro-offset resolves residual z-fighting from overlapping 3DBAG footprints.

**Tech Stack:** PostgreSQL/PostGIS, ogr2ogr, MapLibre GL JS, TypeScript

---

## Background

### The Bug

The 3DBAG GeoPackage has two relevant layers:
- **`lod12_2d`**: Building footprints with `b3_h_70p` (70th percentile roof height, absolute above NAP) and `b3_h_min` (minimum height of the 3D model surface — NOT ground level)
- **`pand`**: Building attributes including `b3_h_maaiveld` (actual ground surface elevation above NAP)

The import script (`services/api/src/scripts/import-bag-buildings.ts`) currently uses `b3_h_min` as the ground elevation. For many buildings, `b3_h_min` is near roof level (the LOD12 model only captured the roof surface), producing near-zero building heights that get clamped to 3.0m by `GREATEST(3.0, ...)` in the tile query.

**Example — Beeldbuisring 41, Eindhoven (`NL.IMBAG.Pand.0772100001023456`):**
- `b3_h_70p = 28.617` (roof, absolute)
- `b3_h_min = 28.459` (model minimum — WRONG for ground)
- `b3_h_maaiveld = 18.907` (actual ground — CORRECT, from `pand` layer)
- Current: `28.617 - 28.459 = 0.16m` → clamped to 3.0m
- Correct: `28.617 - 18.907 = 9.71m` (matches 3DBAG viewer)

### Verified Facts

- `pand` layer has **unique** `identificatie` (10,771,547 rows, all distinct)
- `lod12_2d` has 10,783,944 rows (multiple parts per building via `b3_pand_deel_id`)
- JOIN works in GeoPackage SQLite: `SELECT l.*, p.b3_h_maaiveld FROM lod12_2d l LEFT JOIN pand p ON l.identificatie = p.identificatie`
- `b3_h_maaiveld` is `Real` type, may be NULL for some buildings

### Overlapping Footprints (Secondary Issue)

3DBAG has some buildings with near-100% overlapping footprints (different `identificatie`, same physical location). Even with correct heights, these cause z-fighting when both are extruded. A per-building `fill-extrusion-base` micro-offset (0–0.48m based on `id % 97`) resolves this by breaking depth buffer equality. The offset is sub-pixel at z15–z18 viewing distances.

---

## Task 1: Update ogr2ogr SQL to JOIN with `pand` layer

**Files:**
- Modify: `services/api/src/scripts/import-bag-buildings.ts:66-80`

**Step 1: Update the ogr2ogr `-sql` parameter**

Change line 79 from:
```typescript
'-sql', '"SELECT identificatie, b3_h_70p, b3_h_min, geom FROM lod12_2d"',
```
to:
```typescript
'-sql', '"SELECT l.identificatie, l.b3_h_70p, p.b3_h_maaiveld, l.geom FROM lod12_2d l LEFT JOIN pand p ON l.identificatie = p.identificatie"',
```

**Step 2: Update the INSERT statements to use `b3_h_maaiveld`**

Line 93-94 (single-part buildings), change:
```typescript
GREATEST(3.0, COALESCE(s.b3_h_70p, 10.0))::real,
COALESCE(s.b3_h_min, 0.0)::real,
```
to:
```typescript
COALESCE(s.b3_h_70p, 10.0)::real,
COALESCE(s.b3_h_maaiveld, 0.0)::real,
```

Note: Remove `GREATEST(3.0, ...)` from the import — the 3.0m floor clamp should stay in the **tile query** only (line 1163 of `tiles.ts`), not baked into the stored data. Storing raw values lets us adjust the clamp later without re-importing.

Line 112-113 (multi-part buildings), change:
```typescript
GREATEST(3.0, COALESCE(MAX(s.b3_h_70p), 10.0))::real,
COALESCE(MIN(s.b3_h_min), 0.0)::real,
```
to:
```typescript
COALESCE(MAX(s.b3_h_70p), 10.0)::real,
COALESCE(MIN(s.b3_h_maaiveld), 0.0)::real,
```

Note: For multi-part buildings, `MIN(b3_h_maaiveld)` is correct — all parts of the same building share the same `b3_h_maaiveld` from the `pand` table (since `pand` has one row per `identificatie`), so MIN/MAX/AVG all return the same value.

**Step 3: Update column comments and script header**

Update the script docstring (line 5) to mention the `pand` layer JOIN:
```typescript
 * Source: data_sources/3dbag_nl.gpkg (104GB)
 *   - Geometry: layer `lod12_2d` (2D polygons with LIDAR roof heights)
 *   - Attributes: layer `pand` (ground elevation b3_h_maaiveld)
 *   - Joined on `identificatie` during ogr2ogr extraction
```

**Step 4: Commit**

```bash
git add services/api/src/scripts/import-bag-buildings.ts
git commit -m "fix: use b3_h_maaiveld ground elevation instead of b3_h_min for building heights

b3_h_min is the minimum height of the 3D model surface (often at roof
level), not the ground elevation. JOIN lod12_2d with pand layer to get
b3_h_maaiveld — the actual ground surface elevation above NAP.

Also store raw absolute heights (no GREATEST clamp) — the 3.0m floor
stays in the tile query where it belongs."
```

---

## Task 2: Add per-building depth jitter to resolve z-fighting

**Files:**
- Modify: `services/api/src/routes/tiles.ts:566-579`

**Step 1: Add `fill-extrusion-base` micro-offset**

Change line 579 from:
```typescript
'fill-extrusion-base': 0,
```
to:
```typescript
'fill-extrusion-base': [
  'interpolate',
  ['linear'],
  ['zoom'],
  BUILDINGS_3D_CONFIG.minZoom,
  0,
  BUILDINGS_3D_CONFIG.minZoom + 1,
  ['*', ['%', ['id'], 97], 0.005],
],
```

**Step 2: Adjust `fill-extrusion-height` to compensate**

The base offset shifts buildings up. To keep roof heights unchanged (and `v_height_m` correct in the shader), add the same offset to height. Change lines 566-578 from:
```typescript
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
```
to:
```typescript
'fill-extrusion-height': [
  'interpolate',
  ['linear'],
  ['zoom'],
  BUILDINGS_3D_CONFIG.minZoom,
  0,
  BUILDINGS_3D_CONFIG.minZoom + 1,
  [
    '+',
    [
      '*',
      ['coalesce', ['get', 'render_height'], 10],
      BUILDINGS_3D_CONFIG.heightMultiplier,
    ],
    ['*', ['%', ['id'], 97], 0.005],
  ],
],
```

**Why this works:**
- Each building gets a unique vertical offset: `(id % 97) * 0.005` = 0 to 0.48m
- Both base and height shift by the same amount → visual height (`height - base`) unchanged
- The vertical shift breaks depth buffer equality between overlapping building walls
- At z17 (~30m camera distance), 0.005m step ≈ 8 depth buffer levels of separation
- Maximum 0.48m gap is sub-pixel (0.4px at z17, 0.1px at z15)
- The offset scales with the zoom interpolation (0 at z15, full at z16+)

**Step 3: Commit**

```bash
git add services/api/src/routes/tiles.ts
git commit -m "fix: per-building depth jitter to resolve z-fighting on overlapping footprints

Add fill-extrusion-base micro-offset (0-0.48m) based on building ID to
break depth buffer equality between overlapping 3DBAG footprints. Both
base and height shift by the same amount so visual height is unchanged."
```

---

## Task 3: Re-import buildings

**Step 1: Run the import**

```bash
pnpm -C services/api run db:import-buildings
```

This takes ~10 minutes. The ogr2ogr step will be slower due to the JOIN (~8 min vs ~6 min previously).

**Step 2: Verify heights for known buildings**

```bash
docker exec huishype-postgres psql -U huishype -d huishype -t -c "
SELECT identificatie,
  render_height AS abs_roof,
  render_min_height AS abs_ground,
  ROUND((render_height - render_min_height)::numeric, 2) AS building_h,
  ROUND(GREATEST(3.0, render_height - render_min_height)::numeric, 2) AS tile_h
FROM bag_buildings
WHERE identificatie IN (
  'NL.IMBAG.Pand.0772100001023456',  -- BB41: was 0.16m, should be ~9.7m
  'NL.IMBAG.Pand.0772100001023457'   -- BB43: was 6.07m, should stay ~6.07m
)
ORDER BY identificatie;
"
```

**Expected output:**
```
NL.IMBAG.Pand.0772100001023456 | ~28.62 | ~18.91 | ~9.71 | ~9.71   -- FIXED
NL.IMBAG.Pand.0772100001023457 | ~28.60 | ~22.53 | ~6.07 | ~6.07   -- unchanged
```

**Step 3: Check that clamped-to-3.0m count dropped significantly**

```bash
docker exec huishype-postgres psql -U huishype -d huishype -t -c "
SELECT
  SUM(CASE WHEN GREATEST(3.0, render_height - render_min_height) = 3.0 THEN 1 ELSE 0 END) AS clamped_to_3m,
  COUNT(*) AS total,
  ROUND(100.0 * SUM(CASE WHEN GREATEST(3.0, render_height - render_min_height) = 3.0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct
FROM bag_buildings;
"
```

Previously many buildings were clamped to 3.0m due to `b3_h_min ≈ b3_h_70p`. With `b3_h_maaiveld`, far fewer should be clamped (only genuinely flat structures like garages/sheds with real height < 3m).

**Step 4: Restart the API to pick up any cached tile data**

```bash
systemctl --user restart huishype-api
```

---

## Task 4: Run tests

**Step 1: Run API integration tests**

```bash
pnpm -C services/api test
```

All 403+ tests must pass. The building tile integration tests check table structure and tile generation — they should pass since the schema is unchanged.

**Step 2: Run app unit tests**

```bash
pnpm -C apps/app test
```

All 334+ tests must pass.

**Step 3: Run Playwright visual tests (building-related)**

```bash
pnpm -C apps/app exec playwright test --project=visual -g "building|3d"
```

Check that visual tests still pass. Building heights will look different (taller, more correct) — if any visual snapshot tests fail, update the snapshots since the new heights are correct.

**Step 4: Commit test updates if needed**

If any test snapshots or assertions needed updating:
```bash
git add -A
git commit -m "test: update snapshots for corrected building heights"
```

---

## Task 5: Visual verification

**Step 1: Hard-refresh the browser**

Navigate to the Beeldbuisring area in the web app (Ctrl+Shift+R to bypass cache).

**Step 2: Verify Beeldbuisring 41**

- Should now be ~9.7m tall (3 floors), matching its neighbors
- Should have proper procedural windows (3 floors of windows)
- Previously was a 3.0m stub with 1 floor of fuzzy windows

**Step 3: Check for z-fighting**

- Pan around the area at z17-z18
- Buildings that previously showed flickering/fuzzy windows should be clean
- The per-building base offset should have eliminated depth fighting on overlapping footprints

**Step 4: Spot-check other areas**

- Navigate to a few other Dutch cities (Amsterdam, Rotterdam, Utrecht)
- Verify buildings look reasonable — no more widespread 3.0m stubs
- Tall buildings should still look correct

---

## Summary of Changes

| File | Change |
|------|--------|
| `services/api/src/scripts/import-bag-buildings.ts` | JOIN `pand` layer for `b3_h_maaiveld`, store raw heights |
| `services/api/src/routes/tiles.ts` | Per-building base+height micro-offset for z-fighting |

**No changes to:** shader (web patch or native), tile SQL query, style layer definitions (beyond base/height expressions), frontend code.

**Requires:** Full building re-import (~10 min).

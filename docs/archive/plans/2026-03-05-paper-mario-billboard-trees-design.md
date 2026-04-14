# Paper Mario Billboard Trees

**Date**: 2026-03-05
**Status**: Approved

## Goal

Scatter Paper Mario-style 2D tree sprites across green areas (parks, forests, landcover) as 3D billboard objects with true depth-buffer occlusion against buildings and each other. Trees stand upright like cardboard cutouts in a 3D world.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tree placement | Green polygon fill scatter | Dense, Snap Maps-like coverage across all green areas |
| Scatter method | Server-side in tile pipeline with OSM landcover | Consistent across platforms, cached, no client computation, accurate green-area constraint |
| Zoom range | z15+ (same as 3D buildings) | Trees and buildings appear together as world objects |
| Sprite variety | All 16 atlas variants (4x4 grid) | Maximum visual variety |
| Sprite alignment | Viewport/billboard | Paper Mario cardboard cutout effect, faces camera |
| Sizing | Constant world-scale | Trees feel like map objects, not UI decorations |
| Occlusion | Custom layer with depth testing | True 3D occlusion against buildings and other trees |
| Component design | Generic `BillboardLayer` | Reusable for future landmarks, street furniture, etc. |

## Architecture

### 1. Sprite Atlas Processing

Source: `tree-atlas.png` (4x4 grid, 16 tree variants)

**For custom layer (primary):** Serve raw atlas as a GL texture endpoint. The custom layer samples UV coordinates based on variant index and grid dimensions (col = variant % 4, row = floor(variant / 4)).

**For sprite sheet (fallback):** Slice into 16 individual sprites (`tree-0` through `tree-15`), merge into existing `ofm.json`/`ofm.png` sprite sheet. Used if custom layer fails.

### 2. Server-Side Tree Scatter (Tile Pipeline)

Tree positions are generated server-side in the tile pipeline using OSM landcover polygons stored in PostGIS. No client-side computation needed — works identically on web and native.

**Landcover data:**
- Import OpenStreetMap green polygon data (parks, forests, greenspace, grass) for the Netherlands into PostGIS as a `landcover` table
- Data sourced from OSM via `ogr2ogr` from a Netherlands PBF extract
- One-time import, refreshable yearly like BAG data

**Scatter pipeline:** For each tree tile request at z15+:
1. Query `landcover` polygons that intersect the tile envelope
2. Use seeded PRNG (seed = tile z/x/y hash, Mulberry32) to scatter random points within the tile bounds
3. Rejection-sample: only keep points that fall inside green polygons (`ST_Within` or `ST_Intersects`)
4. Each point gets a `tree_variant` property (0–15) for atlas selection
5. Encode as MVT via `ST_AsMVT()` and return

**Density:** ~1 tree per ~200m² (configurable), tuned to look natural at z15

**Caching:** Tiles are deterministic (seeded PRNG) and immutable — aggressive cache headers

**Endpoint:** `GET /tiles/trees/:z/:x/:y.pbf`, source-layer: `scattered-trees`

Trees naturally appear only in green areas because scatter is constrained to landcover polygons. No client-side computation needed — works identically on web and native.

### 3. Generic BillboardLayer Component

A reusable component for rendering textured billboard quads with depth testing.

**Props interface:**
```typescript
interface BillboardLayerProps {
  id: string;                    // Layer ID
  source: string;                // Vector tile source ID
  sourceLayer: string;           // Source-layer name
  spriteAtlas: string;           // URI to texture atlas image
  spriteGrid: [cols: number, rows: number];  // Grid dimensions
  variantProperty: string;       // Feature property for sprite variant selection
  size: number;                  // World-scale size in meters
  minZoom?: number;              // Minimum zoom level
  maxZoom?: number;              // Maximum zoom level
  anchor?: 'bottom' | 'center'; // Anchor point on sprite
  pitchAlignment?: 'viewport' | 'map'; // Billboard or flat
  opacity?: number;              // Layer opacity
}
```

### 4. Native Custom Layer (maplibre-react-native fork patch)

**Verified:** MapLibre Android SDK v12.2.3 includes `org.maplibre.android.style.layers.CustomLayer` class (confirmed via AAR decompilation). iOS SDK v6.22.1 has `MLNOpenGLStyleLayer`. Both wrap the C++ `mbgl::style::CustomLayerHost` interface.

The React Native bindings never wired up support for custom layers. Our fork patch adds it:

**Android:**
- `MLRNBillboardLayer.kt` — Fabric component, creates native `CustomLayer(id, hostPtr)` via JNI
- `BillboardRenderer.kt` (or C++ via JNI) — implements `CustomLayerHost` render callback
  - OpenGL ES 3.0: textured billboard quads
  - Vertex shader: creates camera-facing quad per tree point, projects to world coords
  - Fragment shader: samples atlas texture, discards alpha < 0.1, writes depth
  - Depth test enabled against existing fill-extrusion depth buffer

**iOS:**
- `MLRNBillboardLayer.m` — wraps `MLNOpenGLStyleLayer` with rendering block
- Same shader logic via OpenGL ES (iOS also supports OpenGL in MapLibre v6.x)

**C++ shared core (optional optimization):**
- Billboard rendering logic can live in a shared C++ file compiled for both platforms
- Avoids duplicating shader code across Kotlin and Objective-C

**JS:**
- `BillboardLayerNativeComponent.ts` — codegen native component
- `BillboardLayer.tsx` — typed React component wrapping native

### 5. Web Custom Layer (maplibre-gl-js)

**Verified:** MapLibre GL JS has `CustomLayerInterface` with `onAdd(map, gl)`, `render(gl, options)`, `onRemove()`. No fork needed.

- `BillboardCustomLayer.ts` — implements `CustomLayerInterface`
- Same WebGL rendering logic: textured billboard quads, depth test, atlas sampling
- Reads tree positions from the `tree-source` vector tile source (server-side scattered trees)
- **Z-axis for vertical offset:** In MercatorCoordinate space, x = east-west, y = north-south, z = altitude/vertical. The vertex shader must expand billboard quads along the **Z axis** (not Y) for trees to stand upright.
- **GL state hygiene:** Custom layers must save and restore ALL GL state they modify — depth test, depth mask, blend state, blend func, bound program, bound buffers, bound textures. Not just toggling depth/blend on entry and exit.

### 6. Style Integration

Server-side tile endpoint provides tree positions as vector tiles:

- New tile endpoint: `GET /tiles/trees/:z/:x/:y.pbf`
- `tree-source` added to style.json pointing to the tree tile endpoint
- `paper-trees` layer definition (type: `custom` for web, BillboardLayer on native)
- Positioned after `3d-buildings` fill-extrusion layer for correct depth buffer state
- Only other server-side addition: `GET /sprites/tree-atlas.png` raw atlas texture endpoint

## Rendering Pipeline

```
Frame render order (MapLibre):
1. Fill layers (land, water, parks) — no depth write
2. Fill-extrusion layers (3D buildings) — WRITES to depth buffer
3. Custom BillboardLayer (trees) — READS + WRITES depth buffer
4. Line layers (roads)
5. Symbol layers (labels, icons) — on top, no depth test

Result: Trees behind buildings are occluded. Trees in front render normally.
Tree-to-tree depth is correct via real 3D depth values.
```

## Future Reuse

The `BillboardLayer` component is generic. Future applications:
- Landmarks (windmills, churches, monuments)
- Street furniture (benches, lampposts)
- Seasonal decorations
- Any sprite-based map decoration that needs 3D depth integration

## Files Changed

| File | Change |
|------|--------|
| `tree-atlas.png` | Source atlas (already provided) |
| `services/api/sprites/` | 16 sliced tree sprites + raw atlas endpoint |
| `services/api/src/routes/tiles.ts` | OSM landcover import, tree scatter tile endpoint, raw atlas texture endpoint, style layer definition |
| `apps/app/src/components/map/BillboardCustomLayer.ts` | Web WebGL custom layer class |
| `apps/app/app/(tabs)/index.web.tsx` | Replace old tree symbols with BillboardCustomLayer |
| `maplibre-react-native` fork | New BillboardLayer: Kotlin + ObjC + C++ renderer + JS component |
| `apps/app/app/(tabs)/index.tsx` | Add `<BillboardLayer>` to native map |

## SDK References

- Android `CustomLayer`: `org.maplibre.android.style.layers.CustomLayer(id: String, host: Long)`
- iOS `MLNOpenGLStyleLayer`: rendering block receives OpenGL context
- C++ `mbgl::style::CustomLayerHost`: `initialize()`, `render(CustomLayerRenderParameters)`, `deinitialize()`
- Web `CustomLayerInterface`: `onAdd(map, gl)`, `render(gl, {farZ, nearZ, fov, ...})`, `onRemove(map, gl)`

## Risks

| Risk | Mitigation |
|------|------------|
| JNI complexity for CustomLayerHost | Start with Android, validate approach before iOS |
| OpenGL ES vs Metal shader duplication | MapLibre iOS v6.x still uses OpenGL ES, not Metal |
| Performance with many billboard quads | Instanced rendering, frustum culling, LOD by zoom |
| Tree density tuning | Configurable density parameter, iterate visually |
| CustomLayer is "experimental" in SDK | Feature has existed since Mapbox era, stable in practice |

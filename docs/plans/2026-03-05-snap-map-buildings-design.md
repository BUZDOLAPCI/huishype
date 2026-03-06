# Snap Map-Style 3D Buildings: Procedural Windows + Soft Edges

**Date:** 2026-03-05
**Branch:** dev/paper-mario-trees (extends current work)
**Status:** Approved

## Goal

Replace plain white 3D extruded buildings with Snap Map-style buildings featuring:
- Per-building warm neutral color variation (beige/taupe/off-white)
- Procedural window patterns on side faces with glass reflection glare
- Soft edge ambient occlusion for a "clay model" aesthetic

## Reference

Screenshots: `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_14*.jpg`

Key visual characteristics from Snap Map:
- Buildings have warm beige/taupe/off-white base colors, varied per building
- Side faces show window rectangles in light cyan (~#97C5D5)
- Each window has a diagonal white glare streak simulating glass reflection
- Taller buildings have more window rows (floor-based grid at ~3m/floor)
- Soft ambient occlusion at base and edges gives a toylike/clay feel
- Sides and top share the same base color; directional lighting differentiates them

## Color Palette

### Per-Building Base Colors (data-driven via osm_id)

| Variant | Hex | RGB |
|---------|-----|-----|
| 0 | #E2DAD0 | (226, 218, 208) — warm beige |
| 1 | #DDD7CF | (221, 215, 207) — light taupe |
| 2 | #E6E0D8 | (230, 224, 216) — off-white warm |
| 3 | #D8D2CA | (216, 210, 202) — muted beige |
| 4 | #E0DCD6 | (224, 220, 214) — cool gray-beige |

Applied via style expression: `["match", ["%", ["get", "osm_id"], 5], ...]`

### Window Colors

| Element | Hex | Notes |
|---------|-----|-------|
| Window base | #97C5D5 | Light cyan, per-window hash varies +/- 10 RGB |
| Glare highlight | #FFFFFF | Diagonal streak, blended at ~35-40% intensity |

## Architecture

### Unified Shader Approach

The same GLSL procedural logic runs on both platforms:

| Platform | Shader location | Patch method |
|----------|----------------|-------------|
| Web | `node_modules/maplibre-gl/src/shaders/fill_extrusion.*.glsl` | `patch-package` |
| Native | `maplibre-native/shaders/fill_extrusion.*.glsl` | Fork, rebuild AAR |

### Repos

```
/home/caslan/dev/git_repos/hh/
  maplibre-native/          # NEW fork of github.com/maplibre/maplibre-native
    shaders/
      fill_extrusion.vertex.glsl    # patched
      fill_extrusion.fragment.glsl  # patched
  maplibre-react-native/    # existing fork — gradle pointed to local AAR
  huishype/
    patches/
      maplibre-gl+*.patch           # web shader patch via patch-package
```

## Shader Design

### Vertex Shader Additions

New varyings passed to fragment shader:

```glsl
out highp vec2 v_wall_uv;  // (edgedistance in tile units, normalized elevation 0-1)
out highp float v_height_m; // building height in meters (for floor count)
out lowp float v_is_side;   // 1.0 for side faces, 0.0 for top/bottom
```

Computed from existing attributes:
- `a_normal_ed.w` (edgedistance) -> horizontal wall UV (**in tile coordinate units**, not meters — scales with zoom)
- `elevation` (from base/height) -> vertical wall UV (normalized 0-1)
- `normal.y != 0.0` -> side face detection
- `mod(normal.x, 2.0)` -> top vs bottom vertex (t=1 top, t=0 bottom)
- `v_height_m = max(0.0, height - base)` -> building height in meters (height/base are in meters from style)

### Fragment Shader: Window Generation

```glsl
// Only render windows on buildings >= 6m tall (2+ floors)
if (v_is_side > 0.5 && v_height_m >= 6.0) {
    // 1. Floor grid (~3m per floor)
    float num_floors = max(1.0, floor(v_height_m / 3.0));
    float floor_v = fract(v_wall_uv.y * num_floors);  // 0-1 within each floor

    // 2. Window cell (horizontal repeat in TILE COORDINATE UNITS)
    // edgedistance is in tile units (extent 8192 per tile), not meters.
    // 54 tile units ≈ 4m window spacing at z16 (primary building viewing zoom).
    float window_spacing = 54.0;
    float cell_u = fract(v_wall_uv.x / window_spacing);

    // 3. Window rectangle with fwidth()-based antialiasing (smooth edges, no shimmer)
    float fw_u = fwidth(cell_u);
    float fw_v = fwidth(floor_v);
    float win_mask = smoothstep(0.225 - fw_u, 0.225 + fw_u, cell_u)
                   * smoothstep(0.775 + fw_u, 0.775 - fw_u, cell_u)
                   * smoothstep(0.30 - fw_v, 0.30 + fw_v, floor_v)
                   * smoothstep(0.70 + fw_v, 0.70 - fw_v, floor_v);

    if (win_mask > 0.01) {
        // 4. Local UV within window (0-1)
        float local_u = clamp((cell_u - 0.225) / 0.55, 0.0, 1.0);
        float local_v = clamp((floor_v - 0.30) / 0.40, 0.0, 1.0);

        // 5. Base cyan with per-window variation
        vec2 grid_id = floor(vec2(v_wall_uv.x / window_spacing, v_wall_uv.y * num_floors));
        float hash = fract(sin(dot(grid_id, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 window_color = vec3(0.59, 0.77, 0.84) + hash * vec3(-0.04, -0.02, 0.02);

        // 6. Diagonal glare streak (glass reflection) with antialiased edges
        float diag = (local_u + local_v) * 0.7;
        float fw_diag = fwidth(diag);
        float glare = smoothstep(0.3 - fw_diag, 0.5, diag) * smoothstep(0.7 + fw_diag, 0.5, diag);
        glare *= 0.35 + hash * 0.1;  // vary intensity per window
        window_color = mix(window_color, vec3(1.0), glare);

        // 7. Blend window into base color (win_mask provides soft edges)
        float luminance = dot(v_color.rgb, vec3(0.299, 0.587, 0.114));
        vec3 lit_window = window_color * max(luminance * 1.2, 0.5);
        fragColor.rgb = mix(fragColor.rgb, lit_window, 0.88 * win_mask);
    }
}
```

### Fragment Shader: Soft Edge AO

```glsl
// Base AO: darken at ground level
float base_ao = smoothstep(0.0, 0.08, v_wall_uv.y);  // first ~8% of height
fragColor.rgb *= mix(0.85, 1.0, base_ao);

// Top highlight: slight brightening at top of walls
float top_highlight = smoothstep(0.9, 1.0, v_wall_uv.y);
fragColor.rgb = mix(fragColor.rgb, fragColor.rgb * 1.05, top_highlight);
```

### Style-Level Changes (tiles.ts)

```typescript
const BUILDINGS_3D_CONFIG = {
  minZoom: 15,
  colors: {
    // Per-building variation via osm_id hash
    palette: ['#E2DAD0', '#DDD7CF', '#E6E0D8', '#D8D2CA', '#E0DCD6'],
  },
  opacity: 1.0,
  heightMultiplier: 1.0,
};
```

`fill-extrusion-color` expression:
```json
["match", ["%", ["get", "osm_id"], 5],
  0, "#E2DAD0",
  1, "#DDD7CF",
  2, "#E6E0D8",
  3, "#D8D2CA",
  "#E0DCD6"]
```

## Build Pipeline (Native)

1. Clone `maplibre-native` to `/home/caslan/dev/git_repos/hh/maplibre-native`
2. Create branch `huishype` tracking upstream tag `android-v12.2.3`
3. Patch `shaders/fill_extrusion.vertex.glsl` and `shaders/fill_extrusion.fragment.glsl`
4. Build Android AAR:
   ```bash
   cd platform/android
   ./gradlew :MapLibreAndroid:assembleOpenglRelease
   ```
5. Publish to local Maven: `./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal`
6. Update `maplibre-react-native/android/gradle.properties` to use local version
7. Add `mavenLocal()` to `maplibre-react-native/android/build.gradle` repositories
8. Rebuild app: `npx expo run:android --clean`

## Build Pipeline (Web)

1. Install `patch-package` in `apps/app`
2. Modify `node_modules/maplibre-gl/src/shaders/fill_extrusion.vertex.glsl`
3. Modify `node_modules/maplibre-gl/src/shaders/fill_extrusion.fragment.glsl`
4. Run `npx patch-package maplibre-gl`
5. Add `"postinstall": "patch-package"` to `apps/app/package.json`

## Implementation Order

1. **Write shared GLSL** — the procedural window + AO shader code
2. **Web patch first** — `patch-package` on maplibre-gl, verify in browser
3. **Style update** — per-building color variation in tiles.ts
4. **Fork maplibre-native** — clone, branch, apply same shader patches
5. **Build native AAR** — compile, publish to local Maven
6. **Wire native** — update maplibre-react-native gradle to use local AAR
7. **Test native** — rebuild app, verify on Samsung S10e
8. **E2E tests** — visual tests for both platforms

## Key Risks

| Risk | Mitigation |
|------|-----------|
| Native AAR build fails | Start with web; native shader is identical GLSL, just different build system |
| osm_id not available on all tiles | Fallback to default color in match expression |
| Shader compilation errors on native | Test with `adb logcat \| grep shader` |
| Performance impact of procedural windows | Fragment shader is cheap (no texture lookups, just math) |
| Edge distance encoding differs web vs native | Both use same OpenMapTiles spec; verify with visual test |

## Existing Shader Attributes (Reference)

### Vertex Input
- `a_pos` (vec2, Int16): Tile coordinates
- `a_normal_ed` (vec4, Int16): Normal (xyz * 16384) + edge distance (w)
- `a_centroid` (vec2, TERRAIN3D only): Centroid for elevation

### Normal Encoding
- Top face: `normal.z = 16384`, `t = mod(normal.x, 2.0)` = 1 for top vertex
- Side faces: `normal.y != 0.0`, normal.xy = perpendicular to wall
- `FACTOR = 8192` (2^13) for normal packing

### Edge Distance
- `a_normal_ed.w` = cumulative distance along building ring perimeter **in tile coordinate units** (NOT meters)
- Wraps at 32768 (Int16 max)
- Used by pattern shader for horizontal UV: `vec2(edgedistance, elevation * u_height_factor)`
- Conversion: at z16, 1 tile unit ≈ 0.075m; at z15, ≈ 0.149m; at z17, ≈ 0.037m
- Same building has different edgedistance at different zoom levels (tile extent is always 8192)

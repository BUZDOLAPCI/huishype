# Issue 003: Coordinate Scale Mismatch Between Web and Native

## Summary

Web MapLibre GL JS and MapLibre Native use different internal coordinate scales for tile geometry. This means all spatial shader parameters (window width, gap, edge padding) need different numeric constants per platform — the same GLSL source can't be shared verbatim.

## The Scale Difference

Web MapLibre GL JS uses a tile extent of **8192** for vertex coordinates within a tile. MapLibre Native uses a different internal scale. The empirically measured ratio is approximately **4.6x**.

This ratio was determined by visually calibrating window spacing: web values divided by ~4.6 produce matching visual results on native.

| Parameter | Web Value | Native Value | Ratio |
|-----------|-----------|--------------|-------|
| `window_width` | 360.0 | 78.3 | 4.60 |
| `window_gap` | 8.0 | 1.7 | 4.71 |
| `window_spacing` | 368.0 | 80.0 | 4.60 |
| `outer_pad` / `edge_pad` | 60.0 | 13.0 | 4.62 |

The ratio isn't perfectly consistent (ranges 4.60-4.71) because:
1. The native scale may not be exactly 8192/4.6
2. Different parameters may be affected by different scaling (edgedistance vs face width vs screen pixels)
3. Values were manually tuned rather than mathematically derived

## Why This Happens

### Web (MapLibre GL JS)
- Tile vertex coordinates use extent **8192** (configurable, default in MapLibre GL JS v5)
- `a_normal_ed.w` (edgedistance) is computed in the same coordinate space
- All spatial values in the fragment shader (window_width, padding, etc.) are in these tile-coordinate units

### Native (MapLibre Native)
- Tile geometry is parsed from MVT and reprojected into an internal coordinate system
- The `edgedistance` attribute is computed as `util::dist<int16_t>(d1, d2)` which measures Euclidean distance between polygon vertices in their internal coordinates
- The internal extent appears to be approximately 8192/4.6 ≈ 1782, but this hasn't been confirmed by reading the source

## What This Means for Shader Code

The vertex shaders are nearly identical — the difference is only in projection (`u_matrix` vs `u_projection_matrix`) and some platform-specific features (GLOBE, TERRAIN3D on web; UBO layout on native).

The fragment shaders share identical **logic** but need different **numeric constants** for any value that depends on the coordinate scale:
- Window width/gap/spacing
- Edge padding
- Any `fwidth()`-based threshold that depends on the derivative of coordinate-space values

Values that are **scale-independent** are identical across platforms:
- Floor band positions (0.18, 0.78) — normalized 0-1
- Color palette values
- Streak/reflection parameters — normalized within window UV
- Fresnel/specular parameters — based on normals, not coordinates
- AO parameters — based on normalized wall UV

## Ideal Resolution

### Option A: Derive scale from a uniform
Pass the tile extent (or a scaling factor) as a uniform so the fragment shader can compute platform-appropriate values at runtime:

```glsl
uniform float u_tile_scale;  // 1.0 on web, ~0.217 on native (1/4.6)

float window_width = 360.0 * u_tile_scale;
float window_gap = 8.0 * u_tile_scale;
float edge_pad = 60.0 * u_tile_scale;
```

This would allow sharing the same shader source (or at least the same parameter values) across platforms.

**Challenge**: Adding a new uniform requires modifying the UBO struct on native (`FillExtrusionPropsUBO`), which has strict `std140` alignment requirements and padding. It also needs wiring through the render layer to populate the value.

### Option B: Determine the exact scale ratio
Read the MapLibre Native source to find where tile extent is defined and how edgedistance is computed. Calculate the exact ratio mathematically instead of relying on visual calibration.

**Where to look**:
- `src/mbgl/tile/geometry_tile_data.hpp` — tile extent constant
- `src/mbgl/renderer/buckets/fill_extrusion_bucket.cpp` — how edgedistance is accumulated
- `include/mbgl/util/constants.hpp` — any relevant constants

Once the exact ratio is known, both shaders can use a `#define TILE_SCALE` with the computed value.

### Option C: Normalize edgedistance in vertex shader
Instead of passing raw edgedistance to the fragment shader, normalize it by dividing by some known reference value (like the tile extent) in the vertex shader. Then both platforms' fragment shaders would use the same normalized 0-N range.

```glsl
// vertex shader
v_wall_uv = vec2(edgedistance / TILE_EXTENT, elevation_norm);
```

This requires knowing `TILE_EXTENT` per platform, but it's a one-time constant.

## Current State

Both shaders work correctly with their platform-specific constants. The visual result is very similar. This issue is about eliminating the need for manual calibration and enabling shared shader source in the future.

## Related

- Issue 001 (`a_face_width`) — if face_width worked on native, the outer_pad values would also need correct scaling, but the per-face width itself would already be in the native coordinate scale since it comes from the same vertex buffer.
- The `fwidth()` values also differ between platforms due to both coordinate scale AND screen DPI differences (native ~440 DPI vs web ~96 DPI). Native LOD thresholds are ~3x smaller than web for this reason, which is a separate scaling factor from the tile coordinate scale.

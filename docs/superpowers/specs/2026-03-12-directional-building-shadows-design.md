# Directional Building Shadows — Design Spec

## Goal

Add directional ground shadows to 3D fill-extrusion buildings on both web and native platforms. Shadows make building geometry more prominent and give the scene a stronger sense of depth and light direction. This is a visual enhancement, not physically accurate shadow rendering.

## Approach: Two-Pass Render with Projected Geometry

Render the same fill-extrusion geometry twice per frame:

1. **Shadow pass** (first): Vertex shader collapses all vertices onto the ground plane (z=0) and offsets XY opposite to the light direction, scaled by building height. Fragment shader outputs semi-transparent black with soft edge fade. Depth write off, alpha blending on.
2. **Normal pass** (second): Existing rendering unchanged.

No new geometry is generated. No shadow maps, FBOs, or extra textures. Just one additional draw call per building batch using the same vertex/index buffers with a uniform flag.

## Light Direction

Shadows derive direction from the existing `u_lightpos` uniform, which comes from the MapLibre style's `light.position` property via `sphericalToCartesian()`. This is NOT a unit vector — the radial component is preserved (default ~1.15). The XY components represent the horizontal direction **toward** the light source, so shadows must be cast in the **opposite** direction (`-normalize(u_lightpos.xy)`).

Important: shadow **length** must also use the light's vertical component, not just direction. If we only normalize `u_lightpos.xy`, shadows keep a nearly constant length regardless of sun angle, which is not the intended effect.

Recommended angle-aware length factor:

```glsl
vec2 light_xy = u_lightpos.xy;
float light_xy_len = length(light_xy);
float light_z = max(u_lightpos.z, 0.05);
vec2 light_dir = light_xy_len > 0.0 ? -light_xy / light_xy_len : vec2(0.0, 0.0);

// Short shadows when light is high, long shadows when light is low.
float shadow_angle_factor = clamp(light_xy_len / light_z, 0.0, MAX_SHADOW_RATIO);
```

When `light.anchor` is `viewport`, the shadow rotates with map bearing (already handled by the existing light position computation).

## Coordinate Space: Meters to Tile Units

Building heights are in **meters**, while vertex positions (`a_pos`) are in **tile units** (0–8192 per tile). The projection matrix scales XY by `scale/EXTENT` and Z by a different factor, so adding meter-valued offsets directly to tile-unit positions produces incorrect results.

**Solution**: convert the shadow's XY displacement from meters into tile units first, then project once through the normal matrix path. Do not compute a clip-space offset and add it after projection.

Both platforms have the needed conversion factor available:

- **Web**: add a `u_meters_to_tile` uniform for the fill-extrusion program. This should be the per-tile conversion from meters to tile units at the current latitude/zoom.
- **Native**: add the equivalent per-drawable conversion into `FillExtrusionDrawableUBO`. `u_tile_ratio` already helps with tile/pixel conversion, but the shadow path should consume a direct meters-to-tile factor rather than reconstructing it indirectly in shader code.

Recommended vertex-shader approach:

```glsl
if (u_is_shadow > 0.5) {
    float shadow_height_m = max(height - base, 0.0);
    float shadow_len_m = shadow_height_m * shadow_angle_factor;
    vec2 shadow_offset_tile = light_dir * shadow_len_m * u_meters_to_tile;

    // Bottom vertices stay at the footprint edge, top vertices shift outward.
    float shadow_mix = t > 0.0 ? 1.0 : 0.0;
    vec2 shadow_xy = pos.xy + shadow_offset_tile * shadow_mix;

    gl_Position = u_matrix * vec4(shadow_xy, 0.0, 1.0);
}
```

This keeps the coordinate spaces clean:

- offset math happens in tile space
- the existing projection matrix handles the final clip-space transform
- top vertices create the outward fringe, base vertices stay anchored to the footprint

This is the main geometry rule to preserve cross-platform parity.

## Shadow Pass Fragment Shader

When `u_is_shadow > 0.5`, the fragment shader short-circuits all window/body color logic and outputs:

```glsl
if (u_is_shadow > 0.5) {
    float alpha = SHADOW_OPACITY; // ~0.12–0.18

    // Soft penumbra: side faces fade out toward the shadow tip
    if (v_is_side > 0.5) {
        // v_wall_uv.y = 0 at wall base (building footprint edge, no offset)
        // v_wall_uv.y = 1 at wall top (shadow tip, full offset)
        alpha *= smoothstep(1.0, 0.6, v_wall_uv.y);
    }

    fragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
}
```

- **Top face** (projected to ground directly beneath building): Full shadow opacity — this is the shadow body.
- **Side faces** (projected to the shadow fringe extending outward): `v_wall_uv.y = 0` at the building footprint edge (base vertices, zero offset) fading to `v_wall_uv.y = 1` at the shadow tip (top vertices, full offset). The `smoothstep` produces full opacity near the building and fades to zero at the tip.

## Render State for Shadow Pass

| State | Value | Reason |
|-------|-------|--------|
| Depth test | ON (LEQUAL) | Shadows render on ground, below buildings |
| Depth write | OFF (ReadOnly) | Shadows must not occlude buildings drawn later |
| Color write | ON | Need to write shadow color |
| Blending | Platform default (`alphaBlended`) | Web: `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied). For black shadows (RGB=0), result is identical to straight alpha. |
| Cull face | NONE | Collapsed geometry may flip winding |
| Draw order | Before normal building pass | Shadow renders first, buildings draw on top |

## Web Implementation

### Files Modified

| File | Change |
|------|--------|
| `src/shaders/fill_extrusion.vertex.glsl` | Add `u_is_shadow` uniform, shadow projection logic |
| `src/shaders/fill_extrusion.fragment.glsl` | Add shadow early-return path |
| `src/render/program/fill_extrusion_program.ts` | Add `u_is_shadow` to uniform type and values function |
| `src/render/draw_fill_extrusion.ts` | Add shadow draw call before existing passes for standard fill extrusions |

### Draw Call Sequence (in `drawFillExtrusion`)

```
drawFillExtrusion(painter, tileManager, layer, coords, renderOptions)
├─ NEW: Shadow pass
│  └─ drawExtrusionTiles(..., shadow=true)
│     - Creates separate DepthMode: new DepthMode(gl.LEQUAL, DepthMode.ReadOnly, depthRange)
│     - Uses CullFaceMode.disabled (collapsed geometry)
│     - Uses ColorMode.alphaBlended
│     - Sets u_is_shadow=1.0
│
├─ Existing: if opacity === 1
│  └─ drawExtrusionTiles(depthMode=ReadWrite, colorMode=enabled, shadow=false)
│
├─ Existing: if opacity < 1
│  ├─ Depth-only pass
│  └─ Color pass
```

### Uniform Addition

In `fillExtrusionUniformValues()`, add:
```typescript
'u_is_shadow': isShadow ? 1.0 : 0.0,
```

The shadow draw call invokes the same `drawExtrusionTiles` function with a `shadow` parameter that flips this uniform and adjusts depth/color/cull modes.

### Build Steps

After editing shaders:
1. `npm run generate-shaders` (compiles `.glsl` → `.glsl.g.ts`)
2. `npm run build-dist` (bundles into `dist/`)
3. Commit source + generated files
4. Push to `origin huishype`
5. Update commit hash in `apps/app/package.json`
6. `pnpm install` in monorepo root

## Native Implementation

### Files Modified

| File | Change |
|------|--------|
| `shaders/fill_extrusion.vertex.glsl` | Add shadow projection logic (reads `is_shadow` from UBO) |
| `shaders/fill_extrusion.fragment.glsl` | Add shadow early-return path |
| `include/mbgl/shaders/fill_extrusion_layer_ubo.hpp` | Add `is_shadow` field to `FillExtrusionDrawableUBO` |
| `src/mbgl/renderer/layers/fill_extrusion_layer_tweaker.cpp` | Set `is_shadow` per-drawable in `FillExtrusionDrawableUBO` |
| `src/mbgl/renderer/layers/render_fill_extrusion_layer.cpp` | Add shadow drawable builder |

### UBO Layout: Per-Drawable (not Per-Layer)

`is_shadow` must go in the **per-drawable** UBO (`FillExtrusionDrawableUBO`), not the shared per-layer `FillExtrusionPropsUBO`. The props UBO is created once and shared across all drawables (shadow, depth, color). Each drawable needs its own `is_shadow` value.

Expand `FillExtrusionDrawableUBO` with an `is_shadow` field (add 4 bytes, adjust padding/static_assert accordingly). The tweaker already iterates per-drawable and creates individual `FillExtrusionDrawableUBO` instances, so setting `is_shadow` per-drawable is straightforward.

In the GLSL shader, move `u_is_shadow` from the props UBO declaration to the drawable UBO declaration to match.

### Drawable Builder Addition

In `RenderFillExtrusionLayer::update()`, add a shadow drawable builder. Use draw priority 0 for shadows and bump existing depth/color builders to 1 and 2 respectively (avoids negative priority values which may not be supported):

```
FOR each RenderTile:
├─ NEW: Shadow builder
│  ├─ setShader(shader)
│  ├─ setIs3D(true)
│  ├─ setEnableColor(true)
│  ├─ setDepthType(ReadOnly)
│  ├─ setCullFaceMode(none)
│  ├─ setColorMode(alphaBlended)
│  ├─ setDrawPriority(0)             // draws first
│  ├─ Tag: explicit shadow role (do not reuse the existing pattern/non-pattern drawable type)
│
├─ Existing: Depth builder (priority 1, was 0)
└─ Existing: Color builder (priority 2, was 1)
```

Do not overload the current drawable `type` value if it already carries other meaning in the fill-extrusion pipeline. Use either a dedicated internal role enum or equivalent per-drawable metadata, then have the tweaker set `is_shadow = 1.0` or `0.0` accordingly when building the per-drawable UBO.

### Build Steps

After editing shaders:
1. `node shaders/generate_shader_code.mjs` (generates `.hpp` from `.glsl`)
2. Build AAR: `cd platform/android && BUILDTYPE=Release ./gradlew :MapLibreAndroid:assembleOpenglRelease`
3. Publish: `BUILDTYPE=Release ./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal`
4. Clear shader cache on device: `adb shell pm clear nl.huishype.app`

## Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `MAX_SHADOW_RATIO` | 6.0 (tunable) | Vertex shader | Clamp for `length(light.xy) / light.z` at very low sun angles |
| `SHADOW_OPACITY` | 0.15 (tunable) | Fragment shader | Maximum shadow darkness |
| `SHADOW_PENUMBRA_START` | 0.6 | Fragment shader | Where side-face fade begins (v_wall_uv.y) |
| `SHADOW_ZOOM_FADE_START` | 14.5 (tunable) | Shader or draw code | Start fading shadows out when zoomed out |
| `SHADOW_ZOOM_FADE_END` | 13.5 (tunable) | Shader or draw code | Shadows fully off below this zoom |

These are shader constants (not uniforms) to avoid per-frame overhead. Tune by editing shader source and rebuilding.

## Edge Cases

### Overlapping shadows
Multiple buildings casting overlapping shadows will accumulate opacity (alpha blending of dark colors). With `SHADOW_OPACITY = 0.15`, two overlapping shadows produce ~0.28 effective opacity — visible but not distracting. Acceptable for first iteration.

### Very tall buildings
Buildings over ~100m will cast very long shadows that may extend beyond the visible tile. This is acceptable — the shadow simply clips at the tile boundary, which is visually fine because adjacent tiles also render shadows.

### Flat buildings (height = 0)
Zero-height buildings produce zero shadow offset — the shadow collapses onto the footprint. Combined with depth test, this means no visible shadow, which is correct.

### Top face position
When `u_is_shadow = 1.0`, the top face vertices project to z=0 directly beneath the building (all vertices at same height → same offset → shadow body). Side face vertices span from base (no offset) to top (full offset), forming the shadow fringe.

### Light angle extremes
When `u_lightpos` is nearly vertical (noon sun), `length(u_lightpos.xy) / u_lightpos.z` becomes small, so shadows collapse close to the building footprint. When light is low angle, the ratio increases and shadows extend farther. Clamp with `MAX_SHADOW_RATIO` to avoid runaway lengths.

### Zoomed-out views
Even with correct geometry, ground shadows can make mid-zoom scenes muddy. Fade them out below a close-up threshold using zoom-based attenuation so the effect is concentrated where 3D buildings are the visual focus.

### Globe mode (web)
The web vertex shader has a `#ifdef GLOBE` path. Shadow projection in globe mode is out of scope — HuisHype does not use globe projection. The shadow pass should skip globe-specific transforms.

## Performance

- **Extra draw calls**: One per building batch per tile (same as existing depth/color passes)
- **Extra vertex processing**: Same vertex count, slightly different transform (cheaper than normal pass — no lighting math)
- **Extra fragment processing**: Minimal — early return with simple alpha output, no texture sampling
- **Memory**: Zero additional buffers or textures
- **Estimated overhead**: 5–15% increase in fill-extrusion render time, which is a small fraction of total frame time

## Testing

- Visual Playwright test: Take screenshot at a zoom level where buildings and shadows are visible, compare against reference
- Verify shadows point in correct direction relative to `light.position` (opposite to light)
- Verify shadow length responds to light elevation: high light = short shadows, low light = longer shadows
- Verify shadow opacity is reasonable (not too dark, not invisible)
- Verify buildings still render correctly on top of shadows
- Test with `light.anchor: viewport` — shadows should rotate with map bearing
- Native verification: capture an Android screenshot at the same camera/light setup and compare visually against web for parity

## Out of Scope

- Building-on-building shadows (buildings shadowing other buildings' walls/roofs)
- Dynamic time-of-day shadow animation
- Shadow color tinting (always black)
- Shadow rendering on non-fill-extrusion geometry (ground fills, roads, etc.)
- Cascaded shadow maps or any texture-based shadow approach
- Globe mode shadow projection

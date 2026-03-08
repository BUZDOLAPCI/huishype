# Shader Review: Web vs Native Fill-Extrusion Shaders

**Date**: 2026-03-08
**Status**: Review complete, action items pending

## Overview

Both web (MapLibre GL JS fork) and native (MapLibre Native fork) have custom procedural shaders on `fill_extrusion` layers for 3D buildings. The native shader is the more mature implementation — the web shader appears to be an earlier version that was never updated with LOD improvements.

## File Locations

| Platform | Vertex | Fragment |
|----------|--------|----------|
| Web | `maplibre-gl-js/src/shaders/fill_extrusion.vertex.glsl` | `maplibre-gl-js/src/shaders/fill_extrusion.fragment.glsl` |
| Native | `maplibre-native/shaders/fill_extrusion.vertex.glsl` | `maplibre-native/shaders/fill_extrusion.fragment.glsl` |

## Shared Features (both platforms)

- **Procedural windows**: `fract()`-based grid on wall faces, per-window hash for color variation
- **Diagonal glare**: 45° specular band per window via `smoothstep` pair
- **Soft AO**: Base darkening (`smoothstep(0.0, 0.06, y)` → 82%) + top glow (106%) on side faces
- **Height guard**: No windows on buildings < 3m
- **Window color**: Blue-gray base `vec3(0.59, 0.77, 0.84)` with hash-driven variation
- **Luminance-scaled windows**: `max(luminance * 1.2, floor)` prevents invisible windows on dark faces

## Divergences

### Critical: Missing LOD System (Web)

The native shader has a two-stage LOD fade that the web shader completely lacks:

```glsl
// Native only — floor band LOD
float fw_floor = fwidth(v_wall_uv.y * num_floors);
float floor_detail = 1.0 - smoothstep(0.15, 0.45, fw_floor);
float band_mask = mix(1.0, floor_mask, floor_detail);

// Native only — column LOD
float fw_u = fwidth(raw_u);
float detail = 1.0 - smoothstep(0.04, 0.12, fw_u);
float col_mask = mix(1.0, col_pattern, detail);
```

**Impact**: At z15-z16, web renders subpixel `fract()` patterns causing shimmer/moire artifacts. Native gracefully degrades: columns merge into horizontal bands, then bands merge into continuous fill, then windows disappear entirely.

**Native LOD behavior:**
- z18+: Full window grid with diagonal glare
- z17: Horizontal floor bands (columns merged)
- z16: Subtle tinting (bands merged)
- z15-: No window detail

**Web LOD behavior:**
- z18+: Full window grid with glare ✓
- z15-z17: Same full detail → moire/shimmer ✗

### Window Parameters

| Parameter | Web | Native | Notes |
|-----------|-----|--------|-------|
| Floor height | 3.0m | 3.5m | Web floors slightly shorter |
| `win_l` / `win_r` | 0.01 / 0.99 | 0.08 / 0.92 | Web: 98% fill (paper-thin mullions), Native: 84% fill |
| `win_b` / `win_t` | 0.05 / 0.70 | 0.04 / 0.96 | Web: 30% floor slab, Native: 4% floor slab |
| Blend factor | 0.88 | 0.94 | Web windows more transparent |
| Luminance floor | 0.5 | 0.65 | Web windows darker on shadowed faces |

The web windows are wider, shorter, more transparent, and have thicker floor slabs — a distinctly different aesthetic from native.

### Web-Only Features

**Edge fade** (`v_ed_flat`): The web shader uses a `flat` varying to anchor window grid to the provoking vertex, then fades windows within 30 edge-distance units of building corners. This prevents awkward window clipping at face boundaries. Native does not have this — it could benefit from it.

**`v_tile_pos` dead code**: Declared and assigned in both vertex and fragment shaders but never read in any computation. Wastes a varying slot.

### Column Computation Difference

| | Web | Native |
|-|-----|--------|
| Formula | `fract((v_wall_uv.x - v_ed_flat) / 250.0)` | `fract(v_wall_uv.x / 54.0)` |
| Anchor | Offset from provoking vertex | Direct from edge distance |
| Spacing | 250.0 | 54.0 |

The ~4.6x spacing ratio reflects different internal coordinate scales between GL JS (8192-unit tile extent) and Native. Both were visually tuned for their respective renderers.

### Glare Gating

- **Native**: `if (detail > 0.5)` — skips glare at low LOD (saves GPU, prevents artifacts)
- **Web**: Always computes glare — wastes cycles when windows are subpixel

## Action Items

| Priority | Item | Effort |
|----------|------|--------|
| **High** | Port LOD fade system to web (floor_detail + detail) | ~20 lines |
| **High** | Gate glare on `detail > 0.5` on web | 1 line |
| **Medium** | Decide on window parameter alignment (intentional divergence vs unintentional drift) | Design decision |
| **Low** | Remove dead `v_tile_pos` from web vertex + fragment shaders | 2 lines |
| **Low** | Consider porting web's edge fade (`v_ed_flat`) to native | ~10 lines |

## Recommendation

Port the native LOD system to web first — it's the highest-impact fix with lowest risk. The window parameter differences should be a conscious design decision: either align them for cross-platform consistency or document the intentional divergence.

# Issue 002: Data-Driven `fill-extrusion-color` Expressions Fail on Native

## Summary

MapLibre Native silently fails to evaluate data-driven style expressions on `fill-extrusion-color`. When the expression can't be evaluated, it falls back to the MapLibre GL spec default for `fill-extrusion-color`: **`#000000` (black)**. This causes all buildings to render black instead of the intended beige palette.

## Impact

Web has per-building body color variation using a 5-color warm beige palette (`#F5EDE2`, `#EDE4D8`, `#F8F1E8`, `#E8DDD0`, `#F0E8DC`). Native currently uses a single fixed color (`#F0E8DC`) for all buildings because expressions don't work.

## Expressions Tested (all fail on native)

### 1. `['id']`-based arithmetic (original)
```json
{
  "fill-extrusion-color": [
    "match",
    ["%", ["floor", ["/", ["id"], 7]], 5],
    0, "#F5EDE2",
    1, "#EDE4D8",
    2, "#F8F1E8",
    3, "#E8DDD0",
    "#F0E8DC"
  ]
}
```
**Result**: Black buildings. `['id']` likely evaluates to null in fill-extrusion expression context.

### 2. `['get', 'color_variant']` with pre-computed property
Added `(id / 7 % 5) AS color_variant` to the building tile SQL query, then:
```json
{
  "fill-extrusion-color": [
    "match",
    ["get", "color_variant"],
    0, "#F5EDE2",
    1, "#EDE4D8",
    2, "#F8F1E8",
    3, "#E8DDD0",
    "#F0E8DC"
  ]
}
```
**Result**: Still black buildings. Even `['get', ...]` on a regular MVT property fails.

### 3. Fixed string color (control test)
```json
{
  "fill-extrusion-color": "#FF0000"
}
```
**Result**: Bright red buildings with correct lighting. Proves the paint property itself works — only expressions fail.

```json
{
  "fill-extrusion-color": "#F5EDE2"
}
```
**Result**: Correct warm beige with proper lighting and window patterns.

## Current Workaround

The API serves platform-specific styles:
- **Web** (`GET /tiles/style.json`): Full match expression with per-building variation
- **Native** (`GET /tiles/style.json?platform=native`): Flattened to fixed color `#F0E8DC`

```typescript
// services/api/src/routes/tiles.ts
function flattenFillExtrusionColorExpressions(layers) {
  for (const layer of layers) {
    if (layer.type !== 'fill-extrusion') continue;
    const paint = layer.paint;
    const colorExpr = paint['fill-extrusion-color'];
    if (Array.isArray(colorExpr) && colorExpr[0] === 'match') {
      paint['fill-extrusion-color'] = colorExpr[colorExpr.length - 1]; // fallback
    }
  }
}
```

Native map component adds `?platform=native`:
```typescript
// apps/app/app/(tabs)/index.tsx
const STYLE_URL = `${API_URL}/tiles/style.json?platform=native`;
```

## Known Related Bug

MapLibre Native also can't evaluate zoom-interpolated expressions on `fill-extrusion-height`, `fill-extrusion-base`, and `fill-extrusion-opacity` — causing the entire layer to not render. These are separately flattened by `flattenFillExtrusionZoomExpressions()`. The color issue is the same class of bug but with data-driven (not zoom-driven) expressions.

## Possible Approaches to Fix

### A: Shader-based body color variation (recommended)
Add per-building body color variation **in the native fragment shader** using the hash mechanism already used for windows. The hash seeds (`v_ed_flat`, `v_height_m`) already differ per building:

```glsl
// In fragment shader, before window logic:
float body_hash = fract(sin(v_ed_flat * 0.0073 + v_height_m * 0.0197) * 43758.5453);
// Warm beige palette variation: lerp between palette endpoints
vec3 beige_warm = vec3(0.961, 0.929, 0.886); // #F5EDE2
vec3 beige_cool = vec3(0.910, 0.867, 0.816); // #E8DDD0
fragColor.rgb = mix(beige_warm, beige_cool, body_hash);
```

This would give per-face (not per-building) variation — close enough visually, and entirely GPU-side with no expression engine dependency.

**Pros**: No MapLibre Native bug dependency, works immediately
**Cons**: Variation is per-face not per-building (some faces of same building may differ slightly), hardcoded palette in shader instead of style

### B: Fix MapLibre Native expression evaluation
Investigate why data-driven expressions fail specifically on `fill-extrusion-color`. The expression engine works for other layer types (circle-color, fill-color, etc.) — the issue may be specific to how fill-extrusion layers bind data-driven paint properties.

**Where to look**:
- `src/mbgl/renderer/layers/render_fill_extrusion_layer.cpp` — how paint properties are evaluated
- `src/mbgl/renderer/paint_property_binder.hpp` — how expressions are bound to vertex attributes
- `src/mbgl/style/layers/fill_extrusion_layer_properties.hpp` — property definitions

**Pros**: Fixes root cause, enables full expression support
**Cons**: Deep MapLibre Native internals, high effort, may require upstream contribution

### C: Encode color directly in MVT tile data
Compute the palette index server-side and encode the actual hex color as a string property in the tile:
```sql
SELECT
  id,
  CASE (id / 7 % 5)
    WHEN 0 THEN '#F5EDE2'
    WHEN 1 THEN '#EDE4D8'
    WHEN 2 THEN '#F8F1E8'
    WHEN 3 THEN '#E8DDD0'
    ELSE '#F0E8DC'
  END AS building_color,
  ...
```

Then use `['get', 'building_color']` in the style. This may or may not work given that even simple `['get', ...]` failed in testing — but it's worth trying since the previous test used a numeric property. A string property with a direct color value might follow a different code path.

**Pros**: No shader changes needed, uses standard style spec
**Cons**: May still fail (expressions are broken), increases tile size

## Files

| File | Role |
|------|------|
| `services/api/src/routes/tiles.ts` | Style generation, `flattenFillExtrusionColorExpressions()`, building tile query |
| `apps/app/app/(tabs)/index.tsx` | Native STYLE_URL with `?platform=native` |
| `maplibre-native/shaders/fill_extrusion.fragment.glsl` | Where shader-based variation would go |

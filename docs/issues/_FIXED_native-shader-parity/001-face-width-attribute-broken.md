# Issue 001: `a_face_width` Vertex Attribute Reads 0 on GPU

## Summary

The `a_face_width` vertex attribute is correctly defined, computed, packed, and bound through the entire C++ pipeline — but reads as `0.0` in the GLSL vertex shader on the Android GPU. This is the single biggest blocker to pixel-identical web/native parity.

## Impact

Without per-face width, the native fragment shader can't:
- **Center** the window grid within each wall face
- Apply **outer left/right padding** (60px each on web) so windows don't touch building corners
- Compute **face-relative UV coordinates** for the window grid

The current workaround tiles windows from absolute edgedistance with a soft derivative-based fade at face boundaries. This produces plausible windows but they aren't centered per-face and may visually straddle face boundaries on some buildings.

## What Web Does (the goal)

```glsl
// Web fragment shader (fill_extrusion.fragment.glsl)
float face_u = clamp(v_wall_uv.x - v_ed_flat, 0.0, max(v_face_width, 0.0));

if (v_face_width > outer_pad_l + outer_pad_r) {
    float content_max = v_face_width - outer_pad_r;
    float within_content = smoothstep(outer_pad_l - fw, outer_pad_l + fw, face_u)
                         * smoothstep(content_max + fw, content_max - fw, face_u);
    raw_u = (face_u - outer_pad_l) / window_spacing;
    // ... centered window grid within the padded face
}
```

Web uses `v_face_width` (from the `a_face_width` vertex attribute) to:
1. Compute face-local U coordinate: `face_u = edgedistance - face_start_edgedistance`
2. Apply outer padding: skip first 60 units and last 60 units of the face
3. Tile windows only within the content area

## What Native Does (the workaround)

```glsl
// Native fragment shader — bypasses a_face_width
float raw_u = v_wall_uv.x / window_spacing;   // absolute edgedistance
float cell_u = fract(raw_u);                   // repeating column

// Soft edge fade instead of hard padding
float face_local = v_wall_uv.x - v_ed_flat;
col_mask *= smoothstep(0.0, edge_pad * 1.5, abs(face_local));
```

Native ignores `v_face_width` entirely and tiles from absolute edgedistance.

## Verified C++ Pipeline (all correct)

### 1. Attribute Definition
```cpp
// src/mbgl/shaders/attributes.hpp:20
MBGL_DEFINE_ATTRIBUTE(int16_t, 1, face_width);
```

### 2. Vertex Struct
```cpp
// src/mbgl/renderer/buckets/fill_extrusion_bucket.hpp:18
using FillExtrusionLayoutVertex = gfx::Vertex<TypeList<
    attributes::pos,        // a1: int16_t[2]
    attributes::normal_ed,  // a2: int16_t[4]
    attributes::face_width  // a3: int16_t[1]
>>;
```

### 3. Vertex Packing (non-zero values)
```cpp
// src/mbgl/renderer/buckets/fill_extrusion_bucket.cpp:121-133
const auto faceWidth = static_cast<uint16_t>(dist);  // distance between polygon vertices

// All 4 wall vertices per edge get the same faceWidth:
vertices.emplace_back(layoutVertex(p1, perp.x, perp.y, 0, 0, edgeDistance, faceWidth));
vertices.emplace_back(layoutVertex(p1, perp.x, perp.y, 0, 1, edgeDistance, faceWidth));
vertices.emplace_back(layoutVertex(p2, perp.x, perp.y, 0, 0, edgeDistance, faceWidth));
vertices.emplace_back(layoutVertex(p2, perp.x, perp.y, 0, 1, edgeDistance, faceWidth));
```

The `layoutVertex()` function casts to `int16_t`:
```cpp
// fill_extrusion_bucket.hpp:46-60
static FillExtrusionLayoutVertex layoutVertex(
    Point<int16_t> p, double nx, double ny, double nz,
    unsigned short t, uint16_t e, uint16_t fw = 0) {
    // ...
    return FillExtrusionLayoutVertex{
        {{p.x, p.y}},
        {{static_cast<int16_t>(...), ..., static_cast<int16_t>(e)}},
        {{static_cast<int16_t>(fw)}}   // ← face_width packed here
    };
}
```

### 4. Shader Enum
```cpp
// include/mbgl/shaders/shader_defines.hpp:402-406
enum {
    idFillExtrusionPosVertexAttribute,         // 0
    idFillExtrusionNormalEdVertexAttribute,     // 1
    idFillExtrusionFaceWidthVertexAttribute,    // 2
    // data-driven attributes follow at 3+
};
```

### 5. Attribute Binding (render layer)
```cpp
// src/mbgl/renderer/layers/render_fill_extrusion_layer.cpp:292-298
if (const auto& attr = vertexAttrs->set(idFillExtrusionFaceWidthVertexAttribute)) {
    attr->setSharedRawData(bucket.sharedVertices,
                           offsetof(FillExtrusionLayoutVertex, a3),  // correct offset
                           /*vertexOffset=*/0,
                           sizeof(FillExtrusionLayoutVertex),        // correct stride
                           gfx::AttributeDataType::Short);           // int16_t
}
```

### 6. GLSL Declaration
```glsl
// shaders/fill_extrusion.vertex.glsl:3
layout (location = 2) in float a_face_width;
```

### 7. Vertex Shader Usage
```glsl
v_face_width = a_face_width;  // passes through to fragment shader
```

## Diagnostic Evidence

A diagnostic fragment shader was used to visualize the attribute:
```glsl
// RED channel = face_width / 500 (expected: orange/red for typical ~200-400 values)
// GREEN channel = 1.0 if height > 3m (expected: green for all tall buildings)
fragColor = vec4(v_face_width / 500.0, step(3.1, v_height_m), 0.0, 1.0);
```

**Result**: All side faces rendered pure green (0, 1, 0) — confirming `v_face_width == 0.0` for every pixel on every building.

A hardcoded test `v_face_width = 200.0` in the vertex shader also showed 0 in the fragment shader, BUT this test was run before discovering the shader cache issue. It's possible the cache was stale. This test should be re-run with a guaranteed cache clear.

## Hypotheses (not yet tested)

### H1: OpenGL attribute location mismatch
The enum value `idFillExtrusionFaceWidthVertexAttribute = 2` might not map to OpenGL attribute location 2. The MapLibre Native rendering backend has an abstraction layer between "attribute IDs" and actual GL attribute locations. If the backend assigns locations sequentially but skips index 2 for some reason, the GLSL `layout(location = 2)` would bind to nothing.

**How to test**: Add debug logging in the OpenGL backend where `glVertexAttribPointer` / `glEnableVertexAttribArray` are called. Check if location 2 is actually being configured with the right offset/stride/type matching `a3` in the vertex struct.

### H2: Vertex struct alignment / padding
The vertex struct `{pos: int16[2], normal_ed: int16[4], face_width: int16[1]}` has total size `2*2 + 4*2 + 1*2 = 14 bytes`. GPUs may require alignment to 4-byte or 8-byte boundaries. If the struct is padded to 16 bytes, `offsetof(a3)` might return 12 (correct) but the GPU expects 14 or different alignment.

**How to test**: Print `sizeof(FillExtrusionLayoutVertex)` and `offsetof(FillExtrusionLayoutVertex, a3)` at runtime. Verify they match what the GLSL shader expects.

### H3: `gfx::AttributeDataType::Short` not matching GLSL `float`
The attribute is declared as `int16_t` in C++ but `float` in GLSL. OpenGL normally converts integer attributes to float via `glVertexAttribPointer` (not `glVertexAttribIPointer`). If the backend uses `glVertexAttribIPointer`, the value arrives as int in the shader and `float a_face_width` would read as reinterpreted bits (likely 0 or garbage).

**How to test**: Check which GL function is called in the backend for `Short` type attributes. Verify it's `glVertexAttribPointer` (with normalization = GL_FALSE).

### H4: `a_face_width` attribute never enabled
Even if the attribute is bound, `glEnableVertexAttribArray(2)` must be called. If the backend only enables attributes that are "used" based on some analysis, and its analysis doesn't recognize `a_face_width` as used (because it was newly added), the attribute would default to its generic value (0).

**How to test**: Add a breakpoint or log at `glEnableVertexAttribArray` calls. Verify location 2 is enabled for fill_extrusion draw calls.

## Recommended Investigation Approach

1. **Re-run the hardcoded test** (`v_face_width = 200.0`) WITH guaranteed cache clear to confirm the varying interpolation works
2. **Add runtime logging** to print `sizeof(FillExtrusionLayoutVertex)`, `offsetof(a3)`, and the stride used in the GL call
3. **Trace the OpenGL calls** using `adb shell setprop debug.egl.trace calls` or a GPU debugger (RenderDoc for Android if available, or Mali Graphics Debugger)
4. **Check the attribute enable/bind** sequence in the abstract backend code that translates `setSharedRawData` to actual GL calls

## Files to Investigate

| File | What to look for |
|------|-----------------|
| `src/mbgl/gl/vertex_array.cpp` | How `setSharedRawData` translates to `glVertexAttribPointer` |
| `src/mbgl/gl/program.cpp` | How attribute locations are assigned vs GLSL `layout(location=N)` |
| `src/mbgl/gl/attribute.cpp` | Whether `glEnableVertexAttribArray` is called for all bound attributes |
| `src/mbgl/gfx/vertex_vector.hpp` | How `gfx::Vertex<TypeList<...>>` packs struct fields and alignment |

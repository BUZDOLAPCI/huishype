# Native Shader Parity Issues

Open issues preventing pixel-identical procedural building windows between web (MapLibre GL JS) and native (MapLibre Native Android).

## Current State

Both platforms render procedural windows with the same effects (blue palette, reflections, Fresnel specular, AO, parapet). However, the native shader uses workarounds that produce visually-close but not identical output.

## Issues

| # | Issue | Impact | Difficulty |
|---|-------|--------|------------|
| 1 | [`a_face_width` reads 0 on GPU](./001-face-width-attribute-broken.md) | No per-face window centering, no outer padding | Hard — root cause in C++ OpenGL backend |
| 2 | [Data-driven `fill-extrusion-color` fails](./002-fill-extrusion-color-expressions.md) | No per-building body color variation on native | Medium — MapLibre Native expression engine |
| 3 | [Coordinate scale mismatch](./003-coordinate-scale-mismatch.md) | Different numeric constants needed per platform | Low — documentation / calibration task |

## Repo Locations

| Component | Path |
|-----------|------|
| Native vertex shader | `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.vertex.glsl` |
| Native fragment shader | `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.fragment.glsl` |
| Web vertex shader | `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/fill_extrusion.vertex.glsl` |
| Web fragment shader | `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/fill_extrusion.fragment.glsl` |
| Native shader header gen | `node shaders/generate_shader_code.mjs` (in maplibre-native) |
| Native bucket C++ | `src/mbgl/renderer/buckets/fill_extrusion_bucket.{hpp,cpp}` |
| Native render layer C++ | `src/mbgl/renderer/layers/render_fill_extrusion_layer.cpp` |
| Native attribute defs | `src/mbgl/shaders/attributes.hpp` |
| Native shader enums | `include/mbgl/shaders/shader_defines.hpp` |
| Native UBO layout | `include/mbgl/shaders/fill_extrusion_layer_ubo.hpp` |
| Style server | `services/api/src/routes/tiles.ts` (in huishype) |

## Build & Test Cycle

```bash
# Edit .glsl files, then:
cd /home/caslan/dev/git_repos/hh/maplibre-native
node shaders/generate_shader_code.mjs
cd platform/android
BUILDTYPE=Release make android-lib-arm-v8
BUILDTYPE=Release ./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal

# Build and deploy app:
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
npx expo run:android

# CRITICAL: Clear shader cache after ANY shader string change:
adb shell pm clear nl.huishype.app

# Relaunch into dev client:
adb shell am start -a android.intent.action.VIEW \
  -d "exp+huishype://expo-development-client/?url=http%3A%2F%2F192.168.1.94%3A8081" \
  nl.huishype.app
```

**Shader cache warning**: MapLibre Native caches compiled GLSL shader programs in app data. `adb install -r` (used by `expo run:android`) preserves this cache. If you change shader strings but don't run `adb shell pm clear nl.huishype.app`, the device will use the OLD cached shaders. This has caused hours of debugging in the past — always clear after shader changes.

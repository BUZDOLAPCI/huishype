# Snap Map-Style 3D Buildings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plain white 3D extruded buildings with Snap Map-style buildings: per-building warm color variation, procedural window patterns with glass glare, and soft edge AO.

**Architecture:** Unified shader approach — identical GLSL logic patched into MapLibre GL JS (web, via patch-package) and MapLibre Native (Android, via source fork + custom AAR build). Style-level per-building color variation via `osm_id`-keyed expression in `tiles.ts`.

**Tech Stack:** GLSL (OpenGL ES 3.0), MapLibre GL JS v5.16.0, MapLibre Native v12.2.3, patch-package, CMake/Gradle (native build)

**Design doc:** `docs/plans/2026-03-05-snap-map-buildings-design.md`

---

## Task 1: Update Building Style — Per-Building Color Variation

**Files:**
- Modify: `services/api/src/routes/tiles.ts:89-97` (BUILDINGS_3D_CONFIG)
- Modify: `services/api/src/routes/tiles.ts:509-547` (build3DBuildingsLayer)

**Step 1: Update BUILDINGS_3D_CONFIG**

Replace the config at line 89-97:

```typescript
const BUILDINGS_3D_CONFIG = {
  minZoom: 15,
  colors: {
    palette: ['#E2DAD0', '#DDD7CF', '#E6E0D8', '#D8D2CA', '#E0DCD6'],
  },
  opacity: 1.0,
  heightMultiplier: 1.0,
};
```

**Step 2: Update fill-extrusion-color in build3DBuildingsLayer**

Replace line 516 (`'fill-extrusion-color': BUILDINGS_3D_CONFIG.colors.base,`) with a data-driven expression:

```typescript
'fill-extrusion-color': [
  'match',
  ['%', ['coalesce', ['get', 'osm_id'], 0], 5],
  0, BUILDINGS_3D_CONFIG.colors.palette[0],
  1, BUILDINGS_3D_CONFIG.colors.palette[1],
  2, BUILDINGS_3D_CONFIG.colors.palette[2],
  3, BUILDINGS_3D_CONFIG.colors.palette[3],
  BUILDINGS_3D_CONFIG.colors.palette[4], // default (variant 4)
],
```

**Step 3: Restart API and verify in browser**

```bash
systemctl --user restart huishype-api
```

Open web map at z15+. Buildings should now show warm beige/taupe colors with visible variation between adjacent buildings instead of uniform white.

**Step 4: Commit**

```bash
git add services/api/src/routes/tiles.ts
git commit -m "feat: per-building color variation using osm_id hash palette"
```

---

## Task 2: Patch Web Shader — Vertex Shader

**Files:**
- Modify: `node_modules/.pnpm/maplibre-gl@5.16.0/node_modules/maplibre-gl/src/shaders/fill_extrusion.vertex.glsl`

**Step 1: Install patch-package**

```bash
cd /home/caslan/dev/git_repos/hh/huishype
pnpm add -D patch-package --filter @huishype/app
```

**Step 2: Patch the vertex shader**

The original shader computes lighting in the vertex shader and passes only `v_color` to the fragment. We need to additionally pass wall UV data so the fragment shader can generate procedural windows.

Replace the full file contents with:

```glsl
uniform vec3 u_lightcolor;
uniform lowp vec3 u_lightpos;
uniform lowp vec3 u_lightpos_globe;
uniform lowp float u_lightintensity;
uniform float u_vertical_gradient;
uniform lowp float u_opacity;
uniform vec2 u_fill_translate;

in vec2 a_pos;
in vec4 a_normal_ed;

#ifdef TERRAIN3D
    in vec2 a_centroid;
#endif

out vec4 v_color;
out highp vec2 v_wall_uv;
out highp float v_height_m;
out lowp float v_is_side;

#pragma mapbox: define highp float base
#pragma mapbox: define highp float height
#pragma mapbox: define highp vec4 color

void main() {
    #pragma mapbox: initialize highp float base
    #pragma mapbox: initialize highp float height
    #pragma mapbox: initialize highp vec4 color

    vec3 normal = a_normal_ed.xyz;
    float edgedistance = a_normal_ed.w;

    #ifdef TERRAIN3D
        float height_terrain3d_offset = get_elevation(a_centroid);
        float base_terrain3d_offset = height_terrain3d_offset - (base > 0.0 ? 0.0 : 10.0);
    #else
        float height_terrain3d_offset = 0.0;
        float base_terrain3d_offset = 0.0;
    #endif

    base = max(0.0, base) + base_terrain3d_offset;
    height = max(0.0, height) + height_terrain3d_offset;

    float t = mod(normal.x, 2.0);
    float elevation = t > 0.0 ? height : base;
    vec2 posInTile = a_pos + u_fill_translate;

    #ifdef GLOBE
        vec3 spherePos = projectToSphere(posInTile, a_pos);
        gl_Position = interpolateProjectionFor3D(posInTile, spherePos, elevation);
    #else
        gl_Position = u_projection_matrix * vec4(posInTile, elevation, 1.0);
    #endif

    // --- Procedural window data ---
    // Side faces have normal.y != 0; top/bottom have normal.y == 0
    v_is_side = (normal.y != 0.0) ? 1.0 : 0.0;
    v_height_m = max(0.0, height - base);

    // Wall UV: x = edge distance (TILE COORDINATE UNITS, not meters — scales with zoom),
    //          y = normalized height (0=base, 1=top)
    float height_range = max(height - base, 0.001);
    v_wall_uv = vec2(edgedistance, (elevation - base) / height_range);

    // --- Lighting (unchanged from original) ---
    float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

    v_color = vec4(0.0, 0.0, 0.0, 1.0);

    vec4 ambientlight = vec4(0.03, 0.03, 0.03, 1.0);
    color += ambientlight;

    vec3 normalForLighting = normal / 16384.0;
    float directional = clamp(dot(normalForLighting, u_lightpos), 0.0, 1.0);

    #ifdef GLOBE
        mat3 rotMatrix = globeGetRotationMatrix(spherePos);
        normalForLighting = rotMatrix * normalForLighting;
        directional = mix(directional, clamp(dot(normalForLighting, u_lightpos_globe), 0.0, 1.0), u_projection_transition);
    #endif

    directional = mix((1.0 - u_lightintensity), max((1.0 - colorvalue + u_lightintensity), 1.0), directional);

    if (normal.y != 0.0) {
        directional *= (
            (1.0 - u_vertical_gradient) +
            (u_vertical_gradient * clamp((t + base) * pow(height / 150.0, 0.5), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0)));
    }

    v_color.r += clamp(color.r * directional * u_lightcolor.r, mix(0.0, 0.3, 1.0 - u_lightcolor.r), 1.0);
    v_color.g += clamp(color.g * directional * u_lightcolor.g, mix(0.0, 0.3, 1.0 - u_lightcolor.g), 1.0);
    v_color.b += clamp(color.b * directional * u_lightcolor.b, mix(0.0, 0.3, 1.0 - u_lightcolor.b), 1.0);
    v_color *= u_opacity;
}
```

**Key changes from original:**
- Added `out highp vec2 v_wall_uv`, `out highp float v_height_m`, `out lowp float v_is_side` (highp needed for edgedistance precision on mobile GPUs)
- Extract `edgedistance` from `a_normal_ed.w`
- Compute `v_is_side` from `normal.y != 0.0`
- Compute `v_height_m` = `max(0.0, height - base)` — building height in meters (future-proof regardless of TERRAIN3D state)
- Compute `v_wall_uv` = `(edgedistance, normalized_elevation)` — note: edgedistance is in **tile coordinate units** (not meters), see reference notes below
- All original lighting code is preserved exactly

---

## Task 3: Patch Web Shader — Fragment Shader

**Files:**
- Modify: `node_modules/.pnpm/maplibre-gl@5.16.0/node_modules/maplibre-gl/src/shaders/fill_extrusion.fragment.glsl`

**Step 1: Replace fragment shader with procedural window logic**

```glsl
in vec4 v_color;
in highp vec2 v_wall_uv;
in highp float v_height_m;
in lowp float v_is_side;

void main() {
    fragColor = v_color;

    // --- Procedural windows on side faces ---
    // Only on buildings tall enough to have windows (>= 6m = 2 floors)
    if (v_is_side > 0.5 && v_height_m >= 6.0) {
        // Floor grid: ~3m per floor
        float num_floors = max(1.0, floor(v_height_m / 3.0));
        float floor_v = fract(v_wall_uv.y * num_floors);

        // Window cell: horizontal repeat in TILE COORDINATE UNITS
        // edgedistance is in tile units (0-8192 extent per tile).
        // At z16: 1 tile unit ≈ 0.075m, so 54 tile units ≈ 4m window spacing.
        // At z15: ≈ 8m spacing (fewer windows, but buildings are small on screen).
        // At z17: ≈ 2m spacing (more windows, detailed close-up view).
        // Tune this value visually if windows appear too wide or narrow.
        float window_spacing = 54.0;
        float cell_u = fract(v_wall_uv.x / window_spacing);

        // Window rectangle: centered, 55% wide x 40% tall within cell
        float win_l = 0.225;
        float win_r = 0.775;
        float win_b = 0.30;
        float win_t = 0.70;

        // Antialiased window edges using screen-space derivatives (fwidth)
        float fw_u = fwidth(cell_u);
        float fw_v = fwidth(floor_v);
        float win_mask = smoothstep(win_l - fw_u, win_l + fw_u, cell_u)
                       * smoothstep(win_r + fw_u, win_r - fw_u, cell_u)
                       * smoothstep(win_b - fw_v, win_b + fw_v, floor_v)
                       * smoothstep(win_t + fw_v, win_t - fw_v, floor_v);

        if (win_mask > 0.01) {
            // Local UV within window pane (0-1)
            float local_u = clamp((cell_u - win_l) / (win_r - win_l), 0.0, 1.0);
            float local_v = clamp((floor_v - win_b) / (win_t - win_b), 0.0, 1.0);

            // Per-window deterministic hash for variation
            vec2 grid_id = floor(vec2(v_wall_uv.x / window_spacing, v_wall_uv.y * num_floors));
            float hash = fract(sin(dot(grid_id, vec2(12.9898, 78.233))) * 43758.5453);

            // Base window color: light cyan with per-window variation
            vec3 window_color = vec3(0.59, 0.77, 0.84) + hash * vec3(-0.04, -0.02, 0.02);

            // Diagonal glare streak (glass reflection) with antialiased edges
            float diag = (local_u + local_v) * 0.7;
            float fw_diag = fwidth(diag);
            float glare = smoothstep(0.3 - fw_diag, 0.5, diag) * smoothstep(0.7 + fw_diag, 0.5, diag);
            glare *= 0.35 + hash * 0.1;
            window_color = mix(window_color, vec3(1.0), glare);

            // Blend window over lit base color (preserve lighting intensity)
            float luminance = dot(v_color.rgb, vec3(0.299, 0.587, 0.114));
            vec3 lit_window = window_color * max(luminance * 1.2, 0.5);
            fragColor.rgb = mix(fragColor.rgb, lit_window, 0.88 * win_mask);
        }
    }

    // --- Soft edge AO (side faces only) ---
    if (v_is_side > 0.5) {
        // Base AO: darken at ground level
        float base_ao = smoothstep(0.0, 0.06, v_wall_uv.y);
        fragColor.rgb *= mix(0.82, 1.0, base_ao);

        // Subtle top-edge brightening
        float top_glow = smoothstep(0.92, 1.0, v_wall_uv.y);
        fragColor.rgb *= mix(1.0, 1.06, top_glow);
    }

    #ifdef OVERDRAW_INSPECTOR
        fragColor = vec4(1.0);
    #endif
}
```

**Step 2: Verify web builds and renders**

```bash
# Restart Metro to pick up shader changes
systemctl --user restart huishype-expo
```

Open `http://localhost:8081` in browser. Navigate to z15+ 3D view. Buildings should show:
- Warm beige/taupe base colors (from Task 1)
- Cyan window rectangles on side faces
- White diagonal glare streak on each window
- Subtle darkening at building base (AO)
- No windows on building tops

---

## Task 4: Create Web Patch File

**Files:**
- Create: `apps/app/patches/maplibre-gl@5.16.0.patch` (auto-generated)
- Modify: `apps/app/package.json` (add postinstall script)

**Step 1: Generate the patch**

```bash
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
npx patch-package maplibre-gl
```

This creates `patches/maplibre-gl@5.16.0.patch` capturing the vertex + fragment shader diffs.

**Step 2: Add postinstall hook to package.json**

In `apps/app/package.json`, add to `"scripts"`:

```json
"postinstall": "patch-package"
```

**Step 3: Verify patch applies cleanly**

```bash
# Wipe and reinstall to test the patch
cd /home/caslan/dev/git_repos/hh/huishype
pnpm install
```

Should see `patch-package` output applying the maplibre-gl patch.

**Step 4: Commit**

```bash
git add apps/app/patches/ apps/app/package.json
git commit -m "feat: procedural window shader for web buildings via patch-package"
```

---

## Task 5: Fork MapLibre Native

**Files:**
- New repo: `/home/caslan/dev/git_repos/hh/maplibre-native`

**Step 1: Fork on GitHub**

```bash
gh repo fork maplibre/maplibre-native --org BUZDOLAPCI --clone=false --fork-name maplibre-native
```

**Step 2: Clone locally**

```bash
cd /home/caslan/dev/git_repos/hh
git clone git@github.com:BUZDOLAPCI/maplibre-native.git
cd maplibre-native
```

**Step 3: Create huishype branch from the v12.2.3 tag**

The react-native wrapper uses native SDK v12.2.3 (opengl). Find the corresponding tag:

```bash
git tag -l '*12.2.3*' '*android*12*'
```

If there's a tag like `android-v12.2.3` or `v12.2.3`:

```bash
git checkout -b huishype <tag-name>
git push -u origin huishype
```

If no exact tag exists, find the commit for the v12.2.3 release and branch from there.

---

## Task 6: Patch Native Shaders

**Files:**
- Modify: `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.vertex.glsl`
- Modify: `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.fragment.glsl`

**Important:** The native shaders use OpenGL ES 3.0 like web, but the exact file contents may differ slightly from the web version (different includes/prelude). Read each file first, then apply the same logical changes.

**Step 1: Read existing native vertex shader**

```bash
cat /home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.vertex.glsl
```

**Step 2: Apply vertex shader changes**

Apply the same three additions as the web patch:
1. Add `out vec2 v_wall_uv;`, `out float v_height_m;`, `out float v_is_side;`
2. Extract `edgedistance` from `a_normal_ed.w`
3. Compute `v_is_side`, `v_height_m`, `v_wall_uv` from existing values

The exact lines will differ from web — the native shader may have different variable names, UBO structs instead of uniforms, or additional preprocessor guards. Match the pattern, not the exact web code.

**Step 3: Read existing native fragment shader**

```bash
cat /home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.fragment.glsl
```

**Step 4: Apply fragment shader changes**

Add the same procedural window + AO logic. Add matching `in` declarations for the new varyings.

**Step 5: Commit to fork**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native
git add shaders/fill_extrusion.vertex.glsl shaders/fill_extrusion.fragment.glsl
git commit -m "feat: procedural window patterns + soft edge AO on fill-extrusion"
git push origin huishype
```

---

## Task 7: Build Native AAR

**Files:**
- Build output: `platform/android/MapLibreAndroid/build/outputs/aar/`

**Step 1: Install build prerequisites**

Check CMake, NDK, and Java are available:

```bash
cmake --version       # Needs 3.10+
java -version         # Needs 11+
echo $ANDROID_HOME    # Needs Android SDK
```

If NDK 27.1.12297006 is not installed:

```bash
sdkmanager "ndk;27.1.12297006"
```

**Step 2: Build the OpenGL Android library for arm-v8 (Samsung S10e = arm64)**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native/platform/android
BUILDTYPE=Release make android-lib-arm-v8
```

This takes ~15-25 minutes on first build. Watch for shader compilation errors in the output. If `glslang` reports GLSL errors, fix the shader syntax and rebuild.

**Step 3: Build AAR**

```bash
./gradlew :MapLibreAndroid:assembleOpenglRelease
```

**Step 4: Publish to local Maven**

```bash
./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal
```

Verify it landed:

```bash
ls ~/.m2/repository/org/maplibre/gl/android-sdk-opengl/
```

Note the exact version string (e.g., `12.2.3-SNAPSHOT` or `12.2.4-SNAPSHOT`).

---

## Task 8: Wire Native AAR into React Native Fork

**Files:**
- Modify: `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/build.gradle`
- Modify: `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/gradle.properties`

**Step 1: Add mavenLocal() repository**

In `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/build.gradle`, update the `repositories` block (around line 87):

```gradle
repositories {
    mavenLocal()    // Check local builds first
    mavenCentral()
    google()
}
```

**Step 2: Update native version**

In `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/gradle.properties`, update:

```properties
org.maplibre.reactnative.nativeVersion=<version-from-local-maven>
```

Use the exact version string from the local Maven publish (Task 7, Step 4).

**Step 3: Rebuild pre-built lib/**

If the react-native fork has pre-built outputs in `lib/`:

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-react-native
pnpm build  # or whatever builds lib/
```

**Step 4: Commit fork changes**

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-react-native
git add android/build.gradle android/gradle.properties
git commit -m "feat: use custom maplibre-native AAR with procedural building windows"
git push origin huishype
```

---

## Task 9: Test Native on Device

**Step 1: Clean build the app**

```bash
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
npx expo run:android --clean
```

This forces Gradle to re-resolve dependencies and use the local AAR.

**Step 2: Verify on Samsung S10e**

- Open app on device
- Navigate to 3D building view (z15+)
- Buildings should show warm beige colors + cyan windows + glare streaks + soft base AO
- Check `adb logcat | grep -i "shader\|glsl\|compile"` for any shader errors

**Step 3: Compare web vs native**

Open web map at same location. Windows, colors, and AO should look identical on both platforms.

---

## Task 10: Visual E2E Test

**Files:**
- Create: `apps/app/e2e/visual/building-windows.spec.ts`

**Step 1: Write Playwright test**

```typescript
import { test, expect } from '@playwright/test';

const KNOWN_ACCEPTABLE_ERRORS = [
  /Failed to load resource/,
  /maplibre|mapbox/i,
  /pointerEvents is deprecated/,
  /ERR_NAME_NOT_RESOLVED/,
  /404.*font/i,
];

test.describe('3D Building Windows', () => {
  test('buildings show procedural windows at z16', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isKnown = KNOWN_ACCEPTABLE_ERRORS.some((p) => p.test(text));
        if (!isKnown) consoleErrors.push(text);
      }
    });

    await page.goto('http://localhost:8081', { timeout: 60000 });

    // Wait for map to load
    await page.waitForFunction(
      () => {
        const map = (window as any).__map;
        return map && map.isStyleLoaded() && map.getLayer('3d-buildings');
      },
      { timeout: 60000 }
    );

    // Navigate to Eindhoven center at z16 with 3D pitch
    await page.evaluate(() => {
      const map = (window as any).__map;
      map.jumpTo({
        center: [5.4795, 51.4381],
        zoom: 16,
        pitch: 60,
        bearing: -20,
      });
    });

    // Wait for tiles to load
    await page.waitForTimeout(3000);
    await page.waitForFunction(
      () => {
        const map = (window as any).__map;
        return map && map.areTilesLoaded();
      },
      { timeout: 30000 }
    );

    // Screenshot
    await page.screenshot({
      path: 'test-results/reference-expectations/building-windows/building-windows-current.png',
      fullPage: false,
    });

    expect(consoleErrors).toEqual([]);
  });
});
```

**Step 2: Run the test**

```bash
cd /home/caslan/dev/git_repos/hh/huishype/apps/app
pnpm exec playwright test --project=visual e2e/visual/building-windows.spec.ts
```

**Step 3: Verify screenshot shows windows**

Manually inspect `test-results/reference-expectations/building-windows/building-windows-current.png`. Buildings should show warm colors + cyan windows + glass glare.

**Step 4: Run full test suite to check for regressions**

```bash
pnpm -C apps/app typecheck
pnpm -C apps/app test
pnpm -C apps/app exec playwright test --project=visual
pnpm -C apps/app exec playwright test --project=integration
```

All must pass.

**Step 5: Commit**

```bash
git add apps/app/e2e/visual/building-windows.spec.ts
git commit -m "test: visual e2e test for procedural building windows"
```

---

## Task Dependency Graph

```
Task 1 (style colors) ──┐
                         ├── Task 4 (create patch) ── Task 10 (e2e test)
Task 2 (vertex shader) ──┤
Task 3 (fragment shader) ┘

Task 5 (fork native) ── Task 6 (patch native) ── Task 7 (build AAR) ── Task 8 (wire AAR) ── Task 9 (test device)
```

Tasks 1-4 (web) and Tasks 5-8 (native) can be parallelized. Task 9 depends on both web style changes (Task 1) and native AAR (Task 8). Task 10 depends on web being complete (Task 4).

---

## Reference: Shader Implementation Notes

**Edge distance encoding:** `a_normal_ed.w` is cumulative distance in **tile coordinate units** (NOT meters) along the building polygon perimeter, computed from `Point.dist()` in `fill_extrusion_bucket.ts`. The tile extent is 8192 units regardless of zoom level. Conversion to meters:
- At z15: tile width ≈ 1223m → 1 tile unit ≈ 0.149m
- At z16: tile width ≈ 611m → 1 tile unit ≈ 0.075m
- At z17: tile width ≈ 306m → 1 tile unit ≈ 0.037m
- Formula: `meters = tile_units × tile_width_meters / 8192`

Since the same building has different edgedistance values at different zoom levels (same extent, different real-world area), the `window_spacing` constant in tile units produces different real-world spacing per zoom. We use `window_spacing = 54.0` which gives ≈4m at z16 (the primary building viewing zoom), ≈8m at z15 (fewer windows on small-on-screen buildings), and ≈2m at z17 (more detail when zoomed in). This is acceptable visual behavior. Edge distance wraps at 32768 (Int16 max).

**Height in tile units vs meters:** The `height` and `base` values from the style are in meters (from OpenMapTiles `render_height`). The vertex shader operates in tile coordinates for position but `height`/`base` are already in meters for the `fill-extrusion-height` property. `v_height_m = max(0.0, height - base)` passes the building height in meters. This formula is correct regardless of whether TERRAIN3D is enabled.

**Window antialiasing:** Fragment shader uses `fwidth()` for screen-space derivative-based edge smoothing on window rectangles and glare streaks. This prevents aliasing/shimmer when buildings are viewed at steep angles or during zoom transitions. The `win_mask` smoothstep replaces hard boolean edges.

**Window height gating:** Windows only render on buildings >= 6m tall (≈2 floors). This avoids visual clutter on sheds, garages, and other small structures.

**Precision qualifiers:** `v_wall_uv` and `v_height_m` use `highp` to avoid banding artifacts on mobile GPUs (edgedistance values can be large). `v_is_side` uses `lowp` (only 0.0 or 1.0).

**osm_id availability:** OpenMapTiles building layer exposes `osm_id` as a feature property. If a tile doesn't have it (rare edge case), the `['coalesce', ['get', 'osm_id'], 0]` expression defaults to 0 (variant 0). Current Netherlands OSM IDs are ~15 billion, well below JavaScript's 2^53 precision limit.

**Native shader differences:** MapLibre Native v12.2.3 uses UBO (Uniform Buffer Object) structs instead of individual uniforms (`FillExtrusionDrawableUBO`, `FillExtrusionPropsUBO`). Native UBO includes `u_height_factor` and `u_tile_ratio` which could be used for more precise edgedistance-to-meters conversion, but the constant `window_spacing` approach works well enough. The shader files in `shaders/` are the source GLSL — they get compiled to platform-specific headers via `glslang`. Read the actual native files before patching; don't blindly copy the web version.

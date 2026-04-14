# Snap Map-Style 3D Buildings — Agent Team Prompt

## PROMPT START

You are the lead orchestrator for implementing Snap Map-style 3D buildings on the HuisHype map. You MUST NOT do implementation work yourself. Create an agent team and delegate ALL work to teammates. Your only job is: create the team, create tasks, assign work, review results, and iterate until the feature is complete and polished on both web and native.

### Feature Summary

Replace plain white 3D extruded buildings with Snap Map-style buildings featuring:
- **Per-building warm color variation** (beige/taupe/off-white) so adjacent buildings are visually distinct
- **Procedural window patterns** on side faces — cyan window rectangles with diagonal white glass-glare streaks
- **Soft edge ambient occlusion** at building bases for a "clay model" aesthetic
- **Unified approach**: identical GLSL shader logic on both web (MapLibre GL JS) and native (MapLibre Native Android)

The shader is patched at the source level — on web via `patch-package`, on native via a **forked MapLibre Native** repo built into a custom AAR.

### Design Doc & Plan

Read these FIRST before doing anything:
- `docs/plans/2026-03-05-snap-map-buildings-design.md` — approved design with color palette, shader pseudocode, all decisions
- `docs/plans/2026-03-05-snap-map-buildings-plan.md` — step-by-step implementation plan with 10 tasks

### Reference Screenshots (Snap Map)

Visual reference at `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_14*.jpg` — examine these with vision to understand the target aesthetic:
- Warm beige/taupe building walls with per-building color variation
- Light cyan window rectangles on building sides (not tops)
- Each window has a diagonal white glare streak simulating glass reflection
- Taller buildings have more window rows (floor-based)
- Soft, toylike/clay aesthetic with subtle ambient occlusion at base

### Critical Technical Context

**Verified facts from research (do NOT re-research these):**

1. **MapLibre GL JS v5.16.0** — fill-extrusion shaders at `node_modules/.pnpm/maplibre-gl@5.16.0/node_modules/maplibre-gl/src/shaders/fill_extrusion.vertex.glsl` and `.fragment.glsl`. Web shaders use individual uniforms (`u_lightcolor`, `u_lightpos`, etc.) and `u_projection_matrix`. Varyings use `out`/`in` syntax (GLSL 300 es). The `#pragma mapbox: define/initialize` system handles data-driven properties.

2. **MapLibre Native v12.2.3** — fill-extrusion shaders at `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.vertex.glsl` and `.fragment.glsl`. Native shaders use **UBO structs** (`FillExtrusionDrawableUBO`, `FillExtrusionPropsUBO`, `FillExtrusionTilePropsUBO`) via `layout(std140) uniform` blocks instead of individual uniforms. Uses `u_matrix` instead of `u_projection_matrix`. Vertex inputs use `layout(location = N)` syntax. **The native shader is NOT identical to web — same logic, different syntax.** Read the actual native shader before patching.

3. **MapLibre Native fork** already set up at `/home/caslan/dev/git_repos/hh/maplibre-native` (GitHub: `BUZDOLAPCI/maplibre-native`, branch `huishype`, based on tag `android-v12.2.3`). Clone via HTTPS (SSH keys not configured for this repo).

4. **MapLibre React Native fork** at `/home/caslan/dev/git_repos/hh/maplibre-react-native` (GitHub: `BUZDOLAPCI/maplibre-react-native`, branch `huishype`). Currently references `org.maplibre.gl:android-sdk-opengl:12.2.3` from Maven Central in `android/build.gradle`. Must be updated to use our custom-built AAR from local Maven.

5. **Vertex attributes** (same on both platforms):
   - `a_pos` (vec2): tile coordinates
   - `a_normal_ed` (vec4): normal (xyz × 16384) + edge distance (w)
   - `a_normal_ed.w` = cumulative edge distance along building perimeter **in tile coordinate units** (NOT meters). At z16, 1 tile unit ≈ 0.075m. Same building has different edgedistance at different zoom levels.
   - `mod(normal.x, 2.0)` = `t`: 1.0 for top vertex, 0.0 for bottom vertex
   - `normal.y != 0.0` = side face detection (vs top/bottom)
   - `elevation = t > 0.0 ? height : base` — vertical position
   - `height` and `base` are in **meters** (from style `fill-extrusion-height`/`fill-extrusion-base`)

6. **Shader changes needed** (both platforms):
   - **Vertex shader**: Add 3 new varyings: `v_wall_uv` (highp vec2: edgedistance in tile units + normalized height 0-1), `v_height_m` (highp float: `max(0.0, height - base)` in meters), `v_is_side` (lowp float: 1.0 for sides, 0.0 for top). Use `highp` precision for v_wall_uv and v_height_m to avoid banding on mobile GPUs.
   - **Fragment shader**: Procedural window generation with `fwidth()`-based antialiasing (smooth edges, no shimmer), floor grid at ~3m, window rectangles with smoothstep masks, cyan base color + diagonal glare, soft base AO. Windows only on buildings >= 6m tall. `window_spacing = 54.0` tile units (≈4m at z16).

7. **Style changes**: In `services/api/src/routes/tiles.ts`, `build3DBuildingsLayer()` at lines 509-547. Change `fill-extrusion-color` from static `#FFFFFF` to data-driven expression using `osm_id % 5` mapped to warm neutral palette: `#E2DAD0`, `#DDD7CF`, `#E6E0D8`, `#D8D2CA`, `#E0DCD6`.

8. **Building tiles** come from OpenFreeMap Positron base style, source `openmaptiles`, source-layer `building`. Features have `osm_id`, `render_height`, `render_min_height`, `hide_3d` properties.

9. **Native AAR build pipeline**: In `/home/caslan/dev/git_repos/hh/maplibre-native/platform/android/`:
   - Build: `BUILDTYPE=Release make android-lib-arm-v8` (first build ~15-25 min)
   - Package: `./gradlew :MapLibreAndroid:assembleOpenglRelease`
   - Publish: `./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal`
   - Then update `maplibre-react-native/android/gradle.properties` with the published version and add `mavenLocal()` to `android/build.gradle` repositories block

10. **Web patch pipeline**: Install `patch-package` as devDependency, modify shaders in node_modules, run `npx patch-package maplibre-gl`, add `"postinstall": "patch-package"` to `apps/app/package.json` scripts.

11. **Physical test device**: Samsung Galaxy S10e always connected via USB. Build: `npx expo run:android` from `apps/app`. ADB reverse: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3100 tcp:3100`.

12. **Services**: API at port 3100 (`systemctl --user restart huishype-api`), Metro at port 8081 (`systemctl --user restart huishype-expo`). Docker (postgres/redis) via `docker compose up -d`.

13. **Pre-commit checks**: `pnpm -C apps/app typecheck` + `pnpm -C apps/app test` must pass before commits.

14. **sudo password is `123123`** if needed for system operations.

15. **Existing MapLibre Native fill-opacity bug workaround**: The codebase already has `flattenFillOpacityExpressions()` in tiles.ts that flattens zoom-interpolated fill-opacity expressions to avoid a native rendering bug where ALL fills render gray. The new data-driven `fill-extrusion-color` expression should NOT trigger this bug (it's a match expression, not a zoom interpolation on fill-opacity), but verify on device.

16. **Android NDK requirement**: The native build requires NDK 27.1.12297006. Check with `sdkmanager --list_installed 2>/dev/null | grep ndk` or look in `$ANDROID_HOME/ndk/`. Install with `sdkmanager "ndk;27.1.12297006"` if missing. Also needs CMake 3.10+, Java 11+.

### Team Structure

1. **style-update** — Per-building color variation (style-level, no shader work)
   - Modify `BUILDINGS_3D_CONFIG` in `services/api/src/routes/tiles.ts`
   - Change `fill-extrusion-color` to data-driven `osm_id % 5` expression with warm neutral palette
   - Restart API, verify in browser that buildings show varied warm colors
   - Run existing tests to ensure no regressions
   - Commit

2. **web-shader** — Patch MapLibre GL JS fill-extrusion shaders (DEPENDS ON style-update)
   - Install `patch-package` as devDependency in `apps/app`
   - Modify vertex shader: add `v_wall_uv`, `v_height_m`, `v_is_side` varyings
   - Modify fragment shader: procedural window grid + cyan color + diagonal glare + base AO
   - Add `"postinstall": "patch-package"` to package.json
   - Generate patch file with `npx patch-package maplibre-gl`
   - Restart Metro, verify in browser at z15+ 3D view
   - Verify patch applies cleanly after `pnpm install`
   - Commit

3. **native-build** — Fork shader patch + AAR build (CAN PARALLEL with web-shader, DEPENDS ON style-update)
   - Read the actual native shaders at `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.*.glsl`
   - Apply equivalent shader changes (SAME LOGIC, DIFFERENT SYNTAX — native uses UBO structs, not bare uniforms)
   - Ensure Android SDK, NDK 27.1.12297006, CMake are available
   - Build: `cd /home/caslan/dev/git_repos/hh/maplibre-native/platform/android && BUILDTYPE=Release make android-lib-arm-v8`
   - Package: `./gradlew :MapLibreAndroid:assembleOpenglRelease`
   - Publish to local Maven: `./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal`
   - Note the exact version string published
   - Commit shader changes to the maplibre-native fork and push to `origin huishype`
   - IMPORTANT: The first native build takes ~15-25 minutes. Set a long timeout.

4. **native-wire** — Wire custom AAR into React Native app (DEPENDS ON native-build)
   - Update `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/build.gradle`: add `mavenLocal()` to repositories
   - Update `/home/caslan/dev/git_repos/hh/maplibre-react-native/android/gradle.properties`: set `nativeVersion` to the locally published version
   - Commit and push maplibre-react-native fork changes
   - Clean build the app: `cd /home/caslan/dev/git_repos/hh/huishype/apps/app && npx expo run:android --clean`
   - Verify on Samsung S10e: buildings should show warm colors + procedural windows
   - Check for shader errors: `adb logcat | grep -i "shader\|glsl\|compile\|error"`

5. **qa-verifier** — Tests and visual verification (DEPENDS ON web-shader AND native-wire)
   - Run full test suite: `pnpm -C apps/app typecheck && pnpm -C apps/app test`
   - Run Playwright e2e tests: `pnpm -C apps/app exec playwright test --project=visual`
   - Create visual e2e test at `apps/app/e2e/visual/building-windows.spec.ts` that navigates to z16 over Eindhoven with pitch=60, takes screenshot
   - Take web screenshot at z16 over Eindhoven (buildings + parks area)
   - Take native screenshot on Samsung S10e at same location
   - Report specific issues found

Add additional teammates as needed for issues that arise. Teammates should always use subagents and tasks to keep their contexts lean.

### Execution Loop

```
REPEAT:
  1. Create/update tasks based on current state
  2. Assign tasks to teammates (parallelize where possible)
  3. Wait for teammates to complete their tasks
  4. Have qa-verifier run tests and take screenshots
  5. Spawn a visual verification subagent with VISION to examine screenshots against Snap Map reference images
  6. Review qa-verifier findings + visual agent feedback
  7. IF issues found:
     - Create fix tasks with specific feedback
     - Assign to appropriate teammate
     - GOTO 3
  8. IF all tests green AND visual quality matches Snap Map aesthetic:
     - Have qa-verifier do final comprehensive check
     - Commit all changes with descriptive messages
     - BREAK
```

### Quality Criteria for "Done"

- [ ] Buildings show 5-variant warm neutral color palette (beige/taupe/off-white) with visible per-building variation
- [ ] Side faces show procedural window rectangles in light cyan (~#97C5D5)
- [ ] Each window has a diagonal white glare streak (glass reflection effect)
- [ ] Window rows scale with building height (~3m per floor)
- [ ] Building tops have NO windows (only sides)
- [ ] Soft AO darkening at building base (ground junction)
- [ ] Web and native look visually identical (same shader logic)
- [ ] Windows visible on Samsung S10e physical device
- [ ] `pnpm -C apps/app typecheck` — zero errors
- [ ] `pnpm -C apps/app test` — all unit tests green
- [ ] Playwright visual e2e tests pass (including new building-windows test)
- [ ] No console errors during rendering (web)
- [ ] No shader compilation errors (native — check adb logcat)
- [ ] Patch-package patch applies cleanly after fresh `pnpm install`
- [ ] Overall aesthetic matches Snap Map reference screenshots (warm, toylike, polished)
- [ ] Existing features (trees, property nodes, clusters, preview cards) are unaffected

### CRITICAL Rules — Non-Negotiable

1. **DO NOT do implementation work on the lead agent.** Delegate EVERYTHING to teammates or subagents. The lead agent only orchestrates, reviews, and iterates. Prefer using Agent Teams, tasks, and subagents to keep individual contexts focused and lean.

2. **No workarounds, temporary fixes, TODOs, or "future work" items.** Every issue must be addressed with the optimal, root-cause solution. If something is broken or suboptimal, fix it properly. Don't skip work or defer it.

3. **Extend scope as needed.** If an auxiliary or seemingly unrelated system needs improvement to close gaps or make the feature work properly, start and orchestrate that work too. Don't leave loose ends. If you encounter unrelated issues during implementation (broken tests, lint errors, outdated code, missing types, build failures), don't ignore them — delegate that work to a teammate and orchestrate its resolution.

4. **Visual verification is mandatory.** After each implementation round, use a visual-capable agent (subagent with vision) to examine screenshots of the map on both web and native against the Snap Map reference images. The buildings must look visually polished — correct window proportions, natural color variation, visible glass glare, proper AO, no rendering artifacts. Don't accept "it compiles and tests pass" as done — it must LOOK right.

5. **Wait for teammates to finish** before proceeding. Don't start implementing yourself.

6. **Keep iterating** until ALL quality criteria are met. Don't declare done prematurely. Loop as many times as needed.

7. **Each teammate should validate their own work** with tests before marking tasks complete.

8. **The style-update teammate must finish first** — both shader teammates depend on the per-building color expression being in place.

9. **Native shader syntax differs from web.** The native shaders use UBO structs, not individual uniforms. The native-build teammate MUST read the actual native shader files before patching — do NOT blindly copy web shader code.

10. **Consult `AGENTS.md`** for project conventions (pre-commit checks, service ports, test requirements, dev services).

11. **The native AAR build takes 15-25 minutes first time.** Plan accordingly — don't timeout. Use long timeout values for build commands (600000ms).

12. **Check that data-driven fill-extrusion-color doesn't trigger the known native fill-opacity rendering bug.** The codebase has a `flattenFillOpacityExpressions()` workaround. The new expression is a `match` on `osm_id`, not a zoom interpolation on fill-opacity, so it should be fine — but verify on device.

### Visual Verification Process

After web-shader and native-wire report completion:

1. Take a web screenshot at z16 over Eindhoven (5.4795, 51.4381) with pitch=60 bearing=-20
2. Take a native screenshot on Samsung S10e at the same location
3. Read the Snap Map reference screenshots at `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_14*.jpg`
4. Spawn a visual verification subagent with vision capabilities to compare ALL screenshots:
   - Do buildings show warm beige/taupe colors with per-building variation? (not white)
   - Are cyan window rectangles visible on building side faces?
   - Is the diagonal white glare streak visible on windows? (especially on taller buildings)
   - Do taller buildings have more window rows than shorter ones?
   - Are building tops window-free? (just solid base color + lighting)
   - Is there subtle darkening at building bases? (AO)
   - Does the overall feel match the Snap Map "clay model" aesthetic?
   - Are there any rendering artifacts? (z-fighting, color banding, missing windows, shader errors)
   - Do existing map features (trees, roads, labels, property nodes) still render correctly?
5. If the visual agent reports issues, create specific fix tasks with the visual feedback and assign to the appropriate teammate
6. Repeat until the visual agent confirms the result matches the Snap Map aesthetic

### Shader Reference — Key Implementation Details

**Window generation pseudocode (fragment shader):**
```
IF side_face AND building_height >= 6m:
  floor_count = floor(height_meters / 3.0)
  floor_v = fract(wall_uv.y * floor_count)           // 0-1 within each floor
  cell_u = fract(wall_uv.x / 54.0)                   // 54 tile units ≈ 4m at z16

  // Antialiased window rectangle using fwidth() screen-space derivatives
  fw_u = fwidth(cell_u), fw_v = fwidth(floor_v)
  win_mask = smoothstep edges (55% wide x 40% tall, centered)

  IF win_mask > 0.01:
    local_uv = remap to 0-1 within window (clamped)
    hash = deterministic_hash(grid_position)          // per-window variation
    color = light_cyan + hash_variation

    // Diagonal glass glare (also antialiased)
    diag = (local_u + local_v) * 0.7
    glare = smoothstep band at center of diagonal (using fwidth for smooth edges)
    color = mix(color, white, glare * 0.35)

    // Blend window over lit base color (win_mask provides soft edges)
    output = mix(base_lit_color, window_color, 0.88 * win_mask)

IF side_face:
  // Base AO
  output *= smoothstep darkening at v=0 (ground level)
```

**IMPORTANT unit note:** `wall_uv.x` (edgedistance) is in **tile coordinate units**, not meters. `window_spacing = 54.0` tile units produces ≈4m windows at z16. At z15 windows are wider (≈8m, fewer per wall), at z17 narrower (≈2m, more per wall). This is acceptable — tune visually if needed.

**Per-building color expression (tiles.ts):**
```json
["match", ["%", ["coalesce", ["get", "osm_id"], 0], 5],
  0, "#E2DAD0",
  1, "#DDD7CF",
  2, "#E6E0D8",
  3, "#D8D2CA",
  "#E0DCD6"]
```

Start by reading the design doc and plan, then create the team and orchestrate the work until everything is complete.

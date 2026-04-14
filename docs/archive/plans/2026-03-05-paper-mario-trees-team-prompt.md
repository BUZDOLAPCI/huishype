# Paper Mario Billboard Trees — Agent Team Prompt

## PROMPT START

You are the lead orchestrator for implementing Paper Mario-style billboard trees on the HuisHype map. You MUST NOT do implementation work yourself. Create an agent team and delegate ALL work to teammates. Your only job is: create the team, create tasks, assign work, review results, and iterate until the feature is complete and polished on both web and native.

### Feature Summary

Scatter 2D tree sprites (from a 16-variant 4x4 atlas at `tree-atlas.png` in repo root) across green map areas as 3D billboard objects. Trees stand upright like Paper Mario cardboard cutouts. They use custom rendering layers with depth-buffer occlusion against 3D buildings. Both web (MapLibre GL JS custom layer) and native Android (MapLibre Native CustomLayer via our RN fork) must be supported. Trees and 3D buildings both appear starting at zoom 15.

### Design Doc & Plan

Read these FIRST before doing anything:
- `docs/plans/2026-03-05-paper-mario-billboard-trees-design.md` — approved design with all decisions
- `docs/plans/2026-03-05-paper-mario-billboard-trees-plan.md` — step-by-step implementation plan with 12 tasks

### Critical Technical Context

**Verified facts from research (do NOT re-research these):**

1. **MapLibre Android SDK v12.2.3** includes `org.maplibre.android.style.layers.CustomLayer` class (confirmed via AAR decompilation of `/home/caslan/.gradle/caches/modules-2/files-2.1/org.maplibre.gl/android-sdk-opengl/12.2.3/*/android-sdk-opengl-12.2.3.aar`). Constructor: `CustomLayer(String id, long hostPtr)` where `hostPtr` is JNI pointer to C++ `mbgl::style::CustomLayerHost`.

2. **MapLibre iOS SDK v6.22.1** has `MLNOpenGLStyleLayer` for custom rendering.

3. **maplibre-react-native fork** at `/home/caslan/dev/git_repos/hh/maplibre-react-native` (branch: `huishype`) does NOT currently expose CustomLayer. The fork patch adds a generic `BillboardLayer` Fabric component.

4. **MapLibre GL JS** has built-in `CustomLayerInterface` with `onAdd(map, gl)`, `render(gl, options)`, `onRemove()`. Set `renderingMode: '3d'` for depth buffer access. No fork needed for web.

5. **Existing web tree code** to REPLACE: `createTreeIcon()` (lines 90-133) and `add3DTreeSymbols()` (lines 138-180) in `apps/app/app/(tabs)/index.web.tsx`.

6. **Tile pipeline**: `services/api/src/routes/tiles.ts` — style endpoint at `GET /tiles/style.json`, property tiles via `ST_AsMVT` in PostGIS. Tree tile endpoint at `GET /tiles/trees/:z/:x/:y.pbf` serves scatter points filtered by landcover polygons.

7. **Sprite system**: `services/api/sprites/ofm.json` + `ofm.png` (and @2x variants). Route: `GET /sprites/:filename`.

8. **Native map**: `apps/app/app/(tabs)/index.tsx` — consumes `/tiles/style.json`, uses `@maplibre/maplibre-react-native` fork.

9. **Physical test device**: Samsung Galaxy S10e always connected via USB. Build: `npx expo run:android` from `apps/app`. ADB reverse needed: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3100 tcp:3100`.

10. **Services**: API at port 3100 (`systemctl --user restart huishype-api`), Metro at port 8081 (`systemctl --user restart huishype-expo`). Docker (postgres/redis) via `docker compose up -d`.

11. **Pre-commit checks**: `pnpm -C apps/app typecheck` + `pnpm -C apps/app test` must pass before commits.

12. **Mercator coordinate Z-axis**: In MapLibre custom layers, the projection matrix operates in Mercator coordinate space where `x` = east-west, `y` = north-south, `z` = altitude/vertical. Billboard quads must expand along the **Z axis** for trees to stand upright. Using Y for vertical offset moves trees north-south (a critical shader bug in the draft plan).

13. **GL state restoration**: Custom layers MUST save and restore ALL GL state they modify — not just toggle depth/blend off. This includes: current program, depth test, depth mask, blend state, blend func, active texture, bound buffers. Incomplete restoration causes rendering artifacts in subsequent MapLibre layers.

14. **OSM landcover data required**: Our PostGIS DB currently has only BAG property data. Green polygon data (parks, forests, greenspace) must be imported from OpenStreetMap via ogr2ogr from a Netherlands PBF extract (Geofabrik). Import into a `landcover` table with GIST index. Tree scatter candidates are generated server-side and filtered via `ST_Within` against these landcover polygons — ensuring trees only appear in green areas. This is a one-time import, refreshable like BAG data.

15. **Server-side tree tile endpoint**: Tree positions are generated server-side in `GET /tiles/trees/:z/:x/:y.pbf`. Candidate points scattered across tile bbox via seeded PRNG, then filtered to only those inside landcover polygons via `ST_Within` join. Encoded as MVT via `ST_AsMVT()`. Added as `tree-source` in style.json. The BillboardCustomLayer reads from this source — no client-side polygon querying needed.

16. **Sprite sheet merge approach**: When merging tree sprites into the existing ofm sprite sheet, do NOT use `sharp().raw().toBuffer()` + raw buffer reconstruction. Instead, use `sharp({ create: { width, height, channels: 4, background: transparent } })` then `.composite([existing sheet at (0,0), ...tree sprites])`. This avoids channel count assumptions and image corruption.

### Team Structure Example

An example of teammates, not limited to:

1. **sprite-api** — Handles sprite atlas, landcover import, and tree scatter tile endpoint
   - Slice `tree-atlas.png` into 16 sprites, merge into ofm sprite sheet (using canvas+composite approach, NOT raw buffer)
   - Serve raw atlas as texture endpoint (`GET /sprites/tree-atlas.png`)
   - Import OSM landcover polygons into PostGIS `landcover` table (parks, forests, greenspace, grass via ogr2ogr from Netherlands PBF)
   - Create tree scatter PRNG utility + tests (in `services/api/src/services/tree-scatter.ts`)
   - Create tree tile endpoint (`GET /tiles/trees/:z/:x/:y.pbf`) — scatter candidates filtered by `ST_Within` against landcover polygons, encoded via `ST_AsMVT`
   - Add `tree-source` to style.json
   - Add `sharp` dependency for image processing

2. **web-billboard** — Handles web BillboardCustomLayer (WebGL)
   - DEPENDS ON sprite-api completing
   - Create `BillboardCustomLayer` class implementing `CustomLayerInterface` with `renderingMode: '3d'`
   - WebGL shaders: textured billboard quads, atlas UV sampling, alpha discard, depth test
   - CRITICAL: Vertical billboard offset must use Z axis (altitude), NOT Y (north-south) in Mercator space
   - CRITICAL: Must save/restore ALL GL state (program, depth, blend, textures, buffers)
   - Reads tree positions from `tree-source` vector tile source (server-side scatter)
   - Replace old `createTreeIcon()` and `add3DTreeSymbols()` in index.web.tsx
   - Wire into map load handler
   - Visual verification on web browser

3. **native-billboard** — Handles native BillboardLayer (maplibre-react-native fork)
   - DEPENDS ON sprite-api completing
   - Research: decompile CustomLayer class fully, understand JNI host pointer mechanism
   - Implement `BillboardLayer` Fabric component in fork (Android first, iOS second)
   - The rendering must use `CustomLayerHost` C++ interface via JNI for OpenGL ES billboard quads
   - CRITICAL: Vertical billboard offset must use Z axis (altitude), NOT Y (north-south) in Mercator space
   - Reads tree positions from `tree-source` vector tile source via the style (server-side scatter)
   - Wire into native map in index.tsx
   - Build and test on physical device (Samsung S10e)
   - If CustomLayer JNI proves too complex after genuine attempt: fall back to symbol layer with `symbol-sort-key` for depth illusion (still ship the feature, just without building occlusion on native)

4. **qa-verifier** — Tests and visual verification
   - DEPENDS ON web-billboard AND native-billboard
   - Run full test suite: `pnpm -C apps/app typecheck && pnpm -C apps/app test`
   - Run Playwright e2e: `pnpm -C apps/app exec playwright test --project=visual`
   - Create new e2e test for trees at `apps/app/e2e/visual/paper-trees.spec.ts`
   - Take screenshots on web and native for visual comparison
   - Report specific issues found (rendering glitches, wrong size, missing trees, performance, console errors)
   - Verify 3D buildings also start at z15 (change minzoom from 14 to 15 if needed)

Add additional teammates as needed. Teammates should always use subagents and tasks to keep their contexts lean.

### Execution Loop

```
REPEAT:
  1. Create/update tasks based on current state
  2. Assign tasks to teammates
  3. Wait for teammates to complete their tasks
  4. Have qa-verifier run tests and take screenshots
  5. Review qa-verifier findings
  6. IF issues found:
     - Create fix tasks with specific feedback
     - Assign to appropriate teammate (web-billboard, native-billboard, or sprite-api)
     - GOTO 3
  7. IF all tests green AND visual quality acceptable:
     - Have qa-verifier do final comprehensive check
     - Commit all changes with descriptive messages
     - BREAK
```

### Quality Criteria for "Done"

- [ ] 16 tree variants from atlas render on map at z15+
- [ ] Trees are billboard-aligned (face camera, Paper Mario style)
- [ ] Trees appear scattered across green areas (parks, forests, landcover)
- [ ] Trees have consistent world-scale size (feel like map objects)
- [ ] Web: trees use custom WebGL layer with depth testing
- [ ] Web: trees behind 3D buildings are occluded (depth test works)
- [ ] Native: trees render on Samsung S10e device
- [ ] 3D buildings and trees both start at z15
- [ ] `pnpm -C apps/app typecheck` — zero errors
- [ ] `pnpm -C apps/app test` — all green
- [ ] Playwright visual tests pass
- [ ] No console errors during rendering
- [ ] Old `createTreeIcon` and `add3DTreeSymbols` code removed from web
- [ ] Trees appear ONLY in green areas (parks, forests, landcover) — NOT on roads, water, or buildings
- [ ] Billboard vertical offset uses Z axis (trees stand upright, not shifted north-south)

### CRITICAL Rules — Non-Negotiable

1. **DO NOT do implementation work on the lead agent.** Delegate EVERYTHING to teammates or subagents. The lead agent only orchestrates, reviews, and iterates. Prefer using Agent Teams, tasks, and subagents to keep individual contexts focused and lean.

2. **No workarounds, temporary fixes, TODOs, or "future work" items.** Every issue must be addressed with the optimal, root-cause solution. If something is broken or suboptimal, fix it properly. Don't skip work or defer it.

3. **Extend scope as needed.** If an auxiliary or seemingly unrelated system needs improvement to close gaps or make the feature work properly, start and orchestrate that work too. Don't leave loose ends. If you encounter unrelated issues during implementation (broken tests, lint errors, outdated code, missing types), don't ignore them — delegate that work to a teammate and orchestrate its resolution.

4. **Visual verification is mandatory.** After each implementation round, use a visual-capable agent (subagent with vision) to examine screenshots of the map on both web and native. The trees must look visually polished — correct size relative to buildings, natural scatter density, no rendering artifacts, proper depth occlusion, colors matching the atlas. Don't accept "it compiles and tests pass" as done — it must LOOK right.

5. **Wait for teammates to finish** before proceeding. Don't start implementing yourself.

6. **Keep iterating** until ALL quality criteria are met. Don't declare done prematurely. Loop as many times as needed.

7. **Each teammate should validate their own work** with tests before marking tasks complete.

8. **The sprite-api teammate must finish first** — web and native both depend on the landcover import, tree tile endpoint, and sprite atlas being live.

9. **If native CustomLayer proves infeasible**, the native-billboard teammate should fall back to symbol layer approach and document why. This is acceptable — ship what works.

10. **Consult `AGENTS.md`** for project conventions (pre-commit checks, service ports, test requirements).

11. **sudo password is `123123`** if needed for system operations.

### Visual Verification Process

After web-billboard and native-billboard report completion:

1. Take a web screenshot at z15 over Eindhoven Strijp area (parks + buildings visible)
2. Take a native screenshot on Samsung S10e at the same location
3. Spawn a visual verification subagent with vision capabilities to examine BOTH screenshots against the design spec:
   - Are trees scattered naturally across green areas?
   - Do trees have correct billboard alignment (standing upright, facing camera)?
   - Is the size proportional to buildings (trees should be ~8-12m, smaller than most buildings)?
   - Do all 16 variants appear (different shapes/colors from the atlas)?
   - On web: are trees behind buildings properly occluded?
   - Are there any rendering artifacts (z-fighting, black quads, missing textures, wrong UV mapping)?
   - Does the overall aesthetic match the Paper Mario / Snap Maps feel?
4. If the visual agent reports issues, create specific fix tasks with the visual feedback and assign to the appropriate teammate
5. Repeat until the visual agent confirms the result is polished

Start by reading the design doc and plan, then create the team and orchestrate the work until everything is complete.
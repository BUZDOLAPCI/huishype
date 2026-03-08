Create an agent team to consolidate and polish our 3D building procedural window shaders to match Snap Map's visual quality. This is a cross-platform shader task spanning two MapLibre forks (web + Android native) plus verification via Playwright e2e tests and on-device native testing.

## CRITICAL DIRECTIVES

- Work on addressing everything with the optimal approach. No future works, TODOs, or skipping work.
- Don't do workarounds or temporary fixes. Only address root causes and implement the optimal solutions.
- If an auxiliary or seemingly unrelated system needs improvement to close gaps, start and orchestrate that work too. Extend scope as needed.
- If you encounter even unrelated issues that are not related to the main workflow we are working on, don't ignore that work — delegate it to teammates and orchestrate its resolution.
- Prefer using Agent Teams, tasks, and subagents to keep individual contexts focused. Don't do work on the lead agent. Delegate to teammates.
- Check the resulting screenshot visuals for our maps with a visual agent to see if they are up to spec and visually polished.
- Loop until feature is completely implemented and polished. Re-iterate on issues encountered.

## Reference Images

Study these Snap Map screenshots carefully — they define the target aesthetic:
- `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_143024_Snapchat.jpg` — Close-up: tall office buildings with LARGE, clearly defined rectangular blue-tinted windows, distinct horizontal floor bands, warm cream/beige wall color, soft shadows
- `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_143224_Snapchat.jpg` — Mid-distance: residential neighborhood, small buildings with 1-2 visible blue window rectangles per wall face, clean sharp window edges, NO shimmer/moire
- `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Screenshot_20260305_143254_Snapchat.jpg` — Mixed zoom: buildings at various distances, windows gracefully fade at distance, no visual artifacts
- `/home/caslan/Downloads/drive-download-20260305T133459Z-1-001/Pasted image.png` — Single building close-up detail

Key visual characteristics from Snap Map that we MUST match:
1. **Window color**: Clean blue/cyan tint, high contrast against warm cream walls
2. **Window proportions**: substantial mullion/frame gaps between windows
3. **Wall color**: Warm cream/beige base (our current palette is correct: #F5EDE2, #EDE4D8, etc.)
5. **Ambient occlusion**: Soft darkening at building base, subtle top highlight
7. **Clean edges**: Windows don't clip or produce artifacts at building face boundaries

## Shader Review Document

Read `/home/caslan/dev/git_repos/hh/huishype/docs/plans/2026-03-08-shader-review.md` — it identifies divergences between web and native shaders. VERIFY AND FACT-CHECK each claim against the actual shader source files before acting on them. Don't take the review at face value.

## Current State — Shader File Locations

| Platform | Vertex Shader | Fragment Shader |
|----------|---------------|-----------------|
| **Web** (MapLibre GL JS fork) | `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/fill_extrusion.vertex.glsl` | `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/fill_extrusion.fragment.glsl` |
| **Native** (MapLibre Native fork) | `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.vertex.glsl` | `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/fill_extrusion.fragment.glsl` |

## Verified Issues to Address (confirmed from source code)

### 2. Web shader MISSING glare gating
Web always computes diagonal glare even at subpixel sizes (wastes GPU, produces artifacts). Native gates with `if (detail > 0.5)`. Add this to web.

### 3. Window parameter divergence
Web uses paper-thin mullions (win_l=0.01, win_r=0.99 → 98% fill) while native has visible frames (0.08/0.92 → 84% fill). Web has thick floor slabs (win_b=0.05, win_t=0.70) while native has thin ones (0.04/0.96). ALIGN BOTH to match Snap Map reference: visible mullions, portrait-ratio windows, thin floor slabs.

### 4. Dead `v_tile_pos` varying on web
Declared in vertex shader, assigned, passed to fragment, but NEVER used in any computation. Remove it.

### 5. Consider porting web's edge fade to native
Web has `v_ed_flat` + `edge_fade = smoothstep(0.0, 30.0, dist_from_prov)` which prevents window clipping at face boundaries. Native doesn't have this. Evaluate if native benefits from it and port if so.

### 6. Cross-platform parameter unification
After fixing individual issues, ensure BOTH shaders produce visually identical output at equivalent zoom levels. Same floor height, same window proportions, same AO, same LOD thresholds (adjusted for coordinate scale differences).

## Build & Deploy Pipelines

### Web shader changes:
1. Edit `.glsl` files in `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/`
2. `cd /home/caslan/dev/git_repos/hh/maplibre-gl-js && npm run generate-shaders`
3. `npm run build-dist`
4. Commit source + generated files, push to `origin huishype`
5. Update commit hash in `apps/app/package.json`: `"maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#<new-hash>"`
6. `pnpm install` in monorepo root
7. `rm -rf /tmp/metro-* /tmp/haste-map-*`
8. `systemctl --user restart huishype-expo`
9. Wait for Metro to rebuild, then hard-refresh browser

### Native shader changes:
1. Edit `.glsl` files in `/home/caslan/dev/git_repos/hh/maplibre-native/shaders/`
2. `cd /home/caslan/dev/git_repos/hh/maplibre-native && node shaders/generate_shader_code.mjs`
3. Build AAR: `BUILDTYPE=Release make android-lib-arm-v8` (takes ~5-10 min)
4. `cd platform/android && BUILDTYPE=Release ../../gradlew :MapLibreAndroid:assembleOpenglRelease`
5. `BUILDTYPE=Release ../../gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal`
6. Back in monorepo: `cd /home/caslan/dev/git_repos/hh/huishype && npx expo run:android` from `apps/app`

## Verification Requirements

### Web verification (Playwright):
- Existing test: `apps/app/e2e/visual/building-windows.spec.ts` — update/expand it
- Take screenshots at z16 (close-up), z17 (mid), z18 (detail), and z15 (distance)
- All screenshots must show NO moire/shimmer artifacts
- Console errors during test = FAIL
- Use visual agent to compare screenshots against Snap Map references
- Run: `pnpm -C apps/app exec playwright test --project=visual building-windows`

### Native verification (on-device):
- Physical device: Samsung Galaxy S10e always connected via USB
- Use `mcp rn-debugger` tools: `android_screenshot`, `get_logs`, `scan_metro`
- Take screenshots at equivalent zoom levels
- Compare native vs web for visual consistency

### Full test suite (must pass before completion):
```bash
pnpm -C apps/app typecheck        # Zero TS errors
pnpm -C apps/app test             # All unit tests
pnpm -C apps/app exec playwright test --project=visual
pnpm -C apps/app exec playwright test --project=integration
```

## Team Structure

Spawn these teammates:

1. **shader-web** — Owns web shader GLSL changes in the maplibre-gl-js fork. Implements LOD, fixes parameters, removes dead code, rebuilds dist, pushes fork, updates hash in package.json. Runs `npm run generate-shaders && npm run build-dist`.

2. **shader-native** — Owns native shader GLSL changes in the maplibre-native fork. Aligns parameters with web, evaluates edge-fade port, regenerates headers, builds AAR, publishes to mavenLocal.

3. **test-and-verify** — Owns all Playwright e2e tests for building windows. Updates `building-windows.spec.ts` with multi-zoom tests, runs them, captures screenshots at z15/z16/z17/z18, reports visual findings. Also runs the full test suite to check for regressions.

4. **visual-reviewer** — Uses vision capabilities to compare screenshots (web + native) against Snap Map references. Provides specific, actionable feedback on what doesn't match. This teammate loops with shader-web and shader-native until visuals match.

### Workflow

1. **shader-web** and **shader-native** work in PARALLEL on their respective forks, aligning to the same target parameters
2. **shader-web** completes → triggers web rebuild pipeline → **test-and-verify** runs Playwright tests and captures screenshots
3. **shader-native** completes → triggers native build → test on physical device via rn-debugger
4. **visual-reviewer** examines ALL screenshots against references, provides feedback
5. If NEEDS_WORK → loop back: shader teammates fix issues, rebuild, re-test, re-review
6. If SUFFICIENT → **test-and-verify** runs full test suite to confirm zero regressions
7. Only mark complete when: visuals match references, NO moire/shimmer at any zoom, both platforms consistent, ALL tests green

## Important Project Context

- Branch: `dev/paper-mario-trees` (current working branch)
- Monorepo root: `/home/caslan/dev/git_repos/hh/huishype`
- Read `AGENTS.md` and `agent-rules/` for project conventions
- sudo password: "123123" if needed for system operations
- Metro dev server: port 8081 (systemd unit `huishype-expo`)
- API server: port 3100 (systemd unit `huishype-api`)
- Expo web dev at localhost:8081
- Use `--dangerously-skip-permissions` is already set globally

Start working immediately. Verify every claim in the shader review against actual source before implementing. Loop until completely polished.

When making decisions, always refer back to the Snap Map examples. Align visuals to exactly that.

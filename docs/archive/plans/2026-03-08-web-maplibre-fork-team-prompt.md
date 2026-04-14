# Web MapLibre GL JS Fork Migration — Agent Team Prompt

## PROMPT START

You are the lead orchestrator for migrating HuisHype's web shader customizations from a fragile pnpm patch on `maplibre-gl` to a maintained fork (`BUZDOLAPCI/maplibre-gl-js`). You MUST NOT do implementation work yourself. Create an agent team and delegate ALL work to teammates. Your only job is: create the team, create tasks, assign work, review results, and iterate until the migration is complete and verified on both web and native (native should be unaffected but must be regression-tested).

### Migration Summary

Replace the current `pnpm.patchedDependencies` workflow (patching both `src/shaders/*.glsl` AND 4 `dist/maplibre-gl*.js` bundles in `patches/maplibre-gl@5.16.0.patch`) with a forked `maplibre-gl-js` repo where shader edits are made in source, rebuilt via the upstream build pipeline, and consumed as a GitHub dependency.

### Plan Document

Read this FIRST before doing anything:
- `docs/plans/2026-03-08-web-maplibre-fork-plan.md` — the full migration plan with 5 phases

### Critical Technical Context

**Helpful prior research:**

1. **Current dependency**: `"maplibre-gl": "^5.16.0"` in `apps/app/package.json` with `pnpm.patchedDependencies` in root `package.json` pointing to `patches/maplibre-gl@5.16.0.patch`.

2. **Patch scope**: The 3.0 MB patch file modifies 6 files — 2 source shaders (`src/shaders/fill_extrusion.{vertex,fragment}.glsl`) and 4 dist bundles (`dist/maplibre-gl.js`, `dist/maplibre-gl-dev.js`, `dist/maplibre-gl-csp.js`, `dist/maplibre-gl-csp-dev.js`). The shaders implement LOD-adaptive procedural windows on 3D fill-extrusion buildings.

3. **MapLibre GL JS build pipeline**: `.glsl` source → `npm run generate-shaders` → `src/shaders/*.glsl.g.ts` (minified JS string exports, 80+ files) → `npm run build-dist` → rollup → `dist/maplibre-gl*.js` (4 bundles). The full `build-dist` script runs: `build-css → generate-unicode-data → generate-typings → generate-shaders → rollup (dev + prod + csp variants)`.

4. **Established fork pattern**: `maplibre-react-native` is already consumed as `"github:BUZDOLAPCI/maplibre-react-native#d2632481"` (pinned commit hash, pnpm resolves via `codeload.github.com` tarball). The web fork should use the same pattern: `"maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#<commit-hash>"`.

5. **dist/ must be committed in the fork**: Consumers install via GitHub tarball and don't run a build step. This matches how `maplibre-react-native` ships pre-built `lib/` in its fork.

6. **Existing sync tooling**: `tools/sync-maplibre-fork.sh` handles upstream sync for the RN fork (fetch upstream, merge, rebuild, push, update hash in package.json). A similar `tools/sync-maplibre-gl-fork.sh` should be created.

7. **Native Android is NOT touched**: The `maplibre-native` fork (`12.2.3-huishype` AAR via `mavenLocal()`) stays as-is. But native must be regression-tested to confirm it still works after the dependency change.

8. **Re-patching workflow to REMOVE**: AGENTS.md currently documents 4 manual steps for re-patching (`rm -rf node_modules/.pnpm/maplibre-gl@*`, `pnpm install`, clear Metro cache, restart Metro, hard-refresh browser). This section gets replaced with the fork workflow.

9. **Web map entry point**: `apps/app/app/(tabs)/index.web.tsx` imports `maplibre-gl` directly.

10. **Existing visual tests**: `building-windows.spec.ts` tests 3D building rendering at z16/z17/z18 with console error gating. Screenshots saved to `test-results/reference-expectations/building-windows/`.

11. **Pre-commit checks**: `pnpm -C apps/app typecheck` + `pnpm -C apps/app test` must pass before commits.

12. **Services**: API at port 3100 (`systemctl --user restart huishype-api`), Metro at port 8081 (`systemctl --user restart huishype-expo`). Docker (postgres/redis) via `docker compose up -d`.

13. **Physical test device**: Samsung Galaxy S10e always connected via USB. Build: `npx expo run:android` from `apps/app`. ADB reverse: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3100 tcp:3100`.

14. **sudo password**: `123123` if needed for system operations.

15. **Fork local clone location**: `/home/caslan/dev/git_repos/hh/maplibre-gl-js` (sibling to `huishype/`, `maplibre-native/`, `maplibre-react-native/`).

16. **GitHub org**: `BUZDOLAPCI` (same org that hosts the `maplibre-react-native` and `maplibre-native` forks).

### Team Structure

1. **baseline-capture** — Phase 1: Record current state
   - Record the exact maplibre-gl version from lockfile and patch hash
   - Run the existing `building-windows.spec.ts` Playwright test to capture a baseline screenshot
   - Verify current web build is reproducible and shader windows render correctly
   - Save baseline screenshot path for later comparison
   - Output: baseline version info + screenshot path + confirmation current state works

2. **fork-builder** — Phase 2: Create and build the fork
   - DEPENDS ON baseline-capture completing
   - Fork `maplibre/maplibre-gl-js` to `BUZDOLAPCI/maplibre-gl-js` on GitHub (use `gh repo fork`)
   - Clone to `/home/caslan/dev/git_repos/hh/maplibre-gl-js`
   - Create `huishype` branch from upstream tag `v5.16.0`
   - Extract the shader-only diff from the current patch file (`patches/maplibre-gl@5.16.0.patch`) — port only the `src/shaders/fill_extrusion.{vertex,fragment}.glsl` changes into the fork source
   - Install fork dependencies (`npm install`)
   - Run `npm run generate-shaders` to regenerate `.glsl.g.ts` intermediate files
   - Run `npm run build-dist` to rebuild all 4 dist bundles
   - Verify the rebuilt dist bundles contain the shader customizations (grep for distinctive shader strings like `v_wall_uv`, `num_floors`, procedural window code)
   - Commit source shader edits + regenerated `.glsl.g.ts` + rebuilt `dist/` together
   - Push to `BUZDOLAPCI/maplibre-gl-js` branch `huishype`
   - Output: commit hash to pin in package.json

3. **dependency-switcher** — Phase 3: Wire up the fork in HuisHype
   - DEPENDS ON fork-builder completing (needs the commit hash)
   - Update `apps/app/package.json`: change `"maplibre-gl": "^5.16.0"` to `"maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#<commit-hash>"`
   - Remove `pnpm.patchedDependencies` entry from root `package.json`
   - Run `pnpm install` and verify lockfile updates cleanly
   - Clear Metro cache: `rm -rf /tmp/metro-* /tmp/haste-map-*`
   - Restart Metro: `systemctl --user restart huishype-expo`
   - Do a quick smoke test: verify the web page loads in browser and map renders (no blank screen, no crash)
   - Do NOT delete the old patch file yet — keep it as rollback safety until verification passes
   - Output: confirmation that install + web load succeeded

4. **qa-web** — Phase 4a: Web verification
   - DEPENDS ON dependency-switcher completing
   - Run `pnpm -C apps/app typecheck`
   - Run `pnpm -C apps/app test`
   - Run Playwright visual tests: `pnpm -C apps/app exec playwright test --project=visual`
   - Run the `building-windows.spec.ts` test specifically and capture the new screenshot
   - Compare new screenshot against the baseline from Phase 1 (spawn a visual subagent)
   - Check for console errors during web rendering
   - Report: test results, screenshot comparison, any regressions

5. **qa-native** — Phase 4b: Native regression test
   - DEPENDS ON dependency-switcher completing
   - Build and deploy to Samsung S10e: `npx expo run:android` from `apps/app`
   - Verify map loads, 3D buildings render with procedural windows, trees render
   - Take a device screenshot for visual verification
   - This should be completely unaffected by the web dependency change — but must confirm
   - Report: native app works, screenshot, any issues

6. **doc-updater** — Phase 5: Documentation and tooling
   - DEPENDS ON qa-web AND qa-native confirming no regressions
   - Update `AGENTS.md`:
     - Replace the "Applying web shader changes" section (the 4-step pnpm re-patch instructions) with the fork workflow
     - Add a "MapLibre GL JS Fork" section documenting: fork location, branch, shader edit + rebuild + consume workflow
     - Add rollback recipe
   - Create `tools/sync-maplibre-gl-fork.sh` following the pattern of `tools/sync-maplibre-fork.sh`:
     - Fetch upstream tag, merge into `huishype` branch
     - Run `npm run generate-shaders && npm run build-dist`
     - Commit, push
     - Update commit hash in `apps/app/package.json`
     - Run `pnpm install`
   - Delete the old patch file `patches/maplibre-gl@5.16.0.patch` (only now, after full verification)
   - Update MEMORY.md if needed
   - Output: list of files changed

7. **visual-reviewer** — Visual quality verification (spawned as subagent, not permanent teammate)
   - Compare baseline screenshot vs post-migration screenshot
   - Verify procedural windows still render on 3D buildings (LOD-adaptive: z16 bands, z17 detailed windows, z18 full detail with glare)
   - Verify soft ambient occlusion at building bases
   - Verify per-building color variation (warm cream/beige palette)
   - Verify paper mario trees still render correctly (not affected by this change)
   - Check for any visual regressions: missing windows, wrong colors, flat gray buildings, z-fighting
   - Verdict: PASS or FAIL with specific feedback

Add additional teammates as needed. Teammates should use subagents and tasks to keep their contexts lean.

### Execution Loop

```
REPEAT:
  1. Create/update tasks based on current state
  2. Assign tasks to teammates in dependency order (baseline → fork → switch → verify → docs)
  3. Wait for teammates to complete their tasks
  4. Have qa-web and qa-native run verification
  5. Spawn visual-reviewer subagent to examine screenshots
  6. Review all findings
  7. IF issues found:
     - Create fix tasks with specific feedback
     - Assign to appropriate teammate
     - GOTO 3
  8. IF all tests green AND visual quality matches baseline AND native unaffected:
     - Have doc-updater finalize documentation
     - Delete old patch file
     - Commit all changes with descriptive messages
     - BREAK
```

### Quality Criteria for "Done"

- [ ] Fork `BUZDOLAPCI/maplibre-gl-js` exists with `huishype` branch containing shader customizations
- [ ] Fork source shaders, `.glsl.g.ts` intermediates, and `dist/` are internally consistent
- [ ] `apps/app/package.json` references fork via `github:BUZDOLAPCI/maplibre-gl-js#<hash>`
- [ ] `pnpm.patchedDependencies` removed from root `package.json`
- [ ] Old patch file `patches/maplibre-gl@5.16.0.patch` deleted
- [ ] Web: procedural windows render identically to baseline (LOD-adaptive at z16/z17/z18)
- [ ] Web: per-building color variation works (warm cream/beige palette)
- [ ] Web: soft AO at building bases works
- [ ] Web: paper mario trees still render correctly
- [ ] Native: 3D buildings with procedural windows still render on Samsung S10e
- [ ] Native: no regressions from the web dependency change
- [ ] `pnpm -C apps/app typecheck` — zero errors
- [ ] `pnpm -C apps/app test` — all green
- [ ] Playwright visual tests pass (especially `building-windows.spec.ts`)
- [ ] No new console errors during web rendering
- [ ] `AGENTS.md` updated with fork workflow, old patch instructions removed
- [ ] `tools/sync-maplibre-gl-fork.sh` created and functional
- [ ] Rollback recipe documented (can revert to pnpm patches in one change)

### CRITICAL Rules — Non-Negotiable

1. **DO NOT do implementation work on the lead agent.** Delegate EVERYTHING to teammates or subagents. The lead agent only orchestrates, reviews, and iterates. Prefer using Agent Teams, tasks, and subagents to keep individual contexts focused and lean.

2. **No workarounds, temporary fixes, TODOs, or "future work" items.** Every issue must be addressed with the optimal, root-cause solution. If something is broken or suboptimal, fix it properly. Don't skip work or defer it.

3. **Extend scope as needed.** If an auxiliary or seemingly unrelated system needs improvement to close gaps or make the migration work properly, start and orchestrate that work too. Don't leave loose ends. If you encounter unrelated issues during implementation (broken tests, lint errors, outdated code, missing types), don't ignore them — delegate that work to a teammate and orchestrate its resolution.

4. **Visual verification is mandatory.** After migration, use a visual-capable agent (subagent with vision) to examine screenshots of the web map buildings. The procedural windows must look identical to the baseline — correct LOD behavior, per-building colors, ambient occlusion, no rendering artifacts. Don't accept "it compiles and tests pass" as done — it must LOOK right.

5. **Wait for teammates to finish** before proceeding. Don't start implementing yourself.

6. **Keep iterating** until ALL quality criteria are met. Don't declare done prematurely. Loop as many times as needed.

7. **Each teammate should validate their own work** with tests before marking tasks complete.

8. **Follow dependency order**: baseline-capture → fork-builder → dependency-switcher → qa-web + qa-native (parallel) → doc-updater. Don't skip phases.

9. **Consult `AGENTS.md`** for project conventions (pre-commit checks, service ports, test requirements, fork patterns).

10. **sudo password is `123123`** if needed for system operations.

11. **Don't delete the patch file until all verification passes.** It's the rollback safety net.

12. **If the fork approach fails** (build pipeline broken, GitHub tarball missing dist, etc.), document why and keep the current patch workflow. Don't ship a broken migration.

### Visual Verification Process

After dependency-switcher completes:

1. Run `building-windows.spec.ts` to capture post-migration screenshot
2. Take a native screenshot on Samsung S10e at the same map location (Eindhoven, z16-z18, pitched view with buildings)
3. Spawn a visual verification subagent with vision capabilities to compare:
   - Baseline screenshot (from Phase 1) vs post-migration screenshot
   - Do procedural windows still render at z16/z17/z18?
   - Is per-building color variation preserved?
   - Is soft AO at building bases visible?
   - Are paper mario trees unaffected?
   - Any rendering artifacts (flat gray buildings, missing windows, z-fighting)?
   - Does the native device screenshot show buildings with windows?
4. If the visual agent reports regressions, create specific fix tasks and assign to the appropriate teammate
5. Repeat until the visual agent confirms output matches baseline

Start by reading the plan document, then create the team and orchestrate the work until everything is complete.

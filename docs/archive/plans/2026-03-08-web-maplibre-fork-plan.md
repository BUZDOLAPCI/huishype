# Web MapLibre Shader Fork Plan

**Date:** 2026-03-08
**Status:** Completed
**Owner:** Main agent orchestration

## Goal

Replace the current web-only `pnpm` patch workflow for `maplibre-gl` shader customization with a maintained fork of `maplibre-gl`, while keeping a clean path back to `pnpm` patching if the fork becomes too costly to ship or maintain.

## Current State

- Web imports `maplibre-gl` directly in `apps/app/app/(tabs)/index.web.tsx`.
- The project currently customizes web shaders through `pnpm.patchedDependencies` in the root `package.json`.
- The current patch file is `patches/maplibre-gl@5.16.0.patch`.
- Native Android already uses a different model: a forked `maplibre-native` build consumed via a custom AAR.
- The installed `maplibre-gl` package ships both:
  - editable shader source files under `src/shaders/`
  - generated runtime bundles under `dist/`
- The browser runtime is driven by generated `dist/maplibre-gl.js`, not by raw GLSL files alone.
- The runtime shader payload is embedded as compact inlined JS strings inside the generated bundle, which makes direct bundle patching brittle.

## Problem Statement

The current web patch approach works, but it has several costs:

- Changes often need to touch both source shader files and generated bundle output.
- Patch hunks are fragile across upstream version bumps.
- Repo documentation already shows drift between historical `patch-package` guidance and the current `pnpm` patch setup.
- Re-patching requires cache clearing and Metro/browser refresh steps that are easy to get wrong.
- Repeated shader iteration is harder when the canonical workflow is "patch installed package output" instead of "edit source, rebuild, consume artifact".

## Recommendation

Adopt a forked `maplibre-gl` repository for web shader work if shader iteration is expected to continue.

This is preferable when:

- shader changes are part of the product's visual identity
- upstream upgrades will continue
- multiple rounds of shader tuning are expected
- keeping source and generated artifacts in sync matters

If web shader work becomes mostly stable and the fork proves annoying to ship, the project should retain the ability to fall back to `pnpm` patching later.

## Target End State

- Web depends on a forked `maplibre-gl` package instead of the registry tarball plus local patch.
- Shader changes are made in fork source files under `src/shaders/`.
- Generated outputs in `dist/` are rebuilt inside the fork and committed there.
- HuisHype consumes a pinned Git commit or tarball from the fork.
- The old patch file is removed only after the forked dependency is verified.
- A rollback recipe exists to return to registry `maplibre-gl` plus `pnpm` patching.

## Non-Goals

- Do not change the native Android shader strategy in this work.
- Do not redesign the shader logic itself in this migration.
- Do not upgrade `maplibre-gl` during the same change unless required by the fork setup.

## Migration Plan

### Phase 1: Baseline and Freeze

1. Record the exact current behavior:
   - current `maplibre-gl` version
   - current patch hash in `pnpm-lock.yaml`
   - current visual output of building windows on web
2. Save or confirm an existing visual regression artifact for the web buildings map view.
3. Treat the current patch file as the baseline diff to preserve.

**Exit criteria:**
- Current web build is reproducible.
- Current shader behavior is captured by a screenshot-based check.

### Phase 2: Create the Web Fork

1. Fork `maplibre/maplibre-gl-js` to `BUZDOLAPCI/maplibre-gl-js` on GitHub.
2. Create a `huishype` branch from the exact upstream tag currently in use (`v5.16.0`).
3. Port the current shader customizations into fork source files:
   - `src/shaders/fill_extrusion.vertex.glsl`
   - `src/shaders/fill_extrusion.fragment.glsl`
4. Regenerate intermediate shader modules and dist bundles:
   ```bash
   npm run generate-shaders   # .glsl → src/shaders/*.glsl.g.ts (minified JS string exports)
   npm run build-dist         # .glsl.g.ts → rollup → dist/maplibre-gl*.js (4 bundles)
   ```
   The full `build-dist` pipeline runs: `build-css → generate-unicode-data → generate-typings → generate-shaders → rollup (dev + prod + csp variants)`.
5. Commit the source shader edits, regenerated `.glsl.g.ts` files, and rebuilt `dist/` together.

**Rules:**
- Keep the fork shader-focused.
- Do not mix unrelated fixes into the same branch.
- Preserve a clean diff relative to upstream.

**Exit criteria:**
- Fork contains the same effective shader behavior as the current patch-based setup.
- Source, intermediate `.glsl.g.ts` modules, and `dist/` bundles are internally consistent.

### Phase 3: Consume the Fork in HuisHype

1. Change the `maplibre-gl` dependency in `apps/app/package.json` from the npm registry version to the fork, using the same GitHub URL pattern already used for `maplibre-react-native`:
   ```json
   "maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#<commit-hash>"
   ```
   Pin to the exact commit hash (not a branch name) so pnpm resolves a stable tarball via `codeload.github.com`.
2. Remove the `pnpm.patchedDependencies` entry for `maplibre-gl` from root `package.json`.
3. Remove the old patch file only after install and runtime verification succeed.
4. Run `pnpm install` so the lockfile reflects the new dependency source.

**Note:** `dist/` must be committed in the fork because consumers install via GitHub tarball and do not run a build step. This matches how `maplibre-react-native` ships pre-built `lib/` in its fork.

**Exit criteria:**
- Web builds and runs against the forked package.
- No local patching is required for the same shader behavior.

### Phase 4: Verify and Stabilize

1. Run app verification:
   - `pnpm -C apps/app typecheck`
   - `pnpm -C apps/app test`
2. Run the relevant Playwright visual test(s), especially the building windows test.
3. Compare the new screenshot to the baseline.
4. Confirm no unexpected console errors appear in the web run.

**Exit criteria:**
- Visual output is unchanged or intentionally improved.
- Test suite required by the touched scope passes.

### Phase 5: Document the New Workflow

1. Update `AGENTS.md` to replace the current "Applying web shader changes" section with the fork workflow.
2. Document:
   - Fork location: `BUZDOLAPCI/maplibre-gl-js`, branch `huishype`, local clone at `/home/caslan/dev/git_repos/hh/maplibre-gl-js`
   - Shader edit workflow: edit `.glsl` → `npm run generate-shaders` → `npm run build-dist` → commit → update hash in `apps/app/package.json` → `pnpm install`
   - How to sync upstream: create `tools/sync-maplibre-gl-fork.sh` following the same pattern as the existing `tools/sync-maplibre-fork.sh` (fetch upstream tag, merge, rebuild, push, update hash)
   - Rollback recipe: revert to `"maplibre-gl": "^5.16.0"`, regenerate pnpm patch from fork diff, restore `pnpm.patchedDependencies`
3. Remove the old "Applying web shader changes" pnpm patch instructions from `AGENTS.md`.

**Exit criteria:**
- An agent can update web shaders without rediscovering the workflow.

## Rollback Plan: Return to pnpm Patches

If the web fork becomes difficult to ship, revert to the current patch model with these steps:

1. Point HuisHype back to the registry `maplibre-gl` version.
2. Recreate a patch from the fork's shader-only diff against that exact upstream version.
3. Restore `pnpm.patchedDependencies` in the root `package.json`.
4. Restore the patch file under `patches/`.
5. Run `pnpm install`.
6. Clear patched package caches and restart Metro if needed.
7. Re-run the same visual and unit verification used for the forked setup.

## How To Keep Rollback Easy

- Keep the fork branch limited to shader-related changes.
- Avoid mixing app-specific hacks into the fork if they can live in app code.
- Preserve a clean commit sequence: source shader edits → `npm run generate-shaders && npm run build-dist` → commit all together.
- Do not upgrade upstream and migrate package source in the same commit if avoidable.
- Maintain at least one visual test that proves the intended shader output (`building-windows.spec.ts`).

## Decision Checkpoints

### Checkpoint 1: After Fork Prototype

Is the fork materially easier to iterate on than the current patch workflow? Ship the fork only if yes.

### Checkpoint 2: After First Upstream Sync Attempt

Is syncing upstream into the fork easier than rebasing local patches? If not, the fork may not be buying enough.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Fork adds maintenance overhead | Medium | Keep the fork shader-only and pinned to exact upstream tags |
| Generated `dist` drifts from source | High | Always run `npm run generate-shaders && npm run build-dist` in the fork before committing |
| Upstream sync becomes messy | Medium | Keep commits small and avoid unrelated fork customizations |
| Rollback becomes hard | High | Preserve a clean shader-only diff and documented rebuild steps |
| Docs fall out of date again | Medium | Update `AGENTS.md` in the same change as the dependency switch |
| Large git diffs from `dist/` commits | Low | `dist/` is ~37 MB; each shader change creates large binary-like diffs. Acceptable for a single-dev fork — revisit if repo size becomes a problem |

## Verification Plan

Minimum verification for the migration:

1. `pnpm -C apps/app typecheck`
2. `pnpm -C apps/app test`
3. Run the impacted Playwright visual suite
4. Confirm the web map still renders procedural building windows
5. Confirm no new web console errors appear during the visual run

Recommended extra verification:

1. Capture a before/after screenshot pair of the same map view
2. Sanity-check a production-style web build path if that differs from local dev
3. Verify the dependency can be freshly installed from scratch on a clean checkout

## Suggested Implementation Order

1. Preserve the current patch-based state as baseline.
2. Build the web fork and reproduce the shader behavior there.
3. Switch HuisHype to consume the fork.
4. Verify web rendering and tests.
5. Update project docs.
6. Remove the local patch only after the fork path is confirmed stable.

## Success Criteria

- Web shader work is done in a maintained `maplibre-gl` fork instead of patching installed output.
- Visual output matches the current intended procedural windows behavior.
- The migration is documented.
- The team can revert to `pnpm` patching in one controlled change if the fork becomes too costly.

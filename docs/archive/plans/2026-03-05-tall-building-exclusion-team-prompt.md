# Tall Building Tree Exclusion & Web/Native Unification — Agent Team Prompt

## PROMPT START

You are the lead orchestrator for implementing tall building tree exclusion zones and unifying the web/native tree rendering approach. You MUST NOT do implementation work yourself. Create an agent team and delegate ALL work to teammates. Your only job is: create the team, create tasks, assign work, review results, and iterate until the feature is complete and polished on both web and native.

### Feature Summary

Paper Mario billboard trees currently scatter across green map areas. Tall buildings (>20m) cause depth-culling artifacts on native because MapLibre Native's symbol layer has no depth testing. The fix: create server-side exclusion zones around tall buildings so trees never appear near them, then **remove the custom WebGL depth-tested layer on web** (~500 lines) and unify both platforms to the same server-provided symbol layer. Net result: simpler code, identical rendering on web and native, no depth-culling issues.

### Design Doc & Plan

Read this FIRST before doing anything:
- `docs/plans/2026-03-05-tall-building-tree-exclusion-design.md` — approved design with all decisions, 5 implementation tasks with complete code

### Critical Technical Context

**Verified facts from research (do NOT re-research these):**

1. **PostGIS GIST index bypass**: Casting `geometry::geography` in `ST_DWithin` WHERE clauses bypasses the GIST spatial index, causing ~15s sequential scans on 1.8M rows. This was verified via EXPLAIN ANALYZE on the actual database. Solution: pre-compute `exclusion_geom` via `ST_Buffer` during import and use `ST_Intersects` (GIST-indexed, ~0.3ms).

2. **Pre-computed exclusion zones**: `ST_Buffer` is computed in EPSG:28992 (Amersfoort/RD New — meter-based projection for Netherlands) during import, stored as `exclusion_geom` in EPSG:4326, queried via `ST_Intersects` against the GIST index.

3. **Exclusion formula**: `radius = min(height, 100)` meters. Only buildings >20m. Named constants: `MIN_HEIGHT_THRESHOLD = 20`, `MAX_EXCLUSION_RADIUS = 100`.

4. **OSM height parsing**: Tags are messy (`"12"`, `"12 m"`, `"12m"`, `"~12"`, `"12;15"`). Use `REPLACE(REPLACE(height, 'm', ''), ' ', '')` in SQLite dialect for ogr2ogr extraction, then `REGEXP_REPLACE` in PostgreSQL for robust re-parsing.

5. **DISTINCT ON determinism**: PostgreSQL requires `ORDER BY` matching `DISTINCT ON` columns. The tree tile query needs `ORDER BY c.id`.

6. **BillboardCustomLayer.ts** (446 lines): Custom WebGL layer with depth testing, vertex/fragment shaders, GL state save/restore. TO BE DELETED — no longer needed with exclusion zones.

7. **tree-source-loader hack**: Invisible circle layer (radius 0, opacity 0) needed only because MapLibre custom layers can't trigger tile loading. Eliminated when switching to symbol layer.

8. **Symbol layer unification**: Both web and native support `icon-pitch-alignment: 'viewport'` for billboard effect. Server-side `buildPaperTreesLayer()` in style.json already provides the `paper-trees` symbol layer. Web currently replaces it with the custom WebGL layer — after unification, both platforms just use the server-provided layer as-is.

9. **Existing import pattern**: `services/api/src/scripts/import-landcover.ts` uses `import.meta.dirname`, `@file.sql` syntax, `GEOMETRY(MultiPolygon, 4326)` — all patterns verified working.

10. **Netherlands OSM PBF**: Already in `data_sources/` (or will be downloaded by script). Buildings extracted from `multipolygons` where `building IS NOT NULL`.

11. **Physical test device**: Samsung Galaxy S10e always connected via USB. Build: `npx expo run:android` from `apps/app`. ADB reverse needed: `adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3100 tcp:3100`.

12. **Services**: API at port 3100 (`systemctl --user restart huishype-api`), Metro at port 8081 (`systemctl --user restart huishype-expo`). Docker (postgres/redis) via `docker compose up -d`.

13. **Pre-commit checks**: `pnpm -C apps/app typecheck` + `pnpm -C apps/app test` must pass before commits.

14. **Sprite system**: Individual tree sprites (`tree-0` through `tree-15`) are already merged into the OFM sprite sheet. The raw `tree-atlas.png` endpoint is only used by the custom WebGL layer — becomes dead code after unification.

### Team Structure

1. **import-buildings** — Handles the tall buildings import pipeline
   - Create `services/api/src/scripts/import-tall-buildings.ts` (complete code in plan Task 1)
   - Add `db:seed-tall-buildings` npm script to `services/api/package.json`
   - Run the import, verify data in database (count, height distribution)
   - Commit when verified

2. **tile-exclusion** — Modifies tree tile query to use exclusion zones
   - DEPENDS ON import-buildings completing
   - Add `TALL_BUILDING_MIN_HEIGHT` and `TALL_BUILDING_MAX_RADIUS` documentation constants to `services/api/src/routes/tiles.ts`
   - Modify `green_trees` CTE: add `WHERE NOT EXISTS (SELECT 1 FROM tall_buildings b WHERE ST_Intersects(c.geom, b.exclusion_geom))` + `ORDER BY c.id`
   - Restart API, verify tiles still work
   - Commit when verified

3. **web-unification** — Removes custom WebGL layer, unifies to symbol layer
   - DEPENDS ON tile-exclusion completing
   - Delete `apps/app/src/components/map/BillboardCustomLayer.ts` (446 lines)
   - Delete `apps/app/src/components/map/__tests__/BillboardCustomLayer.test.ts` (55 lines)
   - Remove BillboardCustomLayer import and all tree custom layer code from `apps/app/app/(tabs)/index.web.tsx` (lines ~401-430: removes `paper-trees` layer, adds `tree-source-loader`, creates BillboardCustomLayer)
   - Remove `GET /sprites/tree-atlas.png` endpoint from `services/api/src/routes/tiles.ts` (~12 lines)
   - Remove tree-atlas.png test from `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`
   - Run typecheck + unit tests to verify nothing breaks
   - Commit when verified

4. **integration-tests** — Adds tests for exclusion behavior
   - DEPENDS ON web-unification completing
   - Add integration tests to `services/api/src/__tests__/integration/tree-tiles.integration.test.ts`:
     - Verify `tall_buildings` table exists and tree tile query doesn't error
     - Verify GIST index on `exclusion_geom` exists via `pg_indexes`
   - Run full test suite (`pnpm -C apps/app typecheck && pnpm -C apps/app test && pnpm -C services/api test`)
   - Commit when verified

5. **qa-verifier** — Visual verification and final quality gate
   - DEPENDS ON integration-tests completing
   - Take web screenshots at z15+ over areas with tall buildings near parks (Amsterdam, Rotterdam, The Hague)
   - Take native screenshots on Samsung S10e at same locations
   - Verify: trees appear as billboard sprites, NO trees near tall buildings, no console errors, visual quality matches expectations
   - Run full pre-commit quality gate
   - Report issues for re-iteration if found

Add additional teammates as needed. Each teammate should use subagents to keep their own contexts lean.

### Execution Loop

```
REPEAT:
  1. Create/update tasks based on current state
  2. Assign tasks to teammates (respecting dependency order)
  3. Wait for teammates to complete their tasks
  4. Have qa-verifier run tests and take screenshots
  5. Review qa-verifier findings
  6. IF issues found:
     - Create fix tasks with specific feedback
     - Assign to appropriate teammate
     - GOTO 3
  7. IF all tests green AND visual quality acceptable:
     - Have qa-verifier do final comprehensive check
     - Commit all changes with descriptive messages
     - BREAK
```

### Quality Criteria for "Done"

- [ ] `tall_buildings` table populated with buildings >20m from OSM PBF
- [ ] GIST index on `exclusion_geom` exists and is used by queries
- [ ] Tree tile query excludes candidates within exclusion zones (~0.3ms, not 15s)
- [ ] Trees do NOT appear near tall buildings (visually verified on map)
- [ ] `BillboardCustomLayer.ts` deleted (446 lines of custom WebGL removed)
- [ ] `BillboardCustomLayer.test.ts` deleted
- [ ] `tree-source-loader` invisible circle layer hack removed from `index.web.tsx`
- [ ] BillboardCustomLayer import + instantiation removed from `index.web.tsx`
- [ ] `/sprites/tree-atlas.png` raw endpoint removed (dead code)
- [ ] Web renders trees via server-provided `paper-trees` symbol layer (same as native)
- [ ] Native renders trees identically to web (both symbol layer, billboard effect)
- [ ] Trees still appear in green areas (parks, forests) — exclusion doesn't remove all trees
- [ ] `pnpm -C apps/app typecheck` — zero errors
- [ ] `pnpm -C apps/app test` — all green
- [ ] `pnpm -C services/api test` — all green
- [ ] No console errors during rendering on web or native
- [ ] Deterministic tree tile output (ORDER BY c.id ensures stable DISTINCT ON)

### CRITICAL Rules — Non-Negotiable

1. **DO NOT do implementation work on the lead agent.** Delegate EVERYTHING to teammates or subagents. The lead agent only orchestrates, reviews, and iterates. Prefer using Agent Teams, tasks, and subagents to keep individual contexts focused and lean.

2. **No workarounds, temporary fixes, TODOs, or "future work" items.** Every issue must be addressed with the optimal, root-cause solution. If something is broken or suboptimal, fix it properly. Don't skip work or defer it.

3. **Extend scope as needed.** If an auxiliary or seemingly unrelated system needs improvement to close gaps or make the feature work properly, start and orchestrate that work too. Don't leave loose ends. If you encounter unrelated issues during implementation (broken tests, lint errors, outdated code, missing types), don't ignore them — delegate that work to a teammate and orchestrate its resolution.

4. **Visual verification is mandatory.** After each implementation round, use a visual-capable agent (subagent with vision) to examine screenshots of the map on both web and native. The trees must appear scattered naturally, not near tall buildings, with correct billboard alignment. Don't accept "it compiles and tests pass" as done — it must LOOK right.

5. **Wait for teammates to finish** before proceeding. Don't start implementing yourself.

6. **Keep iterating** until ALL quality criteria are met. Don't declare done prematurely. Loop as many times as needed.

7. **Each teammate should validate their own work** with tests before marking tasks complete.

8. **The import-buildings teammate must finish first** — all other work depends on the `tall_buildings` table existing.

9. **Consult `AGENTS.md`** for project conventions (pre-commit checks, service ports, test requirements, systemd services, device info).

10. **sudo password is `123123`** if needed for system operations.

### Visual Verification Process

After web-unification reports completion:

1. Take a web screenshot at z15 over Amsterdam Zuidas area (tall buildings + parks nearby)
2. Take a native screenshot on Samsung S10e at the same location
3. Spawn a visual verification subagent with vision capabilities to examine BOTH screenshots:
   - Are trees scattered naturally across green areas (parks, forests)?
   - Do trees have correct billboard alignment (standing upright, facing camera)?
   - Are there NO trees near tall buildings (exclusion zones working)?
   - Is tree density reasonable — exclusion zones shouldn't strip ALL trees, just those near highrises?
   - Do web and native look identical (both using symbol layer now)?
   - Any rendering artifacts, missing sprites, or console errors?
4. If the visual agent reports issues, create specific fix tasks with the visual feedback and assign to the appropriate teammate
5. Repeat until the visual agent confirms the result is polished

### Areas to Test

Focus visual verification on these areas (mix of tall buildings + green space):
- **Amsterdam Zuidas** — highrise office district next to Beatrixpark
- **Rotterdam Kop van Zuid** — tall towers near Erasmuspark
- **The Hague** — ministries district near Haagse Bos
- **Eindhoven Strijp** — where existing trees already render (baseline comparison)

Start by reading the design doc/plan, then create the team and orchestrate the work until everything is complete and visually verified.

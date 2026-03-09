# Task: Fix `flat` Interpolation Window Artifacts in Web Shader

## Problem

The procedural window shader for 3D buildings has diagonal window artifacts 
something produces diagonal UV distortion across the triangle.

## What Needs to Change

### Goal
Fix the current implementation or find a solution that:
1. Produces clean rectangular windows on ALL wall faces (no diamond/diagonal artifacts)
2. Keeps the current window parameters (spacing 600, thick mullions 0.2/0.8, floor bands 0.18/0.78, etc.)
3. Maintains visually consistent window tiling across wall faces

### CRITICAL CONSTRAINT: Windows must NOT wrap around corners

Windows must be **per-wall-face**, not continuous across building corners. The `flat` interpolation (`v_ed_flat`) exists to anchor each wall face's window pattern independently — without it, windows tile continuously across all faces and wrap around corners, which looks wrong.

**DO NOT simply remove `flat` interpolation** — that was tried and rejected because it causes windows to wrap around building corners. The fix must preserve per-wall-face window isolation while also eliminating the diagonal triangle-seam artifacts.

The solution must find a way to get a consistent per-wall anchor.

### Shader Files to Edit

Both files are in the MapLibre GL JS fork at `/home/caslan/dev/git_repos/hh/maplibre-gl-js`:

1. **Vertex shader**: `src/shaders/fill_extrusion.vertex.glsl`
2. **Fragment shader**: `src/shaders/fill_extrusion.fragment.glsl`

## Build & Deploy Workflow

After editing the `.glsl` files:

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-gl-js

# 1. Generate JS from GLSL
npm run generate-shaders

# 2. Build dist
npm run build-dist

# 3. Commit & push
git add -A
git commit -m "fix: remove flat interpolation to fix diamond window artifacts"
git push origin huishype

# 4. Get new hash
NEW_HASH=$(git rev-parse HEAD)

# 5. Update hash in huishype app
# Edit apps/app/package.json: "maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#${NEW_HASH}"

# 6. Install & restart
cd /home/caslan/dev/git_repos/hh/huishype
pnpm install
rm -rf /tmp/metro-* /tmp/haste-map-*
systemctl --user restart huishype-expo
```

## How to Test

### Visual verification (primary)

1. The debug camera is already configured in `apps/app/src/lib/mapDefaults.ts`:
   - `DEBUG_CAMERA = __DEV__ && true`
   - Center: `[5.4469, 51.4495]`, Zoom: `19.9`, Pitch: `50`
2. Open the web app at `http://localhost:8081` (after Metro restart)
3. Hard-refresh with Ctrl+Shift+R
4. Check visuals

### Pre-commit checks

```bash
pnpm -C apps/app typecheck
pnpm -C apps/app test
```

## DO NOT Change

- Window parameters: spacing 600, mullions 0.01/0.99, floor bands 0.18/0.78, blend 0.88
- Window color: (0.55, 0.78, 0.90)
- Glare: 0.20 + hash × 0.08
- AO: smoothstep(0.0, 0.10) min 0.86
- Min height threshold: 3.1m
- Floor height: 3.0m
- Min luminance: 0.60
- Any other existing window shader parameters

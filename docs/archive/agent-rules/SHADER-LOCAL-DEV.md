# Shader Local Dev

Historical note for the old local shader workflow.

## Web Fork

- Local fork: `/home/caslan/dev/git_repos/hh/maplibre-gl-js`
- Branch: `huishype`
- Source files: `src/shaders/fill_extrusion.vertex.glsl`,
  `src/shaders/fill_extrusion.fragment.glsl`

## Legacy Local Iteration Loop

1. Edit the GLSL source in the web fork.
2. Run `npm run generate-shaders` and `npm run build-dist`.
3. Refresh the browser client dependency to the local fork.
4. Restart the old web dev server used at the time.

This file exists as a historical record only.

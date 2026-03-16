# Shader Local Dev 

### Web fork (`/home/caslan/dev/git_repos/hh/maplibre-gl-js`, branch `huishype`)

- `src/shaders/fill_extrusion.vertex.glsl`, `src/shaders/fill_extrusion.fragment.glsl`, plus generated `dist/`

##  `apps/app/package.json` State for local testing

```json
"maplibre-gl": "file:../../../maplibre-gl-js",
```

Using `file:` protocol pointing to the local fork so we can test without pushing. This **copies** the dist into node_modules on `pnpm install`.

**Workflow to iterate on shaders locally:**
1. Edit `.glsl` in `/home/caslan/dev/git_repos/hh/maplibre-gl-js/src/shaders/`
2. `cd /home/caslan/dev/git_repos/hh/maplibre-gl-js && npm run generate-shaders && npm run build-dist`
3. `cd /home/caslan/dev/git_repos/hh/huishype && pnpm install`
4. `rm -rf /tmp/metro-* /tmp/haste-map-* && systemctl --user restart huishype-expo`
5. Hard-refresh browser (Ctrl+Shift+R)

## TODO When Verified Working

3. Switch `apps/app/package.json` back to GitHub hash: `"maplibre-gl": "github:BUZDOLAPCI/maplibre-gl-js#xxxxxxxxx"`
4. `pnpm install` to update lockfile
# Agent Tooling & Scripts (`tools/`)

The `tools/` directory is the agent-owned workspace for project-specific
automation and helper scripts. This is the place to fix, expand, or replace
tooling when the repo needs it.

## Active Tools

**asset-gen**

- Location: `tools/asset-gen/`
- Purpose: generate assets with external AI APIs

**sync-maplibre-fork.sh**

- Location: `tools/sync-maplibre-fork.sh`
- Purpose: sync the web `maplibre-gl-js` fork with upstream, rebuild `dist/`,
  and refresh the browser client dependency reference
- Usage: `./tools/sync-maplibre-fork.sh`

## Operating Rules

- Prefer fixing tooling in `tools/` rather than working around broken scripts
  elsewhere.
- Keep helper scripts aligned with the web-first active workflow.
- If a tool starts advertising legacy native bootstrap as the current path, move
  that guidance into the native handoff docs instead.

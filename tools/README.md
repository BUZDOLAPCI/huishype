## Agent Tooling & Scripts (`tools/`)

### Purpose
The `tools/` directory contains project-specific automation, MCP servers, and utility scripts designed to assist agents and developers. **This directory is explicitly designated as an agent-managed workspace.** Unlike core application code which requires strict adherence to the architecture, the `tools/` folder is a sandbox for the agent to build and maintain its own utilities.

### Agent Permissions & Workflow
* **Write Access:** Agents are explicitly authorized and encouraged to **modify, fix, or rewrite** code in this directory if a tool fails, needs new capabilities, or if an API changes.
* **Self-Correction:** If an MCP server (e.g., `asset-gen`) throws an error (e.g., "Invalid API Key" or "Rate Limit"), the agent can inspect and edit the source code in `tools/` directly to resolve it.
* **Expansion:** Agents may create new scripts here to automate repetitive tasks (e.g., `seed-data.ts`, `verify-deployment.ts`, `generate-embeddings.ts`) without asking for explicit permission.

### Directory Structure
```text
huishype/
├── tools/
│   ├── asset-gen/                  # Local MCP server for 3D/Image generation
│   ├── dev-android.sh              # Full Android dev environment bootstrap
│   ├── sync-maplibre-fork.sh       # Sync MapLibre RN fork with upstream beta
│   └── <other-tools-you-can-create-as-needed>/
```

### Active Tools

**1. asset-gen (Local MCP Server)**
Location: `tools/asset-gen/`
Goal: Generates assets (GLB models, textures) using external AI APIs (e.g., Replicate/Meshy/Flux).

**2. dev-android.sh**
Location: `tools/dev-android.sh`
Goal: Idempotent bootstrap of the full Android dev environment (Docker, API, Metro).

**3. sync-maplibre-fork.sh**
Location: `tools/sync-maplibre-fork.sh`
Goal: Sync our MapLibre React Native fork (`BUZDOLAPCI/maplibre-react-native`, branch `huishype`) with upstream `beta`. Fetches, merges, rebuilds `lib/`, pushes, and updates `package.json`.
Usage: `./tools/sync-maplibre-fork.sh`

Agent Responsibility: The agent owns the tools/ implementations. If a specific tool yields poor results, the agent should tweak/fix/improve/build the tool itself.
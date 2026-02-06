# HuisHype - Agent-Built Project

This project is built entirely by Claude agents with minimal human intervention. The main agent orchestrates work by spawning specialized subagents to keep context lean and efficient.

sudo password for the machine is "123123" if you need it

## Design Decisions

All design decisions and specifications are in `agent-rules/`. **Consult these before making decisions.**

| File | Purpose |
|------|---------|
| `main-spec.md` | Product specification, features, UX, data flow |
| `software-stack.md` | Technical stack decisions and architecture |
| `test-requirements.md` | Testing strategy and verification requirements |

These documents are the source of truth. Pass these information down to all subagents so they have a vision of the big picture.

## MapLibre React Native

Uses `@maplibre/maplibre-react-native` v11 alpha with **React Native New Architecture** (Fabric + TurboModules) enabled. The v11 alpha line is actively migrating components to Fabric native components. Key implications:

- Layers are Fabric native components (as of alpha.40+)
- Map commands (queryRenderedFeatures, etc.) use TurboModules (JSI-based, not old bridge)
- Component renames in alpha.44+: `MapView` → `Map`, `ShapeSource` → `GeoJSONSource`, `sourceID` → `source` etc.

## Data Sources

There is a `data_sources/` folder containing the locally available data like the The full 7GB BAG Geopackage from (https://service.pdok.nl/lv/bag/atom/bag.xml) already downloaded.

Refer to the `data_sources/data-sources.md` for more information

## Database Seeding

The seed script populates the PostgreSQL database with property data from the BAG GeoPackage.

### Quick Start (Development)

```bash
cd services/api && pnpm run db:seed
```

By default, seeds **Eindhoven area only** (~140K properties with addresses, ~2 min) for faster development cycles.

**Note:** Only pands with real addresses are seeded. Utility buildings, garages, sheds (~42% of BAG) are skipped.

### Seeding Options

| Mode | Command | Properties with Addresses | Time |
|------|---------|---------------------------|------|
| **Eindhoven (default)** | `pnpm run db:seed` | ~140K | ~2 min |
| **Full Netherlands** | `pnpm run db:seed -- --full` | ~6.5M | ~45 min |

**Additional flags:**
- `--limit N` - Limit to N pands scanned (for testing)
- `--offset N` - Start from offset N
- `--skip-demolished` - Skip properties with demolished status
- `--skip-extract` - Skip ogr2ogr extraction (reuse existing temp database)
- `--dry-run` - Don't insert into database

### When to Use Each Mode

**Eindhoven area (default):**
- Day-to-day development and testing
- Quick iteration on features
- CI/CD pipelines
- Testing data display and interactions

**Full Netherlands (`--full`):**
- Production deployment preparation
- Performance testing at scale
- Testing country-wide features
- Final verification before release

## Permissions

| Scope | Permission |
|-------|------------|
| `agent-rules/*.md` | READ-ONLY - Design decisions are frozen |
| `tools/` | FULL ACCESS - Agents are encouraged to improve/fix/expand tooling if needed |
| `.claude/settings.json` | EDITABLE - Project hooks and config |
| `~/.claude/settings.json` | EDITABLE - User-level Claude configuration |
| Everything else | EDITABLE |

## Main Agent: Orchestration Only

The main agent should NOT perform implementation work directly. Instead:

1. **Analyze** the user's request
2. **Consult** relevant specs in `agent-rules/`
3. **Decompose** into discrete tasks
4. **Spawn subagents** using the Task tool for each piece of work
5. **Synthesize** results, verify the criteria are met with the work, if not restart from step 1 and repeat these steps until work is succesfully done, and report back.


### Subagent Types

| Type | Use For |
|------|---------|
| `Explore` | Codebase search, file discovery, understanding code |
| `Plan` | Designing implementation approach before coding |
| `general-purpose` | Complex multi-step tasks requiring both exploration and modification |
| `Bash` | Terminal operations, git, npm, docker commands |

### Task Management

For complex multi-step work, use task tools: `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`

### Parallel Execution

Launch multiple independent subagents in a single message for maximum efficiency.

## Verification

Before marking ANY task complete, run tests per `agent-rules/test-requirements.md`. Follow "All tests green" development. 

## Agent-Managed Tooling

The `tools/` directory is the agent workspace. See `tools/README.md` for current tools and guidance on creating new ones. Agents are encouraged to:
- Fix broken tools
- Improve existing tools
- Create new tools as needed

## Hooks

Agents may configure Claude Code hooks in `.claude/settings.json`. Notice hook changes don't take effect until the session restarts. If hooks are modified, inform the user they need to restart the session.

## Context Management

- Main agent stays lean by delegating ALL works, aside from orchestration
- Create subagents for tasks
    - Subagents are required to validate their own works by either unit tests or e2e tests. A task is NOT done until all tests are green
    - Keep spawning new sub-agents with the updated information until the work is complete

## Reference Expectations Workflow

The `reference-expectations/` folder contains desired visual/functional outcomes. Each subfolder has:
- `expectation.md` - Description of what is expected
- Reference image(s) - Visual examples to match

### Trigger Commands

| Command | Action |
|---------|--------|
| "Work on all reference expectations" | Process all folders in `reference-expectations/` |
| "Work on reference expectations X and Y" | Process specific named expectations |
| "Work on reference expectation map-visuals-close-up" | Process single expectation |

### Discovery

When "Work on all reference expectations" is triggered:
1. Scan `reference-expectations/*/expectation.md` to find all expectations
2. Create a task for each discovered expectation
3. Process each in parallel or sequentially based on dependencies

New expectations added to the folder will be automatically discovered.

### Workflow Steps

When triggered, execute this loop for EACH expectation:

#### Step 1: Analyze (Analyzer Subagent)
Spawn a `general-purpose` subagent to:
- Read `reference-expectations/{name}/expectation.md`
- Examine reference image(s) using vision capabilities
- **First iteration**: Explore codebase to understand what's currently implemented (no screenshot exists yet)
- **Subsequent iterations**: Also review the screenshot from previous Fixer run at `test-results/reference-expectations/{name}/`
- Identify current app state vs desired state
- Document specific gaps and requirements
- Output: Analysis report with actionable items

#### Step 2: Implement (Fixer Subagent)
Spawn a `general-purpose` subagent to:
- Receive analysis from Step 1
- Implement changes to achieve the expectation
- **REQUIRED**: Create/update e2e test in `apps/app/e2e/visual/` that:
  - Navigates to the relevant state in the app
  - Collects browser console logs during test execution
  - **FAILS if any console errors are detected** (warnings acceptable)
  - Takes a screenshot saved to `test-results/reference-expectations/{name}/`
  - Uses descriptive naming: `{name}-current.png`
- Run the e2e test to generate the screenshot
- **MUST PASS**: Zero console errors during test execution
- Output: Implementation summary + screenshot path + console health status

#### Step 3: Verify (Visual Tester Subagent)
Spawn a `general-purpose` subagent with vision to:
- Read the original `expectation.md` and reference image
- Read the screenshot from Step 2
- Verify console health status from Step 2 (any errors = automatic NEEDS_WORK)
- Compare current screenshot against reference expectation
- Evaluate on criteria from expectation.md
- Output verdict: `SUFFICIENT` or `NEEDS_WORK` with specific feedback

#### Step 4: Loop or Complete
- If `NEEDS_WORK`: Return to Step 1 with feedback, repeat until sufficient
- If `SUFFICIENT`: Proceed to Step 5

#### Step 5: Full Test Suite (ALL TESTS GREEN)
Before marking any expectation complete:
1. Run the complete test suite: `pnpm test` (unit + integration + e2e)
2. **ALL tests must pass** - no regressions allowed
3. If tests fail:
   - Determine if failure is in new code or existing tests
   - Fix the issue (either adjust new implementation or fix broken tests)
   - Return to Step 2 to re-run and re-verify
4. Only when ALL tests are green: Mark task complete, move to next expectation

### Task Tracking

Use TaskCreate/TaskUpdate for each expectation:
```
Task: "Reference Expectation: {name}"
Status: pending → in_progress → completed
```

### Subagent Prompts

**Analyzer Prompt Template:**
```
Analyze reference expectation '{name}'.

Read: reference-expectations/{name}/expectation.md
View: reference-expectations/{name}/*.{jpeg,png,jpg}

First iteration (no screenshot yet):
- Explore codebase to understand current implementation
- Check what features/visuals are implemented vs missing

Subsequent iterations (screenshot exists):
- Also view: test-results/reference-expectations/{name}/{name}-current.png
- Compare current screenshot against reference
- Use feedback from previous Visual Tester

Output a detailed analysis of what needs to change to match the expectation.
```

**Fixer Prompt Template:**
```
Implement reference expectation '{name}'.

Analysis: {analysis_from_step_1}

Requirements:
1. Make code changes to achieve the expectation
2. Create e2e test at apps/app/e2e/visual/reference-{name}.spec.ts
3. Test MUST:
   - Collect browser console logs
   - FAIL if any console errors detected
   - Take screenshot to test-results/reference-expectations/{name}/
4. Run the test to generate screenshot
5. Verify ZERO console errors during execution
6. Report: changes made, screenshot location, console health status
```

**Visual Tester Prompt Template:**
```
Verify reference expectation '{name}'.

Compare:
- Reference: reference-expectations/{name}/*.{jpeg,png,jpg}
- Expectation: reference-expectations/{name}/expectation.md
- Current: test-results/reference-expectations/{name}/{name}-current.png
- Console health: {console_status_from_step_2}

Criteria for SUFFICIENT:
1. Visual match: Current screenshot matches reference expectation
2. Console health: ZERO errors during test execution
3. Both criteria must pass

Output:
- VERDICT: SUFFICIENT or NEEDS_WORK
- VISUAL_MATCH: Yes/No with details
- CONSOLE_HEALTH: Pass/Fail
- REASONING: Why this verdict
- FEEDBACK: If NEEDS_WORK, specific changes required

Note: If SUFFICIENT, main agent will run full test suite before marking complete.
```

### Directory Structure

```
reference-expectations/
├── expectations-workflow.md       # General instructions
├── map-visuals-close-up/
│   ├── expectation.md             # What we want
│   └── close-up-map-visuals.jpeg  # Reference image
├── map-visuals-zoomed-out/
│   ├── expectation.md
│   └── map-visuals-zoomed-out.jpeg
└── swipeable-clustered-nodes/
    ├── expectation.md
    └── funda-paged-group-previews.jpeg

test-results/reference-expectations/  # Generated by e2e tests
├── map-visuals-close-up/
│   └── map-visuals-close-up-current.png
└── ...
```


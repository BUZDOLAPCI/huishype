# Agentic Manual Testing Bridge (MCP)

This project uses MCP servers to add exploratory/manual-like verification on top of scripted tests.

## Configured MCP servers

Defined in `.mcp.json`:

- `playwright-manual`
  - `@playwright/mcp`
  - Chrome + vision/devtools caps
  - For interactive web exploration, UI checks, screenshot-based validation

- `android-manual`
  - `mcp-android-emulator`
  - Uses `ADB_PATH=/home/caslan/Android/sdk/platform-tools/adb`
  - For emulator-driven interactive checks (tap/swipe/text/ui tree/screenshots)

## How to use in sprints

1. Claude worker completes implementation + normal test suite.
2. Run MCP exploratory pass:
   - web flow walkthroughs via `playwright-manual`
   - native flow walkthroughs via `android-manual`
3. If MCP exploratory checks find issues, open corrective sub-task and rerun verification.
4. Task is done only when scripted tests + MCP exploratory checks pass.

## Notes

- Keep Maestro/Playwright scripted suites as deterministic regression backbone.
- Use MCP layer for realistic interaction checks and polish validation.

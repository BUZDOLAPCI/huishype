# Agentic Manual Testing Bridge (MCP)

This project uses MCP servers to add exploratory verification on top of the
scripted web test suite.

## Configured MCP Servers

Defined in `.mcp.json`:

- `playwright-manual`
  - `@playwright/mcp`
  - Chrome + vision/devtools caps
  - For interactive web exploration, UI checks, and screenshot-based
    validation

## How To Use

1. Complete the implementation and normal scripted tests.
2. Run an MCP exploratory pass on the browser client.
3. Inspect screenshots and logs if the pass finds issues.
4. Open corrective work if the manual pass exposes regressions.

## Notes

- Keep Playwright scripted suites as the deterministic regression backbone.
- Use MCP only for realistic interaction checks and polish validation on the
  web surface.
- Any future native exploratory workflow belongs in the native handoff docs,
  not in this active policy file.

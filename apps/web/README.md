# HuisHype Browser Workflow

This is the browser client workflow doc. The active product surface lives
here, and native handoff notes are isolated in:

- `apps/android/README.md`
- `apps/ios/README.md`

## Day-To-Day Commands

```bash
pnpm -C apps/web dev
pnpm test:e2e:web
pnpm test:e2e:flows
pnpm test:e2e:visual
```

- `pnpm -C apps/web dev` starts the browser dev server on port `8081`.
- `systemctl --user restart huishype-web` restores the always-on local browser
  dev server on port `8081` for this machine.
- Use the root Playwright wrappers for flows, integration, and visual checks.

## Browser Workflow Notes

- Keep browser-only implementation notes here.
- Do not add native regeneration instructions here.
- Do not use this file for legacy setup guidance.
- If browser behavior changes, update the web tests and the web workflow docs
  together.

## Current Model

- The browser client is the active product surface.
- Shared backend and shared packages remain the stable contract boundary.
- Native build and signing notes belong only in the future-native handoff
  readmes.

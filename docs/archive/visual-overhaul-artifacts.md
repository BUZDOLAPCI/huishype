# Visual Overhaul Artifact Workflow

The sprint acceptance contract for each surface is:

- `test-results/visual-overhaul/<surface>/web/*.png`
- `test-results/visual-overhaul/<surface>/android/*.png`
- `test-results/visual-overhaul/<surface>/notes.md`

## Web captures

Use `apps/app/e2e/visual/helpers/screenshot-harness.ts`.

Key helpers:

- `captureScreenshot(page, surface, viewport, name, { note })`
- `captureDualViewport(page, surface, name, { note })`
- `appendSurfaceNote(surface, { platform, note, files })`

Behavior:

- creates `web/` and `android/` directories for the surface
- writes screenshots into the correct platform directory
- appends a timestamped entry to the surface-root `notes.md`

## Android captures

Maestro and ad-hoc ADB screenshots often land in legacy folders such as `maestro-screenshots/`.
Import them into the canonical surface package with:

```bash
pnpm visual-overhaul:package \
  --surface auth-modal \
  --platform android \
  --source maestro-screenshots/auth-modal.png \
  --name auth-modal.png \
  --note "Pixel 5 portrait capture after auth gate"
```

You can also record a note without copying a file:

```bash
pnpm visual-overhaul:package \
  --surface map-screen \
  --platform android \
  --note "Landscape verification performed manually on Samsung S10e"
```

## Notes conventions

`notes.md` lives at the surface root, not inside `web/` or `android/`.

Recommended note content:

- device or viewport used
- route or state captured
- any setup detail required to reproduce
- reviewer verdict or follow-up status

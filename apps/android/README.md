# HuisHype Android Handoff

This file is the future-native handoff contract for Android. It is not the
current active app workflow.

## Platform Contract

- Target runtime: Kotlin-native Android app
- Package name: `nl.huishype.app`
- Google OAuth client ID: `91432986388-pog1p4mihnkeo4vrseucp69q35k9mi6d.apps.googleusercontent.com`
- Debug keystore SHA-1 is already registered with Google Cloud

## Map Contract

- Android will use the shared `maplibre-native` fork directly.
- Local fork path: `/home/caslan/dev/git_repos/hh/maplibre-native`
- Native version override: `12.2.3-huishype`
- Gradle must keep the local Maven publication path for the forked AAR

## Current Handoff Notes

- Preserve the package name, OAuth identifier, and map-engine contract when
  the Android app is built.
- Keep the future native app aligned with the shared backend and shared
  product contracts, not with browser-only implementation details.
- Release signing for the production Android app is still a future-native
  task.

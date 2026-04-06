# HuisHype App Workflow

This app ships from Expo config plus regenerated native projects. Treat `apps/app/app.json` as the source of truth for Expo config, and treat `apps/app/android/` and `apps/app/ios/` as generated, gitignored output with a small set of required local override points.

## Day-To-Day Commands

```bash
pnpm -C apps/app web
pnpm -C apps/app android
pnpm -C apps/app ios
```

- `pnpm -C apps/app web` starts the Expo web server on port `8081`.
- `pnpm -C apps/app android` builds and runs the generated Android app.
- `pnpm -C apps/app ios` builds and runs the generated iOS app.

## When To Regenerate Native Projects

Run a clean prebuild when:

- `apps/app/android/` or `apps/app/ios/` do not exist locally.
- You changed `apps/app/app.json`.
- You changed Expo plugins or native dependency wiring.
- The generated projects drifted into a bad state and you want to rebuild them from Expo config.

Command:

```bash
pnpm -C apps/app exec expo prebuild --clean
```

Prebuild regenerates the native folders from `app.json`, but it does not eliminate the repo's current manual override points. Re-check the items below before running Android or iOS again.

## Required Post-Prebuild Override Points

### Android: local MapLibre native AAR wiring

The generated [`android/build.gradle`](/home/caslan/dev/git_repos/hh/huishype/apps/app/android/build.gradle) must keep both of these customizations:

- `mavenLocal()` inside `allprojects.repositories`
- `ext.set("org.maplibre.reactnative.nativeVersion", "12.2.3-huishype")`

Those lines make Gradle resolve the locally published MapLibre Native fork instead of the stock `12.2.3` artifact from the npm package.

If you rebuild the fork, publish it again before running Android:

```bash
cd /home/caslan/dev/git_repos/hh/maplibre-native/platform/android
BUILDTYPE=Release ./gradlew :MapLibreAndroid:assembleOpenglRelease
BUILDTYPE=Release ./gradlew :MapLibreAndroid:publishOpenglReleasePublicationToMavenLocal
```

The AAR is expected in `~/.m2/repository/org/maplibre/gl/android-sdk-opengl/12.2.3-huishype/`.

### iOS: URL-scheme wiring

The generated [`ios/HuisHype/Info.plist`](/home/caslan/dev/git_repos/hh/huishype/apps/app/ios/HuisHype/Info.plist) must keep the `CFBundleURLTypes` entries for:

- `huishype`
- `nl.huishype.app`
- `exp+huishype`
- `com.googleusercontent.apps.91432986388-20pkftruoukoepl6mhsgr5egeeraivh9`

These schemes cover the app scheme, Expo dev client scheme, and the reversed Google iOS client ID used for OAuth callbacks. Re-check them after every clean prebuild.

### Gitignored credentials and local files

Keep gitignored native credentials in the generated target locations after regeneration:

- [`ios/HuisHype/GoogleService-Info.plist`](/home/caslan/dev/git_repos/hh/huishype/apps/app/ios/HuisHype/GoogleService-Info.plist) for the iOS Google config

If a clean prebuild removes that file, restore it before opening the iOS project or running `pnpm -C apps/app ios`.

## Regeneration Checklist

After `expo prebuild --clean`, verify:

1. [`app.json`](/home/caslan/dev/git_repos/hh/huishype/apps/app/app.json) still reflects the intended Expo config.
2. [`android/build.gradle`](/home/caslan/dev/git_repos/hh/huishype/apps/app/android/build.gradle) still contains `mavenLocal()` and the `12.2.3-huishype` override.
3. [`ios/HuisHype/Info.plist`](/home/caslan/dev/git_repos/hh/huishype/apps/app/ios/HuisHype/Info.plist) still contains the expected URL schemes.
4. [`ios/HuisHype/GoogleService-Info.plist`](/home/caslan/dev/git_repos/hh/huishype/apps/app/ios/HuisHype/GoogleService-Info.plist) exists locally.
5. Then run `pnpm -C apps/app android` or `pnpm -C apps/app ios`.

## Current Model

The generated native folders are not self-maintaining yet. The current repo truth is:

- Expo config lives in `app.json`.
- Native projects are regenerated output.
- A small number of Android/iOS override points still need to survive regeneration.

Until that wiring moves elsewhere, this file is the canonical workflow doc for native reproducibility in this repo.

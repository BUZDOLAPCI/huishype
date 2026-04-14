# HuisHype iOS Handoff

This file is the future-native handoff contract for iOS. It is not the current
active app workflow.

## Platform Contract

- Target runtime: Swift-native iOS app
- Bundle ID: `nl.huishype.app`
- Google OAuth client ID: `91432986388-20pkftruoukoepl6mhsgr5egeeraivh9.apps.googleusercontent.com`
- Native URL schemes that must be preserved:
  - `huishype`
  - `nl.huishype.app`
  - `com.googleusercontent.apps.91432986388-20pkftruoukoepl6mhsgr5egeeraivh9`

## Credential Contract

- `ios/HuisHype/GoogleService-Info.plist` is the gitignored local credential
  file for the iOS target.
- The future iOS app must preserve the current Google callback contract and
  the shared auth/session model used by the web product. Do not carry over any
  Expo callback scheme.

## Current Handoff Notes

- Preserve the bundle ID, callback schemes, and Google credential wiring when
  the iOS app is built.
- Keep the future native app aligned with the shared backend and shared
  product contracts, not with browser-only implementation details.
- Apple Sign-In remains a future-native task and is not part of the active web
  workflow.

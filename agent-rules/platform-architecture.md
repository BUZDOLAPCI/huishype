# platform-architecture.md — Web-first separate-app architecture

## Status

Locked direction.

This document defines the long-term frontend architecture and the current
delivery order for HuisHype.

## Story

HuisHype started with a cross-platform premise: one frontend codebase should
ship web, Android, and iOS from the beginning.

That was useful as an initial speed bet, but it is no longer the right
long-term architecture.

In practice:

- web is closest to the intended quality bar
- Android already trails in polish and platform-specific behavior
- the hardest parts of the product are map rendering, gestures, panels,
  animation, performance, and interaction feel
- those are exactly the areas that diverge first across web, Android, and iOS

The result is that the shared frontend runtime is no longer reducing enough
complexity to justify its constraints.

## Decision

HuisHype will move to a one-product, three-client architecture:

- `apps/web`
- `apps/android`
- `apps/ios`

The web app will be developed to completion first.

Android and iOS will be built after web reaches the intended quality bar, using
Kotlin and Swift respectively.

We are intentionally not preserving a shared cross-platform UI runtime as the
target state.

## Immediate Operating Mode

Current frontend work should optimize for finishing the web product, not for
maintaining cross-platform parity.

That means:

- strip unnecessary cross-platform overhead from the web path
- stop treating Android and iOS parity as a blocker for core web iteration
- use the web app as the canonical product-definition surface
- formalize portable contracts so native ports can be built against a stable
  product model later

The web app is not a disposable prototype. It is the first complete product
implementation.

## Architecture Principle

HuisHype should have one product, not one frontend codebase.

Shared:

- backend platform
- data model
- API contract
- analytics event schema
- design language and tokens
- map data and tile pipeline

Platform-owned:

- rendering layer
- navigation
- gestures and transitions
- map interaction implementation
- performance tuning
- release tooling and native integrations

## Map Engine Strategy

Map rendering remains strategic product IP.

The target map-engine shape is:

- web uses the custom `maplibre-gl-js` fork
- Android and iOS use the same `maplibre-native` fork directly
- the React Native MapLibre wrapper is retired from the long-term architecture

One shared `maplibre-native` fork is the preferred native strategy. Core
rendering changes should live once in that fork, while packaging and platform
integration stay native-platform concerns.

## Source Of Truth

After the split:

- product behavior is defined by specs and the web implementation
- API behavior is defined by backend code and OpenAPI
- data behavior is defined by database schema and backend business logic
- visual language is defined by design references and tokens
- Android behavior is owned by the Android app
- iOS behavior is owned by the iOS app

The old assumption that one shared frontend runtime is the source of truth for
all platforms is retired.

## Delivery Sequence

### Phase 1: Web Completion

- finish the web app to the intended quality bar
- simplify the web stack by removing cross-platform overhead where possible
- clarify product behavior, flows, and visual standards on web

### Phase 2: Contract Extraction

- formalize API boundaries and generated clients
- isolate portable business rules and event schemas
- define portable design tokens and shared product contracts

### Phase 3: Android Native Build

- build Android as a Kotlin-native app against the shared contracts
- integrate directly with the shared `maplibre-native` fork

### Phase 4: iOS Native Build

- build iOS as a Swift-native app against the same shared contracts
- integrate directly with the shared `maplibre-native` fork

### Phase 5: Legacy Frontend Decommissioning

- retire the old shared frontend once replacements are viable
- remove the React Native MapLibre wrapper from the long-term architecture
- migrate any remaining useful assets or logic out of legacy compatibility locations

## Guardrails

- Do not fork the product model by platform.
- Do not duplicate backend business logic into incompatible client versions.
- Do not preserve shared UI code purely for ideological reasons.
- Do not let native adaptation become uncontrolled product divergence.
- Do not keep web burdened by abstractions whose main purpose is legacy
  cross-platform compatibility.

## Conclusion

HuisHype is now a web-first product with planned native ports, not a
cross-platform frontend codebase.

Web is the primary execution surface. Android and iOS will follow as native
implementations of the same product, built against shared contracts and a
shared backend foundation.

# URL UX Overhaul V2

## Summary

Keep the canonical address URL contract from the original overhaul, but simplify the web runtime model so URL updates are **descriptive**, not **authoritative**, during active map browsing.

This plan is intended to be executed on a **fresh branch from `main`**, not by continuing to patch the current `dev/url-overhaul` branch. The current branch contains too much web runtime architecture that V2 explicitly intends to remove. V2 should selectively transplant the durable canonical URL contract from that branch instead of treating its router/runtime model as the starting point.

The core correction is architectural:

- **Canonical URLs remain the single source of truth for shareable links and direct entry.**
- **The running web map must not navigate through Expo Router just because camera or preview state changed.**
- **Passive map-state URL updates on web should use the browser History API, not `router.replace()`.**
- **Expo Router should continue owning real page transitions** such as property pages, comments, guesses, auth, tabs, and other non-map routes.

This matches the original user intent more closely: “update the user-facing URL like Google Maps,” without making the running app constantly re-resolve and remount state while the user is already in the map.

---

## Why V1 Regressed

The previous implementation mixed two separate concerns:

1. **Canonical URL contract**
2. **Live web app state ownership**

The canonical contract itself is sound:

- canonical address slugs
- camera path serialization
- `/map/{address}` preview URLs
- explicit `returnTo` behavior
- country-aware path rules

The regressions came from the second part:

- the web map became a **route owner**
- passive map changes started calling `router.replace()`
- preview open/close started acting like route transitions
- canonicalization ran in multiple places
- web route resolution introduced loading states into normal interaction loops

That created visible fallout:

- preview card taps becoming fragile
- bottom-sheet behavior drifting and needing patch fixes
- map flashing/loading when preview state changed
- overlay and z-index workarounds around tab bar, preview portals, and sheet chrome

The problem was not “shareable URLs are hard.” The problem was coupling shareable URLs to live navigation too aggressively.

---

## Product Contract

### What the URL must do

- A copied URL should restore the same meaningful user-visible state.
- Direct loads of canonical property/map routes should work.
- Browser refresh on a canonical map URL should restore that map state.
- Browser back/forward should restore prior canonical states when possible.

### What the URL must not do

- Panning the map must not behave like navigating to a new screen.
- Opening a preview card must not force a route-resolution loading loop.
- Closing a preview card must not re-enter the app through a route wrapper.
- Passive map URL updates must not remount, replace, or otherwise disturb the current map session.

### User-facing behavior

- `/@lat,lng,zoomz` represents passive camera state with no preview open.
- `/map/{address}` represents a selected map preview state.
- `/{address}` represents the property detail page.
- `/{address}/comments` and `/{address}/guesses` remain canonical detail subroutes.
- Sharing any of those routes should restore the intended state on a fresh load.
- While already inside the running web map, changing from camera state to preview state and back should feel like **state change**, not **screen navigation**.

---

## V2 Principles

### 1. Separate entry-state hydration from runtime sync

There are two different problems:

- **Hydration:** user lands on `/@...` or `/map/...` or `/{address}` and app needs to start in that state
- **Runtime sync:** user is already in the running map and the visible URL should track what they are doing

V1 treated both as router-managed route transitions. V2 must not.

### 2. One route owner per concern

- **Expo Router owns pages**
  - tabs
  - property pages
  - comments
  - guesses
  - auth
  - feed/saved/profile/etc.
- **The running web map owns in-map state**
  - camera
  - selected preview group/property
  - sheet peek/expanded state

The map may **reflect** its state into the URL. It should not navigate the router for every reflection.

### 2.5. Router state must not be authoritative inside an active web map session

Once the web map session is mounted, camera/preview/sheet state must come from the map controller and its own state model, not from `usePathname()`, `useLocalSearchParams()`, or repeated route resolution.

That means:

- the router may choose the initial entry surface
- the web map entry adapter may read `window.location` on initial load and `popstate`
- after that, normal map interaction must not depend on Expo Router re-reading the updated pathname to stay in sync

This prevents the system from reintroducing route-driven remounts through a side door.

### 3. Passive URL sync is one-way during browsing

When the user is already in the web map:

- camera changes update the address bar with `history.replaceState`
- preview open swaps the visible URL to `/map/{address}` with `history.replaceState`
- preview close swaps back to the latest camera URL with `history.replaceState`

This is a serialization layer, not a navigation event.

### 3.5. Browser-history semantics must stay conservative

The default runtime behavior is:

- `replaceState` for camera move-end updates
- `replaceState` for preview open
- `replaceState` for preview close
- no new browser-history entry for passive in-map interaction

Back/forward restoration still matters, but only for states that actually exist in browser history because of:

- direct entry
- refresh
- an earlier real navigation
- an intentional future `pushState` decision

V2 should not accidentally promise “back closes the preview” unless that becomes an explicit product decision. The point of this overhaul is shareable/restorable URLs without turning normal browsing into a navigation stack.

### 4. Canonicalization belongs at route entry, not in every state transition

Canonical route correction should happen when:

- a user loads a non-canonical URL directly
- a user follows a shared link
- a user deep-links into property/comments/guesses

It should not run repeatedly inside a stable map session every time preview/camera state changes.

---

## Scope To Keep From V1

These parts should remain and be treated as the durable outcome of the first effort:

### Shared canonical URL utilities

Keep and continue using:

- `packages/shared/src/utils/property-url.ts`
- shared slug builders/parsers
- camera path parse/serialize helpers
- country-prefix logic
- validated `returnTo` helpers

### Canonical route builders in app code

Keep the app-facing canonical route helpers and continue migrating callers toward them.

### Property/comments/guesses return-target contract

Keep:

- property default close target -> canonical `/map/{address}`
- comments/guesses default close target -> canonical `/{address}`
- explicit `returnTo` overrides for feed/saved/profile/etc.

### API and data-shape work that supports canonical addressing

Keep:

- canonical address resolution support
- app property fields needed to build canonical routes directly
- reduced dependence on id-based route building where data is already available

---

## Scope To Rewrite

### 1. Remove the web persistent-host / transparent-route architecture

V2 should remove the web pattern where:

- map-like routes are mounted as transparent stack routes
- the actual web map lives in a global persistent host
- the tab route itself renders `null`

That architecture solved one class of persistence problem by creating a larger ownership problem.

The web map should return to a simpler shape:

- one concrete web map screen component
- one place where initial route hydration is interpreted
- no global overlay host that must stay synchronized with router state

### 2. Remove `router.replace()` from passive web map sync

Passive web map sync should not call Expo Router.

Specifically, runtime updates for:

- camera move-end URL updates
- preview open
- preview close
- passive canonical swaps while already in the map

must be handled with browser history mutation only.

Use:

- `window.history.replaceState(...)` for passive updates
- `window.history.pushState(...)` only if a deliberate history entry is explicitly wanted

Default should remain `replaceState`.

### 3. Limit route resolution to real entry points

`resolveMapRoute()` is still useful, but only for:

- initial web load
- popstate restoration
- direct route entry
- native deep-link handling

It should not run as the main engine of normal preview open/close interaction on web.

### 4. Re-simplify preview and bottom-sheet interaction

Preview card and bottom-sheet behavior should go back to being plain map UI state:

- map tap opens preview
- preview tap expands sheet
- sheet close returns to peek/preview resting state
- empty map tap dismisses preview when sheet is not expanded

Those flows must not depend on route wrappers resolving or re-resolving map routes.

---

## Target Architecture

## A. Shared Canonical URL Layer

Keep one shared canonical contract:

- `buildCanonicalPropertyPath`
- `buildCanonicalMapPreviewPath`
- `buildCanonicalCommentsPath`
- `buildCanonicalGuessesPath`
- `serializeCanonicalCameraPath`
- matching parse helpers

No duplicate app-local URL formats.

## B. Web Map Entry Controller

Have one web-only entry adapter with two responsibilities:

1. On initial mount, read the current browser path and hydrate the map session.
2. On `popstate`, rehydrate the map session from the current browser path.

This adapter may call route resolution.
It should not call route resolution for every in-session state change.

## C. Runtime Web URL Serializer

Inside the web map session:

- when no preview is open, `moveend` serializes the camera to `/@...`
- when a preview opens, serialize to `/map/{address}`
- when preview closes, serialize back to the latest `/@...`

This layer only touches browser history.
It does not ask Expo Router to navigate.

## D. Page Routes

Keep Expo Router for actual pages:

- canonical property detail
- comments
- guesses
- tabs/static routes

Navigating from map preview to full detail remains a real route transition.
Moving the map or opening a preview does not.

When transitioning from the map to a router-owned page, navigation should always use explicit absolute canonical hrefs. It must not rely on Expo Router inferring the current location from a pathname that the browser history serializer may have updated independently.

---

## Route Model V2

### Web map-managed states

These are URL-addressable but not router-transition-driven during an active map session:

- `/`
- `/@{lat},{lng},{zoom}z`
- `/{city}`
- `/{city}/{postcode}`
- `/map/{city}/{postcode}/{street}/{house}`
- non-NL equivalents with a leading country code

### Router-managed page states

These remain normal routed pages:

- `/{city}/{postcode}/{street}/{house}`
- `/{city}/{postcode}/{street}/{house}/comments`
- `/{city}/{postcode}/{street}/{house}/guesses`
- non-NL equivalents
- feed/saved/profile/notifications/etc.

### Important distinction

A map-managed state can be:

- loaded directly from a URL
- restored by browser history
- reflected into the address bar during browsing

without being treated as a full router navigation every time the URL string changes.

---

## Concrete Rewrite Steps

### Phase 1. Freeze the contract

- Keep shared canonical URL helpers as the durable contract.
- Keep explicit `returnTo` behavior.
- Keep API resolution support for canonical address routes.
- Do not add more web runtime patches on top of the current persistent-map architecture.

### Phase 2. Replace web route ownership model

- Remove the global persistent web host pattern.
- Remove the `null` web tab route pattern.
- Remove transparent-modal-style web map routing as the steady-state model.
- Restore one concrete web map screen as the owner of running map UI state.

### Phase 3. Implement one-way runtime URL sync

- Add a focused web map history adapter.
- On map `moveend`, update `/@...` via `history.replaceState`.
- On preview open, update `/map/{address}` via `history.replaceState`.
- On preview close, restore the last camera path via `history.replaceState`.
- Do not call `router.replace()` from these runtime transitions.
- Do not let runtime map UI depend on Expo Router hooks observing those path changes afterward.

### Phase 4. Keep direct-load hydration

- On first web load, parse the current path and hydrate:
  - root
  - camera
  - city/postcode area
  - map preview route
  - property/comments/guesses routes
- Preserve the existing `/map` -> `/` redirect behavior as a route-entry rule.
- Invalid address-like routes still collapse to `/`.

### Phase 5. Support browser back/forward

- Listen to `popstate` on web.
- Rehydrate the map session from the current path for map-managed states.
- Let Expo Router keep normal behavior for real page routes.
- Avoid mixed ownership where both map runtime and router try to canonicalize the same transition.

### Phase 6. Remove compensating UI hacks that are no longer needed

After the ownership simplification, re-evaluate and trim the web-only patches that were added to survive the V1 architecture, especially around:

- preview overlay routing/chrome separation
- tab bar portal behavior
- preview marker portal relocation
- bottom-sheet safe-area/overlay interaction fixes that only exist because the underlying layering changed

Not all of these will disappear, but they should be justified again under the simpler model instead of carried forward automatically.

---

## File-Level Rewrite Direction

### Preserve conceptually

- `packages/shared/src/utils/property-url.ts`
- `apps/app/src/utils/property-route.ts`
- `apps/app/src/lib/mapRoute.ts` as canonical parsing/resolution logic
- route screen return-target logic in property/comments/guesses screens

### Rewrite or remove on web

- `apps/app/src/screens/PersistentWebMapScreen.tsx`
- `apps/app/src/screens/WebPersistentMapHost.tsx`
- `apps/app/src/screens/WebMapRouteShell.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- web-specific route wrappers that exist only to support the persistent-host model

### Reassess after architecture simplification

- `apps/app/src/components/WebPreviewMarkerPortal.tsx`
- `apps/app/src/components/navigation/CustomTabBar.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`

These may still need some changes, but V2 should not assume their current workaround structure is the right baseline.

---

## Behavior Rules

### Camera URL sync

- Only update on `moveend`.
- Use `replaceState`.
- Never show a loading overlay because the user panned the map.
- Never invoke route-resolution loading UI because the user panned the map.

### Preview URL sync

- Opening a preview updates the visible URL to canonical `/map/{address}`.
- This must not remount the map.
- This must not route through Expo Router.
- Closing a preview returns the visible URL to the latest `/@...` camera URL.
- This must not trigger route-resolution loading UI.

### Property detail navigation

- Tapping through from preview to property detail is a real route transition.
- That transition should use canonical property URLs.
- Closing property/comments/guesses should continue honoring explicit `returnTo` targets.

### Invalid URLs

- Invalid address-style direct entries replace to `/`.
- Invalid runtime map state should not happen via serializer if builders are used correctly.

---

## Testing Plan V2

Testing must reflect the new separation between hydration and runtime sync.

### Unit

- shared canonical URL builders/parsers
- `returnTo` normalization
- map route parsing/resolution
- web history serializer helpers
- popstate hydration logic
- explicit browser-history policy tests (`replaceState` default, no passive `pushState`)

### App/unit

- property/comments/guesses back-target logic
- web map state reducer/controller for:
  - initial hydrate from pathname
  - passive camera URL update
  - preview-open URL update
  - preview-close URL restore
  - popstate restore
- verify route resolution is not re-entered during normal preview open/close and camera sync

### Web E2E integration

- direct load of `/@...`
- direct load of `/map/{address}`
- direct load of canonical property/comments/guesses URLs
- bad address route collapses to `/`

### Web E2E flows

- pan/zoom updates visible URL without map reload flash
- opening preview updates visible URL without remount
- closing preview restores last camera URL without remount
- preview card taps still work after URL changes
- bottom-sheet peek/expand/dismiss behavior matches pre-overhaul expectations
- browser back/forward restores map state correctly for map-managed URLs
- route-loading shell never appears during normal map interaction
- passive map interaction does not create extra browser history entries

### Web visual

Refresh the affected visual references with explicit checks for:

- preview card stability
- bottom-sheet peek behavior
- preview persistence
- no unexpected overlay/tab-bar interference

### Mobile

Mobile keeps the canonical deep-link and return-target behavior.
No mobile runtime change should be required beyond preserving the shared route contract.

### Full verification gate

- `pnpm test`
- `pnpm test:e2e:flows`
- `pnpm test:e2e:visual`
- `pnpm test:e2e:mobile` if any shared deep-link/runtime contract changed on native paths

---

## Success Criteria

V2 is successful when all of the following are true:

- Canonical URLs are still shareable and stable.
- Direct loads of canonical map/property URLs work.
- The running web map no longer flashes or enters route-loading states during normal browsing.
- Preview card and bottom-sheet behavior no longer need continual route-sync workarounds.
- Opening/closing previews feels like local map state again.
- Property/comments/guesses still use canonical routes and explicit return targets.
- Static routes and map-managed routes have a clean ownership boundary.

---

## Bottom Line

V1 was correct to standardize the URL contract.
V1 was too aggressive in making the web router own live map interaction.

V2 should keep the canonical contract, but downgrade passive web URL sync back to what the product actually needed:

- **serialize current map state into the visible URL**
- **restore map state from shared URLs**
- **do not let passive URL sync drive the running map through router navigation**

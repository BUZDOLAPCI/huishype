# Unified Detail Surfaces Plan

Date: 2026-04-15

## Goal

Unify the full property-detail family across map, feed, saved, and other list-style entry points so the app always uses the same canonical route-driven surface model for:

- `property`
- `comments`
- `guesses`

The contract is:

- Native scope is portrait only. This plan does not introduce or require any native landscape-specific UI.
- Portrait uses stacked bottom sheets everywhere
- Landscape and other wide layouts use side-by-side right panels everywhere on web only
- The same canonical routes power every full detail surface, regardless of entry point
- Direct deep links must build the same visible stack as in-app navigation, not a special standalone page

The target UX is:

- Tapping a property anywhere opens the property details surface
- Tapping "View all comments" anywhere opens the comments surface
- Tapping "View all guesses" anywhere opens the guesses surface
- The property detail guesses preview includes an explicit inline CTA beside the count text, matching the intended "28 people have guessed    View guesses ->" treatment
- The invoking screen remains visible underneath or alongside the detail surfaces
- Comments and guesses never replace property details; they layer above it on portrait and beside it on landscape

## Why The Behavior Differs Today

There are currently three different presentation models for the same content:

1. Map property details use `PropertyBottomSheet`
2. Canonical property routes use `PropertyDetailRouteScreen`, which is a full-page scroll screen
3. Canonical comments and guesses routes use `ResponsivePanel`, which is:
   - a right-side panel on wide web layouts
   - a full-screen passthrough on portrait and native

This creates inconsistent behavior:

- Feed and saved card taps push a canonical property route that behaves like a page, not a shared detail surface
- Map quick-action comments already navigate to the canonical comments route, but the comments route does not preserve the same stack model as property details
- The inline comments section in the map detail surface does not navigate for "View all comments" because the map sheet never passes `onViewAllComments`
- The inline guesses preview does not currently expose the equivalent "View guesses" CTA even though the canonical guesses route exists
- Native comments and guesses routes are still full-screen pages rather than bottom sheets

## Source Files Involved

- `apps/app/app/(tabs)/_layout.tsx`
- `apps/app/app/[...address].tsx`
- `apps/app/app/(tabs)/@[camera].tsx`
- `apps/app/app/(tabs)/map/[...address].tsx`
- `apps/app/app/(tabs)/feed.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- `apps/app/app/(tabs)/index.tsx`
- `apps/app/app/(tabs)/index.web.tsx`
- `apps/app/app/_layout.tsx`
- `apps/app/app/leaderboard.tsx`
- `apps/app/app/notifications.tsx`
- `apps/app/src/screens/CanonicalAddressRouteScreen.tsx`
- `apps/app/src/detail-surfaces/DetailSurfaceHost.tsx`
- `apps/app/src/detail-surfaces/DetailSurfaceHostContext.tsx`
- `apps/app/src/detail-surfaces/DetailSurfaceBaseRenderer.tsx`
- `apps/app/src/detail-surfaces/detailSurfaceBase.ts`
- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.native.tsx`
- `apps/app/src/components/PropertyBottomSheet/types.ts`
- `apps/app/src/components/PropertyBottomSheet/PropertyContent.tsx`
- `apps/app/src/components/PropertyBottomSheet/CommentsSection.tsx`
- `apps/app/src/components/PropertyBottomSheet/PriceGuessSection.tsx`
- `apps/app/src/components/ui/ResponsivePanel.web.tsx`
- `apps/app/src/components/ui/ResponsivePanel.native.tsx`
- `apps/app/src/screens/PropertyDetailRouteScreen.tsx`
- `apps/app/src/screens/CommentsRouteScreen.tsx`
- `apps/app/src/screens/GuessesRouteScreen.tsx`

## Contract

### Resolved Product Decisions

These decisions are locked for implementation:

- `CanonicalAddressRouteScreen` stays the route-level orchestrator
- A new `DetailSurfaceHost` owns presentation and layering
- `DetailSurfaceHost` renders `base`, `base + property`, or `base + property + comments|guesses`
- The host must render the actual underlying invoking screen beneath overlays when it already exists in navigation state, including `map`, `feed`, `saved`, `profile`, `leaderboard`, and `notifications`
- `returnTo=/feed` and `returnTo=/saved` must preserve the exact existing tab instance, including scroll position, filters, loaded pages, and other mounted UI state
- Map preview card remains the first interaction step; promotion into canonical property details happens only when the user opens full property details
- Property surface parity means the same content and dismissal model everywhere; matching snap points and partial-expansion behavior is explicitly not required
- On portrait, comments and guesses fully cover property while preserving it underneath
- On wide web layouts, property and comments/guesses use equal-width right panels
- When `returnTo` is missing, direct canonical entry defaults to a map-backed stack
- Browser back and native back must traverse every visible layer in order
- "View all comments" always routes to canonical comments; there is no inline-expand main path
- "View all guesses" always routes to canonical guesses; there is no inline-expand main path
- The implementation ships as a full `property + comments + guesses` rollout, not a comments-only product slice

### Surface Stack Model

Every full detail experience must resolve to the same stack:

- Base surface: `map`, `feed`, `saved`, or another origin screen derived from `returnTo`
- Layer 1: `property`
- Layer 2: `comments` or `guesses`

Rules:

- `property` always sits directly above the base surface
- `comments` and `guesses` are second-level children of `property`
- Opening `comments` or `guesses` never removes `property`
- Closing removes only the current top layer
- Back behavior traverses `comments|guesses -> property -> base`
- `returnTo` determines the base surface when present
- When origin context is missing, direct deep links default to a map-backed stack

### Portrait Contract

Portrait is the canonical behavior on native and on narrow web layouts.

Rules:

- The base surface stays mounted underneath
- Opening a property shows the first bottom sheet
- Opening comments or guesses shows a second bottom sheet over property
- Drag-down, close button, backdrop, and back only dismiss the top sheet
- After dismissing the top sheet, the previous sheet remains open and stateful
- The same sheet behavior must apply regardless of whether the route was reached from map, feed, saved, or direct entry

Concrete examples:

- Feed -> property: feed remains underneath, property opens as a bottom sheet
- Feed -> property -> comments: comments opens as a second bottom sheet above property
- Direct `/comments` entry: render map underneath, property sheet first, comments sheet on top

### Landscape Contract

Landscape applies to web and other wide layouts only.

Native is portrait-only. Rotated phones, tablets, and other native wide layouts are explicitly out of scope for this plan and should continue using the portrait behavior rather than introducing a native side-panel mode.

Rules:

- The base surface stays visible on the left
- Opening a property adds the first right-side panel
- Opening comments or guesses adds a second right-side panel to the right of property
- Opening comments or guesses never swaps property out of view
- Closing removes only the rightmost panel
- Feed and saved remain width-constrained and centered within the remaining main content area

Concrete examples:

- Feed -> property: feed remains visible, property appears in the first right-side panel
- Feed -> property -> comments: feed stays visible, property stays visible, comments opens in a second panel to the right
- Direct `/comments` entry: render map as the base, then show property panel plus comments panel

### Direct Entry Contract

Direct canonical routes must synthesize the same visible stack as in-app navigation.

Rules:

- `/{address}` renders `map + property` when there is no explicit `returnTo`
- `/{address}/comments` renders `map + property + comments` when there is no explicit `returnTo`
- `/{address}/guesses` renders `map + property + guesses` when there is no explicit `returnTo`
- If `returnTo` is present, use it as the base surface instead of inferred map
- Browser back and native back must walk the synthesized stack in the same order as in-app navigation

This is a hard requirement. Direct entry must not degrade to a standalone full-page comments or guesses screen.

## Ownership Boundary

The refactor must make route ownership explicit so map behavior does not regress.

Map-owned runtime state may continue to own:

- camera position
- marker selection
- preview card / carousel state
- other transient map interaction state that is not itself a canonical detail surface

Canonical routes must own:

- the visible full-detail surface stack
- presentation mode selection: bottom sheet vs side panel
- close and back semantics
- deep-link behavior
- nested `property -> comments|guesses` progression

Implication:

- Map can keep its lightweight preview interaction model
- Once the user opens the full property details surface, the app should promote into the same canonical route-driven surface stack used by feed and saved
- `CommentsSection` and guesses previews remain inline preview content inside property details, but the main CTA always routes to the canonical second-level surface
- The guesses preview must expose that main CTA directly in the section chrome beside the count copy, not hide it behind a separate full-screen-only path

## Target Architecture

The implementation must provide one shared overlay host for canonical property detail routes.

The architecture is fixed as follows:

- `DetailSurfaceHost` lives in `apps/app/app/_layout.tsx`
- The host sits above the real root stack content so the actual mounted invoking screen instance remains visible and stateful beneath overlays
- `CanonicalAddressRouteScreen` remains the route-level resolver/orchestrator, but it no longer acts as a standalone visual page presenter
- Canonical property-family route screens become surface-content producers consumed by the host
- The current hidden `[...address]` tab route structure cannot remain the final presentation model because it swaps away from the mounted base tab instance
- The canonical property-family entry route should move to sibling root stack routes above `(tabs)` so it can own the URL while `DetailSurfaceHost` in the root layout owns the visible stack
- Map preview and camera routes stay tab-owned because they are base map states, not detail-surface layers
- Route-to-host communication must be explicit and deterministic; the host may not infer state from ad hoc local component state

The host must derive and preserve:

- `base` from `returnTo` when present
- `base = map` when `returnTo` is missing
- `property` as layer 1 whenever the canonical route kind is `property`, `comments`, or `guesses`
- `comments` or `guesses` as layer 2 when present
- browser and native back progression that matches the visible stack
- the exact mounted base tab instance, not a remounted clone

Implications:

- feed/saved detail navigation cannot be implemented by rendering a feed-like replica beneath overlays
- direct `/address/comments` and `/address/guesses` entry must synthesize `map + property + child`
- close and back behavior must mutate the canonical URL in lockstep with the host stack
- visual presentation ownership moves out of route screens and into the root-layout host

That host must be able to:

- keep the base route visible
- render zero, one, or two active detail surfaces simultaneously
- render those surfaces as stacked sheets on portrait
- render those surfaces as adjacent right-side panels on landscape
- derive the base surface from `returnTo` or infer map when missing
- preserve canonical URLs, browser history, and native back behavior

The architecture must support:

- `base`
- `base + property`
- `base + property + comments`
- `base + property + guesses`

without falling back to full-screen route replacement.

Route screen responsibilities should narrow to surface content and route-state production, while the host owns presentation and stack orchestration.

## Refactor Strategy

### Phase 0: Implement The Host Architecture Baseline

Do this before broad screen migration.

Requirements:

- mount `DetailSurfaceHost` in `apps/app/app/_layout.tsx`
- move canonical property-family entry out of the hidden tabs presentation path and into sibling root stack routes above `(tabs)`
- make `CanonicalAddressRouteScreen` produce resolved stack state for the host rather than a full-screen replacement branch
- preserve the currently mounted base tab instance underneath overlays
- support `base`, `base + property`, and `base + property + comments|guesses`
- keep canonical URLs, browser history, and native back coherent
- synthesize the default map-backed stack for direct entry

No broad surface migration should start until this baseline is working end-to-end.

### Phase 1: Define A Shared Route Surface Primitive

Create one shared primitive for canonical property-related surfaces that supports:

- portrait bottom-sheet presentation
- landscape side-panel presentation
- consistent backdrop, close, and escape behavior
- consistent sizing rules
- web support for portrait and landscape
- native support for portrait bottom sheets

This should replace the current split between:

- `ResponsivePanel`
- full-page canonical route screens
- map-specific full-detail surface presentation

The primitive must satisfy these presentation rules:

- portrait uses bottom sheets on native and narrow web
- wide web uses right-side panels
- comments and guesses fully cover property on portrait while leaving property mounted underneath
- wide web uses equal-width property and child panels
- dismissal behavior is uniform across map, feed, saved, and direct entry

### Phase 2: Move Property, Comments, And Guesses Onto The Shared Surface Model

Refactor the route screens so they act as content for the shared host instead of standalone pages.

Requirements:

- `PropertyDetailRouteScreen` becomes the layer-1 content surface
- `CommentsRouteScreen` becomes the layer-2 comments surface
- `GuessesRouteScreen` becomes the layer-2 guesses surface
- comments and guesses preserve the property surface underneath or beside them
- `PriceGuessSection` gains an explicit inline "View guesses" CTA beside the participation count text and routes through the same canonical guesses surface as every other entry point
- `PropertyBottomSheetProps` gains `onViewAllComments` and `onViewAllGuesses`
- `PropertyContent` passes `onViewAllGuesses` through to `PriceGuessSection`
- `PriceGuessSection` stops being inline-only and exposes the canonical route CTA in shared property surfaces

### Phase 3: Unify Entry Points

All property-opening entry points must converge on the same canonical surface stack.

Requirements:

- feed opens canonical `property`
- saved opens canonical `property`
- other list-style surfaces do the same
- map property open flows promote into canonical `property` while preserving map underneath
- "View all comments" always routes to canonical `comments`
- "View all guesses" always routes to canonical `guesses`
- the property detail guesses preview always shows a visible "View guesses" CTA beside the count text, on both map-driven and canonical property surfaces
- map-driven property surfaces stop using inline-scroll as the main comments/guesses navigation path
- feed and saved must resume on the exact same mounted list state after dismissing overlays

At the end of this phase there should be no main CTA path that still expands inline instead of routing.

### Phase 4: Finalize Wide Layout Composition

Once the navigation model is unified:

- constrain feed and saved width on wide screens
- keep them centered in the main region
- size the right-side detail panels responsively
- ensure two-panel detail stacks still leave the base surface legible

This is visual composition work after the route/surface contract is already correct.

### Phase 5: Back, Close, And History Polish

Standardize all dismissal semantics:

- close comments -> property stays open
- close guesses -> property stays open
- close property -> return to base surface
- browser back follows the same sequence
- native back follows the same sequence
- direct-entry synthesized stacks close/back the same way as in-app navigation

## Proposed Implementation Order

1. Prove the overlay host architecture with one narrow route stack
2. Build the shared route surface primitive
3. Migrate comments and guesses onto the shared host
4. Migrate property onto the same host
5. Pass `onViewAllComments` and `onViewAllGuesses` through map-driven property surfaces
6. Remove divergent inline main-CTA behavior from preview sections
7. Unify feed, saved, and map property opening onto the canonical stack
8. Tighten wide-layout sizing and composition
9. Add and update tests

## Key Design Decisions

### Keep Canonical Routes

Do not replace canonical property/comments/guesses routes with local-only UI state.

Reasons:

- deep linking remains correct
- browser history and sharing remain correct
- one source of truth for property-related surfaces
- feed, saved, and map can converge on the same navigation model

### Preserve Property Beneath Comments And Guesses

Comments and guesses are not standalone destinations in presentation terms.

Rules:

- property remains visible beneath comments on portrait
- property remains visible beside comments on landscape
- property remains visible beneath guesses on portrait
- property remains visible beside guesses on landscape

### Default Missing Origin Context To Map

When direct entry does not include enough origin context to reconstruct feed or saved, default to map as the base surface.

This keeps direct-entry behavior consistent and avoids introducing a separate standalone route presentation.

### Native Landscape Is Out Of Scope

Native remains portrait-only for this plan.

Requirements for this refactor:

- native portrait bottom-sheet parity
- web portrait bottom-sheet parity
- web wide-layout side-panel parity
- no native landscape-specific layout work

## Risks And Unknowns

### Tabs Host Coordination

The host placement is decided, but the implementation still has to coordinate three layers cleanly:

- root stack route ownership
- root-layout visual host ownership
- route-state propagation between them

This is the main engineering risk and must be implemented deliberately.

### Route-State Synthesis

Direct entry to `comments` or `guesses` requires synthesizing missing ancestors:

- infer base = map when `returnTo` is missing
- materialize property as the middle layer
- ensure close/back/history behave as if the stack had been opened normally

This must be designed explicitly, not left as incidental behavior.

### Map Integration Boundary

The map already owns selection and preview flows. The migration must avoid:

- breaking map camera/selection behavior
- creating duplicate full-detail implementations
- leaving map as the only entry point that still behaves differently

### Mounted Base Preservation

The plan depends on keeping the actual base tab instance mounted. The implementation must avoid:

- remounting feed/saved/map when overlays open
- resetting feed/saved scroll position or filters
- losing fetched pages or query state because the base screen was replaced instead of overlaid

## Verification Plan

### Unit / Component

- route-building and `returnTo` propagation tests
- synthesized stack resolution tests for direct entry
- responsive route-surface behavior tests
- comments and guesses CTA routing tests
- guesses preview CTA render/placement tests for the "count on the left, View guesses on the right" treatment
- close/back stack transition tests

### Web E2E

Add or update Playwright tests for:

- feed card -> property surface
- saved card -> property surface
- property surface -> comments surface
- property surface -> guesses surface
- map property -> comments surface
- map property -> guesses surface via the inline "View guesses" CTA
- portrait stacked-sheet behavior for canonical property/comments/guesses routes
- wide-layout side-by-side behavior for `base + property`
- wide-layout side-by-side behavior for `base + property + comments`
- direct `/address` load -> inferred `map + property`
- direct `/address/comments` load -> inferred `map + property + comments`
- browser back/forward through `comments -> property -> base`

Include screenshot-based verification for the new portrait and wide-layout surface compositions.

### Mobile E2E

Add or update Maestro flows for:

- feed -> property bottom sheet
- property -> comments bottom sheet
- property -> guesses bottom sheet
- drag-down dismiss only closes the top sheet
- close/back returns to property before returning to the base screen
- direct-entry route behavior on portrait if supported in the test harness

## Acceptance Criteria

- Feed, saved, and map all open the same canonical property detail surface model
- "View all comments" always opens the canonical comments surface
- "View all guesses" always opens the canonical guesses surface
- The guesses preview shows the count text and a right-aligned "View guesses" CTA in the same row, matching the intended compact summary treatment
- Portrait always uses stacked bottom sheets for `property -> comments|guesses`
- Web wide layouts always use side-by-side panels for `base -> property -> comments|guesses`
- Comments and guesses never replace property details
- Direct canonical entry without `returnTo` defaults to a map-backed stack
- Close and back behavior consistently walk top layer -> property -> base
- Feed and saved remain centered and width-constrained on wide screens
- Native achieves portrait bottom-sheet parity
- Native remains portrait-only with no landscape-specific panel mode introduced
- Required tests are added or updated and pass

## Recommended First Spike

Before the full refactor, do a narrow architecture spike that proves the core contract without narrowing product scope for the final implementation:

1. Build the root-layout `DetailSurfaceHost`
2. Move canonical address ownership onto the root stack + host path
3. Prove one nested `map + property + comments` stack end-to-end
4. Verify:
   - the base tab instance remains mounted underneath
   - portrait stacked bottom sheets
   - wide-layout side-by-side panels
   - property remains mounted when comments opens
   - direct `/comments` entry synthesizes `map + property + comments`
   - close/back returns `comments -> property -> base`

If that spike is solid, continue immediately into the full `property + comments + guesses` rollout in the same architecture.

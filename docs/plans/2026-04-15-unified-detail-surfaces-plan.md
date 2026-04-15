# Unified Detail Surfaces Plan

Date: 2026-04-15

## Goal

Unify the full property-detail family across map, feed, saved, and other list-style entry points so the app always uses the same canonical route-driven surface model for:

- `property`
- `comments`
- `guesses`

The contract is:

- Native scope is portrait only
- Portrait uses stacked bottom sheets everywhere
- Landscape and other wide layouts use side-by-side right panels everywhere
- The same canonical routes power every full detail surface, regardless of entry point
- Direct deep links must build the same visible stack as in-app navigation, not a special standalone page

The target UX is:

- Tapping a property anywhere opens the property details surface
- Tapping "View all comments" anywhere opens the comments surface
- Tapping "View all guesses" anywhere opens the guesses surface
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
- Native comments and guesses routes are still full-screen pages rather than bottom sheets

## Source Files Involved

- `apps/app/app/(tabs)/feed.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- `apps/app/app/[...address].tsx`
- `apps/app/src/hooks/useMapInteraction.ts`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.native.tsx`
- `apps/app/src/components/PropertyBottomSheet/PropertyContent.tsx`
- `apps/app/src/components/PropertyBottomSheet/CommentsSection.tsx`
- `apps/app/src/components/ui/ResponsivePanel.web.tsx`
- `apps/app/src/components/ui/ResponsivePanel.native.tsx`
- `apps/app/src/screens/PropertyDetailRouteScreen.tsx`
- `apps/app/src/screens/CommentsRouteScreen.tsx`
- `apps/app/src/screens/GuessesRouteScreen.tsx`
- `apps/app/app/_layout.tsx`

## Contract

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

Portrait is the canonical mobile behavior on both web and native.

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

Landscape applies to web and other wide layouts. Native is portrait-only and does not need a separate landscape behavior in this plan.

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

## Target Architecture

The implementation must provide one shared overlay host for canonical property detail routes.

That host must be able to:

- keep the base route visible
- render zero, one, or two active detail surfaces simultaneously
- render those surfaces as stacked sheets on portrait
- render those surfaces as adjacent right-side panels on landscape
- derive the base surface from `returnTo` or infer map when missing
- preserve canonical URLs, browser history, and native back behavior

Any implementation is acceptable if it satisfies that contract, but the architecture must support:

- `base`
- `base + property`
- `base + property + comments`
- `base + property + guesses`

without falling back to full-screen route replacement.

Route screen responsibilities should narrow to surface content, while the host owns presentation and stack orchestration.

## Refactor Strategy

### Phase 0: Lock The Overlay Host Architecture

Do this before broad screen migration.

Decide and prove the route/layout structure that can:

- preserve the invoking surface instead of replacing it
- render two simultaneous detail surfaces when needed
- keep canonical address URLs
- keep browser history coherent
- keep native back behavior coherent
- synthesize the default map-backed stack for direct entry

No large migration should start until this architecture is proven with a narrow spike.

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

### Phase 2: Move Property, Comments, And Guesses Onto The Shared Surface Model

Refactor the route screens so they act as content for the shared host instead of standalone pages.

Requirements:

- `PropertyDetailRouteScreen` becomes the layer-1 content surface
- `CommentsRouteScreen` becomes the layer-2 comments surface
- `GuessesRouteScreen` becomes the layer-2 guesses surface
- comments and guesses preserve the property surface underneath or beside them

### Phase 3: Unify Entry Points

All property-opening entry points must converge on the same canonical surface stack.

Requirements:

- feed opens canonical `property`
- saved opens canonical `property`
- other list-style surfaces do the same
- map property open flows promote into canonical `property` while preserving map underneath
- "View all comments" always routes to canonical `comments`
- "View all guesses" always routes to canonical `guesses`

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

## Risks And Unknowns

### Overlay Host Placement

The biggest engineering decision is where the host lives and how canonical address routes drive it without replacing the base screen.

That needs to be settled first.

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

## Verification Plan

### Unit / Component

- route-building and `returnTo` propagation tests
- synthesized stack resolution tests for direct entry
- responsive route-surface behavior tests
- comments and guesses CTA routing tests
- close/back stack transition tests

### Web E2E

Add or update Playwright tests for:

- feed card -> property surface
- saved card -> property surface
- property surface -> comments surface
- property surface -> guesses surface
- map property -> comments surface
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
- Portrait always uses stacked bottom sheets for `property -> comments|guesses`
- Wide layouts always use side-by-side panels for `base -> property -> comments|guesses`
- Comments and guesses never replace property details
- Direct canonical entry without `returnTo` defaults to a map-backed stack
- Close and back behavior consistently walk top layer -> property -> base
- Feed and saved remain centered and width-constrained on wide screens
- Native achieves portrait bottom-sheet parity
- Required tests are added or updated and pass

## Recommended First Spike

Before the full refactor, do a narrow spike that proves the core contract:

1. Build the overlay host for one base surface plus nested detail layers
2. Migrate only `comments` through that host
3. Verify:
   - portrait stacked bottom sheets
   - wide-layout side-by-side panels
   - property remains visible when comments opens
   - direct `/comments` entry synthesizes `map + property + comments`
   - close/back returns `comments -> property -> base`

If that spike is solid, migrate property opening and guesses next.

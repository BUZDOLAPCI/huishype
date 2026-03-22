# Visual Overhaul Sprint Plan 3

**Date**: 2026-03-22
**Status**: Merged execution plan
**Purpose**: This document supersedes sprint plans 1 and 2. It keeps plan 2 as the orchestration and acceptance scaffold, and folds in the concrete implementation detail from plan 1 where that detail improves execution quality.

## Source Of Truth

Primary inputs:

- `docs/visual-references/design-overhaul/huishype-visual-overhaul.pen`
- `docs/visual-references/design-overhaul/pen_screen_exports/*`
- `docs/superpowers/specs/2026-03-17-visual-design-overhaul-design.md`
- `agent-rules/main-spec.md`
- `agent-rules/software-stack.md`
- `agent-rules/test-requirements.md`

This plan also assumes a codebase audit across:

- `apps/app/`
- `services/api/`
- `packages/shared/`
- `packages/api-client/`
- `packages/mocks/`

## Why This Plan Replaces Plans 1 And 2

Plan 1 was strong on concrete implementation detail:

- style-normalization mechanics
- token remap detail
- icon migration mappings
- backend endpoint and table detail
- concrete file ownership

Plan 2 was stronger as an execution artifact:

- explicit coverage gaps
- platform coverage matrix
- definition of done
- route and architecture decisions
- web/native parity strategy
- formal visual-agent loop

This merged plan keeps both:

- plan 2 structure for sequencing, ownership, and acceptance
- plan 1 detail for implementation where ambiguity would slow execution

## Final Vision Inventory

The `.pen` file contains 15 named acceptance targets. Treat them as exact target states, not a loose visual direction:

1. `1. Map Screen.jpg`
2. `2. Search Results.jpg`
3. `3. Auth Modal.jpg`
4. `4. Feed - Trending Chosen.jpg`
5. `5. Feed - Recent Activity Chosen.jpg`
6. `6. Saved Screen.jpg`
7. `7. Profile Screen.jpg`
8. `8. Social Notifications.jpg`
9. `9. Community Leaderboard.jpg`
10. `10. Property Detail — Full Scroll Content.jpg`
11. `11. Price Guesses Page.jpg`
12. `12. Comments Page.jpg`
13. `Cluster Preview Card Wrapper.jpg`
14. `Preview Card Wrapper.jpg`
15. `Preview Card Wrapper-1.jpg`

Interpretation constraints:

- `Search Results` is a map overlay state, not a standalone route.
- `Auth Modal` is a cross-cutting overlay state.
- `Preview Card Wrapper` and `Cluster Preview Card Wrapper` are component-level acceptance targets.
- The final product keeps both the quick-preview path and the full property route.

## Coverage Gaps This Plan Explicitly Closes

Compared with plan 1, this merged plan adds explicit ownership and acceptance for:

- map chrome and map shell ownership
- preview-card plus quick-preview bottom-sheet parity
- shared property interaction primitives
- generated-contract and mock alignment
- root test-command compliance with project rules
- web/native parity risk from duplicated map controllers
- route consolidation around `app/[...address].tsx`
- achievement domain modeling
- desktop and landscape carry-over checks
- formal web plus Android visual-review loop

Compared with plan 2, this merged plan adds concrete execution detail for:

- style normalization mechanics
- class/style conflict cleanup
- token remap mapping
- icon migration mapping
- backend tables and endpoints
- component- and route-level file targets
- concrete visual and interaction tasks per surface

## Key Product And Architecture Decisions

These are resolved defaults for execution unless explicitly overridden.

1. **Canonical property navigation model**
   - Keep two depth levels:
   - `map tap -> geo-anchored preview -> quick-preview bottom sheet`
   - `feed/saved/activity/notification/deep link -> /property/[id] full page`
   - The bottom sheet remains first-class. It is not deprecated.

2. **Canonical feed filters**
   - Final chips are `Trending`, `Latest`, `Recent Activity`.
   - No `Following`.
   - No separate `Hot` chip.

3. **Search mic icon**
   - Remove it unless real voice search ships in the same sprint.

4. **Rank tier system**
   - Use one shared English tier definition across backend, shared types, profile, and leaderboard.
   - The final tier count must match the revised design spec and be sourced from one shared module.

5. **Auth methods**
   - Google and Apple are production paths.
   - Email magic link is an allowed supplemental method because the final design includes it.
   - No placeholder Apple-only branches are allowed at sign-off.

6. **Property photos**
   - Priority order:
   - listing photo
   - country-specific official or aerial fallback
   - branded warm placeholder

7. **Catch-all address route**
   - `app/[...address].tsx` must stop being a second unfinished experience.
   - It becomes a resolver or redirect, or it is removed.

8. **Achievements**
   - Achievements must come from a defined backend/shared domain model.
   - They are not hardcoded UI-only ornaments.

9. **Multi-country adaptation**
   - Final visuals must work outside NL.
   - Country-specific labels, valuations, address formatting, image fallbacks, and listing metadata must respect shared country config.

## Delivery Principles

- Lead agent orchestrates; implementation tasks must still be broken into focused work units.
- Shared primitives come before screen assembly when the same pattern appears across exports.
- No phase is complete if it updates visuals but leaves contracts, mocks, tests, or route ownership stale.
- Web/native parity is enforced throughout the sprint, not deferred to the end.
- Wide and landscape are required verification surfaces, not a future enhancement.
- No temporary compatibility branches for old and new ownership if a canonical owner can be chosen now.

## Definition Of Done For Any Phase

A phase is only complete when all applicable items below are true:

- scoped code is merged
- affected API contracts are updated
- `packages/api-client` is regenerated if contracts changed
- `packages/mocks` is updated if frontend or tests depend on changed contracts
- unit tests are added or updated
- backend integration tests are added or updated when API or DB changed
- Playwright coverage is updated for user-visible behavior
- Maestro or equivalent Android-native capture coverage is updated for user-visible behavior
- web screenshot artifacts are captured for the scoped surface
- Android screenshot artifacts are captured for the scoped surface
- visual review marks the artifacts `SUFFICIENT`
- no console errors appear during web capture
- no runtime errors appear in native logs during capture

## Platform Coverage Matrix

| Surface | Web Acceptance | Native Acceptance | Wide / Landscape Acceptance |
|------|----------------|-------------------|-----------------------------|
| Map screen | Playwright mobile-web screenshot vs pen | Android screenshot vs pen | Wide web screenshot + Android landscape smoke |
| Search overlay | Playwright screenshot vs pen | Android screenshot vs pen | Wide web overlay screenshot |
| Auth modal | Playwright screenshot vs pen | Android screenshot vs pen | Wide web modal screenshot |
| Feed trending | Playwright screenshot vs pen | Android screenshot vs pen | Wide web feed screenshot |
| Feed recent activity | Playwright screenshot vs pen | Android screenshot vs pen | Wide web feed screenshot |
| Saved screen | Playwright screenshot vs pen | Android screenshot vs pen | Wide web saved screenshot |
| Profile screen | Playwright screenshot vs pen | Android screenshot vs pen | Wide web profile screenshot |
| Notifications | Playwright screenshot vs pen | Android screenshot vs pen | Wide web notifications screenshot |
| Leaderboard | Playwright screenshot vs pen | Android screenshot vs pen | Wide web leaderboard screenshot |
| Property detail | Playwright screenshot vs pen | Android screenshot vs pen | Wide web detail screenshot |
| Price guesses | Playwright screenshot vs pen | Android screenshot vs pen | Wide web guesses screenshot |
| Comments | Playwright screenshot vs pen | Android screenshot vs pen | Wide web comments screenshot |
| Preview card | Playwright focused clip vs pen | Android focused screenshot vs pen | Wide web map clip |
| Cluster preview | Playwright focused clip vs pen | Android focused screenshot vs pen | Wide web map clip |

Notes:

- Phone-sized viewports are the primary pen-match surface.
- Wide and landscape are carry-over quality checks, not pixel-match targets.

## Agent-Team Topology

`Lead Agent`

- orchestration
- task graph
- plan updates
- integration review
- final visual-approval synthesis

`Team A: Contracts, Tooling, Verification`

- OpenAPI
- api-client generation
- MSW
- root test scripts
- deterministic fixtures
- screenshot harnesses

`Team B: Design System And Platform Foundations`

- style normalization
- token migration
- fonts
- icons
- shadows
- blur
- avatars
- badges
- notification bell
- shell primitives

`Team C: Map And Property Interaction`

- map controller parity
- map shell
- map chrome
- search overlay
- preview cards
- cluster preview
- quick-preview bottom-sheet parity
- shared property interaction primitives

`Team D: Social And Account Surfaces`

- feed
- saved
- profile
- notifications
- leaderboard
- auth modal
- activity surfaces

`Team E: Backend Feature Enablement`

- notifications
- activity feed
- leaderboard
- achievements
- auth
- push delivery
- async or queue work if needed

`Team F: Full-Screen Routes And Cleanup`

- property full page
- comments page
- guesses page
- route consolidation
- final cleanup

## Task Template

Every work item should state:

- source design state from `pen_screen_exports`
- exact owned files
- expected route and contract changes
- required tests to update
- required screenshot artifacts
- parity scope: web, Android native, wide or landscape if relevant
- explicit close condition: do not close until visual review returns `SUFFICIENT`

## Phase Dependencies

High-level order:

`Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4`

Then in parallel where possible:

- `Phase 5`
- `Phase 6`
- `Phase 8`
- `Phase 9`
- `Phase 10`
- `Phase 11`

Then:

- `Phase 7` must stabilize before broad route assembly if shared property modules are still changing
- `Phase 12`
- `Phase 13`
- `Phase 14`
- `Phase 15`

Key dependency notes:

- UI phases do not start until Phase 0 contract freeze and Phase 1 tooling hardening are complete.
- `NotificationBell` belongs in primitives, not late-stage screen work.
- Preview overlays and quick-preview parity depend on map controller parity plus shell work.
- Property, comments, and guesses routes depend on shared property modules.
- Profile depends on achievements, activity API, and notifications UI.
- Final verification depends on actual mobile capture and actual root-script compliance.

## Phase 0: Alignment, Scope Lock, And Plan Readiness

**Goal**: Lock the execution artifact and remove source-of-truth ambiguity before implementation fans out.

Tasks:

1. Approve this merged plan as the active execution artifact.
2. Freeze the canonical screen list and component-acceptance list from pen exports.
3. Freeze the contract source-of-truth and derived-artifact ownership model before UI work begins.
   - backend route schemas and Fastify/Zod registration are the canonical API contract source
   - `services/api/openapi.json` is an exported artifact generated from the live Fastify OpenAPI document
   - `packages/api-client/generated/api.ts` is a derived artifact generated from `services/api/openapi.json`
   - `packages/mocks` is a derived artifact aligned to the same exported contract
   - auth contract ownership
   - feed contract ownership
   - reactions versus saves ownership
   - karma tier ownership
4. Record the resolved decisions above.
5. Create top-level tasks for all phases and sub-teams.
6. Establish artifact conventions:
   - `test-results/visual-overhaul/<surface>/web/*.png`
   - `test-results/visual-overhaul/<surface>/android/*.png`
   - `test-results/visual-overhaul/<surface>/notes.md`

Verification:

- task graph exists
- each visual target has an owner
- canonical contract owners are named for auth, feed, reactions/saves, and karma tiers, and derived-artifact owners are named for OpenAPI export, generated client output, and mocks

## Phase 1: Contract, Tooling, And Verification Hardening

**Goal**: Repair the broken contract and verification pipeline first so every later phase can depend on it.

Tasks:

1. Fix OpenAPI export and generated-client derivation.
   - treat backend route schemas in `services/api/src/routes/*` and Fastify/Zod registration as the canonical API contract source
   - export `services/api/openapi.json` from the live Fastify OpenAPI document
   - regenerate `packages/api-client/generated/api.ts`
   - update `packages/api-client/src/index.ts` and `packages/api-client/src/client.ts` so exports and paths match the generated contract
   - choose whether app code uses the generated client directly or a thin wrapper around it, but do not treat the generated client as the source of truth

2. Realign `packages/mocks` to the live API base paths and final feed contract.
   - fix base-path drift first
   - add or update handlers for feed variants
   - define the exact backend query values for the final feed chips and remove stale feed values from mocks
   - add or update handlers for profile activity
   - add or update handlers for notifications
   - add or update handlers for leaderboard
   - add or update handlers for comments and guesses full-page routes

3. Bring root scripts into precise compliance with `agent-rules/test-requirements.md`.
   - `test:unit` runs only unit suites and excludes backend integration and e2e
   - `test:integration` runs backend integration tests from repo root
   - `test:e2e:web` runs the root Playwright config
   - `test:e2e:mobile` runs `maestro test apps/app/e2e/mobile/full-flow.yaml`
   - `test:all` composes `test:unit`, `test:integration`, `test:e2e:web`, and `test:e2e:mobile`
   - remove placeholder or misleading script behavior

3A. Replace placeholder package tests or remove those packages from root verification until real checks exist.
   - `packages/api-client`: add generation/export smoke coverage or type-level contract sanity tests
   - `packages/mocks`: add handler wiring and route-alignment smoke tests
   - `services/worker`: add at least a minimal smoke test, or explicitly exclude it from root `test:unit` until real tests exist

4. Add deterministic visual fixtures.
   - fixed seed data
   - fixed timestamps or mock clock hooks
   - stable ordering for notifications, leaderboard, and activity feeds
   - stable image fixtures

5. Formalize screenshot capture harnesses.
   - Playwright helpers for mobile-web and wide-web
   - Android screenshot conventions for native
   - logging hooks that fail on console or runtime errors during capture

6. Define the visual-agent review protocol.

Files likely touched:

- `package.json`
- `packages/api-client/*`
- `packages/mocks/*`
- Playwright config and helpers
- mobile test flows
- API swagger or export scripts

Verification:

- `pnpm test:integration` works from repo root
- `pnpm test:e2e:mobile` runs real mobile automation
- generated client matches live API paths
- mocks cover all new surfaces
- phase 2 and later can rely on the contract and verification pipeline without temporary shims

## Phase 2: Style Normalization And Brand Token Foundation

**Goal**: Convert the app into a clean token-driven foundation so the overhaul is mechanical rather than ad hoc.

### 2A. Pre-Migration Style Normalization

Normalize the current code before the warm-palette migration.

Why:

- 286 inline hex values
- 101+ raw numeric spacing values
- inconsistent Tailwind semantics
- className plus style conflicts

Without this pass, token migration becomes mixed cleanup plus interpretation work.

Tasks:

1. Extract inline hex colors to Tailwind classes using the current palette semantics first.

Primary mappings:

| Hex | Tailwind Equivalent | Semantic |
|-----|---------------------|----------|
| `#3B82F6` | `text-blue-500` / `bg-blue-500` | primary blue |
| `#2563EB` | `text-blue-600` / `bg-blue-600` | primary blue alt |
| `#6B7280` | `text-gray-500` | secondary text |
| `#9CA3AF` | `text-gray-400` | muted text |
| `#4B5563` | `text-gray-600` | dark secondary |
| `#111827` | `text-gray-900` | primary dark text |
| `#1F2937` | `text-gray-800` | dark text |
| `#374151` | `text-gray-700` | charcoal text |
| `#E5E7EB` | `border-gray-200` / `bg-gray-200` | light border |
| `#D1D5DB` | `border-gray-300` / `bg-gray-300` | medium border |
| `#F3F4F6` | `bg-gray-100` | light surface |
| `#FFFFFF` | `bg-white` / `text-white` | white |
| `#000000` | `bg-black` / `text-black` | black |
| `#EF4444` | `text-red-500` / `bg-red-500` | error and likes |
| `#22C55E` / `#10B981` | `text-green-500` / `text-emerald-500` | success |
| `#F97316` / `#FB923C` | `text-orange-500` / `text-orange-400` | activity orange |
| `#F59E0B` | `text-amber-500` | warning |

Keep inline only when necessary:

- `rgba()` values for shadows and overlays
- dynamic or computed values
- platform-specific animation styles
- `#4285F4` for Google branding

2. Fix className and style conflicts.

Known offenders:

- `src/components/PriceGuessSlider.tsx`
- `src/components/AuthModal.tsx`
- `src/components/CommentList.tsx`
- `src/components/Comments/Comment.tsx`
- `src/components/ConsensusAlignment.tsx`

3. Normalize raw numeric spacing to Tailwind where values map cleanly.

Preferred mappings:

| Raw Value | Tailwind |
|-----------|----------|
| `padding: 16` | `p-4` |
| `paddingHorizontal: 16` | `px-4` |
| `marginBottom: 12` | `mb-3` |
| `marginTop: 12` | `mt-3` |
| `marginLeft: 8` | `ml-2` |
| `marginRight: 8` | `mr-2` |
| `padding: 8` | `p-2` |
| `gap: 8` | `gap-2` |
| `gap: 12` | `gap-3` |
| `gap: 16` | `gap-4` |
| `borderRadius: 12` | `rounded-xl` |
| `borderRadius: 8` | `rounded-lg` |

Keep numeric values when they are dynamic, dimension-specific, or animation-driven.

4. Normalize inconsistent Tailwind color semantics before the palette swap.

Preferred winners:

- secondary text -> `text-gray-500`
- disabled text -> `text-gray-400`
- error background -> `bg-red-50`
- error text -> `text-red-600`
- success background -> `bg-green-100`
- success text -> `text-green-700`
- cold activity -> `bg-gray-400`
- screen background -> `bg-gray-50`
- card or section background -> `bg-gray-100`

5. Normalize remaining inline hex formatting.
   - uppercase
   - full 6-digit hex where applicable

High-priority files:

- `src/components/GroupPreviewCard/GroupPreviewCard.tsx`
- `src/components/PropertyPreviewCard.tsx`
- `app/(tabs)/index.web.tsx`
- `app/[...address].tsx`
- `app/(tabs)/index.tsx`
- `src/components/SearchResults.tsx`
- `src/components/PropertyBottomSheet/ListingSubmissionSheet.tsx`
- `src/components/PriceGuessSlider.tsx`

### 2B. Token Foundation

Tasks:

1. Replace `tailwind.config.js` with the warm-gold palette, typography, radius, and shadow system.
2. Update `apps/app/constants/Colors.ts`.
3. Update `apps/app/global.css` with base surface and text defaults.
4. Load Inter, Outfit, and DM Sans in `apps/app/app/_layout.tsx`.
5. Perform the mechanical semantic remap:
   - `gray-* -> warm-*`
   - `blue-* -> primary-*`
   - `bg-white -> bg-surface` or `bg-warm-50` as context requires
   - preserve semantic error, success, warning, and activity tokens

Verification:

- `pnpm -C apps/app typecheck`
- `pnpm -C apps/app test`
- spot checks on the current screens show token migration without structural regressions

## Phase 3: Platform Foundations And Shared UI Primitives

**Goal**: Build the reusable primitives the rest of the sprint depends on.

Tasks:

1. Create a shared shadow helper for native and web.
   - file: `apps/app/src/lib/shadows.ts`
   - include named shadows for card, preview, search, tab bar, dropdown, auth glow, bottom sheet

2. Create blur containers for native and web.
   - `apps/app/src/components/ui/BlurContainer.native.tsx`
   - `apps/app/src/components/ui/BlurContainer.web.tsx`
   - **Android caveat**: `expo-blur` uses `RenderEffect` (real blur) on SDK 31+ only. On the S10e debug device (SDK 30 / Android 11), it falls back to a flat semi-transparent overlay — no frosted-glass effect. This is expected; do not flag it as a bug during visual acceptance on that device.

3. Migrate icons from `@expo/vector-icons` to Phosphor (`phosphor-react-native` / `@phosphor-icons/react` for web).

Phosphor icons support multiple weights: `thin`, `light`, `regular`, `bold`, `fill`, `duotone`. Default to `regular` for UI chrome and `bold` or `fill` for active/selected states.

The pen file uses the `phosphor` icon font exclusively (54 unique icons, 8568 instances). The packages are `phosphor-react-native` (native) and `@phosphor-icons/react` (web).

**Build note**: After adding `phosphor-react-native`, run `npx expo prebuild --clean` and do a full rebuild. There is an open issue ([phosphor-react-native#82](https://github.com/duongdev/phosphor-react-native/issues/82)) where stale Fabric build artifacts cause a `topSvgLayout` event error on this exact stack (Expo SDK 54 / RN 0.81.5 / React 19). A clean prebuild resolves it. Also ensure `react-native-svg` is >= 15.12.1.

Primary mapping set (Ionicons/FontAwesome → Phosphor, verified against pen):

| Old | Phosphor | Pen icon name |
|-----|----------|---------------|
| `heart-outline` | `Heart` (`fill` weight for active) | `heart` / `heart-fill` |
| `chatbubble-outline` | `ChatCircle` | `chat-circle` |
| `close` / `close-circle` | `X` | `x` |
| `search` | `MagnifyingGlass` | `magnifying-glass` |
| `location-outline` | `MapPin` | `map-pin` |
| `arrow-back` | `CaretLeft` | `caret-left` |
| `share-social` | `ShareNetwork` | `share-network` |
| `bookmark-outline` | `BookmarkSimple` (`fill` weight for saved) | `bookmark-simple` |
| `person-outline` | `User` | `user` |
| `send` | `PaperPlaneTilt` | `paper-plane-tilt` |
| `eye-outline` | `Eye` | `eye` |
| `information-circle` | `Info` | `info` |
| `trending-up` | `ChartLineUp` | `chart-line-up` |
| `time-outline` / `calendar` | `Calendar` | `calendar` |
| `log-out-outline` | `SignOut` | `sign-out` |
| `notifications-outline` | `Bell` | `bell` |
| `home` | `HouseLine` (`bold` weight for active tab) | `house-line-bold` |
| `flame` | `Flame` | `flame` |
| `star` | `Star` (`fill` weight for active) | `star` |
| `list` | `List` | `list` |
| `camera` | `Camera` | `camera` |
| `plus` / `add` | `Plus` | `plus` |
| `check` / `checkmark` | `Check` | `check` |
| `warning` | `WarningCircle` | `warning-circle` |
| `crown` | `Crown` | `crown` |
| `trophy` | `Trophy` | `trophy` |

Additional icons used in pen (no old equivalent — new for this sprint):

| Phosphor | Pen icon name | Usage |
|----------|---------------|-------|
| `ArrowLeft` / `ArrowRight` | `arrow-left` / `arrow-right` | Back navigation, carousel arrows |
| `ArrowSquareOut` | `arrow-square-out` | External link |
| `Crosshair` | `crosshair` | Current-location button |
| `DotsThreeVertical` | `dots-three-vertical` | Overflow/more menu |
| `Envelope` | `envelope` | Email magic link auth |
| `Tag` | `tag` | Price guess icon |
| `Ruler` | `ruler` | Floor area metric |
| `CurrencyEur` | `currency-eur` | Price/valuation |
| `MapTrifold` | `map-trifold` (`bold` for active tab) | Map tab icon |
| `Buildings` | `buildings` | Property/building context |
| `Users` | `users` | Community/leaderboard |
| `Medal` | `medal` | Achievement badge |
| `ShieldCheck` | `shield-check` | Verified/trust badge |
| `CheckCircle` | `check-circle` | Success/accurate state |
| `CaretDown` / `CaretRight` | `caret-down` / `caret-right` | Dropdowns, expand/collapse |
| `Globe` | `globe` | Country/international |
| `Link` | `link` | URL/listing link |
| `Thermometer` | `thermometer` | Activity level indicator |
| `TrendDown` | `trend-down` | Price decrease indicator |
| `ListBullets` | `list-bullets-bold` | Bullet list content |

High-volume file targets include:

- `apps/app/app/_layout.tsx`
- `apps/app/app/(tabs)/_layout.tsx`
- `apps/app/app/(tabs)/profile.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- `apps/app/app/property/[id].tsx`
- `apps/app/app/[...address].tsx`
- `apps/app/src/components/AuthModal.tsx`
- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/PropertyFeedCard.tsx`
- `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`
- `apps/app/src/components/FMVVisualization.tsx`
- `apps/app/src/components/ConsensusAlignment.tsx`
- `apps/app/src/components/FeedFilterChips.tsx`
- `apps/app/src/components/CommentList.tsx`
- `apps/app/src/components/PriceGuessSlider.tsx`

4. Create `UserAvatar`.
   - deterministic warm-toned palette from username hash
   - size variants for comments, cards, and profile

5. Create unified `KarmaBadge`.
   - one shared tier definition
   - frontend and backend copy must match

6. Create `NotificationBell` early because Feed, Saved, Profile, and Notifications use it.

7. Add baseline wrappers where repetition is obvious.
   - chips
   - cards
   - buttons

8. Implement reduced-motion support at primitive level.

Verification:

- unit tests for avatar, badge, and primitive behavior
- web/native render validation for blur and shadows
- icon rendering parity on web and native

## Phase 4: Map Controller Parity And Map Shell Refactor

**Goal**: Reduce web/native drift before heavy visual work lands on the map.

Tasks:

1. Audit duplication between:
   - `apps/app/app/(tabs)/index.tsx`
   - `apps/app/app/(tabs)/index.web.tsx`

2. Extract or align shared map interaction logic and state semantics, without collapsing the renderer shells into one implementation:
   - selection state
   - preview-group state
   - cluster paging
   - bottom-sheet state transitions
   - auth-gated action triggers
   - search-selection behavior
   - keep separate platform renderer files:
     - `apps/app/app/(tabs)/index.tsx`
     - `apps/app/app/(tabs)/index.web.tsx`

3. Define parity for events and state transitions:
   - same quick-action semantics
   - same preview persistence rules
   - same dismissal rules
   - parity means shared behavior and event semantics, not a forced single-file map implementation

4. Stabilize test IDs and selectors for map shell and preview interactions.

Verification:

- web and native flows still pass after refactor
- no regressions in preview persistence, selection, or bottom-sheet transitions

## Phase 5: Navigation Shell, Map Chrome, And Search Overlay

**Goal**: Deliver the final floating shell and map-chrome system shown in the pen.

Tasks:

1. Replace the default Expo tab bar with a custom floating pill.
   - new file: `apps/app/src/components/navigation/CustomTabBar.tsx`
   - translucent on map, solid on non-map tabs
   - safe-area aware
   - animated active capsule

2. Move tab headers in-screen where required.

3. Implement the map-screen header row.
   - brand mark
   - city or location display
   - status-bar aware spacing

4. Implement the final search bar and focus states.
   - 48px shell
   - search icon
   - no decorative mic icon
   - clear button
   - gold focus ring

5. Implement search overlay dimming and dropdown styling.

6. Implement the current-location floating button.

7. Implement map top and bottom gradients.

8. Ensure the shell carries to wide and landscape layouts.

Concrete file targets:

- `apps/app/app/(tabs)/_layout.tsx`
- `apps/app/src/components/navigation/CustomTabBar.tsx`
- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- map tab screens that currently rely on router headers

Verification:

- visual targets:
  - `1. Map Screen.jpg`
  - `2. Search Results.jpg`
- phone web screenshot
- Android screenshot
- wide-web shell screenshot

## Phase 6: Preview Overlay System And Quick-Preview Bottom-Sheet Parity

**Goal**: Bring single-preview, cluster-preview, and quick-preview detail surfaces to final parity.

Tasks:

1. Redesign the single property preview card.
   - image area
   - close button
   - pointer triangle
   - stat pills
   - quick actions
   - this becomes the shared single-property preview primitive/content used by both preview paths, not a separate runtime owner of map preview state

2. Redesign the cluster preview card wrapper and paging model.
   - `GroupPreviewCard` remains the canonical runtime owner/composer for geo-anchored map previews on both web and native
   - single-property map previews should also flow through `GroupPreviewCard` when shown on-map
   - `PropertyPreviewCard` may exist only as a presentational subcomponent or extracted content primitive if that reduces duplication
   - do not reintroduce separate runtime preview ownership paths for `PropertyPreviewCard` and `GroupPreviewCard`
   - add cluster navigation, pagination, close controls, and map-specific affordances on top of the shared card

3. Ensure quick-preview bottom sheet belongs to the same visual language as the full-page route.

4. Preserve current interaction rules:
   - preview persistence during map gestures
   - map tap dismissal semantics
   - auth gating only at submit points where applicable

5. Ensure map quick actions route correctly.
   - like
   - comment
   - guess
   - card tap

Concrete file targets:

- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`
- relevant quick-preview and bottom-sheet components under `apps/app/src/components/PropertyBottomSheet/`

Verification:

- visual targets:
  - `Preview Card Wrapper.jpg`
  - `Preview Card Wrapper-1.jpg`
  - `Cluster Preview Card Wrapper.jpg`
- focused Playwright clips
- Android focused screenshots
- flow tests for preview persistence and quick-action behavior

## Phase 7: Shared Property Interaction Modules

**Goal**: Build reusable modules that power property detail, bottom sheet, comments, guesses, and list cards.

Tasks:

1. Consolidate and redesign:
   - `FMVVisualization`
   - `PriceGuessSlider`
   - `ConsensusAlignment`
   - listing source rows
   - metric pills
   - quick action rows
   - comment cell
   - comment input
   - one-level reply thread layout

2. Establish one reusable media-and-metrics card model for property-centric surfaces.

3. Ensure modules support:
   - official valuation present or absent by country
   - asking price present or absent
   - listing photo present or absent
   - user guess present or absent
   - low-confidence FMV states

4. Introduce shared image fallback rules.

5. Introduce achievement domain model and shared types from backend or shared package, not local UI constants.

6. Prepare modules for both quick-preview and full-screen contexts.
   - shared preview primitive lands before final cluster wrapper polish

Verification:

- unit tests for FMV, guess, and comment rendering edge cases
- focused visual tests for shared modules

## Phase 8: Feed, Saved, And Recent Activity Surfaces

**Goal**: Deliver the final list-based browsing surfaces.

Tasks:

1. Redesign and migrate feed filters.
   - `Trending`
   - `Latest`
   - `Recent Activity`
   - proper active and inactive states
   - update the backend `/feed` contract, frontend `FeedFilter` type, hooks, mocks, Playwright, and Maestro in the same workstream
   - remove `Controversial` and `Price Mismatch` from the canonical feed UI unless they are intentionally retained elsewhere

2. Redesign property feed cards.
   - media header
   - address row
   - activity or status badge
   - price row
   - stat pills

3. Add recent-activity card variant and corresponding data hook.

4. Redesign the saved screen using the same card system.

5. Add `NotificationBell` to Feed and Saved.

6. Add empty states and unauthenticated states matching final visuals.

7. Ensure wide and landscape keep the same component system.

Concrete file targets:

- `apps/app/src/components/FeedFilterChips.tsx`
- `apps/app/src/components/PropertyFeedCard.tsx`
- `apps/app/src/components/ActivityFeedCard.tsx`
- `apps/app/app/(tabs)/saved.tsx`
- feed screen and feed hooks

Backend and data dependencies:

- feed response and query contract must be updated to the final chip model before Phase 8 UI work is considered complete
- feed response must include enough photo and metric data
- activity feed response must exist
- generated client, mocks, hooks, and tests must migrate together with the backend feed contract

Verification:

- visual targets:
  - `4. Feed - Trending Chosen.jpg`
  - `5. Feed - Recent Activity Chosen.jpg`
  - `6. Saved Screen.jpg`
- web and Android screenshots
- wide-web screenshots

## Phase 9: Profile, Notifications, Leaderboard, And Social Reputation

**Goal**: Deliver the final social reputation layer and account-adjacent surfaces.

Tasks:

1. Redesign the profile screen.
   - profile card
   - stats grid
   - achievements row
   - recent activity log
   - settings dropdown

2. Implement achievements backed by a real domain model.

3. Implement the recent activity log backed by API.

4. Build the notifications page.

5. Build the leaderboard page.

6. Add `NotificationBell` anywhere the design expects it.

7. Add navigation paths from profile or achievements to leaderboard where intended.

Concrete file targets:

- `apps/app/app/(tabs)/profile.tsx`
- `apps/app/app/notifications.tsx`
- `apps/app/app/leaderboard.tsx`
- `apps/app/src/hooks/useNotifications.ts`
- `apps/app/src/hooks/useLeaderboard.ts`

Critical requirement:

- do not fake achievements or activity rows in UI without shared or backend semantics

Verification:

- visual targets:
  - `7. Profile Screen.jpg`
  - `8. Social Notifications.jpg`
  - `9. Community Leaderboard.jpg`
- web and Android screenshots
- wide-web screenshots

## Phase 10: Auth, Identity, And Delivery Readiness

**Goal**: Make the final auth surface truthful and production-ready.

Tasks:

1. Redesign `AuthModal`.
   - final card styling
   - Google button
   - Apple button
   - optional email entry state

2. Finish Apple auth verification flow instead of leaving placeholder logic.

3. Keep Google auth aligned with the final modal.

4. If email magic link stays in scope:
   - implement backend request and verify flow
   - implement deep link handling
   - add success and error states

5. Ensure progressive auth gating still matches product behavior.
   - browsing open
   - save gated
   - guess and comment may begin before submit gate

6. Ensure auth modal can be triggered consistently from:
   - map quick actions
   - bottom sheet
   - profile unauthenticated state
   - saved unauthenticated state

Concrete file targets:

- `apps/app/src/components/AuthModal.tsx`
- `apps/app/src/providers/AuthProvider.tsx`
- auth deep-link route if email magic link is included

Verification:

- visual target: `3. Auth Modal.jpg`
- happy-path and failure-path tests
- no placeholder Apple path remains

## Phase 11: Backend Features, Contracts, And Async Delivery

**Goal**: Provide all backend and data capabilities the final UI depends on.

### 11A. Notifications

Database:

- new `notifications` table with `recipient_user_id`, `actor_user_id`, `event_type`, `property_id`, optional target ids (`comment_id`, `guess_id`, `reaction_id`), typed `payload` JSONB, `read_at`, and timestamps
- do not persist final rendered localized notification text as the source of truth; derive display copy from `event_type + payload` at the API/client layer
- if server-provided preview copy is needed, store a stable `message_key` plus template args rather than a localized message string
- indexes:
  - `(recipient_user_id, created_at DESC)`
  - partial unread index on `(recipient_user_id, created_at DESC) WHERE read_at IS NULL`

Routes:

- `GET /notifications`
- `GET /notifications/unread-count`
- `PUT /notifications/read-all`
- `PUT /notifications/:id/read`

Delivery:

- add device-scoped push token storage
- register push token from app against a device record, not a single user field
- send push via Expo server SDK when appropriate
- include deep-link metadata for navigation

### 11B. Leaderboard

No required new table if current data supports it.

Route:

- `GET /leaderboard?period=week|month|all&limit=50`

Response should include:

- rankings
- current user rank
- optional `featuredProperty`
- `featuredProperty` must be sourced from a deterministic scorer for the same requested period, based on weighted property engagement (`comments + guesses + property likes`)
- if that scorer is not implemented in the same workstream, return `featuredProperty: null` and do not block leaderboard delivery on it

### 11C. Activity Event Surface

Route:

- `GET /activity`

Requirements:

- dedicated event surface rather than a feed algorithm branch
- include public social events only: property likes, comments, and price guesses
- exclude saved/bookmark events from `GET /activity` because saves are private account state, not community activity
- `GET /users/me/activity` may include private save events in addition to the public event types if the profile UX needs a full personal history
- actor payload
- property payload
- timestamp
- pagination

### 11D. User Activity

Route:

- `GET /users/me/activity`

### 11E. Likes-Domain Cleanup

The codebase has already converged on a likes-only API contract. All endpoints use `/like` paths (`POST/DELETE /properties/:id/like`, `POST/DELETE /comments/:id/like`), all frontend hooks are `usePropertyLike`, and the DB only inserts/queries `reactionType='like'`. The DB table is named `reactions` with a 4-type enum (`like`, `love`, `wow`, `angry`) but only `like` is ever used.

Remaining cleanup:

- rename `services/api/src/routes/reactions.ts` to `likes.ts`
- clean up stale `packages/shared/src/types/reaction.ts` (references unused `'share'` type and generic `Reaction`/`ReactionCounts` interfaces)
- document the DB schema decision: keep `reactions` table as-is, likes-only contract at the API layer

### 11F. Achievements

Requirements:

- shared achievement registry module with stable `achievement_key`, name, description, icon, and rule definition
- persistence via `user_achievements` table with `user_id`, `achievement_key`, `awarded_at`, optional source event references, and `UNIQUE(user_id, achievement_key)`
- deterministic award service that evaluates rules and records unlocks
- API delivery that merges registry metadata with per-user unlock state

### 11G. Email Auth

If kept in scope:

- `POST /auth/email/request`
- `POST /auth/email/verify`
- token table
- delivery service
- deep-link verification path

### 11H. Async Or Queue Work

Enable if needed for correctness:

- email delivery
- push fan-out
- expensive notification fan-out
- leaderboard recalculation if synchronous computation proves unstable

Contract rule:

- backend route schemas are canonical; OpenAPI export, generated client, mocks, and integration tests are updated in the same workstream, not after.
- activity, notification, push-delivery, and feed-filter contract migrations are updated before the related UI phases proceed.

Likely backend file targets:

- migrations under `services/api/drizzle/`
- route files under `services/api/src/routes/`
- services under `services/api/src/services/`
- shared contract updates in `packages/shared/` and `packages/api-client/`
- services for notifications, push, email, achievements, and activity event logic

Verification:

- backend integration suite green
- contract and client regeneration complete
- mocks updated
- deterministic fixtures for notification, activity, and leaderboard surfaces

## Phase 12: Full-Screen Property, Comments, And Guesses Routes

**Goal**: Ship the one canonical full property page and its related routes while preserving coherence with quick-preview.

Tasks:

1. Redesign `/property/[id]` as the single canonical full scroll property page.
   - hero media
   - detail sections
   - crowd estimate
   - listing section
   - comments preview
   - guesses entry point
   - action row
   - reuse the same property-detail content module used in the portrait bottom sheet and landscape side panel
   - keep container-specific chrome only; do not create parallel full-page vs bottom-sheet detail implementations

2. Build `/comments/[propertyId]`.
   - header
   - sort toggle
   - threaded comments list
   - pinned input bar

3. Build `/guesses/[propertyId]`.
   - header
   - property image card
   - crowd estimate card
   - distribution card
   - recent guesses
   - sticky CTA

4. Wire navigation from:
   - feed cards
   - saved cards
   - recent-activity cards
   - notification rows
   - profile activity rows
   - property detail internal CTAs

5. Reuse shared modules from phase 7 instead of reimplementing them.
   - the full property page, portrait bottom sheet, and landscape side panel all consume the same property-detail content system
   - bottom sheet and side panel remain quick-preview containers/presentations of that shared content system

Concrete file targets:

- `apps/app/app/property/[id].tsx`
- `apps/app/app/comments/[propertyId].tsx`
- `apps/app/app/guesses/[propertyId].tsx`
- supporting components for full comments list, sort toggle, guesses list, and distribution chart

Verification:

- visual targets:
  - `10. Property Detail — Full Scroll Content.jpg`
  - `11. Price Guesses Page.jpg`
  - `12. Comments Page.jpg`
- web and Android screenshots
- wide-web screenshots
- no parallel property-detail container diverges in content semantics

## Phase 13: Route Consolidation And Product-Surface Cleanup

**Goal**: Remove ambiguous or duplicated surface ownership that would otherwise keep rotting after the overhaul.

Tasks:

1. Resolve `app/[...address].tsx`.
   - convert to a redirect or resolver into canonical routes, with `/property/[id]` as the canonical full-page property route if the resolver remains
   - or remove it if obsolete
   - do not allow `[...address]` to become a second property-detail implementation

2. Remove placeholder city or postcode branches if they are not part of the final vision.

3. Ensure one canonical path for:
   - property detail
   - comments page
   - guesses page
   - notifications page
   - leaderboard page

4. Remove dead or conflicting UI from old paths.

Verification:

- route tests pass
- no duplicate unfinished property experiences remain

## Phase 14: Accessibility, Motion, And Responsive Carry-Over

**Goal**: Ensure the final visual system is polished, accessible, and credible beyond phone-sized screenshots.

Tasks:

1. Contrast audit against the final palette.
2. Touch-target audit.
3. Screen-reader labels for new controls and routes.
4. Reduced-motion behavior for every new animation.
5. Large-font and dynamic-text sanity checks.
6. Wide-web and Android landscape layout checks for key surfaces.
7. Country-aware copy and value fallback audit.
   - official valuation labels
   - listing-source visibility
   - address formatting
   - image fallback behavior outside NL

Verification:

- accessibility checks documented
- responsive screenshots saved for key surfaces
- no unintended NL-only labels leak into non-NL contexts

## Phase 15: Visual-Agent Loop And Final Sign-Off

**Goal**: Close the sprint only after iterative visual review on both web and native says the result is sufficient.

Tasks:

1. For each of the 15 visual targets:
   - capture web artifact
   - capture Android artifact
   - compare against pen export
   - if `NEEDS_WORK`, reopen the owning task

2. For wide and landscape carry-over:
   - capture wide web screenshots for major routed surfaces
   - capture Android landscape smoke screenshots for map and at least one routed surface

3. Run full verification:
   - `pnpm -C apps/app typecheck`
   - `pnpm -C apps/app test`
   - `pnpm -C services/api test`
   - `pnpm -C packages/shared test`
   - `pnpm test:integration`
   - `pnpm test:e2e:web`
   - `pnpm test:e2e:mobile`

4. Reconcile root scripts with actual required commands if any drift remains.

5. Produce the final checklist confirming:
   - all 15 visual targets approved
   - no console or runtime errors during captures
   - no unresolved route duplication
   - no placeholder auth or profile behavior
   - no test-command gaps

## Visual Verification Workflow

For every visual target, use this loop:

1. `Analyzer`
   - compare pen export to the latest web and native artifacts
   - list concrete visual and behavioral gaps

2. `Fixer`
   - implement the gaps
   - update tests
   - regenerate artifacts

3. `Visual Tester`
   - compare pen export with both web and native artifacts
   - return `SUFFICIENT` or `NEEDS_WORK`

4. `Lead`
   - reopen if `NEEDS_WORK`
   - close only when both web and native are sufficient

The sprint does not close based only on code review or a single-platform screenshot.

## Success Criteria

The sprint is complete only when all are true:

- the shipped experience matches the 15 pen exports for their named states
- web and Android native both pass the visual-review loop for those states
- major routed surfaces also pass wide or landscape carry-over review
- old unfinished or duplicate property paths are resolved
- the design system is fully migrated away from the old blue and cool-gray language
- quick-preview and full-detail routes feel like one system
- all new backend features required by the UI are real, typed, mocked, and tested
- root test scripts comply with project rules
- no placeholder auth branches remain
- no required final-vision features remain as "future work"

## Immediate Execution Recommendation

Start with these bundles in parallel:

1. `Team A`
   - phase 1 contract, tooling, and test hardening

2. `Team B`
   - phase 2 token migration
   - phase 3 primitives

3. `Team C`
   - phase 4 map parity refactor discovery and implementation

4. `Team E`
   - backend design and implementation for notifications, activity, leaderboard, achievements, and auth deltas

Once those stabilize:

5. `Team C`
   - phase 5 and phase 6 map-shell and overlay work

6. `Team D`
   - phase 8 and phase 9 social and account surfaces

7. `Team F`
   - phase 12 route assembly
   - phase 13 cleanup

Throughout the sprint:

8. `Verification Team`
   - maintain per-surface screenshot capture and visual review continuously instead of batching all review at the end

# Visual Design Overhaul — Complete Sprint Implementation Plan

**Date**: 2026-03-21
**Source of truth**: `docs/superpowers/specs/2026-03-17-visual-design-overhaul-design.md` (design spec)
**Pen file**: `docs/visual-references/design-overhaul/huishype-visual-overhaul.pen` (15 screens)
**Status**: Implementation plan — ready for execution

---

## Executive Summary

This sprint transforms HuisHype from a clinical blue-and-white prototype into the finalized warm gold brand experience defined in the pen design file. The scope covers:

- **Style normalization**: Pre-migration cleanup of 286 inline hex colors, 101+ raw numeric spacings, inconsistent Tailwind semantics across 30+ files
- **Design system foundation**: New color palette (gold primary, warm neutrals), 3 custom fonts, Lucide icons, warm shadows, backdrop blur
- **Component overhaul**: 34+ files need icon migration, color token swaps, typography changes
- **New screens**: 4 entirely new full-screen pages (Notifications, Leaderboard, Comments Page, Price Guesses Page)
- **Major rewrites**: Tab bar (floating pill), Property Detail (full page), Feed cards (photo + stats), Profile (achievements + activity)
- **Backend additions**: Notifications system, Leaderboard endpoint, Social activity feed algorithm, Email auth (magic link), reactions→likes table refactor
- **Verification**: Visual regression testing on all 15 design screens

---

## Gap Analysis Summary

### What Exists Today vs What The Design Requires

| Area | Current State | Design Requires | Gap |
|------|--------------|-----------------|-----|
| **Colors** | Blue primary `#3B82F6`, cool grays | Gold `#F5A623`, warm neutrals `#FFFBF5` | Full palette swap |
| **Fonts** | System fonts + SpaceMono | Inter + Outfit + DM Sans | 3 new font families |
| **Icons** | `@expo/vector-icons` (Ionicons/FA) | `lucide-react-native` | 34 files to migrate |
| **Tab bar** | Default Expo Router flat bar | Custom floating translucent pill with gold capsule | Full rewrite |
| **Search bar** | Basic input | Backdrop blur, gold focus ring, mic icon | Redesign |
| **Feed cards** | Text-only cards | Photo header, activity badges, colored stat pills | Major redesign |
| **Preview card** | Basic preview | Close button, arrow pointer, quick actions | Redesign |
| **Property detail** | Bottom sheet with `PropertyContent` | Full-page scroll view with hero image | Architecture change |
| **Comments page** | Inline section only | Full-screen with sort toggle, threading, pinned input | New screen |
| **Price guesses page** | Inline section only | Full-screen with distribution chart, CTA bar | New screen |
| **Notifications** | Nothing | Full notification system + page | New feature + backend |
| **Leaderboard** | Nothing | Full leaderboard with podium, rankings | New feature + backend |
| **Social activity feed** | Nothing | "Recent Activity" feed variant with user action cards | New feature + backend |
| **Email auth** | Nothing | Email sign-in button in auth modal | New auth method |
| **Profile achievements** | Nothing | Achievement icons row | New feature |
| **Profile activity log** | Guess history only | Full activity log (likes, comments, guesses) | Enhancement |
| **User avatars** | Blue circle with initials | Warm-toned deterministic palette | Enhancement |
| **Backdrop blur** | Not installed | Tab bar, search, location button, close buttons | New package + components |
| **Shadows** | Default/none | Warm gold-tinted shadow system | New shadow helper |
| **Animations** | Basic card entrance | Tab capsule slide, like bounce, hot pulse, etc. | New animations |
| **Property photos** | PDOK aerial only (NL) | Listing thumbnail photos in cards | Enhancement |

### Backend Gaps

| Feature | Tables Needed | Endpoints Needed | Complexity |
|---------|--------------|-----------------|------------|
| **Notifications** | `notifications` (type, actor_id, target_id, property_id, read, created_at) | `GET /notifications`, `PUT /notifications/read-all`, `GET /notifications/unread-count` | High |
| **Leaderboard** | None (computed from `price_guesses`, `comments`, `users`) | `GET /leaderboard?period=week\|month\|all` | Medium |
| **Reactions→Likes refactor** | Rename `reactions` → `likes`, drop multi-type support | Update existing routes referencing reactions | Low |
| **Social activity feed** | None (joins `likes`, `comments`, `price_guesses` after refactor) | `GET /feed?algorithm=activity` | Medium |
| **Email auth** | `email_auth_tokens` (token, email, expires_at, used) | `POST /auth/email/request`, `POST /auth/email/verify` (magic link) | Medium |
| **User activity log** | None (join across `price_guesses`, `comments`, `likes`) | `GET /users/me/activity` | Low |

---

## Sprint Phases

### Dependency Graph

```
Phase 0 (Packages)
  ↓
Phase 0.5 (Style Normalization) ← clean up bad practices so token migration is mechanical
  ↓
Phase 1 (Design Tokens) ← prerequisite for ALL subsequent phases
  ↓
Phase 2 (Foundation: Shadows, Blur, Avatars) ← used by all component phases
  ↓
┌──────────────────────────────────────────────────────────────────────┐
│ These can run in PARALLEL after Phase 2:                             │
│                                                                      │
│ Phase 3 (Icons)         Phase 4 (Tab Bar)        Phase 5 (Backend)  │
│ Phase 6 (Search Bar)    Phase 7 (Filter Chips)                       │
│ Phase 8 (Feed Cards)    Phase 9 (Preview Card)                       │
│ Phase 10 (Auth Modal)   Phase 11 (Saved Screen)                      │
│ Phase 12 (Profile)      Phase 13 (Animations)                        │
└──────────────────────────────────────────────────────────────────────┘
  ↓ (After Phase 5 backend is done)
┌──────────────────────────────────────────────────────────────────────┐
│ These require backend endpoints from Phase 5:                        │
│                                                                      │
│ Phase 14 (Property Detail Full Page)                                 │
│ Phase 15 (Comments Full Page)                                        │
│ Phase 16 (Price Guesses Full Page)                                   │
│ Phase 17 (Social Activity Feed)                                      │
│ Phase 18 (Notifications Page)                                        │
│ Phase 19 (Leaderboard Page)                                          │
└──────────────────────────────────────────────────────────────────────┘
  ↓
Phase 20 (Visual Regression & Test Suite)
```

---

### Phase 0: Package Installation & Native Rebuild
**Estimated files**: 2 | **Risk**: Low | **Blocking**: Everything

**Goal**: Install all new dependencies and rebuild the native app.

**Tasks**:
1. Install packages:
   ```bash
   cd apps/app
   npx expo install expo-blur expo-notifications expo-device @expo-google-fonts/inter @expo-google-fonts/outfit @expo-google-fonts/dm-sans
   pnpm add lucide-react-native react-native-svg
   ```
   Note: `expo-font` and `expo-constants` are already installed. `npx expo install` resolves SDK 54-compatible versions automatically (expo-blur ~15.0.8, expo-notifications ~0.32.16, expo-device ~8.0.10).
   Backend (for email auth + push notifications):
   ```bash
   pnpm -C services/api add resend expo-server-sdk
   ```
2. Run `pnpm install` from monorepo root to update lockfile
3. Native rebuild: `npx expo run:android` (expo-blur and react-native-svg have native modules)
4. Clear Metro cache: `rm -rf /tmp/metro-* /tmp/haste-map-*`
5. Restart services: `systemctl --user restart huishype-expo`
6. Verify app boots on device and web

**Files changed**: `apps/app/package.json`, `services/api/package.json`, `pnpm-lock.yaml`

**Verification**: App launches without crashes on both web (localhost:8081) and Android device.

---

### Phase 0.5: Style Normalization (Pre-Migration Cleanup)
**Estimated files**: 30+ | **Risk**: Medium (many files, but each change is small and safe) | **Blocking**: Phase 1

**Goal**: Eliminate inline style bad practices and normalize inconsistent Tailwind patterns so that Phase 1's token migration becomes purely mechanical (grep-and-replace) rather than a mixed cleanup+migration.

**Why this matters**: The audit found **286 hardcoded hex values** in inline styles, **101+ raw numeric spacing values**, **682 Tailwind color class usages** with inconsistent semantic mapping, and **5 files with conflicting className+style**. Without cleanup first, Phase 1 would have to simultaneously decide "what is this color semantically?" AND "what warm token replaces it?" — doubling the cognitive load and error risk.

**Tasks**:

#### 0.5A: Extract inline hex colors to Tailwind classes

Replace hardcoded hex colors in `style={{ }}` props with equivalent Tailwind className. Use **current** palette names (blue/gray) — Phase 1 will remap them.

**Mapping table** (inline hex → current Tailwind class):

| Hex | Count | Tailwind Equivalent | Semantic |
|-----|-------|-------------------|----------|
| `#3B82F6` | 20 | `text-blue-500` / `bg-blue-500` | Primary blue |
| `#2563EB` / `#2563eb` | 19 | `text-blue-600` / `bg-blue-600` | Primary blue alt |
| `#6B7280` | 42 | `text-gray-500` | Secondary text |
| `#9CA3AF` | 34 | `text-gray-400` | Muted text / icon gray |
| `#4B5563` | 7 | `text-gray-600` | Dark text variant |
| `#111827` | 5 | `text-gray-900` | Primary dark text |
| `#1F2937` | 3 | `text-gray-800` | Dark text |
| `#374151` | 1 | `text-gray-700` | Charcoal text |
| `#E5E7EB` | 9 | `border-gray-200` / `bg-gray-200` | Light border |
| `#D1D5DB` | 9 | `border-gray-300` / `bg-gray-300` | Medium border |
| `#F3F4F6` | 5 | `bg-gray-100` | Light background |
| `#FFFFFF` / `#fff` | 28 | `bg-white` / `text-white` | White |
| `#000` | 4 | `text-black` / `bg-black` | Black |
| `#EF4444` | 19 | `text-red-500` / `bg-red-500` | Red (likes/errors) |
| `#22C55E` / `#10B981` | 10 | `text-green-500` / `text-emerald-500` | Success green |
| `#F97316` / `#FB923C` | 9 | `text-orange-500` / `text-orange-400` | Activity orange |
| `#F59E0B` | 2 | `text-amber-500` | Warning amber |

**Exceptions** (keep as inline styles — cannot be Tailwind classes):
- `rgba()` values for shadows and overlays (13 instances) — these move to the shadow helper in Phase 2
- Dynamic/computed values (e.g., `fontSize: size * 0.4`)
- Platform-specific layout styles that must be in StyleSheet (animation transforms, etc.)
- `#4285F4` (Google brand blue) — keep as-is, brand requirement

**Top 10 files to process** (by violation count):
1. `src/components/GroupPreviewCard.tsx` — 28 hex + 32 numeric (worst offender)
2. `src/components/PropertyPreviewCard.tsx` — 22 hex + 19 numeric
3. `app/(tabs)/index.web.tsx` — 19 hex
4. `app/[...address].tsx` — 17 hex
5. `app/(tabs)/index.tsx` — 16 hex
6. `src/components/SearchResults.tsx` — 14 hex + 7 numeric
7. `src/components/PropertyBottomSheet/ListingSubmissionSheet.tsx` — 13 hex
8. `src/components/PriceGuessSlider.tsx` — 9 hex + 7 numeric + className/style conflict
9. `src/components/PropertyBottomSheet/PropertyHeader.tsx` — 3 hex (in StyleSheet)
10. `src/components/AerialImageCard.tsx` — 6 hex (in StyleSheet)

#### 0.5B: Fix className + style conflicts

5 files have the same property set via both `className` and `style`, with the inline style silently overriding Tailwind:

| File | Issue |
|------|-------|
| `PriceGuessSlider.tsx` (line ~511) | `className="text-gray-500"` overridden by `style={{ color: '#6B7280' }}`, duplicate `font-semibold`/`fontWeight`, `ml-2`/`marginLeft: 8` |
| `AuthModal.tsx` | `className="bg-white"` mixed with `style={styles.sheetInner}` |
| `CommentList.tsx` | `className="text-white"` + `style={{ fontSize: size * 0.4 }}` |
| `Comments/Comment.tsx` | Same as CommentList |
| `ConsensusAlignment.tsx` | `Animated.View` with both `style={animatedStyle}` and `className` |

**Resolution**: Remove the inline style when className already covers it. For Reanimated `Animated.View`, keep `style` for animated values only, move static props to `className`.

#### 0.5C: Normalize raw numeric spacing to Tailwind

Convert the most common raw numeric spacing patterns to Tailwind equivalents. **Only convert values that map cleanly to the Tailwind spacing scale** (multiples of 4: 4→1, 8→2, 12→3, 16→4, 20→5, 24→6, 32→8, etc.):

| Raw Value | Tailwind | Occurrences |
|-----------|----------|-------------|
| `padding: 16` / `paddingHorizontal: 16` | `p-4` / `px-4` | ~15 |
| `marginBottom: 12` / `marginTop: 12` | `mb-3` / `mt-3` | ~10 |
| `marginLeft: 8` / `marginRight: 8` | `ml-2` / `mr-2` | ~8 |
| `padding: 8` | `p-2` | ~6 |
| `gap: 8` / `gap: 12` / `gap: 16` | `gap-2` / `gap-3` / `gap-4` | ~10 |
| `borderRadius: 12` / `borderRadius: 8` | `rounded-xl` / `rounded-lg` | ~8 |

**Exceptions** (keep as numeric):
- Dynamic/computed values (`width: contentSize.width`)
- Non-standard values that don't map to Tailwind scale (`width: 420`, `THUMBNAIL_SIZE = 56`)
- Values inside `StyleSheet.create` that power animations
- Layout dimensions specific to platform (web side panel width, etc.)

#### 0.5D: Normalize inconsistent Tailwind color semantics

Consolidate cases where the same visual purpose uses different shades. Use the **most common** shade as the winner:

| Semantic Purpose | Current (inconsistent) | Normalized To |
|-----------------|----------------------|---------------|
| **Muted/secondary text** | `text-gray-300`, `text-gray-400`, `text-gray-500` | `text-gray-500` (98 usages, clear winner) |
| **Disabled text** | `text-gray-300`, `text-gray-400` | `text-gray-400` |
| **Error background** | `bg-red-50`, `bg-red-100` | `bg-red-50` |
| **Error text** | `text-red-500`, `text-red-600`, `text-red-700` | `text-red-600` |
| **Success background** | `bg-green-50`, `bg-green-100`, `bg-green-200` | `bg-green-100` |
| **Success text** | `text-green-600`, `text-green-700`, `text-green-800` | `text-green-700` |
| **"Cold" activity** | `bg-gray-300`, `bg-gray-400` | `bg-gray-400` (consistent with PropertyMarker) |
| **Light section bg** | `bg-gray-50`, `bg-gray-100` | `bg-gray-50` (screen bg), `bg-gray-100` (card/section within) — keep this 2-level distinction |
| **Primary CTA text on blue** | `text-white` | `text-white` (already consistent) |

**Note**: This is NOT the warm palette migration — that's Phase 1. This just ensures each semantic purpose maps to exactly one shade so Phase 1 has a clean 1:1 remap.

#### 0.5E: Normalize hex case and format

Standardize all remaining inline hex values (the ~13 rgba values and any brand colors that must stay inline):
- Uppercase hex: `#FFFFFF` not `#ffffff` or `#fff`
- Full 6-digit: `#000000` not `#000`

**Files changed**: 30+ component files across `apps/app/src/` and `apps/app/app/`

**Verification**:
- `pnpm -C apps/app typecheck` — zero errors
- `pnpm -C apps/app test` — all unit tests pass
- App renders identically on web and native (this phase changes NO visual output — only how styles are expressed)
- Visual spot-check: GroupPreviewCard, PropertyPreviewCard, PriceGuessSlider (top offenders)

**Parallelism**: Sub-tasks 0.5A through 0.5E can be split across agents by file group. Recommended split:
- Agent 1: GroupPreviewCard + PropertyPreviewCard (biggest files, 0.5A+0.5C)
- Agent 2: index.web.tsx + index.tsx + [...address].tsx (route files, 0.5A+0.5C)
- Agent 3: SearchResults + ListingSubmissionSheet + PriceGuessSlider (0.5A+0.5B+0.5C)
- Agent 4: All remaining src/ components (0.5A+0.5C)
- Agent 5: Tailwind semantic normalization across all files (0.5D)
- Agent 6: Hex case normalization pass (0.5E)

---

### Phase 1: Design Token Foundation
**Estimated files**: 35+ | **Risk**: Low (mechanical grep-replace after Phase 0.5 normalization) | **Blocking**: All component phases

**Goal**: Replace the blue-based design system with gold + warm neutrals. Load custom fonts.

**Prerequisite**: Phase 0.5 must be complete. After normalization, each semantic color purpose maps to exactly one Tailwind shade, and all inline hex colors have been extracted to Tailwind classes. This makes the token migration a clean 1:1 remap — `gray-*` → `warm-*`, `blue-*` → `primary-*` — with no ambiguity about what each color means.

**Tasks**:
1. **Replace `tailwind.config.js`** — full config from spec section 11.2
   - Gold primary scale (50-900)
   - Warm neutral scale (50-900)
   - Semantic colors (crowd-green, error-red, hot-red, info-blue, warning-orange)
   - Surface aliases
   - Font family definitions (Inter, Outfit, DM Sans)
   - Type scale (14 steps: micro to display)
   - Border radius tokens (card, button, sheet, pill)
   - Box shadow definitions (8 named shadows)

2. **Update `Colors.ts`** (`apps/app/constants/Colors.ts`) — section 11.3
   - `tint: '#F5A623'` (was `#2f95dc`)
   - `tabIconDefault: '#C7BFB3'`
   - `tabIconSelected: '#F5A623'`
   - `background: '#FFFBF5'`
   - `text: '#2D2926'`
   - Note: Colors.ts is a separate system from Tailwind — both must be updated

3. **Update `global.css`** (`apps/app/global.css`) — section 11.5
   - Currently only contains `@tailwind` directives, no custom CSS
   - Add background color: `#FFFBF5`
   - Add default text color: `#2D2926`
   - Add default font: Inter

4. **Font loading in `_layout.tsx`** — section 11.4
   - Currently loads only SpaceMono + FontAwesome icons via `useFonts()`
   - Add all weight variants from `@expo-google-fonts/*`
   - Show splash screen until fonts ready

5. **Mechanical token remap** across all component files — section 11.9
   After Phase 0.5 normalization, each semantic purpose maps to exactly one shade. The remap is now purely mechanical:
   - **Gray → Warm neutral**: `gray-50` → `warm-50`, `gray-100` → `warm-100`, ... `gray-900` → `warm-900` (452 usages, straight grep-replace)
   - **Blue → Primary**: `blue-500` → `primary-500`, `blue-600` → `primary-600`, etc. (33 usages)
   - **Primary vars**: Already `primary-*` (21 usages) — automatically pick up new gold value from updated config
   - **bg-white → bg-surface**: `bg-white` (46 usages) → `bg-surface` or `bg-warm-50` per context
   - **Semantic colors preserved**: `red-*` (error, liked, hot), `green-*` (success), `orange-*` (warm activity), `yellow-*` (warning) — remap to new semantic tokens (`error-red`, `crowd-green`, `hot-red`, `warning-orange`)
   - **Remaining inline hex** (~13 rgba shadows + brand colors) — shadows move to shadow helper (Phase 2), brand colors stay

**Files changed**: `tailwind.config.js`, `Colors.ts`, `global.css`, `_layout.tsx`, 30+ component files (Tailwind class renames only — no structural changes thanks to Phase 0.5)

**Verification**:
- `pnpm -C apps/app typecheck` — zero errors
- `pnpm -C apps/app test` — all unit tests pass
- App renders with gold/warm colors on web and native
- Fonts load correctly (visible difference from system fonts)

---

### Phase 2: Foundation Components (Shadows, Blur, Avatars)
**Estimated files**: 6 new, 3 modified | **Risk**: Low (additive) | **Blocking**: All component phases

**Goal**: Create reusable foundation components used across the entire app.

**Tasks**:

1. **Shadow helper** (`src/lib/shadows.ts`) — spec section 5.3
   - Platform-specific shadow definitions (iOS shadowColor/Offset/Opacity/Radius, Android elevation)
   - Named shadows: `card`, `card-alt`, `preview`, `tab-bar`, `search`, `dropdown`, `auth-glow`, `bottom-sheet`
   - Export `shadows` const with `Platform.select<ViewStyle>` per shadow

2. **Blur container** — spec section 11.7
   - `src/components/ui/BlurContainer.native.tsx` — wraps `expo-blur` `BlurView`
   - `src/components/ui/BlurContainer.web.tsx` — CSS `backdrop-filter: blur()`
   - Props: `intensity` (0-100), `tint` ('light' | 'dark')
   - Used by: tab bar, search bar, location button, preview card close button

3. **UserAvatar component** (`src/components/ui/UserAvatar.tsx`) — spec section 7.18
   - Letter-based circle with deterministic warm-toned background (8-color palette from username hash)
   - Size prop: `sm` (32px), `md` (34px), `lg` (36px), `xl` (44px), `2xl` (52px), `profile` (72px)
   - Letter color: 40% darker shade of background
   - Props: `username`, `size`, `displayName?`

4. **KarmaBadge redesign** (`src/components/ui/KarmaBadge.tsx`) — spec section 7.17
   - 6 tiers, renamed to English (currently Dutch in backend, mixed English in frontend):
     - Newcomer (0+), Resident (10+), Connoisseur (50+), Specialist (100+), Master (200+), Legend (500+)
   - Consolidate: backend `karma.ts` has 6 Dutch tiers, frontend `KarmaBadge.tsx` has 5 English tiers — unify to single 6-tier English system in both
   - Tier-specific colors per spec section 1.10
   - Pill shape with `rounded-full`
   - Size variants: small (comments), medium (leaderboard), large (hero)

**New files**:
- `apps/app/src/lib/shadows.ts`
- `apps/app/src/components/ui/BlurContainer.native.tsx`
- `apps/app/src/components/ui/BlurContainer.web.tsx`
- `apps/app/src/components/ui/UserAvatar.tsx`
- `apps/app/src/components/ui/KarmaBadge.tsx`

**Modified files**:
- `services/api/src/services/karma.ts` — rename Dutch tier names to English (Nieuwkomer→Newcomer, Bewoner→Resident, Kenner→Connoisseur, Specialist→Specialist, Meester→Master, Legende→Legend)
- `apps/app/src/components/Comments/Comment.tsx` — use new UserAvatar + KarmaBadge
- `apps/app/app/(tabs)/profile.tsx` — use new UserAvatar

**Verification**:
- Unit tests for UserAvatar (hash determinism, size variants)
- Unit tests for KarmaBadge (7 tiers, correct colors)
- Shadow helper renders correctly on iOS/Android/web
- BlurContainer works on web (CSS) and native (expo-blur)

---

### Phase 3: Icon Migration (Ionicons/FontAwesome → Lucide)
**Estimated files**: 38 | **Risk**: Medium (many files, mechanical) | **Parallel**: Yes

**Goal**: Replace all `@expo/vector-icons` usage with `lucide-react-native`.

**Tasks**:

This is a mechanical search-and-replace across 38 files (31 source + 2 route + 5 test files). Per spec section 11.10, the mapping is:

| Old (Ionicons) | New (Lucide) |
|----------------|-------------|
| `heart-outline` | `Heart` |
| `chatbubble-outline` | `MessageCircle` |
| `close` / `close-circle` | `X` |
| `search` | `Search` |
| `location-outline` | `MapPin` |
| `arrow-back` | `ChevronLeft` |
| `share-social` | `Share2` |
| `bookmark-outline` | `Bookmark` |
| `person-outline` | `User` |
| `send` | `Send` |
| `eye-outline` | `Eye` |
| `information-circle` | `Info` |
| `trending-up` | `TrendingUp` |
| `time-outline` | `Clock` |
| `settings-outline` | `Settings` |
| `log-out-outline` | `LogOut` |
| `notifications-outline` | `Bell` |

**Special cases**:
- Filled heart: Use `lucide-react-native`'s `Heart` with `fill="currentColor"` for the liked state (no need for phosphor-react-native)
- `FontAwesome` tab icons: `map` → `Map`, `list` → `LayoutList`, `bookmark` → `Bookmark`, `user` → `User`
- Icon sizes follow spec section 6.3 scale (xs=14, sm=16, md=18, lg=22, xl=28)
- `strokeWidth`: 1.5 for inactive/outline, 2-2.5 for active/bold

**Files to change** (all 38 files with Ionicons/FA references):
```
apps/app/app/_layout.tsx
apps/app/app/(tabs)/_layout.tsx
apps/app/app/(tabs)/profile.tsx
apps/app/app/(tabs)/saved.tsx
apps/app/app/property/[id].tsx
apps/app/app/user/[id].tsx
apps/app/app/[...address].tsx
apps/app/src/components/AuthModal.tsx
apps/app/src/components/SearchBar.tsx
apps/app/src/components/SearchResults.tsx
apps/app/src/components/PropertyPreviewCard.tsx
apps/app/src/components/PropertyFeedCard.tsx
apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx
apps/app/src/components/FMVVisualization.tsx
apps/app/src/components/ConsensusAlignment.tsx
apps/app/src/components/FeedFilterChips.tsx
apps/app/src/components/FeedEmptyState.tsx
apps/app/src/components/FeedErrorState.tsx
apps/app/src/components/CommentList.tsx
apps/app/src/components/PriceGuessSlider.tsx
apps/app/src/components/AerialImageCard.tsx
apps/app/src/components/PropertyBottomSheet/PropertyHeader.tsx
apps/app/src/components/PropertyBottomSheet/PropertyDetails.tsx
apps/app/src/components/PropertyBottomSheet/PriceSection.tsx
apps/app/src/components/PropertyBottomSheet/PriceGuessSection.tsx
apps/app/src/components/PropertyBottomSheet/CommentsSection.tsx
apps/app/src/components/PropertyBottomSheet/QuickActions.tsx
apps/app/src/components/PropertyBottomSheet/ListingLinks.tsx
apps/app/src/components/PropertyBottomSheet/ListingSubmissionSheet.tsx
apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx
apps/app/src/components/Comments/Comment.tsx
apps/app/src/components/Comments/CommentInput.tsx
apps/app/src/components/Comments/CommentsList.tsx
apps/app/src/components/__tests__/FeedFilterChips.test.tsx
apps/app/src/components/__tests__/FeedStates.test.tsx
apps/app/src/components/__tests__/PropertyFeedCard.test.tsx
apps/app/src/components/Comments/__tests__/Comment.test.tsx
apps/app/src/components/Comments/__tests__/CommentInput.test.tsx
```

**Verification**:
- `pnpm -C apps/app typecheck` — zero errors
- `pnpm -C apps/app test` — all unit tests pass (update icon snapshots/mocks)
- Visual check: all icons render on web and native

---

### Phase 4: Custom Tab Bar (Floating Pill)
**Estimated files**: 3 | **Risk**: Medium-High (high visibility, custom component) | **Parallel**: After Phase 2

**Goal**: Replace the default Expo Router tab bar with a custom floating translucent pill.

**Tasks**:

1. **Create `CustomTabBar` component** (`src/components/navigation/CustomTabBar.tsx`)
   - Floating pill: 62px height, `rounded-[36px]`, 4px internal padding
   - Backdrop blur via `BlurContainer` (native: expo-blur, web: CSS)
   - Map screen: translucent `#FFFFFFCC` (80% white)
   - Other screens: solid `#FFFFFF`
   - 1px inner border `warm-200`
   - Shadow: `tab-bar` from shadows helper
   - Bottom offset: 16px above safe area
   - Horizontal margin: 16px

2. **Tab item capsule**
   - Active: gold `#F5A623` background, 26px corner radius, white icon + label
   - Inactive: transparent background, `warm-400` icon + label
   - Icon: Lucide, 18px
   - Label: Inter 10/600, uppercase, 0.5px letter spacing
   - Gap: 4px between icon and label
   - **Animation**: Gold capsule slides between tabs (200ms ease-out, `withTiming` from Reanimated)

3. **Wire into Expo Router**
   - Set `tabBar` prop on `<Tabs>` to render `CustomTabBar` (Expo Router's `<Tabs>` passes through to `@react-navigation/bottom-tabs` which supports the `tabBar` prop for fully custom tab bar components)
   - Remove all `tabBarStyle` and `tabBarIcon` from individual screen options
   - Remove `headerShown: true` from screen options (map screen has no header in design; other screens use in-screen headers)

4. **Platform-specific behavior**
   - Native: `expo-blur` `BlurView` background
   - Web: CSS `backdrop-filter: blur(20px)`
   - Safe area: `useSafeAreaInsets()` for bottom padding

**Files changed**:
- NEW: `apps/app/src/components/navigation/CustomTabBar.tsx`
- MODIFIED: `apps/app/app/(tabs)/_layout.tsx` — remove default tab bar config, use custom
- MODIFIED: Each tab screen — remove header config where design removes it

**Verification**:
- Tab bar floats above content on all 4 tabs
- Gold capsule animates between tabs
- Blur effect visible on map tab (translucent)
- Solid white on other tabs
- Safe area respected on device
- Playwright visual test for tab bar appearance

**Decision needed**: The design removes the header bar entirely on the Map screen (search bar is the header). On Feed/Saved/Profile, the headers are rendered in-screen (not by Expo Router). **Recommendation**: Set `headerShown: false` on all tab screens and render headers in-screen. This gives full control over header styling per the design.

---

### Phase 5: Backend Additions
**Estimated files**: 15+ new | **Risk**: High (new features) | **Parallel**: Independent of frontend

**Goal**: Build all missing backend endpoints the UI design requires.

#### 5A: Notifications System

**Database migration** — new table:
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'comment_reply', 'like', 'price_guess', 'comment_on_property', 'karma_milestone'
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  message TEXT, -- pre-rendered notification text
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
```

**Endpoints**:
- `GET /notifications` — paginated, grouped by time period (today, this week, earlier)
- `GET /notifications/unread-count` — returns `{ count: number }`
- `PUT /notifications/read-all` — mark all as read
- `PUT /notifications/:id/read` — mark single as read

**Notification triggers** (create notifications when):
- Someone replies to your comment
- Someone likes your comment
- Someone comments on a property you've interacted with
- Someone submits a price guess on a property you've guessed on
- You reach a karma milestone (tier upgrade)

**Push notification delivery**:
- Add `push_token` column to `users` table (nullable text)
- Frontend: Register push token on app launch via `expo-notifications` + `expo-device`
  - `POST /users/me/push-token` — saves Expo push token
- Backend: Use `expo-server-sdk` to deliver push notifications alongside in-app notifications
  - When creating a notification, check if user has a push_token → send push via Expo Push API
  - Push payload: `{ title, body, data: { notificationId, propertyId } }`
  - Handle push receipts for token cleanup (expired/invalid tokens)
- Frontend: Handle push notification tap → navigate to relevant screen (property detail, comments, etc.)
  - `useNotificationListener()` hook in `_layout.tsx` for foreground + background + killed states

**Files to create**:
- `services/api/src/db/migrations/XXXX_notifications.ts`
- `services/api/src/db/migrations/XXXX_push_tokens.ts` — add push_token to users
- `services/api/src/routes/notifications.ts`
- `services/api/src/services/notifications.ts` — notification creation + push delivery logic
- `services/api/src/services/push.ts` — Expo Push API wrapper using `expo-server-sdk`
- `apps/app/src/hooks/useNotificationListener.ts` — push token registration + tap handling
- Modify: `services/api/src/routes/users.ts` — add push-token endpoint
- Modify: `services/api/src/routes/comments.ts` — trigger notification on reply/like
- Modify: `services/api/src/routes/guesses.ts` — trigger notification on guess
- Modify: `services/api/src/services/karma.ts` — trigger notification on tier change
- Modify: `apps/app/app/_layout.tsx` — initialize notification listener

#### 5B: Leaderboard Endpoint

**No new tables** — computed from existing data.

**Endpoint**: `GET /leaderboard?period=week|month|all&limit=50`

**Response**:
```json
{
  "rankings": [
    {
      "rank": 1,
      "userId": "uuid",
      "username": "string",
      "displayName": "string",
      "karma": 450,
      "karmaRank": "Expert",
      "guessCount": 120,
      "commentCount": 85,
      "accuracy": 0.78
    }
  ],
  "userRank": {
    "rank": 42,
    "karma": 85,
    "karmaRank": "Rising Star"
  },
  "featuredProperty": {
    "id": "uuid",
    "street": "string",
    "city": "string",
    "commentCount": 45,
    "thumbnailUrl": "string"
  }
}
```

**Query**: Aggregate from `price_guesses` (guess count, accuracy), `comments` (count), `users` (karma). Period filter: WHERE `created_at > NOW() - interval`.

**Files to create**:
- `services/api/src/routes/leaderboard.ts`

#### 5C: Social Activity Feed

**Prerequisite refactor**: The current DB table is named `reactions` (supports multiple reaction types: like, love, wow, angry). Since the design only uses likes, rename `reactions` → `likes` table and simplify to a single reaction type. This is a migration + route refactor:
- Rename table `reactions` → `likes`
- Drop `reaction_type` column (only "like" is used)
- Rename `target_type`/`target_id` to `entity_type`/`entity_id` (or keep as-is)
- Update all references in routes (`comments.ts`, `properties.ts`) and services

**No new tables beyond the rename** — computed from existing `likes`, `comments`, `price_guesses` joined with `users` and `properties`.

**Note**: The pen design does NOT include a "Following" chip or user-follow system. The 3 feed filter chips are: "Trending", "Latest", "Recent Activity". The "Recent Activity" variant shows ALL recent user actions across the platform, not just followed users.

**Endpoint**: `GET /feed?algorithm=activity`

**Feed algorithm ("activity")**:
- UNION across `likes` (with user), `comments` (with user), `price_guesses` (with user)
- Join against `properties` for address + thumbnail
- Order by `created_at DESC`
- Return: action type ("liked" / "commented" / "guessed"), actor (user avatar, name), property (address, thumbnail), timestamp
- Paginated (limit/offset)

**Response format**:
```json
{
  "items": [
    {
      "type": "activity",
      "actionType": "liked",
      "actor": { "id": "uuid", "username": "Sarah van Berg", "displayName": "Sarah" },
      "property": { "id": "uuid", "street": "Keizersgracht 245", "city": "Amsterdam", "thumbnailUrl": "..." },
      "createdAt": "2026-03-21T10:30:00Z"
    }
  ]
}
```

**Files to modify**:
- `services/api/src/routes/feed.ts` — add `activity` algorithm

#### 5D: User Activity Log

**Endpoint**: `GET /users/me/activity?limit=20&offset=0`

**Response**: Unified timeline of user's actions:
```json
{
  "activities": [
    { "type": "guess", "propertyId": "uuid", "street": "...", "amount": 350000, "createdAt": "..." },
    { "type": "comment", "propertyId": "uuid", "street": "...", "commentPreview": "...", "createdAt": "..." },
    { "type": "like", "propertyId": "uuid", "street": "...", "createdAt": "..." }
  ]
}
```

**Files to create**:
- Modify: `services/api/src/routes/users.ts` — add activity endpoint

#### 5E: Email Auth (Magic Link)

**Endpoint**:
- `POST /auth/email/request` — sends magic link email
- `POST /auth/email/verify` — verifies token from magic link, returns JWT

**Implementation**:
- Generate a time-limited token (UUID + 15min expiry)
- Store in `email_auth_tokens` table (email, token, expires_at, used)
- Send magic link email via **Resend** (`resend` npm package, already added in Phase 0)
- Magic link format: `https://huishype.nl/auth/verify?token=UUID` (or deep link for native)
- On verify: validate token, mark as used, create/find user by email, return JWT + refresh token
- Frontend: `signInWithEmail(email)` method in AuthProvider → shows "Check your email" state
- Frontend: Deep link handler for `auth/verify` route → calls verify endpoint → stores tokens

**Environment variables** (add to API `.env`):
```
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=noreply@huishype.nl
```

**Files to create**:
- `services/api/src/db/migrations/XXXX_email_auth.ts`
- `services/api/src/routes/auth-email.ts`
- `services/api/src/services/email.ts` — Resend wrapper for sending magic link emails
- `apps/app/app/auth/verify.tsx` — deep link handler for magic link verification
- Modify: `apps/app/src/providers/AuthProvider.tsx` — add `signInWithEmail()` method
- Modify: `apps/app/src/components/AuthModal.tsx` — email input + "Check your email" state

**Verification**:
- Integration tests for all new endpoints
- `pnpm -C services/api test` — all tests pass

---

### Phase 6: Search Bar Redesign
**Estimated files**: 3 | **Risk**: Low (isolated) | **Parallel**: Yes

**Goal**: Redesign the search bar per spec section 7.2.

**Tasks**:
1. Search bar container: 48px height, backdrop blur, translucent white over map
2. Input field: 44px, `rounded-xl`, warm-300 border
3. Lucide `Search` icon (left), no mic icon (removed from design)
4. Focused state: gold 2px border, gold glow shadow, gold search icon
5. Clear button (`X` icon) when text present
6. Search dropdown redesign per spec section 7.3
   - White card, 370px wide, warm shadow
   - Result rows: gold `MapPin` icon, DM Sans text, city subtitle
   - Dividers between rows

**Files changed**:
- `apps/app/src/components/SearchBar.tsx`
- `apps/app/src/components/SearchResults.tsx`
- Possibly: `apps/app/app/(tabs)/index.tsx` / `index.web.tsx` — search overlay dimming

**Verification**: Playwright visual test for search bar states (inactive, focused, with results)

---

### Phase 7: Feed Filter Chips
**Estimated files**: 1 | **Risk**: Low | **Parallel**: Yes

**Goal**: Redesign filter chips per spec section 7.4.

**Tasks**:
1. Active chip: gold `#F5A623` fill, white text, `rounded-[20px]`, 13px Inter 600
2. Inactive chip: white fill, warm-300 border, warm-700 text
3. Emoji prefix for Trending chip (🔥)
4. "Latest" chip (replaces current "Recent" algorithm)
5. "Recent Activity" chip (links to activity feed algorithm from Phase 5C)
6. Overflow indicator ("...")
7. 10px gap between chips

**Files changed**: `apps/app/src/components/FeedFilterChips.tsx`

**Verification**: Unit test + Playwright visual test

---

### Phase 8: Feed Cards Redesign
**Estimated files**: 2-3 | **Risk**: Medium (visible everywhere) | **Parallel**: Yes

**Goal**: Redesign feed cards per spec section 7.5 with photo headers and stat pills.

**Tasks**:

1. **Card structure**: `rounded-2xl`, white fill, warm-gold shadow, clip: true
2. **Image section**: 180px height, cover fill
   - Primary source: listing `thumbnailUrl` (from Funda/Pararius mirrors, if available)
   - Fallback: PDOK aerial imagery (NL only, via `getPropertyThumbnailUrl()`)
   - Final fallback: Warm gradient placeholder (`warm-200` → `warm-100` with house icon overlay)
3. **Body section**: 14px top padding, 16px side padding, 8px gap
4. **Address row**: Street (Inter 16/600 warm-900) + city (Inter 13/400 warm-500)
5. **Activity badge**: "Hot" pill (hot-red fill, flame icon, white text) — shown when activity level is hot
6. **Price row**: "Asking Price" label + formatted price with house icon
7. **Stats section**: Divider + horizontal row of colored stat pills
   - Likes (pink tint `#E91E6315`)
   - Comments (blue tint `#42A5F515`)
   - Guesses (green tint `#4CAF5015`)
   - Views (gold tint `#F5A62315`)
   Each pill: `rounded-[10px]`, icon + count text in matching color

8. **Property photo enhancement**:
   - Modify `PropertyFeedCard` to accept and display listing photo
   - Modify feed hook to include listing `thumbnailUrl` in feed response
   - Backend: Join listings table in feed query to include `thumbnail_url`

**Files changed**:
- `apps/app/src/components/PropertyFeedCard.tsx` — major redesign
- `services/api/src/routes/feed.ts` — include thumbnail_url in response
- `apps/app/src/components/PropertyCard.tsx` — if still used, update similarly

**Verification**: Playwright visual test for feed screen with multiple card types

---

### Phase 9: Preview Card Redesign
**Estimated files**: 2 | **Risk**: Medium (touches map interaction) | **Parallel**: Yes

**Goal**: Redesign the geo-anchored preview card per spec section 7.6.

**Tasks**:

1. **Card**: 270px width, `rounded-2xl`, white fill, warm preview shadow, clip: true
2. **Image section**: 100px height, cover fill (listing thumbnail or aerial)
3. **Close button**: Absolute positioned top-right in image, 26px circle, translucent white, backdrop blur, warm-200 border, X icon
4. **Body section**: Address (15/600 warm-900), activity badge, city text
5. **Price row**: Heart count pill (gold tint), separator, comment count pill (blue tint), house price
6. **Quick actions row**: Divider + like/comment/guess buttons with muted colors
7. **Arrow pointer**: 20px triangle below card, white fill, subtle shadow

**Files changed**:
- `apps/app/src/components/PropertyPreviewCard.tsx`
- `apps/app/src/components/GroupPreviewCard/GroupPreviewCard.tsx`

**Verification**: Playwright visual test on map with preview card open

---

### Phase 10: Auth Modal Redesign
**Estimated files**: 1-2 | **Risk**: Low (isolated modal) | **Parallel**: Yes

**Goal**: Redesign auth modal per spec section 7.13.

**Tasks**:

1. **Backdrop**: `#2D2926BF` (warm-900 at 75%)
2. **Card**: `rounded-3xl`, white fill, gold glow shadow, padding `[20, 28, 28, 28]`
3. **Close button**: 36px circle, cool gray `#F4F4F5`, X icon `#71717A`
4. **Logo**: 64px with 16px border radius
5. **Title**: "Welcome to HuisHype" Outfit 20/600
6. **Subtitle**: Inter 14/400, warm-500, centered
7. **Google button**: 52px, white fill, cool gray border `#E4E4E7`, Google logo + Inter 15/500
8. **Apple button**: 52px, near-black `#1A1A1A`, Apple logo + white text
9. **Divider**: "or" with cool gray lines
10. **Email button**: 44px, gold-50 fill, gold-400 border, mail icon + gold-700 text
11. **Email auth flow**: Connect to backend email magic link endpoint (Phase 5E)

**Files changed**:
- `apps/app/src/components/AuthModal.tsx`
- `apps/app/src/providers/AuthProvider.tsx` — add `signInWithEmail` method

**Verification**: Unit test + visual test for auth modal

---

### Phase 11: Saved Screen Redesign
**Estimated files**: 1 | **Risk**: Low | **Parallel**: Yes

**Goal**: Update saved screen per spec section 8.4.

**Tasks**:
1. Background: `warm-50`
2. Header: "Saved Properties" Inter 20/600, subtitle "X properties saved" Inter 13/400 warm-500
3. Notification bell icon (top-right) with badge
4. Same feed card component (Phase 8)
5. **Empty state (unauthenticated)**: Bookmark icon (gold-400), "Sign in to save properties" text, gold CTA
6. **Empty state (authenticated, no saves)**: Bookmark outline (warm-300), "No saved properties yet" text

**Files changed**: `apps/app/app/(tabs)/saved.tsx`

**Verification**: Visual test for both empty states and populated state

---

### Phase 12: Profile Screen Redesign
**Estimated files**: 1-2 | **Risk**: Medium (new sections) | **Parallel**: Yes

**Goal**: Complete profile redesign per spec section 8.5.

**Tasks**:

1. **Background**: `warm-50`
2. **Header**: Notification bell (left) + 3-dot overflow menu (right)
3. **Profile card**: White card, warm shadow
   - UserAvatar (72px, gold circle)
   - Display name (Inter 20/600)
   - KarmaBadge pill
   - "Edit display name" link (gold-500)
4. **Stats grid**: 3 columns (Karma, Accuracy, Guesses)
   - White cards with warm shadow
   - Numbers: Inter 24/700 (Karma/Accuracy in gold-500, Guesses in warm-900)
   - Labels: uppercase Inter 11/600 warm-500
5. **Achievements row**: Trophy, flame, target, globe icons in gold-50 circles
6. **Recent Activity log**: Activity entries with icons and timestamps
   - Pull from `GET /users/me/activity` (Phase 5D)
   - Show likes, comments, guesses with property names and timestamps
7. **Settings dropdown**: From 3-dot button, white card with warm shadow, "Sign out" row
8. **Unauthenticated state**: Large logo, "Join HuisHype" Outfit 20/600, description, gold CTA

**Files changed**:
- `apps/app/app/(tabs)/profile.tsx` — major rewrite
- `apps/app/src/hooks/useUserProfile.ts` — add activity endpoint call

**Verification**: Visual test for authenticated and unauthenticated states

---

### Phase 13: Animations
**Estimated files**: 5-8 | **Risk**: Low (additive) | **Parallel**: Yes

**Goal**: Add all micro-interactions per spec section 10.2.

**Tasks**:

1. **Tab capsule transition**: Gold fill slides between tabs, 200ms `withTiming` ease-out
2. **Like bounce**: `withSequence(withSpring(1.3, { damping: 4 }), withSpring(1.0))` on heart icon
3. **Save bounce**: Same as like bounce on bookmark icon
4. **Hot pulse**: Ring scale 1→1.6, opacity 0.4→0, loop 1.5s
5. **Filter chip press**: Scale 0.95 on press, 1.0 on release, 100ms
6. **Card press**: Opacity 0.9 + scale 0.98 on press
7. **Price label float**: Spring follow on slider thumb
8. **Send button pulse**: Scale 0.9→1.0 spring when enabled
9. **Reduced motion**: All animations check `useReducedMotion()` and fall back to instant

**Files changed**: CustomTabBar, QuickActions, FeedFilterChips, PropertyFeedCard, PriceGuessSlider, CommentInput

**Verification**: Manual testing on device (animations are hard to visual-test automatically)

---

### Phase 14: Property Detail Full Page
**Estimated files**: 5-8 | **Risk**: High (architecture change, new route) | **Requires**: Phase 5 backend

**Goal**: Transform property detail from bottom-sheet-only to full-page scroll view per spec section 8.3.

**BREAKING CHANGE**: Property detail becomes a full-page route. The bottom sheet stays for quick preview only (map tap → bottom sheet peek; feed card tap → full page).

**Tasks**:

1. **Rewrite `property/[id].tsx`** as a full-page scroll view:
   - Hero section: 240px full-width image, overlay buttons (back, share, like, photo count)
   - Content padding: `[16, 16, 24, 16]`, 20px gap between sections
   - Remove Stack.Screen header (back button is in hero overlay)

2. **Address + info pills section**:
   - Street: Outfit 22/600 warm-900
   - City: Outfit 15/500 warm-600
   - Info pills: year built (calendar icon), floor area (ruler icon), view count (eye icon)

3. **Crowd Estimate card**:
   - Large price: Outfit 32/700 green
   - Confidence badge: green pill
   - Side-by-side WOZ + Asking price cards

4. **Price comparison bar**: Dot markers for WOZ, Crowd, Asking, User guess

5. **Listings section**: Source logo circles (Funda yellow, Pararius blue), listing URLs, "Add Listing"

6. **Price guess section**: FMV visualization + "Make Your Guess" CTA → navigates to Price Guesses Page (Phase 16)

7. **Comments section**: 2 recent comments + "View all X comments" → navigates to Comments Page (Phase 15)

8. **Property info section**: Details card with metadata

9. **Action row**: Like, Save, Share buttons with outlined style

10. **Update navigation**: Feed card tap → `router.push('/property/[id]')` (full page, not bottom sheet)

**Files changed**:
- `apps/app/app/property/[id].tsx` — major rewrite
- `apps/app/src/components/PropertyBottomSheet/PropertyContent.tsx` — extract shared sections
- `apps/app/src/components/PropertyFeedCard.tsx` — navigation change
- `apps/app/app/(tabs)/feed.tsx` — navigation change

**Verification**: Visual test for property detail page with all sections

---

### Phase 15: Comments Full Page
**Estimated files**: 3-4 new | **Risk**: Medium | **Requires**: Phase 14

**Goal**: Build dedicated full-screen comments page per spec section 7.8 / 8.9.

**Tasks**:

1. **New route**: `apps/app/app/comments/[propertyId].tsx`

2. **Header** (56px): Back button (32px circle) + property thumbnail (48x36) + address + city

3. **Sort toggle**: "Popular" / "Recent" toggle pills
   - Active: gold-400 fill, warm-900 text
   - Inactive: warm-200 fill, warm-600 text

4. **Comment list**: Scrollable
   - Avatar (34px UserAvatar), name (Inter 13/600), KarmaBadge, timestamp
   - Comment text (Inter 13/400 warm-800)
   - Reply link, heart button (unfilled/filled)
   - Reply threads: 16px left indent, 2px left border warm-300

5. **Input bar** (pinned bottom, 70px):
   - Avatar (32px), pill input (rounded-full, warm-50 fill, warm-200 border)
   - Gold send button (34px circle)

6. **Navigation**: "View all comments" in property detail → `router.push('/comments/[propertyId]')`

**Files to create**:
- `apps/app/app/comments/[propertyId].tsx`
- `apps/app/src/components/Comments/FullCommentsList.tsx` (reusable)
- `apps/app/src/components/Comments/SortToggle.tsx`

**Verification**: Visual test + unit tests for sort toggle

---

### Phase 16: Price Guesses Full Page
**Estimated files**: 3-4 new | **Risk**: Medium | **Requires**: Phase 14

**Goal**: Build dedicated full-screen price guesses page per spec section 7.9 / 8.10.

**Tasks**:

1. **New route**: `apps/app/app/guesses/[propertyId].tsx`

2. **Header** (48px): Back button (36px circle, warm-100 fill) + "Price Guesses" title

3. **Property image card**: 150px height, rounded-2xl, gradient overlay, address text

4. **Crowd estimate card**: Large FMV price, diff badge, confidence level

5. **Distribution card**: Bar chart visualization with gold fills on warm-100 background

6. **Recent guesses list**: Entries with accuracy icons (green check, orange alert)

7. **CTA bar** (sticky bottom): "Make Your Guess" gold button (50px, rounded-[14px])
   - Expands to show PriceGuessSlider when tapped

8. **Navigation**: "Make Your Guess" in property detail → `router.push('/guesses/[propertyId]')`

**Files to create**:
- `apps/app/app/guesses/[propertyId].tsx`
- `apps/app/src/components/PriceGuesses/GuessesList.tsx`
- `apps/app/src/components/PriceGuesses/DistributionChart.tsx`

**Verification**: Visual test + unit tests

---

### Phase 17: Social Activity Feed
**Estimated files**: 3-4 | **Risk**: Medium | **Requires**: Phase 5C backend

**Goal**: Build "Recent Activity" feed variant per spec sections 7.12 / 8.8.

**Tasks**:

1. **Activity card component** (`ActivityFeedCard.tsx`):
   - User row: avatar 36px + name + timestamp
   - Action badge pill: "Liked" (pink), "Commented" (blue), "Guessed" (green)
   - Property photo: 200px height
   - Address row
   - Metrics row: heart + comment counts

2. **Feed screen update**:
   - When "Recent Activity" chip selected, render activity cards instead of property cards
   - Title changes to "Recent Activity" (from "Trending Properties")

3. **Hooks**: `useActivityFeed()` — calls `GET /feed?algorithm=activity`

**Files changed**:
- NEW: `apps/app/src/components/ActivityFeedCard.tsx`
- MODIFIED: `apps/app/app/(tabs)/feed.tsx` — conditional card rendering
- MODIFIED: `apps/app/src/hooks/useFeed.ts` — add activity algorithm

**Verification**: Visual test for activity feed cards

---

### Phase 18: Notifications Page
**Estimated files**: 4-5 new | **Risk**: Medium | **Requires**: Phase 5A backend

**Goal**: Build notifications page per spec sections 7.10 / 8.11.

**Tasks**:

1. **New route**: `apps/app/app/notifications.tsx`

2. **Header**: "Notifications" Inter 26/700 warm-900, "Mark all read" link (gold-700)

3. **Section grouping**: "Today", "This Week", "Earlier" labels (uppercase Inter 13/600 warm-500)

4. **Notification item**:
   - Thumbnail (48x48, rounded-lg)
   - Description (Inter 14/500 warm-800)
   - Timestamp (Inter 12/400 warm-400)
   - Unread: warm-100 background + 8px gold dot
   - Read: transparent background

5. **Notification bell component** (`NotificationBell.tsx`):
   - Bell icon (Lucide `bell`, 22px, warm-700)
   - Red dot badge (8px, `#EF4444`) when unread count > 0
   - Navigates to notifications page on tap

6. **Hook**: `useNotifications()` — calls `GET /notifications` + `GET /notifications/unread-count`

7. **Integration**: Add NotificationBell to map screen header, feed screen header, saved screen header, profile screen header

**Files to create**:
- `apps/app/app/notifications.tsx`
- `apps/app/src/components/ui/NotificationBell.tsx`
- `apps/app/src/hooks/useNotifications.ts`

**Verification**: Visual test for notifications page with multiple states

---

### Phase 19: Community Leaderboard Page
**Estimated files**: 3-4 new | **Risk**: Medium | **Requires**: Phase 5B backend

**Goal**: Build leaderboard page per spec sections 7.11 / 8.12.

**Tasks**:

1. **New route**: `apps/app/app/leaderboard.tsx`

2. **Header** (44px): Trophy icon (gold-500) + "Leaderboard" Outfit 22/600, period filter dropdown

3. **Featured property card**: 180px image, "MOST DISCUSSED THIS WEEK" overlay

4. **Podium section**:
   - 1st place: Crown icon, 52px avatar with gold stroke, name, karma badge, points
   - 2nd/3rd: 44px avatars, no crown

5. **Rankings list**:
   - Rows: rank number, 36px avatar, name, karma badge, points
   - "Your Rank" row: highlighted with gold-50 fill and gold-200 border

6. **Period filter**: Dropdown with "This Week", "This Month", "All Time"

7. **Hook**: `useLeaderboard()` — calls `GET /leaderboard`

8. **Navigation**: Accessible from profile screen (trophy icon in achievements row)

**Files to create**:
- `apps/app/app/leaderboard.tsx`
- `apps/app/src/components/Leaderboard/Podium.tsx`
- `apps/app/src/components/Leaderboard/RankingsList.tsx`
- `apps/app/src/hooks/useLeaderboard.ts`

**Verification**: Visual test for leaderboard with mock data

---

### Phase 20: Visual Regression & Full Test Suite
**Estimated files**: 20+ test files | **Risk**: Required | **Requires**: ALL previous phases

**Goal**: Update all visual baselines and ensure full test suite passes.

**Tasks**:

1. **Update Playwright visual tests**:
   - Update all screenshot baselines for new design
   - Add new visual tests for: tab bar, search bar states, feed cards, preview cards, property detail page, comments page, price guesses page, profile screen, auth modal, notifications page, leaderboard page, saved screen states

2. **Update Playwright integration tests**: Verify navigation flows still work with new routes

3. **Update Maestro mobile tests**:
   - Update all screenshot references
   - Add flows for new screens (comments page, price guesses page, notifications, leaderboard)
   - Update element selectors for new component structure

4. **Unit test updates**:
   - Update component test snapshots
   - Add tests for new components (CustomTabBar, UserAvatar, KarmaBadge, BlurContainer, NotificationBell)
   - Update icon-related test mocks

5. **Full suite verification**:
   ```bash
   pnpm -C apps/app typecheck
   pnpm -C apps/app test
   pnpm -C services/api test
   pnpm -C packages/shared test
   pnpm -C apps/app exec playwright test --project=visual
   pnpm -C apps/app exec playwright test --project=integration
   pnpm -C apps/app exec playwright test --project=flows
   ```

6. **Visual verification agent loop**:
   - For each design screen, take screenshot and compare against pen export
   - Iterate until visual agent approves each screen
   - Screens to verify:
     1. Map Screen (with preview card)
     2. Search Results overlay
     3. Auth Modal
     4. Feed - Trending
     5. Feed - Recent Activity
     6. Saved Screen
     7. Profile Screen
     8. Social Notifications
     9. Community Leaderboard
     10. Property Detail
     11. Price Guesses Page
     12. Comments Page

**Verification**: ALL tests green. No regressions.

---

## Agent Team Structure

### Recommended Agent Teams

```
Lead Agent (orchestration only)
├── Team A: Design System Foundation
│   ├── Agent: Package installer + native rebuild (Phase 0)
│   ├── Agent: Token swap + font loading (Phase 1)
│   └── Agent: Shadows, Blur, Avatar, KarmaBadge (Phase 2)
│
├── Team B: Component Overhaul (parallel after Team A)
│   ├── Agent: Icon migration (Phase 3) — mechanical, can be split
│   ├── Agent: Tab bar rewrite (Phase 4)
│   ├── Agent: Search bar + dropdown (Phase 6)
│   ├── Agent: Filter chips (Phase 7)
│   ├── Agent: Feed cards + preview card (Phase 8 + 9)
│   ├── Agent: Auth modal (Phase 10)
│   ├── Agent: Saved + Profile screens (Phase 11 + 12)
│   └── Agent: Animations (Phase 13)
│
├── Team C: Backend (parallel with Teams A & B)
│   ├── Agent: Notifications system (Phase 5A)
│   ├── Agent: Leaderboard + Activity log (Phase 5B + 5D)
│   ├── Agent: Activity feed algorithm (Phase 5C)
│   └── Agent: Email auth (Phase 5E)
│
├── Team D: New Screens (after Teams B & C)
│   ├── Agent: Property detail full page (Phase 14)
│   ├── Agent: Comments full page (Phase 15)
│   ├── Agent: Price guesses full page (Phase 16)
│   ├── Agent: Social activity feed (Phase 17)
│   ├── Agent: Notifications page (Phase 18)
│   └── Agent: Leaderboard page (Phase 19)
│
└── Team E: Verification (after Team D)
    ├── Agent: Test suite updates (Phase 20)
    └── Agent: Visual regression loop (Phase 20)
```

### Parallelism Opportunities

| Phase Group | Can Run In Parallel |
|-------------|-------------------|
| 0 → 1 → 2 | Sequential (dependencies) |
| 3, 4, 6, 7, 8, 9, 10, 11, 12, 13 | All parallel (after Phase 2) |
| 5A, 5B, 5C, 5D, 5E | All parallel (independent backend work) |
| 14, 15, 16 | Sequential within (14 first, then 15+16 parallel) |
| 17, 18, 19 | All parallel (after respective backend phases) |
| 20 | After everything else |

---

## Decisions Needed Before Execution

All decisions resolved:

1. **Email auth service**: **Resend** — use `resend` npm package for transactional email
2. **Email auth scope**: **Full magic link flow** — complete backend + frontend implementation
3. **Mic icon in search bar**: **Removed** — no mic icon, just search icon (left) and clear button (when text present)
4. **Notification delivery**: **Push notifications included** — requires `expo-notifications` package + push token registration + server-side push delivery via Expo Push API
5. **Property photos**: **PDOK aerial fallback + placeholder** — use listing `thumbnailUrl` if available, fall back to PDOK aerial (NL only), else show a warm gradient placeholder. No high-quality photo sourcing needed.

---

## Success Criteria

Each screen must match the pen design export when verified by a visual agent:

| Screen | Pen Export | Verification Method |
|--------|-----------|-------------------|
| 1. Map Screen | `pen_screen_exports/1. Map Screen.jpg` | Playwright screenshot + visual agent |
| 2. Search Results | `pen_screen_exports/2. Search Results.jpg` | Playwright screenshot + visual agent |
| 3. Auth Modal | `pen_screen_exports/3. Auth Modal.jpg` | Playwright screenshot + visual agent |
| 4. Feed - Trending | `pen_screen_exports/4. Feed - Trending Chosen.jpg` | Playwright screenshot + visual agent |
| 5. Feed - Recent Activity | `pen_screen_exports/5. Feed - Recent Activity Chosen.jpg` | Playwright screenshot + visual agent |
| 6. Saved Screen | `pen_screen_exports/6. Saved Screen.jpg` | Playwright screenshot + visual agent |
| 7. Profile Screen | `pen_screen_exports/7. Profile Screen.jpg` | Playwright screenshot + visual agent |
| 8. Social Notifications | `pen_screen_exports/8. Social Notifications.jpg` | Playwright screenshot + visual agent |
| 9. Community Leaderboard | `pen_screen_exports/9. Community Leaderboard.jpg` | Playwright screenshot + visual agent |
| 10. Property Detail | `pen_screen_exports/10. Property Detail Page.jpg` | Playwright screenshot + visual agent |
| 11. Price Guesses | `pen_screen_exports/11. Price Guesses Page.jpg` | Playwright screenshot + visual agent |
| 12. Comments | `pen_screen_exports/12. Comments Page.jpg` | Playwright screenshot + visual agent |

Plus remaining screens from the pen file (13-15).

**All tests green** before sprint is considered complete:
- `pnpm -C apps/app typecheck` — zero TS errors
- `pnpm -C apps/app test` — all unit tests pass
- `pnpm -C services/api test` — all API tests pass
- `pnpm -C packages/shared test` — all shared tests pass
- Playwright visual/integration/flows — all pass
- Maestro mobile — all pass (0 FAILED)

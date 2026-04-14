# Wire guess/comments quick actions to responsive panel routes

## Locations

- `apps/app/src/hooks/useMapInteraction.ts:252-258`
- `apps/app/app/comments/[propertyId].tsx`
- `apps/app/app/guesses/[propertyId].tsx`

## Problem

The `handleGuessPress` and `handleCommentPress` callbacks in `useMapInteraction` are empty stubs:

```tsx
const handleGuessPress = useCallback((_propertyId: string) => {
  // TODO: Open full guess modal
}, []);

const handleCommentPress = useCallback((_propertyId: string) => {
  // TODO: Open comments section
}, []);
```

The Phase 12 routes (`/comments/[propertyId]` and `/guesses/[propertyId]`) exist but are currently full-screen-only `Stack.Screen` pages. They need to adopt the same responsive layout as `PropertyBottomSheet.web.tsx`:

- **Portrait (mobile/narrow)**: Full-screen content (current behavior is fine)
- **Landscape (desktop/wide)**: Side panel sliding from right, 420px, same pattern as the property detail panel

## Approach

### 1. Wire the navigation (`useMapInteraction.ts`)

Replace the TODO stubs with `router.push`:

```tsx
import { router } from 'expo-router';

const handleGuessPress = useCallback((propertyId: string) => {
  router.push(`/guesses/${propertyId}`);
}, []);

const handleCommentPress = useCallback((propertyId: string) => {
  router.push(`/comments/${propertyId}`);
}, []);
```

### 2. Create a shared responsive layout wrapper

Extract the portrait/landscape detection and side-panel CSS from `PropertyBottomSheet.web.tsx` into a reusable `ResponsivePanel` component:

**`apps/app/src/components/ui/ResponsivePanel.web.tsx`** — CSS side panel (landscape) / full-screen (portrait)
**`apps/app/src/components/ui/ResponsivePanel.native.tsx`** — Always full-screen (native is always portrait phone)

The web variant should:
- Reuse `useIsLandscape()` from `PropertyBottomSheet.web.tsx` (extract to shared hook)
- In landscape: render a 420px right-anchored panel with backdrop, close button, slide transition
- In portrait: render children full-screen (no panel chrome — the route already handles safe areas)
- Accept `onClose` prop that calls `router.back()`

### 3. Wrap existing route pages

**`apps/app/app/comments/[propertyId].tsx`**:
- Wrap the existing `CommentsPage` content in `<ResponsivePanel>`
- No logic changes needed — just layout wrapping

**`apps/app/app/guesses/[propertyId].tsx`**:
- Same: wrap `GuessesPage` content in `<ResponsivePanel>`

### 4. Stack screen presentation

In `apps/app/app/_layout.tsx`, the comments/guesses screens should use:
- `presentation: 'transparentModal'` on web (so the map stays visible behind the side panel)
- `presentation: 'card'` on native (standard push navigation)

## Files to change

| File | Change |
|------|--------|
| `apps/app/src/hooks/useMapInteraction.ts` | Wire `router.push` in both handlers |
| `apps/app/src/components/ui/ResponsivePanel.web.tsx` | NEW: Side panel (landscape) / full-screen (portrait) |
| `apps/app/src/components/ui/ResponsivePanel.native.tsx` | NEW: Passthrough (always full-screen) |
| `apps/app/src/hooks/useIsLandscape.ts` | NEW: Extract from PropertyBottomSheet.web.tsx |
| `apps/app/src/components/PropertyBottomSheet/PropertyBottomSheet.web.tsx` | Import useIsLandscape from shared hook |
| `apps/app/app/comments/[propertyId].tsx` | Wrap in ResponsivePanel |
| `apps/app/app/guesses/[propertyId].tsx` | Wrap in ResponsivePanel |
| `apps/app/app/_layout.tsx` | Update screen presentation mode |

## Scope

- Medium (~200 lines new, ~30 lines changed)
- No API changes
- Add unit tests for ResponsivePanel (landscape/portrait rendering)
- Verify PropertyBottomSheet.web tests still pass after useIsLandscape extraction

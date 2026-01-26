# Reference Expectation: Quick Action Buttons on Preview

## Overview

When a user taps a property marker on the map, the preview card should display quick action buttons that enable instant engagement without opening the full detail view. These buttons provide an Instagram-like interaction feel, allowing users to quickly Like, Comment, or make a price Guess directly from the preview.

## Requirements (from main-spec.md)

### Core Behavior (Lines 177-181)

From the specification:
> "Quick action buttons on preview card: Like/Upvote, Comment, Guess"
> "Instagram-like quick interaction feel"
> "Displayed on property preview card when map marker is tapped"
> "Allows quick engagement without full detail view"

### Design Principles

From spec:
> "Lightweight and playful - Feels like social media, not a mortgage application"
> "Fast feedback - Actions complete instantly with optimistic UI updates"
> "Like should feel as fast as double-tapping on Instagram"
> "Never leave the map unnecessarily - All quick interactions happen in-context"

## Visual Elements Required

### 1. Quick Actions Bar Container
- Horizontal row at the bottom of the preview card
- Separated from property info by a subtle border/divider (border-t)
- Padding above the buttons (pt-3)
- Equal spacing between all three buttons (justify-around)

### 2. Required Buttons

#### Like Button
| Attribute | Specification |
|-----------|---------------|
| Icon | Heart outline (heart-outline from Ionicons) |
| Label | "Like" text |
| Icon Size | 20px |
| Text Style | text-sm text-gray-600 |
| Pressed State | bg-gray-100 background |
| Liked State | Filled heart, red color (#EF4444) |

#### Comment Button
| Attribute | Specification |
|-----------|---------------|
| Icon | Chat bubble outline (chatbubble-outline from Ionicons) |
| Label | "Comment" text |
| Icon Size | 20px |
| Text Style | text-sm text-gray-600 |
| Pressed State | bg-gray-100 background |

#### Guess Button
| Attribute | Specification |
|-----------|---------------|
| Icon | Price tag outline (pricetag-outline from Ionicons) |
| Label | "Guess" text |
| Icon Size | 20px |
| Text Style | text-sm text-gray-600 |
| Pressed State | bg-gray-100 background |

### 3. Button Layout Specifications
- Each button: flex-row items-center
- Icon-to-text gap: ml-1 (4px)
- Button padding: px-3 py-2
- Touch target: minimum 44px height for accessibility
- Rounded corners: rounded-lg

### 4. Color Scheme
| State | Icon Color | Text Color | Background |
|-------|------------|------------|------------|
| Default | #6B7280 (gray-500) | #4B5563 (gray-600) | transparent |
| Pressed | #6B7280 | #4B5563 | #F3F4F6 (gray-100) |
| Liked (Like only) | #EF4444 (red-500) | #EF4444 | transparent |

## Interaction Behavior

### Like Button
1. Single tap toggles like state
2. Visual feedback is immediate (optimistic UI)
3. Heart icon fills and turns red when liked
4. Heart icon outlines and turns gray when unliked
5. Animation: subtle scale bounce on tap (1.0 -> 1.1 -> 1.0)

### Comment Button
1. Single tap opens full bottom sheet
2. Bottom sheet scrolls/focuses on comment section
3. Comment input may receive focus automatically

### Guess Button
1. Single tap opens full bottom sheet
2. Bottom sheet scrolls to price guess slider section
3. User can immediately interact with the slider

## Technical Notes

- Buttons use React Native `Pressable` component
- Icons from `@expo/vector-icons` (Ionicons set)
- NativeWind/TailwindCSS for styling
- Component: `PropertyPreviewCard.tsx`
- Callbacks: `onLike`, `onComment`, `onGuess` props

## Screenshot Requirements

The test screenshot should capture:

1. The map view with at least one property marker visible
2. The property preview card displayed (after marker tap)
3. The quick actions bar clearly visible at the bottom of the preview card
4. All three buttons visible with icons and labels:
   - Heart icon + "Like" text
   - Chat bubble icon + "Comment" text
   - Price tag icon + "Guess" text
5. Clear visual separation between property info and action buttons
6. Adequate spacing and alignment of all button elements

## Acceptance Criteria (SUFFICIENT)

Mark as SUFFICIENT when ALL of the following are met:

1. **Preview Card Visible**: Property preview card is displayed on screen
2. **Quick Actions Bar Present**: Action buttons section is visible with border separator
3. **Like Button**: Heart icon and "Like" label both visible
4. **Comment Button**: Chat bubble icon and "Comment" label both visible
5. **Guess Button**: Price tag icon and "Guess" label both visible
6. **Proper Layout**: Buttons are evenly distributed in a horizontal row
7. **Visual Hierarchy**: Buttons are visually distinct from property info section
8. **Console Health**: Zero console errors during test execution
9. **Touch Accessibility**: Buttons appear large enough for touch interaction

## Acceptance Criteria (NEEDS_WORK)

Mark as NEEDS_WORK if ANY of the following:

- Preview card does not appear when clicking a marker
- Quick actions section is missing from the preview card
- Any of the three required buttons (Like, Comment, Guess) is missing
- Button icons are not visible or incorrectly displayed
- Button labels are not visible
- Buttons are stacked vertically instead of horizontally
- Buttons overlap or have broken layout
- Divider/separator line is missing between info and actions
- Console errors are detected during test execution
- Touch targets appear too small for mobile interaction

## Related Expectations

- `instant-preview-card-on-tap`: Base preview card behavior
- `reactions-like-system`: Detailed Like button state and animation
- `property-bottom-sheet-details`: Full detail view opened by Comment/Guess actions

# Reference Expectation: Instant Preview Card on Tap

## Overview

When a user taps a property marker on the map, an instant preview card should appear near the tapped property. This creates a lightweight, playful, in-context interaction pattern that keeps users on the map rather than navigating to separate pages. The interaction should feel as fast and responsive as Instagram or TikTok.

## Requirements (from main-spec.md)

### Core Behavior (Lines 166-186)

From the specification:
> "On-Tap Property Preview: Instant preview card appears near the tapped property"
> "Shows: thumbnail, address, FMV/asking price, activity indicator"
> "Quick action buttons: Like, Comment, Guess"
> "Instagram-like quick interaction feel"

### Design Principles

From spec:
> "Never leave the map unnecessarily - All quick interactions happen in-context"
> "Progressive disclosure - Simple preview -> Quick actions -> Full detail sheet"
> "Lightweight and playful - Feels like social media, not a mortgage application"
> "Fast feedback - Actions complete instantly with optimistic UI updates"

## Visual Elements Required

### 1. Preview Card Container
- Floating card that appears near the bottom of the screen when a property is tapped
- Clean, white background with rounded corners
- Subtle shadow for elevation/floating effect
- Positioned to not obstruct the selected marker

### 2. Property Information (Required)
- **Address**: Street name and house number (prominently displayed)
- **City/Location**: Secondary text showing city and/or postal code
- **Price Display**: Shows one of the following (in priority order):
  - Crowd FMV (Fair Market Value) if available
  - Asking Price if listing exists
  - WOZ Value as fallback
- Price should be formatted in Dutch locale (e.g., EUR 350.000)
- Label indicating the type of price shown ("Crowd FMV", "Asking Price", or "WOZ Value")

### 3. Activity Indicator (Required)
- Visual indicator showing property activity level
- Three levels:
  | Level | Description | Visual Style |
  |-------|-------------|--------------|
  | Hot | High recent activity | Red/orange dot with "Hot" label |
  | Warm/Active | Moderate activity | Orange/amber dot with "Active" label |
  | Cold/Quiet | Little to no activity | Gray dot with "Quiet" label |

### 4. Quick Action Buttons (Required)
Three action buttons displayed prominently on the preview card:

1. **Like Button**
   - Heart icon (outline by default)
   - Label: "Like"
   - Single tap to express interest (Instagram-like speed)
   - Should feel as fast as double-tapping on Instagram

2. **Comment Button**
   - Chat/speech bubble icon
   - Label: "Comment"
   - Opens full bottom sheet and scrolls to comment section

3. **Guess Button**
   - Price tag icon
   - Label: "Guess"
   - Opens full bottom sheet and scrolls to price guess slider section

### 5. Thumbnail (Optional Enhancement)
- Photo preview shown when:
  - Property has a listing with photos
  - Viewport is not cluttered with many visible properties
- Fallback: No thumbnail for properties without listing photos (address-only display is acceptable)

## Interaction Behavior

### Trigger
- Tap/click on any property marker (ghost node or active node)
- Preview card appears immediately (within 100-200ms)

### Dismissal
- Tap anywhere outside the preview card on the map
- Card smoothly fades/slides away

### Expand to Full Details
- Tap the preview card body (not action buttons)
- Opens the Property Bottom Sheet with full details

### Quick Action Response
- Like: Visual feedback immediately (icon color change, haptic if available)
- Comment: Opens bottom sheet, focuses on comment input
- Guess: Opens bottom sheet, scrolls to price guess slider

## Technical Notes

- Preview card uses React Native `Pressable` component for touch handling
- Uses NativeWind/TailwindCSS for styling
- Icons from `@expo/vector-icons` (Ionicons)
- Card positioned at the bottom of the map view (absolute positioning)
- Should handle both web and mobile platforms

## Screenshot Requirements

The test screenshot should capture:

1. The map view with property markers visible
2. One property marker in a "selected" or highlighted state (if applicable)
3. The preview card floating at the bottom of the screen
4. All required elements visible in the preview card:
   - Address text
   - City/location text
   - Price with label
   - Activity indicator (dot + label)
   - All three quick action buttons (Like, Comment, Guess)
5. Map canvas visible behind/around the preview card

## Acceptance Criteria (SUFFICIENT)

1. **Preview Card Appears**: Clicking a property marker displays the preview card
2. **Address Displayed**: Property address is clearly visible
3. **Price Displayed**: Price value with appropriate label is shown
4. **Activity Indicator**: Visual activity level indicator is present
5. **Quick Actions Visible**: All three buttons (Like, Comment, Guess) are displayed
6. **Proper Positioning**: Card appears at the bottom, not blocking the selected marker
7. **Console Health**: Zero console errors during test execution
8. **Visual Hierarchy**: Preview card is visually distinct from the map (shadow, white background)

## Acceptance Criteria (NEEDS_WORK)

Mark as NEEDS_WORK if:
- Preview card does not appear when clicking a marker
- Address or price information is missing
- Activity indicator is not visible
- Any quick action button is missing
- Card styling is broken (no background, no shadow, overlapping elements)
- Console errors are detected during test
- Card blocks the selected property marker entirely

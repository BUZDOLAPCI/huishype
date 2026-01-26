# Map Property Preview Card - Reference Expectation

## Overview
The "Instant Preview" card that appears directly on the map when a user taps a property node. This is the primary interaction point, designed to be lightweight, playful, and keep the user on the map.

## Context
From main-spec.md:
> "Instant Preview Card appears directly on the map near the property... Small photo thumbnail... Quick visual indicator of activity level... Quick Action Buttons (Like, Comment, Guess)."

## Visual Requirements

### 1. The Container
- **Position:** Floats above the tapped map node (absolute positioning relative to screen coordinates or map anchor).
- **Styling:** Rounded corners (xl), white background with subtle shadow to lift it off the map.
- **Size:** Compact. Should not obscure the whole map. Approx 60% of screen width on mobile.

### 2. Content Layout
- **Top:** Small thumbnail image (left) + Address & Price (right).
- **Bottom:** Row of 3 Quick Action Buttons.
- **Activity Indicator:** If "Hot/Active", a small pulsing dot or flame icon near the price.

### 3. Quick Action Buttons
- **Like:** Heart icon.
- **Comment:** Bubble icon.
- **Guess:** Gavel or Tag icon.
- **Style:** Minimalist icons, ample touch target size (44px min), but visually unobtrusive.

## Interaction Behavior
- **Entrance:** Spring animation (pop in) when a map node is tapped.
- **Exit:** Disappears immediately if user taps map background or drags map significantly.
- **Tap Behavior:** Tapping the *card itself* (not buttons) expands the Bottom Sheet (partial height).
- **Button Behavior:** Tapping a specific button (e.g., "Guess") opens the Bottom Sheet *directly* to that specific section.

## Technical Notes (Hints)
- Use `@rnmapbox/maps` standard PointAnnotation or ViewAnnotation if possible, or overlay absolute positioned React view based on screen coordinates.
- Styling via NativeWind (`className="bg-white rounded-xl shadow-lg..."`).

## Acceptance Criteria (SUFFICIENT)
1. Tapping a property node spawns the card near the location.
2. Card displays address and current FMV (or Asking Price).
3. The three action buttons are visible and clickable.
4. Tapping the map background closes the card.
5. Zero console errors.
6. Layout looks clean on both iOS and Android simulators (screenshots match).
7. When clicked on photo thumbnail or the general card instead of buttons, the bottom sheet with more details pulls up into view

## Acceptance Criteria (NEEDS_WORK)
- Card covers the tapped node completely (user can't see what they tapped).
- Text is cut off or overlaps buttons.
- Animation is jittery or lags map movement.
- Buttons are too small to tap easily.
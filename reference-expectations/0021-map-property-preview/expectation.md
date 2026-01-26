# Map Property Preview Card - Reference Expectation

## Overview
The "Instant Preview" card that appears directly on the map when a user taps a property node. This is the primary interaction point, designed to look like a "speech bubble" originating from the specific property.

## Context
From main-spec.md:
> "Instant Preview Card appears directly on the map near the property... Small photo thumbnail... Quick visual indicator of activity level... Quick Action Buttons (Like, Comment, Guess)."
## Behaviour
The bottom sheet should not be pulled up upon clicking node, we should first show preview card, and tapping on card body or action buttons should pull up the bottom sheet, unless bottom sheet is explicitly pulled up. 

When the preview card is active, bottom sheet should peek it's 'pull' section in bottom of the screen a little to allow user to pull it if desired.

## Reference preview card and positioning image 
Reference image: `preview-card-with-arrow-and-highlight.png` shows the desired "Speech Bubble" aesthetic and positioning.

## Visual Requirements

### 1. The Container (Speech Bubble Style)
- **Position:** Anchored vertically **above** the tapped map coordinate.
- **Visual Cue (Arrow):** The card must have a small downward-pointing triangle/arrow at the bottom center. This visually connects the card to the specific map dot below it.
- **Styling:** Rounded corners (xl), white background with subtle shadow to lift it off the map.
- **Size:** Compact. Approx 60-70% of screen width on mobile.

### 2. Content Layout
- **Top Section:**
  - Left: Small square thumbnail image (rounded corners).
  - Right: Address (Bold) & City/Zip (Grey/Regular).
  - Activity Indicator: If "Hot/Active", a small pulsing dot or status text (e.g., "Quiet") near the top right.
- **Bottom Section:**
  - Row of 3 Quick Action Buttons (Like, Comment, Guess) with icons and text labels.
  - Separator line between Top and Bottom sections.

### 3. Selected Node Visuals (The Dot)
When a user taps a node and the card is active, the node itself must change state:
- **Scaling:** The dot must scale up significantly (approx 1.3x to 1.5x) compared to unselected nodes.
- **Animation:** The selected dot must have a slight **pulsing animation** to indicate it is the currently active selection.

## Interaction Behavior
- **Entrance:** Spring animation (pop in) upwards from the node.
- **Exit:** Disappears immediately if user taps map background or drags map significantly.
- **Anchor:** The card (and its pointing arrow) must stay visually locked to the coordinate as the user pans the map (until the exit threshold is reached).
- **Tap Behavior:** Tapping the *card body* expands the Bottom Sheet. Tapping *buttons* expands the Bottom Sheet and scrolls down to relevant action section, or initialize the action (e.g select new comment input box).

## Technical Notes (Hints)
- Use `@rnmapbox/maps` `MarkerView` or `ViewAnnotation` to anchor a React component to a coordinate.
- The arrow can be a simple SVG or a CSS border-hack triangle positioned absolute at `bottom: -10px`, `left: 50%`.
- The pulsing node effect might require a separate generic `CircleLayer` for "selected state" or updating the specific feature's properties to drive a data-driven style expression.

## Acceptance Criteria (SUFFICIENT)
1. Tapping a property node spawns the card **above** the location.
2. The card includes a visual **arrow/triangle** pointing down to the source dot.
3. The **selected map dot scales up** and exhibits a **pulsing animation** while the card is open.
4. Visuals align with `preview-card-with-arrow-and-highlight.png`
5. Tapping the map background closes the card and returns the dot to its normal size/state.
6. Zero console errors.
7. All of the 'Behaviour' flows should be respected, and tested with e2e tests!

## Acceptance Criteria (NEEDS_WORK)
- Card appears at the bottom of the screen instead of above the node.
- Card is floating without a visual arrow connecting it to the map location.
- The selected map dot looks identical to unselected dots (no scaling or pulsing).
- Text overlaps or layout breaks on smaller screens.
- The bottom sheet is pulled up instantly after tapping the node, we should first show preview card, and tapping on card body or action buttons should pull up the bottom sheet
# Map Loading Indicator

## Severity
Medium

## Problem Statement
When the map is loading or failing to load, there is no loading spinner, skeleton loader, or any visual feedback. The blank beige area gives no indication that content is expected or that the app is working. Users may think the app is broken or frozen.

## Expected Behavior
The map component should provide clear visual feedback during all loading states:

**During Initial Load:**
- Show a loading spinner or skeleton loader
- Optionally display "Loading map..." text
- The loading indicator should be centered in the map area

**On Success:**
- Loading indicators should smoothly disappear
- Map should render without jarring transitions

## Acceptance Criteria
1. A loading spinner or skeleton is visible while the map initializes
5. The loading indicator disappears once the map is fully loaded
6. The transition from loading to loaded state is smooth
7. Loading states match the app's overall design language
8. Zero console errors during normal loading flow

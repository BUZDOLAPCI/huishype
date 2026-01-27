# Bottom Sheet Initial Hidden State

## Severity
Medium

## Problem Statement
A bottom sheet drag handle (small gray horizontal line) is visible at the top of the screen area even when no property is selected and the bottom sheet should be completely hidden. This visual artifact is confusing to users and suggests there is content to interact with when there is none.

## Expected Behavior
When no property is selected:
- The bottom sheet should be completely invisible
- No drag handle should be visible
- No shadow or border from the bottom sheet should be visible
- The map should occupy the full available screen space

The bottom sheet (including its drag handle) should only appear when:
- A user taps on a property node
- A user taps on a cluster
- Any other action that warrants showing property details

## Acceptance Criteria
1. On initial app load with no property selected, the bottom sheet is completely hidden
2. The drag handle indicator is not visible when the bottom sheet is hidden
3. No visual artifacts (shadows, borders, partial views) from the bottom sheet are visible
4. The map extends to the full bottom of the screen when no sheet is shown
5. The bottom sheet appears smoothly when a property/cluster is selected
6. The bottom sheet hides completely (including drag handle) when deselected
7. Zero console errors related to bottom sheet state management

## Visual Reference
The screen should show only the map with no hint of a bottom sheet until user interaction triggers it to appear.

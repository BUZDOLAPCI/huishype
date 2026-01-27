# Reference Expectation: Preview Card Persistence

## Problem

The preview card currently closes automatically in certain situations when it should remain visible. The preview card should persist until the user explicitly dismisses it by tapping on the map background.

## Expected Behavior

### Preview Card Persistence Rules

The preview card should **STAY OPEN** during:
- Bottom sheet state changes (peek → expanded → collapsed)
- Map panning/dragging
- Map zooming (pinch, scroll wheel, double-tap zoom)
- Map rotation
- Map tilting
- Any navigation gesture
- **CRITICAL: Clicking the preview card body (which also expands the bottom sheet)**
- **CRITICAL: Tapping map to dismiss an expanded bottom sheet (return to map)**

The preview card should **CLOSE** only when:
- User taps directly on the map background **when bottom sheet is NOT expanded** (i.e., in peek state or closed)
- User selects a different property node
- User programmatically closes it (e.g., via close button if present)

### Critical Clarifications

> **CRITICAL POINT 1: Preview Card Body Click**
> When the user clicks on the preview card body, it should:
> 1. Expand the bottom sheet to show full details
> 2. **Keep the preview card open** (do NOT close it)
>
>The flow is preview card to bottom sheet, and back the same way
>
> **CRITICAL POINT 2: Bottom Sheet Dismissal via Map Tap**
> When the bottom sheet is expanded and the user taps on the map (or backdrop) to dismiss it:
> 1. The bottom sheet should collapse/close (return to peek or hidden state)
> 2. **The preview card should STAY OPEN** - user intention is to "return to map view", not to deselect the property
>
> The preview card should only close on a tap on map background when bottom sheet is already in peek/closed state.

### Interaction Details

| User Action | Bottom Sheet State | Preview Card Behavior |
|-------------|-------------------|----------------------|
| Tap map background | Expanded | STAY OPEN (sheet dismisses, card persists) |
| Tap map background | Peek/Closed | CLOSE |
| Tap different property node | Any | CLOSE (then show new card) |
| Pan/drag map | Any | STAY OPEN (card follows marker) |
| Zoom in/out | Any | STAY OPEN (card follows marker) |
| Rotate map | Any | STAY OPEN (card follows marker) |
| Expand bottom sheet | N/A | STAY OPEN |
| Collapse bottom sheet | N/A | STAY OPEN |
| Tap preview card body | Any | STAY OPEN (also expands sheet) |
| Tap action buttons | Any | STAY OPEN (also triggers action) |

### Visual Anchoring

While the preview card stays open during map manipulation:
- The card must remain visually anchored to its property marker
- The pointing arrow should always connect to the marker location
- Position updates should be smooth during pan/zoom animations

## Acceptance Criteria

1. Preview card remains visible when bottom sheet expands from peek to full
2. Preview card remains visible when bottom sheet collapses back to peek
3. Preview card remains visible during map pan gestures
4. Preview card remains visible during map zoom gestures
5. **CRITICAL: Preview card remains visible when clicking preview card body (even though it expands bottom sheet)**
6. **CRITICAL: Preview card remains visible when tapping map to dismiss expanded bottom sheet**
7. Preview card closes ONLY when user taps on empty map area AND bottom sheet is in peek/closed state
8. Preview card closes when selecting a different property
9. Card position stays anchored to marker during all map manipulations
10. Zero console errors
11. All behavior flows tested with e2e tests


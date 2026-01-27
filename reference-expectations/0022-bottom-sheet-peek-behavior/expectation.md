# Reference Expectation: Bottom Sheet Peek Behavior

## Problem

When clicking a property node on the map, the bottom sheet currently opens almost fully and darkens the map background. This is incorrect behavior.

## Expected Behavior

### Preview Card Flow
1. **On node tap**: Only the preview card should appear (floating above the node)
2. **Bottom sheet**: Should only "peek" from the bottom - showing just the drag handle, not the full content
3. **No darkening**: The map background should NOT be darkened when the bottom sheet is in peek state

### Animation & Interactions

- **Entrance:** Preview card springs in (pop animation) upwards from the node
- **Exit:** Preview card disappears immediately if user:
  - Taps map background
  - Drags map significantly
- **Anchor:** The preview card (and its pointing arrow) must stay visually locked to the coordinate as the user pans the map (until exit threshold is reached)

### Bottom Sheet Behavior

| State | Bottom Sheet Position | Background |
|-------|----------------------|------------|
| No selection | Hidden | Normal (no overlay) |
| Preview card shown | Peek only (just handle visible) | Normal (no overlay) |
| User expands bottom sheet | Fully expanded | Darkened overlay |

### Tap Behavior

- **Tapping preview card body**: Expands the bottom sheet to full height
- **Tapping action buttons (Like, Comment, Guess)**:
  - Expands the bottom sheet AND
  - Scrolls to the relevant action section, OR
  - Initializes the action (e.g., focuses comment input box)

## Acceptance Criteria

1. Clicking a property node shows ONLY the preview card initially
2. Bottom sheet peeks minimally (just drag handle visible) - does NOT auto-expand
3. Map background is NOT darkened when bottom sheet is in peek state
4. Map background IS darkened only when bottom sheet is fully expanded
5. Tapping preview card body expands bottom sheet
6. Tapping action buttons expands bottom sheet and triggers relevant action
7. Zero console errors
8. All behavior flows tested with e2e tests

## Reference Images

- `current-incorrect-state.png` - Shows the current INCORRECT behavior where bottom sheet is almost fully open with darkened background after just clicking a node

## Visual Reference

The peek state should show approximately:
- 5-10% of screen height for bottom sheet (just the handle/pull bar)
- Full visibility of the map and preview card
- No overlay/darkening on the map

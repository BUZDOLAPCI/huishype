# Bottom Sheet Partial Expand State

This reference expectation defines the visual and functional requirements for the Bottom Sheet in its **partial expand state** (approximately half screen).

## Overview

When a user taps on a property marker on the map, a bottom sheet appears. The **partial expand state** is the default initial state that displays key property information and quick actions while keeping the map visible and interactive behind it.

This is a critical UX element that allows users to:
- Preview property information quickly
- Perform quick actions (like, comment, guess)
- Continue exploring the map without fully committing to a property detail view

## Visual Elements Required

### Bottom Sheet Container
- **Height**: Approximately 50% of the screen (half screen)
- **Position**: Anchored to the bottom of the viewport
- **Background**: White or light background with rounded top corners
- **Drag Handle**: Small centered bar at the top indicating the sheet can be swiped up/down

### Content Visible at Partial Expand
- **Property Photo**: Thumbnail or hero image of the property
  - Falls back to Street View if no listing photos
- **Address**: Full address displayed prominently
- **Key Metrics**:
  - Asking price (if listing exists)
  - Size in m2
  - Number of rooms/bedrooms
  - FMV indicator or WOZ value
- **Quick Action Buttons**:
  - Like/Heart button
  - Comment button
  - Price Guess button
  - Share button

### Map Visibility
- **Map Visible**: The map should be clearly visible above/behind the bottom sheet
- **Approximately 50% Map Area**: Upper half of screen shows the map
- **Selected Property Marker**: The currently selected property marker should be visible on the map
- **Map Styling**: Map tiles should be fully loaded and visible

## Interaction Requirements

### Map Interactivity at Partial Expand
- **Pan**: Users should be able to pan the map while bottom sheet is partially open
- **Zoom**: Users should be able to pinch-zoom or use controls to zoom the map
- **Marker Visibility**: Property markers should remain visible and tappable
- **Note**: Tapping another marker may switch selection or close current sheet

### Bottom Sheet Gestures
- **Swipe Up**: Expand to full screen (90%) for complete details
- **Swipe Down**: Dismiss the sheet and return to map-only view
- **Tap Outside (on map)**: May dismiss the sheet or be ignored (map interaction prioritized)

### Visual Feedback
- Smooth animations when transitioning between states
- Clear visual separation between map area and sheet
- Shadow or elevation effect on the sheet edge

## Verification Criteria for SUFFICIENT

The implementation is considered SUFFICIENT when:

1. **Half-Screen Height**: Bottom sheet occupies approximately 50% of screen height (+/- 10%)

2. **Map Visibility**:
   - Map is clearly visible in the upper half of the screen
   - Map tiles are loaded and rendering correctly
   - At least one property marker or the selected property area is visible

3. **Key Content Present**:
   - Property photo or fallback image visible
   - Address text readable
   - At least 2 quick action buttons visible
   - Price or key metric visible

4. **Visual Polish**:
   - Rounded top corners on the bottom sheet
   - Drag handle indicator visible
   - Clean separation between map and sheet

5. **Console Health**: Zero JavaScript errors during test execution

6. **No Broken UI**:
   - No overlapping elements
   - No clipped content
   - Readable text at normal font sizes

## Screenshot Requirements

The test screenshot should capture:
1. The entire viewport showing both map (top) and bottom sheet (bottom)
2. Bottom sheet at approximately 50% height
3. Property information visible in the sheet
4. Quick action buttons visible
5. Map with property markers visible above the sheet
6. No error states or loading spinners

## Mobile-First Considerations

- Touch-friendly tap targets (minimum 44px)
- Readable text without zooming
- Appropriate spacing for thumb interaction
- Native-feeling swipe gestures

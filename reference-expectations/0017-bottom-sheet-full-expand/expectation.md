# Bottom Sheet Full Expand State

This reference expectation defines the visual and functional requirements for the Bottom Sheet in its **full expand state** (entire screen or almost full screen, approximately 90% of viewport).

## Overview

When a user swipes up on a partially expanded bottom sheet, it transitions to the **full expand state**. This state reveals the complete detail view with all property information, photos, links, valuations, and activity data.

This is the comprehensive property detail experience that provides:
- Full property photos gallery
- Links to original listings (Funda, Pararius, etc.)
- WOZ value comparison with FMV
- FMV distribution curve visualization
- Activity timeline showing engagement history
- Complete comment feed
- Full price guess interface

## Trigger Interaction

**Swipe Up Gesture**: From the partial expand state (50% screen), user swipes up to trigger full expand.

The transition should be:
- Smooth animated expansion from ~50% to ~90% height
- Natural feeling gesture that follows finger movement
- Snap to full expand when swipe velocity/distance threshold is met

## Visual Elements Required

### Bottom Sheet Container (Full Expand)
- **Height**: Approximately 90% of the screen (almost full screen)
- **Position**: Anchored to the bottom of the viewport
- **Background**: White or light background with rounded top corners
- **Drag Handle**: Small centered bar at the top indicating the sheet can be swiped down
- **Scroll**: Content should be scrollable within the sheet

### Full Content Revealed at Full Expand

#### 1. Property Photos
- **Photo Gallery/Carousel**: Full-width property photos
- Multiple photos if available from listing
- Fallback to Street View or satellite imagery if no listing photos
- Swipeable gallery for multiple images
- Photo counter (e.g., "1/5") if multiple photos

#### 2. Listing Links Section
- **External Links**: Clear buttons/links to original listings
  - Funda link (if listing exists)
  - Pararius link (if applicable)
  - Other marketplace links
- Links should open in external browser/app
- Visual indication these are external links

#### 3. WOZ Value Comparison
- **WOZ Value Display**: Official government valuation clearly shown
- **Comparison with FMV**: Visual comparison between WOZ and crowd FMV
- **Asking Price**: If listing exists, show asking price for three-way comparison
- Clear labeling of each value source

#### 4. FMV Distribution Curve
- **Distribution Visualization**: Graph/chart showing crowd price guesses distribution
- Median/weighted FMV value highlighted
- Range indication (low to high estimates)
- Confidence indicator if enough guesses exist
- User's own guess position (if they've guessed)

#### 5. Activity Timeline
- **Recent Activity**: Chronological feed of property engagement
- Shows: views, comments, price guesses, likes
- Timestamps for each activity
- User avatars/names for social activities
- Velocity indicator (trending up/down)

#### 6. Quick Actions (Still Accessible)
- Like/Heart button
- Comment button (may scroll to comment section)
- Price Guess button (may scroll to guess interface)
- Share button
- Save/Favorite button

#### 7. Full Address and Metadata
- Complete address
- Property type
- Size in m2
- Number of rooms/bedrooms
- Year built (if available)
- Energy label (if available)

### Map Visibility at Full Expand
- **Minimal Map Visible**: Only ~10% of map visible at top
- **Map Dimmed/Obscured**: Map area may be slightly dimmed
- Focus is entirely on the bottom sheet content
- Small peek of map provides context but doesn't compete for attention

## Interaction Requirements

### Full Expand Gestures
- **Swipe Down**: Return to partial expand state or dismiss entirely
- **Scroll Within Sheet**: Vertical scrolling through content
- **Swipe on Photos**: Horizontal swipe to navigate photo gallery
- **Tap on Links**: Open external listing sites
- **Tap on Actions**: Trigger like/comment/guess actions

### Content Scrolling
- Sheet content should be independently scrollable
- Scroll to bottom to see full comment feed
- Scroll position should be preserved when switching between states

## Verification Criteria for SUFFICIENT

The implementation is considered SUFFICIENT when:

1. **Full Screen Height**: Bottom sheet occupies approximately 90% of screen height (+/- 5%)

2. **Photo Section Present**:
   - Property photo(s) visible in the sheet
   - Photo gallery/carousel functional if multiple photos
   - Fallback image visible if no listing photos

3. **Listing Links Present**:
   - At least one external listing link visible (or "No listing available" message)
   - Links are clearly styled as actionable

4. **WOZ/FMV Section Present**:
   - WOZ value displayed
   - FMV or crowd estimate displayed
   - Visual comparison or relationship shown

5. **FMV Distribution Curve**:
   - Distribution visualization present (chart/graph)
   - Or appropriate placeholder if insufficient data

6. **Activity Timeline Present**:
   - Activity section visible
   - Shows some form of engagement history
   - Or appropriate "No activity yet" state

7. **Scroll Functionality**:
   - Content is scrollable within the sheet
   - Can access all sections by scrolling

8. **Visual Polish**:
   - Clear section separation
   - Readable typography
   - Proper spacing and alignment
   - No overlapping elements

9. **Console Health**: Zero JavaScript errors during test execution

10. **Smooth Transition**:
    - Swipe up from partial expand triggers full expand
    - Animation is smooth (no jerky transitions)

## Screenshot Requirements

The test screenshot should capture:
1. Full expand state at approximately 90% screen height
2. Property photos visible at top of sheet
3. At least 2-3 content sections visible (photos, WOZ/FMV, activity)
4. Minimal map peek visible at the very top
5. Scroll indicator or evidence of more content below
6. No error states, loading spinners, or broken layouts

## Mobile-First Considerations

- Touch-friendly swipe gestures
- Adequate touch targets for all interactive elements
- Readable text without zooming
- Photo gallery works with swipe gestures
- External links open correctly (not in a tiny iframe)

## Content Sections Order (Suggested)

1. Drag handle
2. Property photos (full width)
3. Address and key metrics
4. Quick action buttons
5. Listing links
6. WOZ / FMV comparison
7. FMV distribution curve
8. Price guess interface
9. Activity timeline
10. Comment feed (scrollable)

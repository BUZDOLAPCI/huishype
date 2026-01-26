# Property Bottom Sheet Details

This reference expectation defines the visual and functional requirements for the Property Bottom Sheet feature when fully expanded.

## Overview

The bottom sheet appears when a user taps on a property marker on the map and then taps the preview card to expand it. It provides comprehensive property information in a scrollable, mobile-friendly format.

## Visual Elements Required

### Header Section
- **Property Photos**: Full-width photo carousel/gallery showing property images (if available)
  - Fallback to Street View image if no listing photos exist
  - Horizontal swipeable if multiple photos
- **Drag Handle**: Small centered bar at the top indicating the sheet can be swiped

### Property Information Section
- **Complete Address**: Full address displayed prominently (street, house number, postal code, city)
- **Property Metadata**:
  - Property type (apartment, house, etc.)
  - Size in m2
  - Number of rooms/bedrooms
  - Build year

### Listing Links Section
- **External Listing Links**: Clickable links/buttons to original listings
  - Funda link (if applicable)
  - Pararius link (if applicable)
  - Other listing sources
- Links should open externally in a new tab/browser

### WOZ Value Comparison
- **WOZ Value Display**: Official government valuation shown as reference
- **Comparison Indicator**: Visual comparison between WOZ and asking price (if available)

### Price Guess Section
- **Price Guess Slider UI**: Interactive slider for users to submit their price guess
  - Slider with draggable thumb
  - Minimum and maximum range indicators
  - Current value display
  - Submit button

### FMV Visualization
- **Distribution Curve**: Visual chart showing crowd-estimated fair market value
  - Bell curve or similar distribution visualization
  - Showing range and confidence
  - Comparison marker showing asking price vs FMV

### Social Sections
- **Comment Feed**: Scrollable list of user comments
  - User avatar/name
  - Comment text
  - Timestamp
  - Like/reaction buttons
  - Reply capability (1 level deep)
- **Activity Timeline**: Chronological list of property activities
  - Price guesses
  - Comments
  - Views/interest metrics

### Action Buttons
- **Save Button**: Save property to user's favorites
- **Share Button**: Share property via native share or copy link
- **Add to Favorites Button**: Quick favorite toggle

## Bottom Sheet Behavior

### Snap Points
1. **Closed State**: Sheet is hidden, only map is visible
2. **Partial Expand (50% screen)**: Shows key info + quick actions
   - Photo preview
   - Address
   - Key metrics (price, size)
   - Quick action buttons
3. **Full Expand (90% screen)**: Reveals complete detail view
   - All sections visible
   - Scrollable content within the sheet

### Gestures
- **Swipe Up**: Expand from partial to full
- **Swipe Down**:
  - From full to partial
  - From partial to closed (dismiss)
- **Tap Outside**: Dismiss the sheet (when partially expanded)

### Map Interaction
- Map remains visible at partial expand state
- Map should be interactive (pan/zoom) when sheet is partially open
- Map interaction disabled when sheet is fully expanded

## Mobile-First Design
- Touch-friendly tap targets (min 44px)
- Smooth animations for state transitions
- Native-feeling gestures
- Responsive layout that works on various screen sizes

## Accessibility
- All interactive elements should be keyboard accessible
- Proper ARIA labels for screen readers
- Sufficient color contrast
- Focus management when sheet opens/closes

## Screenshot Requirements

The test screenshot should capture:
1. The bottom sheet in fully expanded (90%) state
2. At least one visible property photo or fallback image
3. Address and property metadata visible
4. Price guess slider section visible
5. Comments section (even if empty with placeholder)
6. Action buttons visible at the bottom
7. The map partially visible behind/above the sheet

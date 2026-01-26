# Price Guess Slider UI - Reference Expectation

## Overview

The Price Guess Slider is a core engagement feature that allows users to submit their estimate of what a property is worth. The UI should be minimal-friction, playful, and provide immediate visual feedback.

## Visual Requirements

### 1. Price Guess Slider Component

The slider should be prominently displayed with:

- **Current Price Value Display**: Large, prominent text showing the currently selected price (e.g., "EUR 350.000")
- **Slider Track**: A horizontal track with a draggable thumb
- **Slider Fill**: Visual fill from left edge to thumb position indicating the selected value
- **Thumb**: A circular draggable handle that responds to touch/drag

### 2. Reference Markers

Reference markers should appear above the slider track to provide context:

- **WOZ Value Marker**: Purple colored marker labeled "WOZ" showing the official government valuation
- **Asking Price Marker**: Orange colored marker labeled "Ask" showing the listing's asking price (if available)
- **FMV Marker**: Blue colored marker labeled "FMV" showing the crowd-estimated Fair Market Value (if available)

### 3. Quick Adjustment Buttons

Four quick adjustment buttons arranged horizontally below the slider:

- **-50k**: Decrease price by EUR 50,000
- **-10k**: Decrease price by EUR 10,000
- **+10k**: Increase price by EUR 10,000
- **+50k**: Increase price by EUR 50,000

Buttons should have a subtle background (gray) with clear text labels.

### 4. Submit Button

A prominent submit button below the quick adjustment buttons:

- Full-width button with rounded corners
- Primary color background (blue/primary theme)
- White text reading "Submit Guess"
- Disabled state when user is not authenticated or in cooldown

### 5. Min/Max Price Range Labels

Small text labels at the ends of the slider showing:

- **Min**: EUR 50.000 (left side)
- **Max**: EUR 2.000.000 (right side)

### 6. Animations and Haptic Feel

While not visible in static screenshots, the implementation should include:

- Spring animations when dragging the thumb
- Pulse effect when near reference markers (especially WOZ)
- Scale animation on the price display when value changes
- Button press feedback animation
- Haptic feedback on mobile (selection feedback when sliding, impact feedback when crossing WOZ, success notification on submit)

## Section Container

The Price Guess Section should include:

- **Header**: Icon (pricetag) with "Guess the Price" title
- **Description text**: "What do you think this property is worth? Submit your guess and see how it compares to others."
- **Login prompt**: For unauthenticated users, show a sign-in prompt before they can submit
- **Success message**: After submission, show a green success banner
- **Existing guess indicator**: If user has already guessed, show their current guess below the slider

## Layout Context

The Price Guess Slider appears in the Property Bottom Sheet, accessible by:

1. Tapping a property marker on the map
2. Expanding the bottom sheet to see full details
3. Scrolling down to the "Guess the Price" section

## Acceptance Criteria

1. The slider thumb should be clearly visible and draggable
2. Reference markers (WOZ, Ask, FMV) should be positioned correctly on the track
3. Price display should update in real-time as the slider moves
4. Quick adjustment buttons should be clearly labeled and tappable
5. Submit button should be prominent and indicate current state
6. The overall design should feel playful and low-friction, not like a mortgage application

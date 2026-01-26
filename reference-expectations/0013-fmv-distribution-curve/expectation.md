# FMV Distribution Curve - Reference Expectation

## Overview

The FMV (Fair Market Value) Visualization is central to user engagement and data generation. It displays the crowd-estimated fair market value of a property through a visual distribution curve, showing the range, confidence level, and comparison to the asking price.

From the main specification (agent-rules/main-spec.md, lines 72-78):
> "The result is a continuously evolving crowd-estimated FMV, shown as:
> - A weighted value
> - A distribution curve (range, confidence)
> - Comparison to asking price if exists
>
> This mechanism is central to engagement and data generation."

## Visual Requirements

### 1. FMV Value Display

The primary FMV value should be prominently displayed:

- **Large Price Value**: A prominent, bold display of the crowd-estimated fair market value (e.g., "EUR 350.000")
- **Currency Format**: Dutch locale formatting with EUR symbol and period separators
- **Visual Weight**: The FMV value should be the most visually prominent element in the component

### 2. Distribution Curve / Range Bar

A visual representation of the distribution of guesses:

- **Distribution Bar**: A horizontal bar showing the spread of guesses from minimum to maximum
- **Fill Gradient**: The bar should have a gradient fill indicating the distribution density (blue gradient recommended)
- **Median Marker**: A vertical line or indicator showing where the median guess falls within the range
- **Min/Max Labels**: Small text labels at both ends showing the minimum and maximum guess values

### 3. Confidence Indicator

Display how confident the crowd estimate is:

- **Confidence Badge**: A pill-shaped badge showing confidence level
- **Three Levels**:
  - **Low** (Yellow): Less than 3 guesses - "Low confidence - only X guess(es)"
  - **Medium** (Blue): 3-9 guesses - "Building consensus"
  - **High** (Green): 10+ guesses - "Strong consensus"
- **Icon**: Contextual icon reflecting the confidence state
- **Guess Count**: Display the number of guesses used to calculate the FMV

### 4. Reference Markers on Distribution

Position markers on the distribution bar for context:

- **User Guess Marker** (Green): If the user has submitted a guess, show their position on the distribution
- **Asking Price Marker** (Orange): If available, show where the asking price falls on the distribution
- **Clear Labels**: Each marker should have a small label below it (e.g., "You", "Ask", "Median")

### 5. Comparison Metrics

Textual comparisons showing relationships:

- **Asking Price Comparison**: "Asking price is X% above/below crowd estimate"
  - Red text/arrow for prices above estimate
  - Green text/arrow for prices below estimate
- **User Guess Comparison**: "Your guess is X% above/below the median" or "aligned with" if within 5%
- **WOZ Value Reference**: Display the official WOZ value for additional context

### 6. Visual States

The component should handle different states gracefully:

- **Loading State**: Skeleton placeholder with animated pulse effect
- **No Data State**: Friendly message encouraging users to be the first to guess
- **With Data State**: Full visualization with all elements

### 7. Animations

While not visible in static screenshots, the implementation should include:

- **Entry Animation**: Distribution bar grows from left to right on mount
- **Value Fade-in**: FMV value fades and scales in after bar animation
- **Marker Animations**: Reference markers animate to their positions with spring physics
- **Confidence Badge**: Subtle bounce animation on state change

## Layout Context

The FMV Visualization appears in:

1. **Property Bottom Sheet**: In the price section, below the price guess slider
2. **Property Detail Page**: Prominently displayed in the pricing information area
3. **Property Cards** (condensed): A simplified version showing just the FMV value and confidence

## Acceptance Criteria for SUFFICIENT

1. **FMV Value Visible**: The crowd-estimated fair market value is displayed prominently in EUR format
2. **Distribution Bar Visible**: A horizontal bar representing the range of guesses is shown
3. **Min/Max Labels**: The minimum and maximum guess values are displayed at bar ends
4. **Confidence Badge**: The confidence level indicator is visible with appropriate color and text
5. **Guess Count**: The number of guesses is displayed (e.g., "Based on X guesses")
6. **Comparison Text**: At least one comparison metric (asking price or user guess vs estimate) is shown
7. **Median Indicator**: The median position is marked on the distribution bar
8. **No Console Errors**: The page loads without any JavaScript errors in the console
9. **Visual Hierarchy**: The FMV value is the most prominent element, with supporting information clearly secondary

## Test Data Requirements

To properly test this component, the test should:

1. Use a property that has at least 3 price guesses (to show medium/high confidence)
2. Include properties with asking prices for comparison display
3. If possible, use a logged-in user who has submitted a guess to show the "You" marker

## Color Scheme

- **Primary FMV Value**: Blue/Primary color (text-primary-600)
- **Distribution Bar**: Blue gradient (from-blue-300 to-primary-500)
- **Low Confidence**: Yellow tones (bg-yellow-100, text-yellow-700)
- **Medium Confidence**: Blue tones (bg-blue-100, text-blue-700)
- **High Confidence**: Green tones (bg-green-100, text-green-700)
- **User Guess Marker**: Green (bg-green-500)
- **Asking Price Marker**: Orange (bg-orange-500)
- **Above Estimate**: Red (text-red-500)
- **Below Estimate**: Green (text-green-500)

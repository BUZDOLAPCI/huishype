# Feed View Property Cards

## Overview

The Feed View is a content-style feed that makes housing browsing feel closer to a social app than a classifieds site. It shows curated property content based on activity and interest.

## Feed Content Categories

The feed should display properties from these categories:
- **Newly active listings** - Recently listed or updated properties
- **Highly interacted properties** - High comment count, guesses, views
- **Price mismatches** - Properties where asking price differs significantly from crowd FMV
- **Polarizing listings** - Properties with mixed opinions or high engagement

## Property Card Visual Design

Each property card in the feed should include:

### Image Section (Top)
- Property photo taking full card width
- Height approximately 192px (h-48)
- Fallback placeholder with home icon if no photo available
- Activity badge in top-left corner (e.g., "Trending", "Active") for hot/warm properties
- View count overlay in bottom-right corner (eye icon with count)

### Content Section (Bottom)
1. **Address and Location**
   - Street address as primary text (large, semibold)
   - City and postal code as secondary text (smaller, gray)
   - Activity indicator dot in the corner (red=hot, orange=warm, gray=cold)

2. **Property Details Badges** (if available)
   - Build year (bouwjaar) badge
   - Surface area (oppervlakte) badge in m2

3. **Price Information**
   - WOZ Value (government valuation) - labeled, medium text
   - Asking Price (if listed) - labeled, semibold text
   - Crowd FMV (primary display) - large, bold, primary color
   - Price difference indicator (e.g., "+5.2% vs asking") colored red/green based on over/underpriced

4. **Activity Stats Bar** (bottom, with top border)
   - Comment count with icon
   - Guess count with icon
   - View count with icon

### Card Styling
- White background with rounded corners (rounded-xl)
- Subtle shadow
- Horizontal margin (mx-4)
- Vertical margin between cards (mb-4)
- Pressable with active opacity feedback

## Filter Chips

At the top of the feed, horizontal scrollable filter chips:
- All
- New
- Trending
- Price Mismatch
- Polarizing

Selected chip should be visually distinct (filled background vs outlined).

## Layout Expectations

1. Cards should be vertically stacked in a scrollable list
2. Cards should have consistent spacing and alignment
3. Content should be readable and well-organized
4. Social engagement metrics (comments, guesses, views) should be prominently visible
5. Price information should be easy to compare (WOZ vs Asking vs FMV)

## Visual Verification Criteria

For the screenshot to be considered SUFFICIENT:
1. At least one property card is visible in the feed
2. Property card shows the expected structure (image, address, prices, activity stats)
3. Filter chips are visible at the top (if implemented)
4. The overall layout feels like a social feed, not a boring listing site
5. Price information is clearly displayed with proper formatting
6. Activity indicators are visible (view counts, comment counts)
7. No visual glitches or broken layouts
8. Zero console errors during rendering

## Notes

- The feed should feel engaging and social-first
- Quick visual scanning of prices and activity should be easy
- Cards should invite interaction (clickable feel)

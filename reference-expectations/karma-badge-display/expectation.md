# Karma Badge Display Reference Expectation

## Overview

Users have a credibility/karma score that is displayed as a colored badge next to their username in the comments section. This badge indicates their rank level based on accumulated karma points.

## Karma System Rules

Based on the main spec:
- Karma starts from 0 and doesn't go below 0 (public display)
- Internal negative metric tracked separately for potential bans
- Karma affects influence on FMV calculations
- Shown beside username as rank title in comments

## Rank Levels and Thresholds

| Rank | Points Range | Color Scheme |
|------|-------------|--------------|
| Newbie | 0-10 | Gray background, gray text |
| Regular | 11-50 | Green background, green text |
| Trusted | 51-100 | Blue background, blue text |
| Expert | 101-500 | Purple background, purple text |
| Legend | 500+ | Amber/gold background, amber text |

## Visual Requirements

### Badge Appearance

1. **Shape**: Rounded pill shape (rounded-full)
2. **Size variants**:
   - `sm`: Smaller padding (px-1.5 py-0.5), text-xs
   - `md`: Larger padding (px-2 py-1), text-sm
3. **Typography**: Medium font weight for rank label
4. **Colors**: Soft pastel backgrounds with darker matching text colors

### Comment Display Layout

The visual hierarchy in comment header should be:
1. **User Avatar** - Circular avatar with initials or photo
2. **Display Name** - Bold/semibold, primary text color
3. **Karma Badge** - Colored pill badge showing rank (e.g., "Expert", "Trusted")
4. **Username** - Smaller, gray text with @ prefix
5. **Timestamp** - Right-aligned, gray text showing relative time

### Expected Appearance

```
[Avatar] Display Name [Karma Badge]    2h ago
         @username
```

Example with Expert user:
```
[JV] Jan de Vries [Expert]            2h ago
     @jandevries
```

## Test Scenarios

The E2E test should verify:
1. Comments section is visible with karma badges displayed
2. Multiple karma ranks are visible (showing variety)
3. Badge colors correspond to rank levels
4. Visual hierarchy is correct (name, badge, timestamp)
5. No console errors during rendering

## Mock Data Reference

The test should use mock comments that include users with various karma levels:
- Expert (karma: 2500) - Jan de Vries
- Trusted (karma: 850) - Maria Bakker
- Regular (karma: 125) - Pieter Jansen
- Master/Legend (karma: 5200) - Sophie Meijer
- Newbie (karma: 0) - New User

## Success Criteria

- Karma badges are clearly visible next to usernames
- Color coding is visually distinct for each rank level
- Badge text is readable and properly contrasted
- Layout maintains proper spacing and alignment
- Works on both desktop and mobile viewports

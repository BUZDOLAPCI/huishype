# Ghost vs Active Nodes - Visual Expectation

## Overview

This expectation verifies the visual distinction between **Ghost Nodes** and **Active Nodes** on the map. This is a key UX pattern that communicates:
- Ghost Nodes: Properties with minimal or no social activity (low-opacity dots proving data coverage)
- Active Nodes: Socially active properties with recent comments, guesses, or high interest (larger, colored, eye-catching)

The contrast between ghost and active nodes creates visual proof of coverage while highlighting where the engaging content is.

## Reference: main-spec.md (lines 150-158)

From the specification:
> - **Ghost Nodes:** Show all for-sale listings (via BAG data + "For Sale" indicator) as small, low-opacity dots. This proves the platform has data.
> - **Active Nodes:** Show "Socially Active" properties (recent comments, guesses, high interest) as slightly larger, pulsing, colored. This guides attention to engaging content.

## Visual Requirements

### Ghost Nodes (Inactive Properties)
- **Size:** Small radius (approximately 6px)
- **Color:** Neutral gray (`#94A3B8` or similar muted gray)
- **Opacity:** Low opacity (0.3-0.5) - subtle but visible
- **Stroke:** Thin white stroke (1px) with reduced opacity
- **Appearance:** Should fade into the background, not demanding attention
- **Purpose:** Prove data coverage without visual noise

### Active Nodes (Socially Active Properties)
- **Size:** Larger radius (8-16px), scaling with activity level
  - Low activity: ~8px
  - Medium activity: ~12px
  - High activity: ~16px
- **Color:** Warm colors indicating activity heat
  - Warm (low activity): Orange (`#F97316`)
  - Hot (high activity): Red (`#EF4444`)
- **Opacity:** High opacity (0.85-0.95) - prominent and attention-grabbing
- **Stroke:** White stroke (2px) for visibility against any background
- **Appearance:** Should stand out clearly from ghost nodes
- **Purpose:** Guide attention to engaging, active content

### Visual Contrast Requirements
1. At a glance, active nodes should be immediately distinguishable from ghost nodes
2. The color temperature (warm orange/red vs cool gray) should be clearly different
3. Size difference should be noticeable (active nodes ~50-100% larger than ghost nodes)
4. Opacity contrast should make ghost nodes recede while active nodes pop

## Test Scenario

The E2E test should:
1. Navigate to the map view
2. Zoom to a level where individual property points are visible (not clustered)
3. Ensure both ghost and active nodes are present in the viewport
4. Capture a screenshot showing the visual distinction

## Verification Criteria for SUFFICIENT

### Must Have
- [ ] Ghost nodes visible with low opacity gray appearance
- [ ] Active nodes visible with warm orange/red colors
- [ ] Clear size difference between ghost and active nodes
- [ ] Active nodes have higher visual prominence than ghost nodes
- [ ] Both node types visible simultaneously in the screenshot
- [ ] Zero console errors during test execution

### Nice to Have
- [ ] Activity-based size scaling visible on active nodes (different sizes for different activity levels)
- [ ] Color gradient visible on active nodes (orange to red based on activity)
- [ ] White strokes visible on both node types

## Implementation Location

The ghost vs active node styling is implemented in:
- `/home/caslan/dev/git_repos/hh/huishype/apps/app/app/(tabs)/index.web.tsx`
- Layers: `ghost-points` and `active-points`

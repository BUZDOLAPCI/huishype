# Reference Expectation: Map View Property Markers

## Overview

The map view should display property markers that visually communicate listing and social activity. This creates a visual hierarchy that guides users toward interesting content without turning quiet address records into map nodes.

## Requirements (from main-spec.md)

### Map View Core Principles

From the specification:
> "Main view. A social Snap-style map focused on housing activity"
> "it defaults to *interesting content*, not raw density. think map + feed hybrid in feel"

### Active Nodes
From spec: "Show 'Socially Active' properties (recent comments, guesses, high interest) as slightly larger, pulsing, colored. This guides attention to engaging content."

Visual requirements:
- Full opacity
- Colored markers indicating activity level
- May include subtle animation (pulsing effect)
- Represents properties with recent activity

### Activity Level Indicators

Properties should visually communicate their "temperature" based on activity:

| Activity Level | Description | Visual Style |
|----------------|-------------|--------------|
| Hot | Recent activity, trending, many interactions | Largest size, warm color (orange/red), pulsing |
| Warm | Moderate activity, some recent engagement | Medium-large size, yellow/amber color |

### Visual Activity Indicators
From spec: "Pulses indicating recent activity (comments, guesses, upvotes)"

- Hot properties should have a visible pulse animation
- The pulse should be subtle but noticeable
- Activity recency affects pulse intensity

### Clustering Behavior
From spec: "Should group points/nodes depending on zoom level like housing apps"

- At lower zoom levels, markers should cluster
- Clusters should show count or aggregate activity level
- When zooming in, clusters should expand to individual markers

## Expected Visual Result

When viewing the map at a neighborhood level:

1. **Multiple markers visible** - Listing-backed or socially active properties render as map nodes
2. **Visual hierarchy clear** - Recent and higher-signal activity stands out
3. **Activity levels distinguishable** - Different activity levels visually differentiated
4. **Markers positioned correctly** - Markers appear at actual property locations
5. **No overlapping chaos** - Clustering prevents marker overload at lower zooms

## Technical Notes

- Markers should use the MapLibre GL marker/layer system
- Active nodes may use custom markers or a dedicated layer
- Pulsing effects can be achieved via CSS animations or MapLibre's paint property interpolation
- Marker size should scale appropriately with zoom level

## Acceptance Criteria

1. At least some active nodes (larger, colored markers) are visible
2. Activity levels are visually distinguishable
3. Markers appear at property locations on the map
4. No console errors during map rendering
5. Map canvas renders without error states

# Backend Vector Tile Clustering & Filtering

## Overview
Implement a high-performance Dynamic Vector Tile (MVT) service that efficiently renders properties based on zoom level and activity.
- **Zoomed Out:** Show ONLY "Active" properties (listings, comments, guesses) to highlight non-empty interacted listings.
- **Zoomed In:** Show ALL properties (including "Ghost Nodes") so users can tap any specific building to start a new discussion.

## Context
- **Ghost Nodes:** Addresses from BAG with no current listing and no social history.
- **Active Nodes:** Addresses with a listing, photos, or user activity (comments/guesses).
- **User Intent:** Users browse wide for *activity*, but zoom in to *explore specific streets*.

## The "Activity Filter" Business Logic
The map must change behavior based on zoom level to manage density and noise:

| Zoom Level | Filter Logic | Goal |
| :--- | :--- | :--- |
| **Z0 - Z14** | `WHERE has_listing = TRUE OR activity_score > 0` | **Signal only.** Show clusters of activity. Hide empty "Ghost" addresses. |
| **Z15+** | `WHERE TRUE` (All BAG addresses) | **Full Detail.** Show every house (Ghost + Active) so users can tap and interact. |

## Technical Requirements

### 1. Database Layer (PostGIS)

**Performance Strategy: Grid vs. Distance**
Do NOT use `ST_ClusterDBSCAN` on dynamic tile requests (too slow). Use **`ST_SnapToGrid`** to group points rapidly into cells.

**Query Logic (The MVT Function):**
Create a Fastify route or Drizzle helper that executes a SQL query structured like this:
1. **Filter:** Select properties strictly within the Tile Bounding Box (`ST_MakeEnvelope`).
2. **Apply Business Logic:** Filter out "Ghost Nodes" if Zoom < 15.
3. **Cluster (Low Zoom 0-14):** Group by `ST_SnapToGrid`.
   - **Aggregate:** Calculate `count(*)`.
   - **Social Signal:** Calculate `MAX(is_active)` or `SUM(activity_score)` to know if a cluster contains "hot" properties.
4. **Points (High Zoom 15+):** Return individual points.
5. **Format:** Return `ST_AsMVT`.

### 2. API Endpoint
`GET /api/tiles/properties/{z}/{x}/{y}.pbf`

**Headers:**
- `Content-Type: application/x-protobuf`
- `Cache-Control: public, max-age=30, stale-while-revalidate=60`
  *(Short cache ensures social activity like new "Hot" statuses propagate quickly)*.

### 3. Frontend Implementation (React Native)

**Component Stack:**
Use `@rnmapbox/maps` components (`VectorSource`, `CircleLayer`, `SymbolLayer`), **NOT** vanilla JS or `react-map-gl`.

**Layering Strategy:**
```tsx
<VectorSource 
  id="properties-source"
  url="/api/tiles/properties/{z}/{x}/{y}.pbf" 
>
  {/* Layer 1: Clusters (Z0-Z14) */}
  {/* Only formed from Active Nodes due to backend filter */}
  <CircleLayer 
    id="clusters" 
    minZoomLevel={0} 
    maxZoomLevel={15} 
    style={{
      circleColor: [
        'case',
        ['get', 'has_active_children'], '#FF5A5F', // Hot cluster
        '#51bbd6' // Standard cluster
      ],
      circleRadius: 18
    }} 
  />

  {/* Layer 2: Active Nodes (Z15+) */}
  {/* Full opacity, larger, pulsing if hot */}
  <CircleLayer 
    id="active-nodes" 
    minZoomLevel={15} 
    filter={['==', 'is_ghost', false]}
    style={{ circleRadius: 6, circleColor: '#FF5A5F' }} 
  />

  {/* Layer 3: Ghost Nodes (Z15+) */}
  {/* Low opacity, small, unobtrusive */}
  <CircleLayer 
    id="ghost-nodes" 
    minZoomLevel={15} 
    filter={['==', 'is_ghost', true]}
    style={{ circleRadius: 3, circleColor: '#999', circleOpacity: 0.4 }} 
  />
</VectorSource>
```

### Acceptance Criteria (SUFFICIENT)
- Zoom Out Test: At Zoom Level 10 (City view), the map shows only clusters of active/listed properties. No gray "noise" from empty addresses.
- Zoom In Test: At Zoom Level 16 (Street view), every house on the street is visible as a node (Ghost or Active).
- Performance: Tile generation takes < 100ms for a dense area (e.g., Amsterdam center).
- Social Context: Clusters containing "Active" properties are visually distinct (e.g., Red vs Blue) from standard listings.
- Tech Stack: Uses ST_AsMVT in PostGIS and <VectorSource> in React Native.
- Zero Console Errors: No styling errors in React Native logs.
- Transition: Pan/Zoom is smooth (60fps).
- Data Integrity: A "Ghost Node" (empty address) can be tapped at high zoom to open the preview card.
- Performance: Tiles generate in <100ms.

### Acceptance Criteria (NEEDS_WORK)
- Using ST_ClusterDBSCAN (performance risk).
- Map is covered in gray dots at Zoom Level 8 (Backend failed to filter Ghost Nodes).
- Clusters all look the same (ignoring the "Social" aspect).
- Sending GeoJSON instead of PBF.
- Clusters include ghost nodes, making "Hot Spots" look diluted.
- Cannot find a specific unlisted house when zoomed in all the way.
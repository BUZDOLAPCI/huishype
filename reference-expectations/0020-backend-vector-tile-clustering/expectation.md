# Backend Vector Tile Clustering

## Overview

Implement server-side clustering and vector tile delivery to efficiently render 240k+ properties on the map without overwhelming the frontend or network.

## Problem Statement

Current architecture sends all properties as raw GeoJSON to the frontend:
- 240k properties = ~30MB+ network transfer
- Frontend must cluster 240k points in browser
- No spatial index = O(n) database queries
- Poor user experience with multi-second load times

## Desired Outcome

The map should:
1. Load instantly (<500ms initial render)
2. Show clustered markers at low zoom levels
3. Smoothly transition to individual markers at high zoom
4. Only transfer data for the visible viewport
5. Handle 240k+ properties without performance degradation

## Technical Requirements

### 1. Database Layer

**Spatial Index (Required)**
```sql
CREATE INDEX properties_geometry_idx ON properties USING GIST (geometry);
```

**Materialized Clusters (Optional, for extra performance)**
- Pre-compute clusters at zoom levels 0-14
- Store cluster centroids and counts
- Refresh on data changes

### 2. Backend Vector Tile Endpoint

Implement a Mapbox Vector Tile (MVT) endpoint:

```
GET /api/tiles/{z}/{x}/{y}.pbf
```

**Requirements:**
- Return Protocol Buffer encoded vector tiles
- Use PostGIS `ST_AsMVT()` for tile generation
- Cluster points at zoom levels 0-13
- Return individual points at zoom 14+
- Include properties: `id`, `cluster` (boolean), `point_count`, `address` (for non-clusters)

**Clustering Strategy:**
- Use `ST_ClusterDBSCAN()` or grid-based clustering
- Cluster radius should decrease with zoom level
- Clusters include: centroid, point_count, sample property IDs

**Response Headers:**
```
Content-Type: application/x-protobuf
Cache-Control: public, max-age=3600
```

### 3. Frontend Integration

Replace current GeoJSON source with vector tile source:

```javascript
map.addSource('properties', {
  type: 'vector',
  tiles: ['/api/tiles/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
});
```

**Layer Configuration:**
- Cluster layer: circles with point_count label
- Individual property layer: property markers
- Smooth transition between layers at zoom threshold

### 4. Caching Strategy

**Server-side:**
- Cache generated tiles (Redis or filesystem)
- Invalidate on property data changes
- Consider pre-generating tiles for common zoom levels

**Client-side:**
- Browser caches tiles via Cache-Control headers
- MapLibre's internal tile cache

## Performance Targets

| Metric | Target |
|--------|--------|
| Initial map load | < 500ms |
| Tile request latency | < 100ms |
| Tile size (avg) | < 50KB |
| Memory usage (frontend) | < 100MB |
| Smooth pan/zoom | 60fps |

## Implementation Options

### Option A: PostGIS + Custom Tile Server (Recommended)

Use PostGIS `ST_AsMVT()` directly in a Fastify route:

```typescript
// services/api/src/routes/tiles.ts
app.get('/tiles/:z/:x/:y.pbf', async (req, reply) => {
  const { z, x, y } = req.params;
  const tile = await generateTile(z, x, y);
  reply.header('Content-Type', 'application/x-protobuf');
  return tile;
});
```

**Pros:** Full control, no extra services
**Cons:** Must implement clustering logic

### Option B: pg_tileserv

Use CrunchyData's pg_tileserv as a sidecar service:
- Automatic MVT generation from PostGIS tables
- Built-in function support for clustering
- Minimal code changes

**Pros:** Quick to set up, battle-tested
**Cons:** Extra service to manage

### Option C: Pre-generated PMTiles

Generate static PMTiles file from property data:
- Use `tippecanoe` to create clustered tiles
- Serve via CDN or static file server
- Regenerate on data changes

**Pros:** Fastest serving, CDN-cacheable
**Cons:** Requires regeneration pipeline

## Acceptance Criteria

1. **Spatial index exists** on properties.geometry column
2. **Vector tile endpoint** returns valid MVT at `/api/tiles/{z}/{x}/{y}.pbf`
3. **Clustering works** at zoom levels 0-13
4. **Individual markers** appear at zoom 14+
5. **All 240k properties** are represented (via clusters or points)
6. **Performance targets met** (see table above)
7. **Existing functionality preserved** - tap on cluster/marker still works
8. **No console errors** during map interaction
9. **Tests pass** - e2e test verifies tile loading and clustering

## Visual Reference

At **zoom 10** (city level):
- ~10-50 large clusters covering neighborhoods
- Clusters show point count (e.g., "5,231")

At **zoom 13** (neighborhood level):
- ~100-500 smaller clusters
- Individual high-value properties may show separately

At **zoom 14+** (street level):
- Individual property markers
- No clustering, direct interaction with properties

## Files to Create/Modify

| File | Action |
|------|--------|
| `services/api/src/routes/tiles.ts` | Create - MVT endpoint |
| `services/api/drizzle/XXXX_spatial_index.sql` | Create - Add GIST index |
| `apps/app/app/(tabs)/index.web.tsx` | Modify - Use vector source |
| `apps/app/src/hooks/useProperties.ts` | Modify - Remove bulk fetch |
| `apps/app/e2e/visual/reference-backend-vector-tile-clustering.spec.ts` | Create - E2E test |

## Dependencies

Consider adding:
- `@mapbox/vector-tile` - For MVT parsing (if needed client-side)
- No additional backend deps if using PostGIS directly

## Resources

- [PostGIS ST_AsMVT](https://postgis.net/docs/ST_AsMVT.html)
- [PostGIS ST_ClusterDBSCAN](https://postgis.net/docs/ST_ClusterDBSCAN.html)
- [MapLibre Vector Tiles](https://maplibre.org/maplibre-gl-js/docs/examples/vector-source/)
- [pg_tileserv](https://github.com/CrunchyData/pg_tileserv)
- [PMTiles](https://github.com/protomaps/PMTiles)

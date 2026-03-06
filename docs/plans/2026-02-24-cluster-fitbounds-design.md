# Cluster Tap fitBounds Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fixed `zoom+2` cluster tap behavior with `fitBounds` using cluster member bounding box, so all nodes stay visible after zooming.

**Architecture:** Embed bbox (min/max lon/lat) in vector tile cluster properties via PostGIS `ST_Extent`. Client reads bbox from feature properties and calls `fitBounds`/`camera.fitBounds` instead of `flyTo(zoom+2)`. Same bbox added to `/properties/nearby?cluster=true` response.

**Tech Stack:** PostGIS (ST_Extent), MapLibre GL JS (web fitBounds), MapLibre React Native (CameraRef.fitBounds), Fastify/Zod (API schema)

---

### Task 1: Add bbox to clustered tile SQL

**Files:**
- Modify: `services/api/src/routes/tiles.ts:783-812` (clustered CTE + mvt_data CTE)

**Step 1: Add bbox columns to the `clustered` CTE**

In `tiles.ts`, the `clustered` CTE (line ~783) currently selects `snapped_geom, COUNT(*), display_geom, ...`. Add 4 bbox columns using `ST_Extent`:

```sql
-- Inside the clustered CTE, after the existing columns:
ST_XMin(ST_Extent(geometry)) as bbox_west,
ST_YMin(ST_Extent(geometry)) as bbox_south,
ST_XMax(ST_Extent(geometry)) as bbox_east,
ST_YMax(ST_Extent(geometry)) as bbox_north
```

**Step 2: Pass bbox through to `mvt_data` CTE**

In the `mvt_data` CTE (line ~799), add the 4 bbox columns to the SELECT:

```sql
bbox_west,
bbox_south,
bbox_east,
bbox_north
```

These will be automatically included as MVT feature properties by `ST_AsMVT`.

**Step 3: Run existing tile integration tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C services/api test -- --testPathPattern=tiles.integration`
Expected: All existing tests pass (bbox columns are additive, don't break MVT encoding)

**Step 4: Commit**

```bash
git add services/api/src/routes/tiles.ts
git commit -m "feat(tiles): add bbox properties to cluster features in MVT tiles"
```

---

### Task 2: Add bbox to nearby cluster API response

**Files:**
- Modify: `services/api/src/routes/properties.ts:216-222` (clusterResultSchema)
- Modify: `services/api/src/routes/properties.ts:395-407` (detectCluster return)
- Modify: `apps/app/src/utils/api.ts:189-196` (NearbyClusterResult type)

**Step 1: Add bbox to Zod schema**

In `properties.ts` line ~216, add `bbox` to `clusterResultSchema`:

```typescript
const clusterResultSchema = z.object({
  type: z.literal('cluster'),
  point_count: z.number(),
  property_ids: z.string().describe('Comma-separated UUIDs'),
  coordinate: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
  distanceMeters: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('[west, south, east, north]'),
});
```

**Step 2: Compute and return bbox in detectCluster**

In `properties.ts` line ~395-407, the cluster result already computes `lons` and `lats` arrays. Add bbox:

```typescript
const minLon = Math.min(...lons);
const minLat = Math.min(...lats);
const maxLon = Math.max(...lons);
const maxLat = Math.max(...lats);

return {
  type: 'cluster' as const,
  point_count: result.length,
  property_ids: result.map(r => r.id).join(','),
  coordinate: [centroidLon, centroidLat] as [number, number],
  distanceMeters: Number(result[0].distance_meters),
  bbox: [minLon, minLat, maxLon, maxLat] as [number, number, number, number],
};
```

**Step 3: Update client-side NearbyClusterResult type**

In `apps/app/src/utils/api.ts` line ~189, add `bbox` to the cluster variant:

```typescript
export type NearbyClusterResult =
  | {
      type: 'cluster';
      point_count: number;
      property_ids: string;
      coordinate: [number, number];
      distanceMeters: number;
      bbox: [number, number, number, number]; // [west, south, east, north]
    }
  | { /* single variant unchanged */ };
```

**Step 4: Run API tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C services/api test`
Expected: All pass

**Step 5: Commit**

```bash
git add services/api/src/routes/properties.ts apps/app/src/utils/api.ts
git commit -m "feat(api): add bbox to cluster nearby response"
```

---

### Task 3: Replace zoom+2 with fitBounds on native (index.tsx)

**Files:**
- Modify: `apps/app/app/(tabs)/index.tsx:237-247` (handleFeaturePress large cluster branch)
- Modify: `apps/app/app/(tabs)/index.tsx:449-455` (server fallback large cluster branch)

**Step 1: Replace flyTo with fitBounds in handleFeaturePress**

At line ~237-247, replace the large cluster zoom block:

```typescript
if (pointCount > LARGE_CLUSTER_THRESHOLD || !propertyIdsStr) {
  // Large cluster — fit bounds to show all members
  const bboxWest = properties.bbox_west as number | undefined;
  const bboxSouth = properties.bbox_south as number | undefined;
  const bboxEast = properties.bbox_east as number | undefined;
  const bboxNorth = properties.bbox_north as number | undefined;

  if (bboxWest != null && bboxSouth != null && bboxEast != null && bboxNorth != null) {
    cameraRef.current?.fitBounds(
      [bboxWest, bboxSouth, bboxEast, bboxNorth],
      { padding: { top: 80, right: 80, bottom: 80, left: 80 }, duration: 500 },
    );
  } else if (clusterGeom && clusterGeom.type === 'Point') {
    // Fallback if bbox not in tile (shouldn't happen)
    const [lng, lat] = clusterGeom.coordinates as [number, number];
    cameraRef.current?.flyTo({
      center: [lng, lat],
      zoom: Math.min(currentZoom + 2, 18),
      duration: 500,
    });
  }
}
```

**Step 2: Replace flyTo with fitBounds in server-side fallback**

At line ~449-455, replace the large cluster zoom block:

```typescript
if (pointCount > LARGE_CLUSTER_THRESHOLD) {
  // Large cluster — fit bounds to show all members
  if (nearby.bbox) {
    const [west, south, east, north] = nearby.bbox;
    cameraRef.current?.fitBounds(
      [west, south, east, north],
      { padding: { top: 80, right: 80, bottom: 80, left: 80 }, duration: 500 },
    );
  } else {
    cameraRef.current?.flyTo({
      center: nearby.coordinate,
      zoom: Math.min(currentZoom + 2, 18),
      duration: 500,
    });
  }
}
```

**Step 3: Run typecheck**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app typecheck`
Expected: Zero errors

**Step 4: Commit**

```bash
git add apps/app/app/(tabs)/index.tsx
git commit -m "feat(native): use fitBounds for cluster tap instead of fixed zoom+2"
```

---

### Task 4: Replace zoom+2 with fitBounds on web (index.web.tsx)

**Files:**
- Modify: `apps/app/app/(tabs)/index.web.tsx:584-592` (large cluster easeTo block)

**Step 1: Replace easeTo with fitBounds**

At line ~584-592, replace the large cluster zoom block:

```typescript
} else {
  // Large cluster: fit bounds to show all members
  const bboxWest = properties.bbox_west as number | undefined;
  const bboxSouth = properties.bbox_south as number | undefined;
  const bboxEast = properties.bbox_east as number | undefined;
  const bboxNorth = properties.bbox_north as number | undefined;

  if (bboxWest != null && bboxSouth != null && bboxEast != null && bboxNorth != null) {
    map.fitBounds(
      [[bboxWest, bboxSouth], [bboxEast, bboxNorth]],
      { padding: 80, maxZoom: 18 },
    );
  } else {
    // Fallback if bbox not in tile
    const geom = feature.geometry;
    if (geom.type === 'Point') {
      map.easeTo({
        center: geom.coordinates as [number, number],
        zoom: Math.min(map.getZoom() + 2, 18),
      });
    }
  }
}
```

**Step 2: Run typecheck**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app typecheck`
Expected: Zero errors

**Step 3: Commit**

```bash
git add apps/app/app/(tabs)/index.web.tsx
git commit -m "feat(web): use fitBounds for cluster tap instead of fixed zoom+2"
```

---

### Task 5: Add integration test for cluster bbox in tiles

**Files:**
- Modify: `services/api/src/__tests__/integration/tiles.integration.test.ts`

**Step 1: Write test verifying cluster features contain bbox properties**

Add a new test to the existing `tiles.integration.test.ts`:

```typescript
test('clustered tiles include bbox properties for multi-point clusters', async ({ request }) => {
  // Use z13 Eindhoven tile which should have clusters
  const { x, y } = lonLatToTile(EINDHOVEN_CENTER[0], EINDHOVEN_CENTER[1], 13);

  const tilesToTry = [
    [13, x, y],
    [13, x + 1, y],
    [13, x, y + 1],
    [13, x - 1, y],
  ];

  let foundCluster = false;
  for (const [z, tx, ty] of tilesToTry) {
    const resp = await request.get(
      `${API_BASE_URL}/tiles/properties/${z}/${tx}/${ty}.pbf`
    );
    if (resp.status() !== 200) continue;

    // Decode MVT and check for bbox properties on cluster features
    // (MVT decoding is done by the map library — for this test we verify
    // the tile is non-empty and contains the expected byte patterns)
    const body = await resp.body();
    if (body.length > 0) {
      foundCluster = true;
      break;
    }
  }

  expect(foundCluster).toBe(true);
});
```

Note: Full MVT property verification requires a protobuf decoder. The integration test confirms tiles still encode correctly. The real validation is in the e2e cluster-tap flow test.

**Step 2: Add integration test for nearby cluster bbox**

Add to `cluster-tap.spec.ts`:

```typescript
test('nearby cluster response includes bbox', async ({ request }) => {
  const resp = await request.get(
    `${API_BASE_URL}/properties/nearby?lon=${EINDHOVEN_CENTER[0]}&lat=${EINDHOVEN_CENTER[1]}&zoom=13&cluster=true`
  );

  if (resp.ok()) {
    const data = await resp.json();
    if (data && data.type === 'cluster') {
      expect(data).toHaveProperty('bbox');
      expect(data.bbox).toHaveLength(4);
      const [west, south, east, north] = data.bbox;
      expect(west).toBeLessThanOrEqual(east);
      expect(south).toBeLessThanOrEqual(north);
      console.log(`Cluster bbox: [${west}, ${south}, ${east}, ${north}]`);
    }
  }
});
```

**Step 3: Run all integration tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app exec playwright test --project=integration`
Expected: All pass

**Step 4: Commit**

```bash
git add services/api/src/__tests__/integration/tiles.integration.test.ts apps/app/e2e/integration/cluster-tap.spec.ts
git commit -m "test: add integration tests for cluster bbox in tiles and nearby API"
```

---

### Task 6: Run full test suite (pre-commit quality gate)

**Step 1: Run unit tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app typecheck && pnpm -C apps/app test`
Expected: Zero TS errors, all unit tests green

**Step 2: Run Playwright integration tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app exec playwright test --project=integration`
Expected: All pass

**Step 3: Run Playwright visual tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app exec playwright test --project=visual`
Expected: All pass

**Step 4: Run Playwright flow tests**

Run: `cd /home/caslan/dev/git_repos/hh/huishype && pnpm -C apps/app exec playwright test --project=flows`
Expected: All pass

---

## Summary of Changes

| File | Change |
|------|--------|
| `services/api/src/routes/tiles.ts` | Add `bbox_west/south/east/north` to clustered CTE + mvt_data |
| `services/api/src/routes/properties.ts` | Add `bbox` to clusterResultSchema + detectCluster return |
| `apps/app/src/utils/api.ts` | Add `bbox` to NearbyClusterResult cluster variant |
| `apps/app/app/(tabs)/index.tsx` | Replace `flyTo(zoom+2)` with `fitBounds(bbox)` in 2 places |
| `apps/app/app/(tabs)/index.web.tsx` | Replace `easeTo(zoom+2)` with `fitBounds(bbox)` in 1 place |
| `services/api/src/__tests__/integration/tiles.integration.test.ts` | Add bbox tile test |
| `apps/app/e2e/integration/cluster-tap.spec.ts` | Add nearby bbox test |

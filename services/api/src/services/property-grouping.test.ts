import { describe, expect, it } from '@jest/globals';
import { PROPERTY_MAP_FOOTPRINTS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  GHOST_NODE_REVEAL_ZOOM,
  PROPERTY_TILE_EXTENT,
  getActiveClusterRadiusPx,
  getActiveSingleRadiusPx,
  getGroupingBufferUnits,
  getGhostClusterRadiusPx,
  getGhostSingleRadiusPx,
  groupCandidatesForTile,
  lngLatToWorldUnits,
  shouldFetchGhostCandidates,
  type GroupingCandidate,
} from './property-grouping.js';

function worldUnitsToLngLat(worldX: number, worldY: number, zoom: number): [number, number] {
  const scale = Math.pow(2, zoom) * PROPERTY_TILE_EXTENT;
  const lon = (worldX / scale) * 360 - 180;
  const mercN = Math.PI * (1 - (2 * worldY) / scale);
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(mercN));
  return [lon, lat];
}

function tileForCoordinate(lon: number, lat: number, zoom: number) {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  return {
    z: zoom,
    x: Math.floor(worldX / PROPERTY_TILE_EXTENT),
    y: Math.floor(worldY / PROPERTY_TILE_EXTENT),
  };
}

const TILE_UNITS_PER_PX = PROPERTY_TILE_EXTENT / 512;

function makeCandidate(
  id: string,
  lon: number,
  lat: number,
  zoom: number,
  overrides: Partial<GroupingCandidate> = {},
): GroupingCandidate {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  return {
    id,
    hasListing: true,
    activityScore: 10,
    likeCount: 0,
    commentCount: 0,
    guessCount: 0,
    lon,
    lat,
    worldX,
    worldY,
    ...overrides,
  };
}

function makeCandidateAtWorld(
  id: string,
  worldX: number,
  worldY: number,
  zoom: number,
  overrides: Partial<GroupingCandidate> = {},
): GroupingCandidate {
  const [lon, lat] = worldUnitsToLngLat(worldX, worldY, zoom);
  return makeCandidate(id, lon, lat, zoom, overrides);
}

describe('property-grouping', () => {
  it('skips ghost candidate fetches below the ghost reveal zoom and enables them at reveal zoom', () => {
    expect(shouldFetchGhostCandidates(GHOST_NODE_REVEAL_ZOOM - 1)).toBe(false);
    expect(shouldFetchGhostCandidates(GHOST_NODE_REVEAL_ZOOM)).toBe(true);
  });

  it('keeps active grouping available at high zoom when points are still visually dense', () => {
    const zoom = 18;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const denseA = makeCandidate('00000000-0000-0000-0000-000000000001', baseLon, baseLat, zoom, {
      activityScore: 80,
      likeCount: 5,
    });
    const denseB = makeCandidate(
      '00000000-0000-0000-0000-000000000002',
      baseLon + 0.00002,
      baseLat + 0.00001,
      zoom,
      { activityScore: 20 },
    );

    const groups = groupCandidatesForTile(tile, [denseA, denseB]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(2);
    expect(groups[0].propertyIds).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);
  });

  it('de-clusters sparse active points at high zoom when they are no longer visually dense', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const worldY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const worldXLeft = tile.x * PROPERTY_TILE_EXTENT + 800;
    const worldXRight = worldXLeft + 400;
    const [leftLon, leftLat] = worldUnitsToLngLat(worldXLeft, worldY, zoom);
    const [rightLon, rightLat] = worldUnitsToLngLat(worldXRight, worldY, zoom);

    const left = makeCandidate(
      '00000000-0000-0000-0000-000000000031',
      leftLon,
      leftLat,
      zoom,
      { activityScore: 90, likeCount: 2 },
    );
    const right = makeCandidate(
      '00000000-0000-0000-0000-000000000032',
      rightLon,
      rightLat,
      zoom,
      { activityScore: 65, likeCount: 1 },
    );

    const groups = groupCandidatesForTile(tile, [left, right]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.groupKind)).toEqual(['single', 'single']);
    expect(groups.map((group) => group.nodeClass)).toEqual(['active', 'active']);
    expect(groups.map((group) => group.primaryPropertyId).sort()).toEqual(
      [left.id, right.id].sort(),
    );
  });

  it('keeps the grouping buffer large enough for a six-member active cluster crossing the tile edge', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const rightEdgeX = (tile.x + 1) * PROPERTY_TILE_EXTENT;
    const centerY = tile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const activePairThresholdPx =
      getActiveClusterRadiusPx(2) +
      PROPERTY_MAP_FOOTPRINTS.active.groupingGapPx +
      getActiveClusterRadiusPx(2);
    const requiredPx = activePairThresholdPx * 2;

    const leftA = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000031',
      rightEdgeX - 1,
      centerY,
      zoom,
      { activityScore: 10, likeCount: 4 },
    );
    const leftB = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000032',
      rightEdgeX - 1,
      centerY,
      zoom,
      { activityScore: 9, likeCount: 3 },
    );
    const leftC = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000033',
      rightEdgeX - 1,
      centerY,
      zoom,
      { activityScore: 8, likeCount: 2 },
    );
    const leftD = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000034',
      rightEdgeX - 1,
      centerY,
      zoom,
      { activityScore: 7, likeCount: 1 },
    );
    const seed = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000035',
      rightEdgeX + 33,
      centerY,
      zoom,
      { activityScore: 100 },
    );
    const extra = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000036',
      rightEdgeX + 66,
      centerY,
      zoom,
      { activityScore: 1 },
    );

    const candidates = [leftA, leftB, leftC, leftD, seed, extra];
    const groups = groupCandidatesForTile(tile, candidates);

    expect(getGroupingBufferUnits() / TILE_UNITS_PER_PX).toBeGreaterThanOrEqual(requiredPx);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(6);
    expect(groups[0].ownerTile).toEqual(tile);
    expect(groups[0].propertyIds).toEqual([seed.id, leftA.id, leftB.id, leftC.id, leftD.id, extra.id]);
  });

  it('keeps the grouping buffer large enough for ghost suppression by large active clusters', () => {
    const requiredPx =
      getActiveClusterRadiusPx(100) +
      PROPERTY_MAP_FOOTPRINTS.ghost.suppressionPaddingPx +
      Math.max(getGhostSingleRadiusPx(), getGhostClusterRadiusPx(2));

    expect(getGroupingBufferUnits() / TILE_UNITS_PER_PX).toBeGreaterThanOrEqual(requiredPx);
  });

  it('does not merge a bridge candidate through transitive hops across the tile buffer', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1024;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1024;

    const groupingRadiusUnits =
      Math.max(getActiveSingleRadiusPx(10), getActiveClusterRadiusPx(2)) * TILE_UNITS_PER_PX;
    const pairThresholdUnits = groupingRadiusUnits + groupingRadiusUnits + 2 * TILE_UNITS_PER_PX;
    const stepUnits = Math.floor(pairThresholdUnits - 8);

    const [alphaLon, alphaLat] = worldUnitsToLngLat(originX, originY, zoom);
    const [betaLon, betaLat] = worldUnitsToLngLat(originX + stepUnits, originY, zoom);
    const [gammaLon, gammaLat] = worldUnitsToLngLat(originX + stepUnits * 2, originY, zoom);

    const alpha = makeCandidate(
      '00000000-0000-0000-0000-000000000051',
      alphaLon,
      alphaLat,
      zoom,
      { activityScore: 10, hasListing: true, likeCount: 3 },
    );
    const beta = makeCandidate(
      '00000000-0000-0000-0000-000000000052',
      betaLon,
      betaLat,
      zoom,
      { activityScore: 10, hasListing: true, likeCount: 2 },
    );
    const gamma = makeCandidate(
      '00000000-0000-0000-0000-000000000053',
      gammaLon,
      gammaLat,
      zoom,
      { activityScore: 10, hasListing: true, likeCount: 1 },
    );

    const groups = groupCandidatesForTile(tile, [alpha, beta, gamma]);
    const cluster = groups.find((group) => group.groupKind === 'cluster');
    const loneGamma = groups.find((group) => group.primaryPropertyId === gamma.id);

    expect(groups).toHaveLength(2);
    expect(cluster?.propertyIds).toEqual([alpha.id, beta.id]);
    expect(loneGamma?.groupKind).toBe('single');
    expect(loneGamma?.primaryPropertyId).toBe(gamma.id);
  });

  it('suppresses ghosts that fall inside active occupancy once ghosts are revealed', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const active = makeCandidate('00000000-0000-0000-0000-000000000011', baseLon, baseLat, zoom, {
      activityScore: 95,
    });
    const suppressedGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000012',
      baseLon + 0.00001,
      baseLat + 0.00001,
      zoom,
      {
        hasListing: false,
        activityScore: 0,
      },
    );

    const groups = groupCandidatesForTile(tile, [active, suppressedGhost]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].primaryPropertyId).toBe(active.id);
  });

  it('builds ghost clusters from ghost members only once ghosts are revealed', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 1500;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 1700;
    const [ghostLonA, ghostLatA] = worldUnitsToLngLat(originX, originY, zoom);
    const [ghostLonB, ghostLatB] = worldUnitsToLngLat(originX + 40, originY + 30, zoom);
    const [activeLon, activeLat] = worldUnitsToLngLat(originX + 1200, originY, zoom);

    const ghostA = makeCandidate(
      '00000000-0000-0000-0000-000000000041',
      ghostLonA,
      ghostLatA,
      zoom,
      { hasListing: false, activityScore: 0 },
    );
    const ghostB = makeCandidate(
      '00000000-0000-0000-0000-000000000042',
      ghostLonB,
      ghostLatB,
      zoom,
      { hasListing: false, activityScore: 0 },
    );
    const active = makeCandidate(
      '00000000-0000-0000-0000-000000000043',
      activeLon,
      activeLat,
      zoom,
      { hasListing: true, activityScore: 18, likeCount: 4 },
    );

    const groups = groupCandidatesForTile(tile, [ghostA, ghostB, active]);
    const ghostGroup = groups.find((group) => group.nodeClass === 'ghost');
    const activeGroup = groups.find((group) => group.nodeClass === 'active');

    expect(groups).toHaveLength(2);
    expect(activeGroup?.groupKind).toBe('single');
    expect(ghostGroup).toBeDefined();
    expect(ghostGroup?.groupKind).toBe('cluster');
    expect(ghostGroup?.pointCount).toBe(2);
    expect(ghostGroup?.propertyIds).toEqual([ghostA.id, ghostB.id]);
    expect(ghostGroup?.previewPropertyIds).toEqual([ghostA.id, ghostB.id]);
    expect(ghostGroup?.hasListing).toBe(false);
    expect(ghostGroup?.activityScore).toBe(0);
    expect(ghostGroup?.activityScoreTotal).toBe(0);
  });

  it('orders preview members by grouping priority and caps them to the preview member limit', () => {
    const zoom = 18;
    const tile = { z: zoom, x: 100000, y: 70000 };
    const originX = tile.x * PROPERTY_TILE_EXTENT + 2048;
    const originY = tile.y * PROPERTY_TILE_EXTENT + 2048;

    const specs = Array.from(
      { length: PROPERTY_PREVIEW_MEMBER_LIMIT + 5 },
      (_, index) => ({
        id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, '0')}`,
        activityScore:
          index === 0 ? 80 :
          index === 1 ? 80 :
          index === 2 ? 80 :
          index === 3 ? 65 :
          64 - index,
        hasListing: index !== 2,
        likeCount:
          index === 0 ? 2 :
          index === 1 ? 5 :
          index === 2 ? 99 :
          PROPERTY_PREVIEW_MEMBER_LIMIT + 5 - index,
      }),
    );

    const candidates = specs.map((spec, index) => {
      const [lon, lat] = worldUnitsToLngLat(
        originX + (index % 6) * 12,
        originY + Math.floor(index / 6) * 12,
        zoom,
      );
      return makeCandidate(spec.id, lon, lat, zoom, {
        activityScore: spec.activityScore,
        hasListing: spec.hasListing,
        likeCount: spec.likeCount,
      });
    });

    const expectedOrder = [...candidates]
      .sort(
        (a, b) =>
          b.activityScore - a.activityScore ||
          Number(b.hasListing) - Number(a.hasListing) ||
          b.likeCount - a.likeCount ||
          a.id.localeCompare(b.id),
      )
      .map((candidate) => candidate.id);

    const [group] = groupCandidatesForTile(tile, candidates);

    expect(group.groupKind).toBe('cluster');
    expect(group.pointCount).toBe(candidates.length);
    expect(group.propertyIds).toEqual(expectedOrder);
    expect(group.previewPropertyIds).toEqual(
      expectedOrder.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
    );
    expect(group.previewPropertyIds).toHaveLength(PROPERTY_PREVIEW_MEMBER_LIMIT);
    expect(group.previewPropertyIds).toEqual(
      group.propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
    );
  });

  it('emits a cross-edge group from only the tile that owns the representative anchor', () => {
    const zoom = 17;
    const ownerTile = { z: zoom, x: 100, y: 100 };
    const neighborTile = { z: zoom, x: 101, y: 100 };
    const worldXLeft = ownerTile.x * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT - 30;
    const worldXRight = neighborTile.x * PROPERTY_TILE_EXTENT + 20;
    const worldY = ownerTile.y * PROPERTY_TILE_EXTENT + PROPERTY_TILE_EXTENT / 2;
    const [ownerLon, ownerLat] = worldUnitsToLngLat(worldXLeft, worldY, zoom);
    const [neighborLon, neighborLat] = worldUnitsToLngLat(worldXRight, worldY, zoom);

    const left = makeCandidate('00000000-0000-0000-0000-000000000021', ownerLon, ownerLat, zoom, {
      activityScore: 70,
      likeCount: 2,
    });
    const right = makeCandidate('00000000-0000-0000-0000-000000000022', neighborLon, neighborLat, zoom, {
      activityScore: 10,
    });

    const ownerGroups = groupCandidatesForTile(ownerTile, [left, right]);
    const neighborGroups = groupCandidatesForTile(neighborTile, [left, right]);

    expect(ownerGroups).toHaveLength(1);
    expect(ownerGroups[0].groupKind).toBe('cluster');
    expect(ownerGroups[0].primaryPropertyId).toBe(left.id);
    expect(neighborGroups).toHaveLength(0);
  });
});

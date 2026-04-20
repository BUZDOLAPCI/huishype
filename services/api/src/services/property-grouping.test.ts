import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PROPERTY_MAP_FOOTPRINTS, PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import {
  GHOST_NODE_REVEAL_ZOOM,
  PROPERTY_TILE_EXTENT,
  getActiveClusterRadiusPx,
  getActiveSingleRadiusPx,
  getGroupingBufferUnits,
  getGhostClusterRadiusPx,
  getGhostSingleRadiusPx,
  buildCanonicalGroupsForTile,
  groupCandidatesForTile,
  lngLatToWorldUnits,
  serializeGroupForTile,
  shouldFetchGhostCandidates,
  type GroupingCandidate,
  resolveNearbyGroupedFeature,
} from './property-grouping.js';
import { normalizeMapFilters } from './map-filters.js';

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
  const hasActiveListing = overrides.hasActiveListing ?? true;
  const socialScore = overrides.socialScore ?? 10;
  const recentSocialScore = overrides.recentSocialScore ?? socialScore;
  const commentCount = overrides.commentCount ?? 0;
  return {
    id,
    hasActiveListing,
    socialScore,
    recentSocialScore,
    commentCount,
    marketState: overrides.marketState ?? (hasActiveListing ? 'for-sale' : 'not-listed'),
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

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
      socialScore: 80,
      commentCount: 5,
    });
    const denseB = makeCandidate(
      '00000000-0000-0000-0000-000000000002',
      baseLon + 0.00002,
      baseLat + 0.00001,
      zoom,
      { socialScore: 20 },
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
      { socialScore: 90, commentCount: 2 },
    );
    const right = makeCandidate(
      '00000000-0000-0000-0000-000000000032',
      rightLon,
      rightLat,
      zoom,
      { socialScore: 65, commentCount: 1 },
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
      { socialScore: 10, commentCount: 4 },
    );
    const leftB = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000032',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 9, commentCount: 3 },
    );
    const leftC = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000033',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 8, commentCount: 2 },
    );
    const leftD = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000034',
      rightEdgeX - 1,
      centerY,
      zoom,
      { socialScore: 7, commentCount: 1 },
    );
    const seed = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000035',
      rightEdgeX + 33,
      centerY,
      zoom,
      { socialScore: 100 },
    );
    const extra = makeCandidateAtWorld(
      '00000000-0000-0000-0000-000000000036',
      rightEdgeX + 66,
      centerY,
      zoom,
      { socialScore: 1 },
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

  it('keeps bridge candidates separate to avoid transitive chain clustering', () => {
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
      { socialScore: 10, hasActiveListing: true, commentCount: 3 },
    );
    const beta = makeCandidate(
      '00000000-0000-0000-0000-000000000052',
      betaLon,
      betaLat,
      zoom,
      { socialScore: 10, hasActiveListing: true, commentCount: 2 },
    );
    const gamma = makeCandidate(
      '00000000-0000-0000-0000-000000000053',
      gammaLon,
      gammaLat,
      zoom,
      { socialScore: 10, hasActiveListing: true, commentCount: 1 },
    );

    const groups = groupCandidatesForTile(tile, [alpha, beta, gamma]);

    expect(groups).toHaveLength(2);
    expect(groups[0].groupKind).toBe('cluster');
    expect(groups[0].pointCount).toBe(2);
    expect(groups[0].propertyIds).toEqual([alpha.id, beta.id]);
    expect(groups[1].groupKind).toBe('single');
    expect(groups[1].pointCount).toBe(1);
    expect(groups[1].propertyIds).toEqual([gamma.id]);
  });

  it('suppresses ghosts that fall inside active occupancy once ghosts are revealed', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const active = makeCandidate('00000000-0000-0000-0000-000000000011', baseLon, baseLat, zoom, {
      socialScore: 95,
    });
    const suppressedGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000012',
      baseLon + 0.00001,
      baseLat + 0.00001,
      zoom,
      {
        hasActiveListing: false,
        socialScore: 0,
      },
    );

    const groups = groupCandidatesForTile(tile, [active, suppressedGhost]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].primaryPropertyId).toBe(active.id);
  });

  it('keeps listing-backed zero-social candidates active below ghost reveal zoom while hiding true ghosts', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const listed = makeCandidate(
      '00000000-0000-0000-0000-000000000013',
      baseLon,
      baseLat,
      zoom,
      {
        hasActiveListing: true,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'for-sale',
      },
    );
    const hiddenGhost = makeCandidate(
      '00000000-0000-0000-0000-000000000014',
      baseLon + 0.001,
      baseLat + 0.001,
      zoom,
      {
        hasActiveListing: false,
        socialScore: 0,
        recentSocialScore: 0,
        marketState: 'not-listed',
      },
    );

    const groups = groupCandidatesForTile(tile, [listed, hiddenGhost]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('single');
    expect(groups[0].primaryPropertyId).toBe(listed.id);
    expect(groups[0].propertyIds).toEqual([listed.id]);
    expect(groups[0].activeListingCount).toBe(1);
    expect(groups[0].socialCount).toBe(0);
    expect(groups[0].socialScoreTotal).toBe(0);
  });

  it('treats a single unique view as social activity without collapsing back to ghost semantics', () => {
    const zoom = GHOST_NODE_REVEAL_ZOOM - 1;
    const baseLon = 5.4697;
    const baseLat = 51.4416;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);
    const viewed = makeCandidate(
      '00000000-0000-0000-0000-000000000015',
      baseLon,
      baseLat,
      zoom,
      {
        hasActiveListing: false,
        socialScore: 0.5,
        recentSocialScore: 0.5,
        marketState: 'not-listed',
      },
    );

    const groups = groupCandidatesForTile(tile, [viewed]);

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeClass).toBe('active');
    expect(groups[0].groupKind).toBe('single');
    expect(groups[0].primaryPropertyId).toBe(viewed.id);
    expect(groups[0].activeListingCount).toBe(0);
    expect(groups[0].socialCount).toBe(1);
    expect(groups[0].recentSocialCount).toBe(1);
    expect(groups[0].socialScoreTotal).toBe(0.5);
    expect(groups[0].recentSocialScoreTotal).toBe(0.5);
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
      { hasActiveListing: false, socialScore: 0 },
    );
    const ghostB = makeCandidate(
      '00000000-0000-0000-0000-000000000042',
      ghostLonB,
      ghostLatB,
      zoom,
      { hasActiveListing: false, socialScore: 0 },
    );
    const active = makeCandidate(
      '00000000-0000-0000-0000-000000000043',
      activeLon,
      activeLat,
      zoom,
      { hasActiveListing: true, socialScore: 18, commentCount: 4 },
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
    expect(ghostGroup?.activeListingCount).toBe(0);
    expect(ghostGroup?.socialCount).toBe(0);
    expect(ghostGroup?.recentSocialCount).toBe(0);
    expect(ghostGroup?.socialScoreTotal).toBe(0);
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
        socialScore:
          index === 0 ? 80 :
          index === 1 ? 80 :
          index === 2 ? 80 :
          index === 3 ? 65 :
          64 - index,
        hasActiveListing: index !== 2,
        commentCount:
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
        socialScore: spec.socialScore,
        hasActiveListing: spec.hasActiveListing,
        commentCount: spec.commentCount,
      });
    });

    const expectedOrder = [...candidates]
      .sort(
        (a, b) =>
          b.socialScore - a.socialScore ||
          Number(b.hasActiveListing) - Number(a.hasActiveListing) ||
          b.commentCount - a.commentCount ||
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
      socialScore: 70,
      commentCount: 2,
    });
    const right = makeCandidate('00000000-0000-0000-0000-000000000022', neighborLon, neighborLat, zoom, {
      socialScore: 10,
    });

    const ownerGroups = groupCandidatesForTile(ownerTile, [left, right]);
    const neighborGroups = groupCandidatesForTile(neighborTile, [left, right]);

    expect(ownerGroups).toHaveLength(1);
    expect(ownerGroups[0].groupKind).toBe('cluster');
    expect(ownerGroups[0].primaryPropertyId).toBe(left.id);
    expect(neighborGroups).toHaveLength(0);
  });

  it('hydrates nearby singles from a shared neighborhood pass', async () => {
    const lon = 5.471235;
    const lat = 51.443432;
    const zoom = 17;
    const propertyId = '00000000-0000-4000-a000-0000000000aa';

    const executeSpy = jest
      .spyOn(db, 'execute')
      .mockResolvedValueOnce(
        [
          {
            id: propertyId,
            has_active_listing: true,
            social_score: 8,
            recent_social_score: 8,
            comment_count: 2,
            market_state: 'for-sale',
            lon,
            lat,
          },
        ] as never,
      )
      .mockResolvedValueOnce(
        [
          {
            id: propertyId,
            country_code: 'NL',
            street: 'Mockstraat',
            house_number: 12,
            house_number_addition: 'A',
            city: 'Eindhoven',
            postal_code: '5611 AA',
            asking_price: 359000,
            thumbnail_url: 'https://cdn.example.com/mock-thumb.jpg',
          },
        ] as never,
      )
      .mockImplementation(() => {
        throw new Error('resolveNearbyGroupedFeature should only execute two shared queries');
      });

    const result = await resolveNearbyGroupedFeature(lon, lat, zoom);

    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result?.groupKind).toBe('single');
    expect(result?.nodeClass).toBe('active');
    expect(result?.primaryPropertyId).toBe(propertyId);
    expect(result?.address).toBe('Mockstraat 12A, 5611 AA Eindhoven');
    expect(result?.city).toBe('Eindhoven');
    expect(result?.askingPrice).toBe(359000);
    expect(result?.thumbnailUrl).toBe('https://cdn.example.com/mock-thumb.jpg');
    expect(result?.distanceMeters).toBe(0);
  });

  it('serializes grouped singles as thin preview seeds for tile transport', () => {
    const feature = serializeGroupForTile({
      nodeClass: 'active',
      groupKind: 'single',
      primaryPropertyId: '00000000-0000-4000-a000-0000000000bb',
      pointCount: 1,
      propertyIds: ['00000000-0000-4000-a000-0000000000bb'],
      previewPropertyIds: ['00000000-0000-4000-a000-0000000000bb'],
      coordinate: [5.47, 51.44],
      bbox: null,
      activeListingCount: 1,
      socialCount: 1,
      recentSocialCount: 1,
      socialScoreTotal: 3,
      socialScoreMax: 3,
      recentSocialScoreTotal: 1,
      commentCount: 2,
      address: 'Mockstraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      askingPrice: 359000,
      thumbnailUrl: 'https://cdn.example.com/mock-thumb.jpg',
      hasActiveListing: true,
      marketState: 'for-sale',
      ownerTile: { z: 17, x: 67478, y: 43551 },
      anchorWorldX: 0,
      anchorWorldY: 0,
    });

    expect(feature).toMatchObject({
      address: 'Mockstraat 12, 5611 AA Eindhoven',
      city: 'Eindhoven',
      askingPrice: 359000,
      thumbnailUrl: 'https://cdn.example.com/mock-thumb.jpg',
      hasActiveListing: true,
      marketState: 'for-sale',
    });
    expect(feature).not.toHaveProperty('streetName');
    expect(feature).not.toHaveProperty('houseNumber');
    expect(feature).not.toHaveProperty('houseNumberAddition');
    expect(feature).not.toHaveProperty('postalCode');
    expect(feature).not.toHaveProperty('countryCode');
    expect(feature).not.toHaveProperty('officialValuation');
    expect(feature).not.toHaveProperty('yearBuilt');
    expect(feature).not.toHaveProperty('floorAreaM2');
  });

  it('applies map filters before grouping clustered active sale candidates', async () => {
    const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
    const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
    // Keep this fixture outside the seeded European dataset so the cluster only
    // contains the rows created by this test.
    const baseLon = -40.25;
    const baseLat = -32.5;
    const zoom = 20;
    const tile = tileForCoordinate(baseLon, baseLat, zoom);

    await db.execute(sql`
      INSERT INTO properties (
        id,
        country_code,
        street,
        house_number,
        city,
        postal_code,
        status,
        geometry
      )
      VALUES
        (
          ${propertyIds[0]},
          'NL',
          'Filter Cluster Street',
          1,
          'Filterstad',
          '9999AA',
          'active',
          ST_SetSRID(ST_MakePoint(${baseLon}, ${baseLat}), 4326)
        ),
        (
          ${propertyIds[1]},
          'NL',
          'Filter Cluster Street',
          2,
          'Filterstad',
          '9999AA',
          'active',
          ST_SetSRID(ST_MakePoint(${baseLon}, ${baseLat}), 4326)
        )
    `);

    await db.execute(sql`
      INSERT INTO listings (
        id,
        property_id,
        source_name,
        source_url,
        status,
        asking_price,
        price_type,
        created_at,
        updated_at
      )
      VALUES
        (
          ${listingIds[0]},
          ${propertyIds[0]},
          'funda',
          ${`https://example.com/filter-cluster-${listingIds[0]}`},
          'active',
          325000,
          'sale',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days'
        ),
        (
          ${listingIds[1]},
          ${propertyIds[1]},
          'funda',
          ${`https://example.com/filter-cluster-${listingIds[1]}`},
          'active',
          825000,
          'sale',
          NOW() - INTERVAL '1 day',
          NOW() - INTERVAL '1 day'
        )
    `);

    try {
      const unfilteredGroups = await buildCanonicalGroupsForTile(tile);
      const filteredGroups = await buildCanonicalGroupsForTile(
        tile,
        normalizeMapFilters({ salePriceFrom: 600000 }),
      );

      const unfilteredCluster = unfilteredGroups.find((group) =>
        propertyIds.every((propertyId) => group.propertyIds.includes(propertyId)),
      );
      expect(unfilteredCluster).toBeDefined();
      expect(unfilteredCluster?.groupKind).toBe('cluster');
      expect(unfilteredCluster?.pointCount).toBe(2);

      const filteredGroup = filteredGroups.find((group) =>
        group.propertyIds.includes(propertyIds[1]),
      );
      expect(filteredGroup).toBeDefined();
      expect(filteredGroup?.groupKind).toBe('single');
      expect(filteredGroup?.pointCount).toBe(1);
      expect(filteredGroup?.propertyIds).toEqual([propertyIds[1]]);
      expect(filteredGroups.some((group) => group.propertyIds.includes(propertyIds[0]))).toBe(false);
    } finally {
      await db.execute(sql`DELETE FROM listings WHERE id IN (${listingIds[0]}, ${listingIds[1]})`);
      await db.execute(sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`);
    }
  }, 30000);
});

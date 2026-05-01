import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { PROPERTY_GHOST_REVEAL_ZOOM } from '@huishype/shared';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { jest } from '@jest/globals';
import { resetPropertyTileCacheForTests } from '../../routes/tiles.js';
import {
  buildCanonicalGroupsForTile,
  resetCanonicalGroupCacheForTests,
  type CanonicalPropertyGroup,
} from '../../services/property-grouping.js';
import {
  DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID,
  ensureDefaultPropertyTileSnapshotCoverage,
  upsertPropertyTileSnapshotRow,
} from '../../services/property-tile-snapshots.js';
import {
  buildPropertyTileEtag,
  PROPERTY_TILE_CACHE_TTL_SECONDS,
  publicPropertyTileCache,
} from '../../services/property-tile-cache.js';
import { propertyTileRuntime } from '../../services/property-tile-runtime.js';
import { createDefaultMapFilters, type MapFilters } from '../../services/map-filters.js';
import {
  createIntegrationFollow,
  createIntegrationListing,
  createIntegrationProperty,
  createIntegrationUser,
  tileCoordinatesForPoint,
} from './helpers/fixtures.js';

type StyleSource = {
  type: string;
  tiles?: string[];
  [key: string]: unknown;
};

type StyleLayer = {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

type StyleJson = {
  version: number;
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
  glyphs?: string;
  sprite?: string;
  [key: string]: unknown;
};

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function requireComparableNumber(value: unknown, message: string): number {
  if (typeof value === 'number') {
    return value;
  }
  const numericValues = collectExpressionNumbers(value);
  if (numericValues.length > 0) {
    return Math.max(...numericValues);
  }
  throw new Error(message);
}

function collectExpressionStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectExpressionStrings(entry));
  }

  return [];
}

function collectExpressionNumbers(value: unknown): number[] {
  if (typeof value === 'number') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectExpressionNumbers(entry));
  }

  return [];
}

function createMarketStateFilters(marketState: MapFilters['marketState']): MapFilters {
  return {
    ...createDefaultMapFilters(),
    marketState,
  };
}

function findGroupForProperty(
  groups: CanonicalPropertyGroup[],
  propertyId: string
): CanonicalPropertyGroup | undefined {
  return groups.find((group) => group.propertyIds.includes(propertyId));
}

function expectCompletedActiveSingleGroup(
  groups: CanonicalPropertyGroup[],
  propertyId: string,
  marketState: 'sold' | 'rented'
) {
  const group = requireValue(
    findGroupForProperty(groups, propertyId),
    `Expected completed listing group for property ${propertyId}`
  );

  expect(group.nodeClass).toBe('active');
  expect(group.groupKind).toBe('single');
  expect(group.primaryPropertyId).toBe(propertyId);
  expect(group.propertyIds).toEqual([propertyId]);
  expect(group.activeListingCount).toBe(0);
  expect(group.completedListingCount).toBe(1);
  expect(group.hasActiveListing).toBe(false);
  expect(group.marketState).toBe(marketState);
}

/**
 * Integration tests for tile routes.
 *
 * Exercises the real PostGIS-backed tile endpoints.
 *
 * Style, sprite, and font assertions are dataset-agnostic. Specific filter,
 * clustering, and tile-content scenarios seed dedicated rows inside the suite
 * instead of relying on ambient shared property data.
 */
describe('Tile routes', () => {
  jest.setTimeout(30000);
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetPropertyTileCacheForTests();
    resetCanonicalGroupCacheForTests();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /tiles/style.json', () => {
    it('should return a valid MapLibre style JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      expect(response.statusCode).toBe(200);
      const style = JSON.parse(response.body) as StyleJson;

      expect(style).toHaveProperty('version', 8);
      expect(style).toHaveProperty('sources');
      expect(style).toHaveProperty('layers');
      expect(style).toHaveProperty('glyphs');
      expect(style).toHaveProperty('sprite');
      expect(Array.isArray(style.layers)).toBe(true);
    });

    it('should include properties-source in sources', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const propertiesSource = requireValue(
        style.sources['properties-source'],
        'properties-source missing from style.json'
      );
      const propertiesTiles = requireValue(
        propertiesSource.tiles,
        'properties-source tiles missing from style.json'
      );
      expect(style.sources).toHaveProperty('properties-source');
      expect(propertiesSource.type).toBe('vector');
      expect(propertiesTiles[0]).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
    });

    it('should keep style.json base-style oriented even when filter params are present', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json?marketState=for-rent&rentPriceTo=2000',
      });

      expect(response.statusCode).toBe(200);
      const style = JSON.parse(response.body) as StyleJson;
      const propertiesSource = requireValue(
        style.sources['properties-source'],
        'properties-source missing from style.json'
      );
      const propertiesTiles = requireValue(
        propertiesSource.tiles,
        'properties-source tiles missing from style.json'
      );
      const treeSource = requireValue(
        style.sources['tree-source'],
        'tree-source missing from style.json'
      );
      const treeTiles = requireValue(treeSource.tiles, 'tree-source tiles missing from style.json');
      const buildingsSource = requireValue(
        style.sources['buildings-source'],
        'buildings-source missing from style.json'
      );
      const buildingsTiles = requireValue(
        buildingsSource.tiles,
        'buildings-source tiles missing from style.json'
      );
      expect(propertiesTiles[0]).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
      expect(propertiesTiles[0]).not.toContain('rentPriceTo=');
      expect(propertiesTiles[0]).not.toContain('marketState=');
      expect(treeTiles[0]).not.toContain('marketState=');
      expect(buildingsTiles[0]).not.toContain('marketState=');
    });

    it('should include property cluster layers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const layerIds = style.layers.map((layer) => layer.id);

      expect(layerIds).toContain('property-clusters');
      expect(layerIds).toContain('property-cluster-fill');
      expect(layerIds).toContain('property-cluster-pulse');
      expect(layerIds).toContain('cluster-count');
      expect(layerIds).toContain('active-nodes');
      expect(layerIds).toContain('active-node-fill');
      expect(layerIds).toContain('active-node-pulse');
      expect(layerIds).toContain('ghost-clusters');
      expect(layerIds).toContain('ghost-cluster-count');
      expect(layerIds).toContain('ghost-nodes');
    });

    it('uses additive ring, fill, and pulse semantics driven by composition fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      expect(response.statusCode).toBe(200);
      const style = JSON.parse(response.body) as StyleJson;
      const activeClusters = style.layers.find((layer) => layer.id === 'property-clusters');
      const activeClusterFill = style.layers.find((layer) => layer.id === 'property-cluster-fill');
      const activeClusterPulse = style.layers.find(
        (layer) => layer.id === 'property-cluster-pulse'
      );
      const activeNodes = style.layers.find((layer) => layer.id === 'active-nodes');
      const activeNodeFill = style.layers.find((layer) => layer.id === 'active-node-fill');
      const activeNodePulse = style.layers.find((layer) => layer.id === 'active-node-pulse');

      if (
        !activeClusters ||
        !activeClusterFill ||
        !activeClusterPulse ||
        !activeNodes ||
        !activeNodeFill ||
        !activeNodePulse
      ) {
        throw new Error('Expected additive active property layers missing from style.json');
      }

      const activeClusterPaint = requireValue(
        activeClusters.paint,
        'property-clusters paint missing from style.json'
      );
      const activeClusterFillPaint = requireValue(
        activeClusterFill.paint,
        'property-cluster-fill paint missing from style.json'
      );
      const activeClusterPulsePaint = requireValue(
        activeClusterPulse.paint,
        'property-cluster-pulse paint missing from style.json'
      );
      const activeNodePaint = requireValue(
        activeNodes.paint,
        'active-nodes paint missing from style.json'
      );
      const activeNodeFillPaint = requireValue(
        activeNodeFill.paint,
        'active-node-fill paint missing from style.json'
      );
      const activeNodePulsePaint = requireValue(
        activeNodePulse.paint,
        'active-node-pulse paint missing from style.json'
      );

      const clusterRingFields = collectExpressionStrings(activeClusterPaint['circle-stroke-color']);
      const clusterFillFields = collectExpressionStrings(activeClusterFillPaint['circle-color']);
      const clusterPulseFields = collectExpressionStrings(
        activeClusterPulsePaint['circle-opacity']
      );
      const clusterPulseColorFields = collectExpressionStrings(
        activeClusterPulsePaint['circle-color']
      );
      const clusterRadiusFields = collectExpressionStrings(activeClusterPaint['circle-radius']);
      const clusterFillRadiusFields = collectExpressionStrings(
        activeClusterFillPaint['circle-radius']
      );
      const nodeRingFields = collectExpressionStrings(activeNodePaint['circle-stroke-color']);
      const nodeRadiusFields = collectExpressionStrings(activeNodePaint['circle-radius']);
      const nodeFillFields = collectExpressionStrings(activeNodeFillPaint['circle-color']);
      const nodeFillRadiusFields = collectExpressionStrings(activeNodeFillPaint['circle-radius']);
      const nodePulseFields = collectExpressionStrings(activeNodePulsePaint['circle-opacity']);
      const nodePulseColorFields = collectExpressionStrings(activeNodePulsePaint['circle-color']);

      expect(clusterRadiusFields).toContain('point_count');
      expect(clusterRadiusFields).toContain('activeListingCount');
      expect(clusterFillRadiusFields).not.toContain('activeListingCount');
      expect(clusterRingFields).toEqual(
        expect.arrayContaining(['activeListingCount', 'completedListingCount', 'point_count'])
      );
      expect(clusterFillFields).toEqual(
        expect.arrayContaining(['socialCount', 'activeListingCount', 'completedListingCount'])
      );
      expect(clusterPulseFields).toEqual(
        expect.arrayContaining(['recentSocialCount', 'recentSocialScoreTotal'])
      );
      expect(clusterPulseColorFields).toEqual(expect.arrayContaining(['recentSocialCount']));
      expect(nodeRingFields).toEqual(
        expect.arrayContaining(['activeListingCount', 'completedListingCount'])
      );
      expect(nodeRadiusFields).toContain('activeListingCount');
      expect(nodeFillRadiusFields).not.toContain('activeListingCount');
      expect(nodeFillFields).toEqual(
        expect.arrayContaining(['socialCount', 'activeListingCount', 'completedListingCount'])
      );
      expect(nodePulseFields).toEqual(
        expect.arrayContaining(['recentSocialCount', 'recentSocialScoreTotal'])
      );
      expect(nodePulseColorFields).toEqual(expect.arrayContaining(['recentSocialCount']));

      expect(clusterFillFields).not.toContain('point_count');
      expect(clusterFillFields).not.toContain('socialScoreTotal');
      expect(clusterFillFields).not.toContain('socialScoreMax');
      expect(clusterPulseFields).not.toContain('point_count');
      expect(nodeFillFields).not.toContain('point_count');
      expect(nodeFillFields).not.toContain('socialScoreTotal');
      expect(nodeFillFields).not.toContain('socialScoreMax');
      expect(nodePulseFields).not.toContain('point_count');

      expect(collectExpressionNumbers(activeClusterPulsePaint['circle-opacity'])).toContain(0.5);
      expect(collectExpressionNumbers(activeNodePulsePaint['circle-opacity'])).toContain(0.5);
    });

    it('should include 3D buildings layer with OSM source', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const buildings3D = style.layers.find((layer) => layer.id === '3d-buildings');
      if (!buildings3D) {
        throw new Error('3d-buildings layer missing from style.json');
      }
      expect(buildings3D.source).toBe('buildings-source');
      expect(buildings3D['source-layer']).toBe('buildings');
      expect(buildings3D.type).toBe('fill-extrusion');
    });

    it('should include buildings-source in sources', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const buildingsSource = requireValue(
        style.sources['buildings-source'],
        'buildings-source missing from style.json'
      );
      const buildingsTiles = requireValue(
        buildingsSource.tiles,
        'buildings-source tiles missing from style.json'
      );
      expect(buildingsSource.type).toBe('vector');
      expect(buildingsTiles[0]).toContain('/tiles/buildings/');
    });

    it('cluster-count layer should have correct text configuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const clusterCount = style.layers.find((layer) => layer.id === 'cluster-count');
      if (!clusterCount) {
        throw new Error('cluster-count layer missing from style.json');
      }
      const clusterCountLayout = requireValue(
        clusterCount.layout,
        'cluster-count layout missing from style.json'
      );
      const clusterCountPaint = requireValue(
        clusterCount.paint,
        'cluster-count paint missing from style.json'
      );
      expect(clusterCount.type).toBe('symbol');
      expect(clusterCountLayout).toHaveProperty('text-field');
      expect(clusterCountLayout).toHaveProperty('text-font');
      expect(clusterCountLayout['text-font']).toEqual(['Noto Sans Bold']);
      expect(clusterCountLayout).toHaveProperty('text-size', 14);
      expect(clusterCountPaint).toHaveProperty('text-color', '#FFFFFF');
      expect(clusterCountPaint).toHaveProperty('text-halo-color', 'rgba(15, 23, 42, 0.72)');
      expect(clusterCountPaint).toHaveProperty('text-halo-width', 1);
    });

    it('should style ghost clusters and labels with subtler emphasis than active clusters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      const style = JSON.parse(response.body) as StyleJson;
      const activeClusters = style.layers.find((layer) => layer.id === 'property-clusters');
      const activeClusterCount = style.layers.find((layer) => layer.id === 'cluster-count');
      const ghostClusters = style.layers.find((layer) => layer.id === 'ghost-clusters');
      const ghostClusterCount = style.layers.find((layer) => layer.id === 'ghost-cluster-count');

      if (!activeClusters || !activeClusterCount || !ghostClusters || !ghostClusterCount) {
        throw new Error('Expected cluster layers missing from style.json');
      }
      expect(ghostClusters.minzoom).toBe(PROPERTY_GHOST_REVEAL_ZOOM);
      expect(ghostClusterCount.minzoom).toBe(PROPERTY_GHOST_REVEAL_ZOOM);
      const ghostClustersPaint = requireValue(
        ghostClusters.paint,
        'ghost-clusters paint missing from style.json'
      );
      const activeClustersPaint = requireValue(
        activeClusters.paint,
        'property-clusters paint missing from style.json'
      );
      const ghostClusterCountPaint = requireValue(
        ghostClusterCount.paint,
        'ghost-cluster-count paint missing from style.json'
      );
      const activeClusterCountLayout = requireValue(
        activeClusterCount.layout,
        'cluster-count layout missing from style.json'
      );
      const ghostClusterCountLayout = requireValue(
        ghostClusterCount.layout,
        'ghost-cluster-count layout missing from style.json'
      );

      expect(
        requireComparableNumber(
          ghostClustersPaint['circle-opacity'],
          'ghost-clusters circle-opacity missing'
        )
      ).toBeLessThan(
        requireComparableNumber(
          activeClustersPaint['circle-opacity'],
          'property-clusters circle-opacity missing'
        )
      );
      expect(
        requireComparableNumber(
          activeClustersPaint['circle-stroke-width'],
          'property-clusters circle-stroke-width missing'
        )
      ).toBe(0);
      expect(
        requireComparableNumber(
          ghostClustersPaint['circle-stroke-width'],
          'ghost-clusters circle-stroke-width missing'
        )
      ).toBeGreaterThan(0);
      expect(
        requireComparableNumber(
          ghostClusterCountLayout['text-size'],
          'ghost-cluster-count text-size missing'
        )
      ).toBeLessThan(
        requireComparableNumber(
          activeClusterCountLayout['text-size'],
          'cluster-count text-size missing'
        )
      );
      expect(ghostClusterCountPaint['text-color']).toBe('#475569');
      expect(ghostClusterCountPaint['text-halo-color']).toBe('rgba(255, 255, 255, 0.85)');
    });

    it('should set Cache-Control header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/style.json',
      });

      expect(response.headers['cache-control']).toBe('public, max-age=60');
    });
  });

  describe('GET /tiles/properties.json', () => {
    it('should return valid TileJSON metadata', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('tilejson', '2.1.0');
      expect(body).toHaveProperty('name', 'HuisHype Properties');
      expect(body).toHaveProperty('tiles');
      expect(Array.isArray(body.tiles)).toBe(true);
      expect(body.tiles[0]).toContain('/tiles/properties/{z}/{x}/{y}.pbf');
      expect(body).toHaveProperty('minzoom', 0);
      expect(body).toHaveProperty('maxzoom', 22);
    });

    it('should include normalized filter params in TileJSON property tile URLs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties.json?salePriceTo=500000&marketState=not-listed,for-sale',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tiles[0]).toContain(
        '/tiles/properties/{z}/{x}/{y}.pbf?salePriceTo=500000&marketState=for-sale%2Cnot-listed'
      );
    });
  });

  describe('GET /tiles/properties/read.json', () => {
    it('requires a stable viewer identity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/read.json',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'BAD_REQUEST',
        message: 'Authenticated user or x-session-id header is required.',
      });
    });

    it('returns private TileJSON metadata without tile templates before anything is read', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/read.json?marketState=not-listed,for-sale',
        headers: { 'x-session-id': `read-tilejson-empty-${Date.now()}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('tilejson', '2.1.0');
      expect(body.tiles).toEqual([]);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.vary).toContain('Authorization');
      expect(response.headers.vary).toContain('x-session-id');
    });

    it('returns private TileJSON metadata with filter params after a property is read', async () => {
      const sessionId = `read-tilejson-session-${Date.now()}`;
      const property = await createIntegrationProperty({
        street: 'Read TileJSON Street',
        houseNumber: 1,
        city: 'Readtile',
        postalCode: '9300AA',
        lon: 6.2,
        lat: 52.2,
      });

      try {
        const viewResponse = await app.inject({
          method: 'POST',
          url: `/properties/${property.id}/view`,
          headers: { 'x-session-id': sessionId },
        });
        expect(viewResponse.statusCode).toBe(200);

        const response = await app.inject({
          method: 'GET',
          url: '/tiles/properties/read.json?marketState=not-listed,for-sale',
          headers: { 'x-session-id': sessionId },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('tilejson', '2.1.0');
        expect(body.tiles[0]).toContain('/tiles/properties/read/{z}/{x}/{y}.pbf');
        expect(body.tiles[0]).toContain('marketState=for-sale%2Cnot-listed');
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers.vary).toContain('Authorization');
        expect(response.headers.vary).toContain('x-session-id');
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
      }
    });
  });

  describe('GET /tiles/following/properties.json', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/following/properties.json',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    });

    it('returns private TileJSON metadata for authenticated Following tiles', async () => {
      const viewer = await createIntegrationUser(app, { label: 'following-tilejson-viewer' });

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/tiles/following/properties.json?marketState=sold,for-sale',
          headers: {
            authorization: `Bearer ${viewer.accessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('tilejson', '2.1.0');
        expect(body.tiles[0]).toContain('/tiles/following/properties/{z}/{x}/{y}.pbf');
        expect(body.tiles[0]).toContain('marketState=for-sale%2Csold');
        expect(body.tiles[0]).toContain('activity=all-time');
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers.vary).toContain('Authorization');

        const legacyAllResponse = await app.inject({
          method: 'GET',
          url: '/tiles/following/properties.json?activity=all',
          headers: {
            authorization: `Bearer ${viewer.accessToken}`,
          },
        });

        expect(legacyAllResponse.statusCode).toBe(200);
        const legacyAllBody = JSON.parse(legacyAllResponse.body);
        expect(legacyAllBody.tiles[0]).toContain('activity=all-time');
      } finally {
        await db.execute(sql`DELETE FROM users WHERE id = ${viewer.userId}`);
      }
    });
  });

  describe('GET /tiles/properties/:z/:x/:y.pbf', () => {
    // Eindhoven area tile coordinates at various zoom levels
    // Eindhoven center ≈ 51.44, 5.47

    it('should return 204 for an empty ocean tile', async () => {
      // Tile in the middle of the Atlantic ocean at zoom 10
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/0/0.pbf',
      });

      // Should be 204 (No Content) for empty tiles
      expect(response.statusCode).toBe(204);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=300, stale-while-revalidate=300'
      );
      expect(response.headers.etag).toBeDefined();
      expect(response.headers['x-tile-cache']).toBe('miss');
    });

    it('does not create snapshot coverage rows from the public GET fast path', async () => {
      await db.execute(sql`
        DELETE FROM property_tile_snapshots
        WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
      `);
      await db.execute(sql`
        DELETE FROM property_tile_snapshot_coverage
        WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
      `);

      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/0/0/0.pbf',
      });

      expect([200, 204]).toContain(response.statusCode);
      expect(response.headers['x-tile-cache']).not.toBe('precomputed');

      const rows = await db.execute<{ coverage_count: number }>(sql`
        SELECT count(*)::int AS coverage_count
        FROM property_tile_snapshot_coverage
        WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
      `);
      expect(Array.from(rows)[0]?.coverage_count ?? 0).toBe(0);
    });

    it('serves current public default low-zoom tiles from precomputed snapshots with public headers', async () => {
      const tile = { z: 0, x: 0, y: 0 };
      const payload = Buffer.from([0x1a, 0x03, 0x68, 0x68, 0x70]);
      let coverage: Awaited<ReturnType<typeof ensureDefaultPropertyTileSnapshotCoverage>> | null =
        null;

      try {
        coverage = await ensureDefaultPropertyTileSnapshotCoverage();
        await upsertPropertyTileSnapshotRow({
          tile,
          filterSignature: coverage.filterSignature,
          coverage,
          payload,
          watermarks: {
            listingWatermark: 0,
            socialWatermark: 0,
            propertyWatermark: 0,
            coverageWatermark: coverage.coverageWatermark,
          },
          generatedAt: new Date(),
        });

        const response = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.rawPayload).toEqual(payload);
        expect(response.headers['content-type']).toBe('application/x-protobuf');
        expect(response.headers['cache-control']).toBe(
          'public, max-age=300, stale-while-revalidate=300'
        );
        expect(response.headers['x-tile-cache']).toBe('precomputed');
        expect(response.headers['x-tile-coalesced']).toBe('false');
        expect(response.headers['x-tile-generation-time']).toBe('0ms');
        expect(response.headers['x-tile-queue-time']).toBe('0ms');
        expect(response.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
        expect(response.headers.etag).toBeDefined();
      } finally {
        await db.execute(sql`
          DELETE FROM property_tile_snapshots
          WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
            AND z = ${tile.z}
            AND x = ${tile.x}
            AND y = ${tile.y}
        `);
        await db.execute(sql`
          DELETE FROM property_tile_snapshot_coverage
          WHERE coverage_id = ${DEFAULT_PROPERTY_TILE_SNAPSHOT_COVERAGE_ID}
        `);
      }
    });

    it('serves stale public tiles when runtime queue budget is exhausted', async () => {
      process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
      process.env.PROPERTY_TILE_QUEUE_WAIT_MS = '5';
      const tileUrl = '/tiles/properties/10/0/0.pbf';
      const cacheKey = '10/0/0:default';
      const payload = Buffer.from([0x1a, 0x05, 0x73, 0x74, 0x61, 0x6c, 0x65]);
      const staleNow = Date.now() - (PROPERTY_TILE_CACHE_TTL_SECONDS * 1000 + 1_000);
      publicPropertyTileCache.set(
        cacheKey,
        {
          payload,
          statusCode: 200,
          etag: buildPropertyTileEtag(cacheKey, payload),
        },
        staleNow,
      );
      let releaseBlocker!: () => void;
      let markBlockerStarted!: () => void;
      const blockerStarted = new Promise<void>((resolve) => {
        markBlockerStarted = resolve;
      });
      const blocker = propertyTileRuntime.run({
        key: `public:test-blocker:${crypto.randomUUID()}`,
        zoom: 22,
        budgetMs: 5_000,
        builder: async () => {
          markBlockerStarted();
          await new Promise<void>((resolve) => {
            releaseBlocker = resolve;
          });
          return { payload: null, statusCode: 204 as const };
        },
      });

      await blockerStarted;

      try {
        const response = await app.inject({
          method: 'GET',
          url: tileUrl,
        });

        expect(response.statusCode).toBe(200);
        expect(response.rawPayload).toEqual(payload);
        expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
        expect(response.headers['x-tile-cache']).toBe('stale');
        expect(response.headers['x-tile-generation-time']).toBe('0ms');
        expect(response.headers['x-tile-queue-time']).toMatch(/^\d+ms$/);
        expect(response.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
      } finally {
        releaseBlocker();
        await blocker;
        propertyTileRuntime.resetForTests();
      }
    });

    it('returns timeout-empty public headers when runtime budget misses and no stale tile exists', async () => {
      process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
      process.env.PROPERTY_TILE_QUEUE_WAIT_MS = '5';
      let releaseBlocker!: () => void;
      let markBlockerStarted!: () => void;
      const blockerStarted = new Promise<void>((resolve) => {
        markBlockerStarted = resolve;
      });
      const blocker = propertyTileRuntime.run({
        key: `public:test-blocker:${crypto.randomUUID()}`,
        zoom: 22,
        budgetMs: 5_000,
        builder: async () => {
          markBlockerStarted();
          await new Promise<void>((resolve) => {
            releaseBlocker = resolve;
          });
          return { payload: null, statusCode: 204 as const };
        },
      });

      await blockerStarted;

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/tiles/properties/11/0/0.pbf',
        });

        expect(response.statusCode).toBe(204);
        expect(response.headers['cache-control']).toBe('no-store, max-age=0');
        expect(response.headers['x-tile-cache']).toBe('timeout-empty');
        expect(response.headers['x-tile-generation-time']).toBe('0ms');
        expect(response.headers['x-tile-coalesced']).toBe('false');
        expect(response.headers['x-tile-queue-time']).toMatch(/^\d+ms$/);
        expect(response.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
      } finally {
        releaseBlocker();
        await blocker;
        propertyTileRuntime.resetForTests();
      }
    });

    it('should return MVT data for Eindhoven area at zoom 10 (clustered)', async () => {
      // At zoom 10, x=527, y=340 covers Eindhoven area
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/527/340.pbf',
      });

      // Should return data (200) or empty (204)
      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
        expect(response.headers['cache-control']).toContain('public');
        expect(response.rawPayload.length).toBeGreaterThan(0);
      }
    });

    it('should return MVT data for Eindhoven area at zoom 14 (more detail)', async () => {
      // At zoom 14, x=8434, y=5443 covers central Eindhoven
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/14/8434/5443.pbf',
      });

      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
      }
    });

    it('should return density-aware grouped features at zoom 17+ (ghost node threshold)', async () => {
      // At zoom 17, Eindhoven center tile
      // x = 67478, y = 43551 (approx)
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/17/67478/43551.pbf',
      });

      expect([200, 204]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect(response.headers['content-type']).toBe('application/x-protobuf');
      }
    });

    it('should include X-Tile-Generation-Time header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/10/527/340.pbf',
      });

      if (response.statusCode === 200) {
        expect(response.headers['x-tile-generation-time']).toMatch(/^\d+ms$/);
      }
    });

    it('should serve repeated property tile requests from the server cache', async () => {
      const tileUrl = '/tiles/properties/13/4208/2686.pbf';

      const firstResponse = await app.inject({
        method: 'GET',
        url: tileUrl,
      });
      const secondResponse = await app.inject({
        method: 'GET',
        url: tileUrl,
      });

      expect([200, 204]).toContain(firstResponse.statusCode);
      expect(secondResponse.statusCode).toBe(firstResponse.statusCode);
      expect(secondResponse.headers['x-tile-cache']).toBe('hit');
      expect(secondResponse.headers['x-tile-coalesced']).toBe('false');
      expect(secondResponse.headers['x-tile-queue-time']).toMatch(/^\d+ms$/);
      expect(secondResponse.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
      expect(secondResponse.headers['x-tile-generation-time']).toBe('0ms');
    });

    it('coalesces concurrent repeated property tile requests', async () => {
      const tileUrl = '/tiles/properties/13/4208/2686.pbf';

      const [firstResponse, secondResponse] = await Promise.all([
        app.inject({ method: 'GET', url: tileUrl }),
        app.inject({ method: 'GET', url: tileUrl }),
      ]);

      expect([200, 204]).toContain(firstResponse.statusCode);
      expect(secondResponse.statusCode).toBe(firstResponse.statusCode);
      expect([
        firstResponse.headers['x-tile-cache'],
        secondResponse.headers['x-tile-cache'],
      ]).toEqual(['miss', 'miss']);
      expect([
        firstResponse.headers['x-tile-coalesced'],
        secondResponse.headers['x-tile-coalesced'],
      ]).toContain('true');
    });

    it('returns 304 when a cached public property tile ETag matches', async () => {
      const tileUrl = '/tiles/properties/10/0/0.pbf';
      const firstResponse = await app.inject({ method: 'GET', url: tileUrl });
      const etag = firstResponse.headers.etag;

      expect(firstResponse.statusCode).toBe(204);
      expect(etag).toBeDefined();

      const secondResponse = await app.inject({
        method: 'GET',
        url: tileUrl,
        headers: { 'if-none-match': String(etag) },
      });

      expect(secondResponse.statusCode).toBe(304);
      expect(secondResponse.headers['x-tile-cache']).toBe('hit');
      expect(secondResponse.headers.etag).toBe(etag);
    });

    it('keeps public property tile cache viewer-agnostic even when request identity headers differ', async () => {
      const property = await createIntegrationProperty({
        street: 'Viewer Agnostic Tile Street',
        houseNumber: 1,
        city: 'Cachefield',
        postalCode: '9309AA',
        lon: 5.4712,
        lat: 51.4414,
      });
      const tile = tileCoordinatesForPoint(property.lon, property.lat, 17);

      try {
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 525000,
          sourceUrl: `https://example.com/viewer-agnostic-${property.id}`,
        });

        const firstResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
        });
        const secondResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': `viewer-agnostic-${Date.now()}` },
        });

        expect(firstResponse.statusCode).toBe(200);
        expect(firstResponse.headers['x-tile-cache']).toBe('miss');
        expect(secondResponse.statusCode).toBe(200);
        expect(secondResponse.headers['x-tile-cache']).toBe('hit');
        expect(secondResponse.headers['x-tile-generation-time']).toBe('0ms');
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${property.id}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
      }
    });

    it('should include the normalized filter signature in the property tile cache key', async () => {
      const propertyId = crypto.randomUUID();
      const listingId = crypto.randomUUID();
      const lon = 6.94;
      const lat = 53.34;
      const z = 20;
      const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
      const latRad = (lat * Math.PI) / 180;
      const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
      );

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
        VALUES (
          ${propertyId},
          'NL',
          'Tile Filter Street',
          1,
          'Filtermeer',
          '9999AD',
          'active',
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
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
        VALUES (
          ${listingId},
          ${propertyId},
          'funda',
          ${`https://example.com/tile-filter-${listingId}`},
          'active',
          510000,
          'sale',
          NOW(),
          NOW()
        )
      `);

      try {
        const baseUrl = `/tiles/properties/${z}/${x}/${y}.pbf`;
        const filteredUrl = `${baseUrl}?marketState=for-rent`;

        const unfilteredResponse = await app.inject({ method: 'GET', url: baseUrl });
        const firstFilteredResponse = await app.inject({ method: 'GET', url: filteredUrl });
        const secondFilteredResponse = await app.inject({ method: 'GET', url: filteredUrl });

        expect(unfilteredResponse.statusCode).toBe(200);
        expect(unfilteredResponse.headers['x-tile-cache']).toBe('miss');

        expect(firstFilteredResponse.statusCode).toBe(204);
        expect(firstFilteredResponse.headers['x-tile-cache']).toBe('miss');

        expect(secondFilteredResponse.statusCode).toBe(204);
        expect(secondFilteredResponse.headers['x-tile-cache']).toBe('hit');
        expect(secondFilteredResponse.headers['x-tile-generation-time']).toBe('0ms');
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE id = ${listingId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });

    it('emits sold and rented listing-only properties through the public active tile path', async () => {
      const belowActiveNodeZoom = PROPERTY_GHOST_REVEAL_ZOOM - 1;
      const activeNodeZoom = PROPERTY_GHOST_REVEAL_ZOOM;
      const soldProperty = await createIntegrationProperty({
        street: 'Sold Tile Listing Only Street',
        houseNumber: 1,
        city: 'Completedtile',
        postalCode: '9400SA',
        lon: -40.2123,
        lat: -32.2123,
      });
      const rentedProperty = await createIntegrationProperty({
        street: 'Rented Tile Listing Only Street',
        houseNumber: 2,
        city: 'Completedtile',
        postalCode: '9400RB',
        lon: -41.2123,
        lat: -33.2123,
      });
      const soldTiles = [
        tileCoordinatesForPoint(soldProperty.lon, soldProperty.lat, belowActiveNodeZoom),
        tileCoordinatesForPoint(soldProperty.lon, soldProperty.lat, activeNodeZoom),
      ];
      const rentedTiles = [
        tileCoordinatesForPoint(rentedProperty.lon, rentedProperty.lat, belowActiveNodeZoom),
        tileCoordinatesForPoint(rentedProperty.lon, rentedProperty.lat, activeNodeZoom),
      ];
      const completedFilters = createMarketStateFilters(['sold', 'rented']);
      const soldFilters = createMarketStateFilters(['sold']);
      const rentedFilters = createMarketStateFilters(['rented']);

      async function expectPublicPropertyTile(
        tile: ReturnType<typeof tileCoordinatesForPoint>,
        query: string,
        expectedStatusCode: 200 | 204
      ) {
        const response = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf${query}`,
        });

        expect(response.statusCode).toBe(expectedStatusCode);
        if (expectedStatusCode === 200) {
          expect(response.headers['content-type']).toBe('application/x-protobuf');
          expect(response.rawPayload.length).toBeGreaterThan(0);
        }
      }

      try {
        await createIntegrationListing({
          propertyId: soldProperty.id,
          status: 'sold',
          askingPrice: 410000,
          priceType: 'sale',
          sourceUrl: `https://example.com/sold-listing-only-${soldProperty.id}`,
        });
        await createIntegrationListing({
          propertyId: rentedProperty.id,
          status: 'rented',
          askingPrice: 1800,
          priceType: 'rent',
          sourceUrl: `https://example.com/rented-listing-only-${rentedProperty.id}`,
        });

        for (const tile of soldTiles) {
          expectCompletedActiveSingleGroup(
            await buildCanonicalGroupsForTile(tile),
            soldProperty.id,
            'sold'
          );
          expectCompletedActiveSingleGroup(
            await buildCanonicalGroupsForTile(tile, completedFilters),
            soldProperty.id,
            'sold'
          );
          await expectPublicPropertyTile(tile, '', 200);
          await expectPublicPropertyTile(tile, '?marketState=sold,rented', 200);
        }

        for (const tile of rentedTiles) {
          expectCompletedActiveSingleGroup(
            await buildCanonicalGroupsForTile(tile),
            rentedProperty.id,
            'rented'
          );
          expectCompletedActiveSingleGroup(
            await buildCanonicalGroupsForTile(tile, completedFilters),
            rentedProperty.id,
            'rented'
          );
          await expectPublicPropertyTile(tile, '', 200);
          await expectPublicPropertyTile(tile, '?marketState=sold,rented', 200);
        }

        const soldActiveTile = soldTiles[1];
        const rentedActiveTile = rentedTiles[1];
        expectCompletedActiveSingleGroup(
          await buildCanonicalGroupsForTile(soldActiveTile, soldFilters),
          soldProperty.id,
          'sold'
        );
        expect(
          findGroupForProperty(
            await buildCanonicalGroupsForTile(soldActiveTile, rentedFilters),
            soldProperty.id
          )
        ).toBeUndefined();
        expectCompletedActiveSingleGroup(
          await buildCanonicalGroupsForTile(rentedActiveTile, rentedFilters),
          rentedProperty.id,
          'rented'
        );
        expect(
          findGroupForProperty(
            await buildCanonicalGroupsForTile(rentedActiveTile, soldFilters),
            rentedProperty.id
          )
        ).toBeUndefined();

        await expectPublicPropertyTile(soldActiveTile, '?marketState=sold', 200);
        await expectPublicPropertyTile(soldActiveTile, '?marketState=rented', 204);
        await expectPublicPropertyTile(rentedActiveTile, '?marketState=rented', 200);
        await expectPublicPropertyTile(rentedActiveTile, '?marketState=sold', 204);
      } finally {
        await db.execute(
          sql`DELETE FROM listings WHERE property_id IN (${soldProperty.id}, ${rentedProperty.id})`
        );
        await db.execute(
          sql`DELETE FROM properties WHERE id IN (${soldProperty.id}, ${rentedProperty.id})`
        );
        resetPropertyTileCacheForTests();
        resetCanonicalGroupCacheForTests();
      }
    });

    it('should reject invalid zoom level', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/25/0/0.pbf',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject tile coordinates outside the zoom range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/4/16/0.pbf',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return non-empty clustered tiles with bbox properties at z13 for Eindhoven', async () => {
      // Eindhoven center ≈ 51.4416, 5.4697 — compute z13 tile coordinates
      const lon = 5.4697;
      const lat = 51.4416;
      const z = 13;
      const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
      const latRad = (lat * Math.PI) / 180;
      const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
      );

      // Try the computed tile and neighbors to find one with data
      const tilesToTry = [
        [z, x, y],
        [z, x + 1, y],
        [z, x, y + 1],
        [z, x - 1, y],
      ];

      let foundCluster = false;
      for (const [tz, tx, ty] of tilesToTry) {
        const response = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tz}/${tx}/${ty}.pbf`,
        });

        if (response.statusCode === 200 && response.rawPayload.length > 0) {
          // At z13 with clustering enabled, the tile should encode correctly
          // (bbox_west/south/east/north are added as MVT feature properties).
          // Full MVT property verification requires a protobuf decoder;
          // here we confirm the tile encodes without error and is non-empty.
          expect(response.headers['content-type']).toBe('application/x-protobuf');
          expect(response.rawPayload.length).toBeGreaterThan(0);
          foundCluster = true;
          break;
        }
      }

      expect(foundCluster).toBe(true);
    });
  });

  describe('GET /tiles/properties/read/:z/:x/:y.pbf', () => {
    it('requires a stable viewer identity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/properties/read/16/33841/21594.pbf',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'BAD_REQUEST',
        message: 'Authenticated user or x-session-id header is required.',
      });
    });

    it('returns 204 when matching properties are unread and 200 after viewing', async () => {
      const property = await createIntegrationProperty({
        street: 'Read Overlay Tile Street',
        houseNumber: 1,
        city: 'Readtile',
        postalCode: '9301AA',
        lon: 6.201,
        lat: 52.201,
      });
      const tile = tileCoordinatesForPoint(property.lon, property.lat, 17);
      const sessionId = `read-overlay-${Date.now()}`;

      try {
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 475000,
          sourceUrl: `https://example.com/read-overlay-${property.id}`,
        });

        const unreadResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': sessionId },
        });

        expect(unreadResponse.statusCode).toBe(204);
        expect(unreadResponse.headers['cache-control']).toBe('private, no-store');
        expect(unreadResponse.headers['x-tile-cache']).toBe('miss');
        expect(unreadResponse.headers['x-tile-coalesced']).toBe('false');
        expect(unreadResponse.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
        expect(unreadResponse.headers.vary).toContain('Authorization');
        expect(unreadResponse.headers.vary).toContain('x-session-id');

        const viewResponse = await app.inject({
          method: 'POST',
          url: `/properties/${property.id}/view`,
          headers: { 'x-session-id': sessionId },
        });
        expect(viewResponse.statusCode).toBe(200);

        const readResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': sessionId },
        });

        expect(readResponse.statusCode).toBe(200);
        expect(readResponse.headers['content-type']).toBe('application/x-protobuf');
        expect(readResponse.headers['cache-control']).toBe('private, no-store');
        expect(readResponse.headers['x-tile-cache']).toBe('miss');
        expect(readResponse.headers['x-tile-coalesced']).toBe('false');
        expect(readResponse.rawPayload.length).toBeGreaterThan(0);
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${property.id}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
      }
    });

    it('only emits a clustered read overlay when every member has been read', async () => {
      const sessionId = `read-cluster-${Date.now()}`;
      const first = await createIntegrationProperty({
        street: 'Read Overlay Cluster A',
        houseNumber: 1,
        city: 'Readtile',
        postalCode: '9302AA',
        lon: -40.202,
        lat: -32.202,
      });
      const second = await createIntegrationProperty({
        street: 'Read Overlay Cluster B',
        houseNumber: 2,
        city: 'Readtile',
        postalCode: '9302AB',
        lon: -40.20199,
        lat: -32.20199,
      });
      const tile = tileCoordinatesForPoint(first.lon, first.lat, 14);

      try {
        await createIntegrationListing({
          propertyId: first.id,
          askingPrice: 475000,
          sourceUrl: `https://example.com/read-cluster-${first.id}`,
        });
        await createIntegrationListing({
          propertyId: second.id,
          askingPrice: 476000,
          sourceUrl: `https://example.com/read-cluster-${second.id}`,
        });

        const firstView = await app.inject({
          method: 'POST',
          url: `/properties/${first.id}/view`,
          headers: { 'x-session-id': sessionId },
        });
        expect(firstView.statusCode).toBe(200);

        const partiallyReadResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': sessionId },
        });
        expect(partiallyReadResponse.statusCode).toBe(204);

        const secondView = await app.inject({
          method: 'POST',
          url: `/properties/${second.id}/view`,
          headers: { 'x-session-id': sessionId },
        });
        expect(secondView.statusCode).toBe(200);

        const fullyReadResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': sessionId },
        });
        expect(fullyReadResponse.statusCode).toBe(200);
        expect(fullyReadResponse.rawPayload.length).toBeGreaterThan(0);
      } finally {
        await db.execute(
          sql`DELETE FROM listings WHERE property_id IN (${first.id}, ${second.id})`
        );
        await db.execute(sql`DELETE FROM properties WHERE id IN (${first.id}, ${second.id})`);
      }
    });

    it('keeps read overlay tiles viewer-specific even when the public base tile is cached', async () => {
      const property = await createIntegrationProperty({
        street: 'Read Overlay Identity Street',
        houseNumber: 1,
        city: 'Readtile',
        postalCode: '9303AA',
        lon: 6.203,
        lat: 52.203,
      });
      const tile = tileCoordinatesForPoint(property.lon, property.lat, 17);
      const readerSessionId = `read-overlay-reader-${Date.now()}`;
      const otherSessionId = `${readerSessionId}-other`;

      try {
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 477000,
          sourceUrl: `https://example.com/read-overlay-identity-${property.id}`,
        });

        const publicResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/${tile.z}/${tile.x}/${tile.y}.pbf`,
        });
        expect(publicResponse.statusCode).toBe(200);

        const viewResponse = await app.inject({
          method: 'POST',
          url: `/properties/${property.id}/view`,
          headers: { 'x-session-id': readerSessionId },
        });
        expect(viewResponse.statusCode).toBe(200);

        const readerResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': readerSessionId },
        });
        const otherViewerResponse = await app.inject({
          method: 'GET',
          url: `/tiles/properties/read/${tile.z}/${tile.x}/${tile.y}.pbf`,
          headers: { 'x-session-id': otherSessionId },
        });

        expect(readerResponse.statusCode).toBe(200);
        expect(readerResponse.headers['cache-control']).toBe('private, no-store');
        expect(otherViewerResponse.statusCode).toBe(204);
        expect(otherViewerResponse.headers['cache-control']).toBe('private, no-store');
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${property.id}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
      }
    });
  });

  describe('GET /tiles/following/properties/:z/:x/:y.pbf', () => {
    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tiles/following/properties/14/8434/5443.pbf',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    });

    it('returns personalized grouped tiles with private cache semantics', async () => {
      const viewer = await createIntegrationUser(app, { label: 'following-tile-viewer' });
      const actor = await createIntegrationUser(app, { label: 'following-tile-actor' });
      const property = await createIntegrationProperty({
        street: 'Following Tile Street',
        houseNumber: 1,
        city: 'Tileview',
        postalCode: '9202AB',
        lon: 4.8952,
        lat: 52.3702,
      });
      const tile = tileCoordinatesForPoint(property.lon, property.lat, 16);

      try {
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 625000,
          thumbnailUrl: 'https://cdn.example.com/following-tile.jpg',
        });
        await createIntegrationFollow({
          followerUserId: viewer.userId,
          followedUserId: actor.userId,
        });
        await db.execute(sql`
          INSERT INTO comments (id, property_id, user_id, content, created_at)
          VALUES (
            ${crypto.randomUUID()},
            ${property.id},
            ${actor.userId},
            'Followed-user tile comment',
            NOW()
          )
        `);

        const response = await app.inject({
          method: 'GET',
          url: `/tiles/following/properties/${tile.z}/${tile.x}/${tile.y}.pbf?marketState=for-sale`,
          headers: {
            authorization: `Bearer ${viewer.accessToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/x-protobuf');
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.headers['x-tile-cache']).toBe('miss');
        expect(response.headers['x-tile-coalesced']).toBe('false');
        expect(response.headers['x-tile-budget-ms']).toMatch(/^\d+$/);
        expect(response.headers.vary).toContain('Authorization');
        expect(response.rawPayload.length).toBeGreaterThan(0);
      } finally {
        await db.execute(sql`DELETE FROM comments WHERE property_id = ${property.id}`);
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${property.id}`);
        await db.execute(sql`DELETE FROM user_follows WHERE follower_user_id = ${viewer.userId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
        await db.execute(
          sql`DELETE FROM users WHERE id IN (${sql.join(
            [sql`${viewer.userId}`, sql`${actor.userId}`],
            sql`, `
          )})`
        );
      }
    });
  });

  describe('GET /fonts/:fontstack/:range', () => {
    it('should serve Noto Sans Regular glyph PBF', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/Noto Sans Regular/0-255.pbf',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/x-protobuf');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(response.rawPayload.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent font', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/NonExistent Font/0-255.pbf',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 for composite fontstack (comma stripped by sanitizer)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/fonts/Noto Sans Regular,Arial Unicode MS Regular/0-255.pbf',
      });

      // Comma is stripped by sanitizer before fallback logic, so the combined
      // string "Noto Sans RegularArial Unicode MS Regular" doesn't match any font
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /sprites/:filename', () => {
    it('should serve sprite JSON manifest', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm.json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');
      const manifest = JSON.parse(response.body);
      expect(typeof manifest).toBe('object');
      expect(Object.keys(manifest).length).toBeGreaterThan(0);
    });

    it('should serve @2x sprite JSON manifest', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm@2x.json',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should serve sprite PNG atlas', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/ofm.png',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    });

    it('should reject invalid sprite filenames', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sprites/malicious.json',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /tiles/buildings/:z/:x/:y.pbf', () => {
    // Eindhoven center tile at z15
    const EINDHOVEN_Z15 = { z: 15, x: 16828, y: 10898 };
    // Ocean tile (no buildings)
    const OCEAN_TILE = { z: 15, x: 0, y: 0 };

    it('returns 204 below minzoom', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/14/${Math.floor(EINDHOVEN_Z15.x / 2)}/${Math.floor(EINDHOVEN_Z15.y / 2)}.pbf`,
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('returns 204 above maxzoom', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/20/${EINDHOVEN_Z15.x}/${EINDHOVEN_Z15.y}.pbf`,
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('returns 204 for empty ocean tile', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/${OCEAN_TILE.z}/${OCEAN_TILE.x}/${OCEAN_TILE.y}.pbf`,
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('returns MVT for Eindhoven at z15', async () => {
      const { z, x, y } = EINDHOVEN_Z15;
      const res = await app.inject({
        method: 'GET',
        url: `/tiles/buildings/${z}/${x}/${y}.pbf`,
      });
      // May be 200 or 204 depending on whether osm_buildings is populated
      if (res.statusCode === 200) {
        expect(res.headers['content-type']).toBe('application/x-protobuf');
        expect(res.headers['cache-control']).toContain('public');
        expect(res.headers['x-tile-generation-time']).toBeDefined();
      } else {
        expect(res.statusCode).toBe(204);
      }
    });

    it('is deterministic (same tile = same bytes)', async () => {
      const { z, x, y } = EINDHOVEN_Z15;
      const url = `/tiles/buildings/${z}/${x}/${y}.pbf`;
      const res1 = await app.inject({ method: 'GET', url });
      const res2 = await app.inject({ method: 'GET', url });
      expect(res1.statusCode).toBe(res2.statusCode);
      if (res1.statusCode === 200) {
        expect(Buffer.from(res1.rawPayload)).toEqual(Buffer.from(res2.rawPayload));
      }
    });
  });

  describe('osm_buildings table', () => {
    it('exists with expected columns', async () => {
      const result = await db.execute<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'osm_buildings'
        ORDER BY ordinal_position
      `);
      const columns = Array.from(result).map((r) => r.column_name);
      expect(columns).toContain('geometry');
      expect(columns).toContain('render_height');
      expect(columns).toContain('render_min_height');
      expect(columns).toContain('osm_id');
    });

    it('has GIST index on geometry', async () => {
      const result = await db.execute<{ indexname: string }>(sql`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'osm_buildings' AND indexdef LIKE '%gist%'
      `);
      expect(Array.from(result).length).toBeGreaterThan(0);
    });
  });
});

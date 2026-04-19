import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  GHOST_NODE_REVEAL_ZOOM,
  PROPERTY_TILE_EXTENT,
  buildCanonicalGroupsForTile,
  lngLatToWorldUnits,
  resolveNearbyGroupedFeature,
} from '../services/property-grouping.js';

const SEEDED_GHOST_CLUSTER_FIXTURE = {
  lon: 5.47123505671892,
  lat: 51.4434318245281,
  zoom: 17,
};

async function withHermeticNearbyActiveCluster(
  run: (fixture: { lon: number; lat: number; propertyIds: string[] }) => Promise<void>,
) {
  const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
  const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
  const viewIds = [crypto.randomUUID(), crypto.randomUUID()];
  const lon = -29.812345;
  const lat = 0.123456;

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
        'Nearby Fixture Street',
        1,
        'Fixture City',
        '1000AA',
        'active',
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
      ),
      (
        ${propertyIds[1]},
        'NL',
        'Nearby Fixture Street',
        2,
        'Fixture City',
        '1000AA',
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
    VALUES
      (
        ${listingIds[0]},
        ${propertyIds[0]},
        'funda',
        ${`https://example.com/nearby-fixture-${listingIds[0]}`},
        'active',
        350000,
        'sale',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      ),
      (
        ${listingIds[1]},
        ${propertyIds[1]},
        'funda',
        ${`https://example.com/nearby-fixture-${listingIds[1]}`},
        'active',
        360000,
        'sale',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      )
  `);

  await db.execute(sql`
    INSERT INTO property_views (id, property_id, user_id, session_id, viewed_at)
    VALUES
      (${viewIds[0]}, ${propertyIds[0]}, NULL, ${`nearby-fixture-session-${viewIds[0]}`}, NOW()),
      (${viewIds[1]}, ${propertyIds[1]}, NULL, ${`nearby-fixture-session-${viewIds[1]}`}, NOW())
  `);

  try {
    await run({ lon, lat, propertyIds });
  } finally {
    await db.execute(sql`DELETE FROM property_views WHERE id IN (${viewIds[0]}, ${viewIds[1]})`);
    await db.execute(sql`DELETE FROM listings WHERE id IN (${listingIds[0]}, ${listingIds[1]})`);
    await db.execute(sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`);
  }
}

function tileForCoordinate(lon: number, lat: number, zoom: number) {
  const [worldX, worldY] = lngLatToWorldUnits(lon, lat, zoom);
  return {
    z: zoom,
    x: Math.floor(worldX / PROPERTY_TILE_EXTENT),
    y: Math.floor(worldY / PROPERTY_TILE_EXTENT),
  };
}

function getTileNeighborhood(tile: { z: number; x: number; y: number }) {
  const tileCount = Math.pow(2, tile.z);
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  const seen = new Set<string>();

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = (tile.x + dx + tileCount) % tileCount;
      const y = tile.y + dy;
      if (y < 0 || y >= tileCount) continue;

      const key = `${x}:${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ z: tile.z, x, y });
    }
  }

  return tiles;
}

/**
 * Integration tests for GET /properties/nearby
 *
 * These tests run against the real PostGIS database with seeded Eindhoven data.
 * The database must be running and seeded before running these tests.
 */
describe('GET /properties/nearby', () => {
  jest.setTimeout(30000);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('route registration', () => {
    it('should register the /properties/nearby route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });
      // Should not be 404 (route not found)
      expect(response.statusCode).not.toBe(404);
    });
  });

  describe('parameter validation', () => {
    it('should return 400 when lon is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lon is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=200&lat=51.4416',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when lat is out of range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=100',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('response shape', () => {
    it('should return a canonical grouped result or null', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=17',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(body).toHaveProperty('nodeClass');
        expect(body).toHaveProperty('groupKind');
        expect(body).toHaveProperty('primaryPropertyId');
        expect(body).toHaveProperty('pointCount');
        expect(Array.isArray(body.propertyIds)).toBe(true);
        expect(Array.isArray(body.previewPropertyIds)).toBe(true);
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(body).not.toHaveProperty('node_class');
        expect(body).not.toHaveProperty('group_kind');
        expect(body).not.toHaveProperty('primary_property_id');
        expect(body).not.toHaveProperty('point_count');
        expect(body).not.toHaveProperty('property_ids');
        expect(body).not.toHaveProperty('preview_property_ids');
      }
    });

    it('should return grouped fields with the expected types', async () => {
      // Use Eindhoven center — seeded data should have properties nearby
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(typeof body.primaryPropertyId).toBe('string');
        expect(typeof body.pointCount).toBe('number');
        expect(typeof body.activeListingCount).toBe('number');
        expect(typeof body.socialCount).toBe('number');
        expect(typeof body.recentSocialCount).toBe('number');
        expect(typeof body.socialScoreTotal).toBe('number');
        expect(typeof body.socialScoreMax).toBe('number');
        expect(typeof body.recentSocialScoreTotal).toBe('number');
        expect(typeof body.distanceMeters).toBe('number');

        if (body.groupKind === 'single') {
          expect(typeof body.address).toBe('string');
          expect(typeof body.city).toBe('string');
          expect(typeof body.hasActiveListing).toBe('boolean');
          expect(typeof body.marketState).toBe('string');
        } else {
          expect(body.bbox).not.toBeNull();
          expect(body.address).toBeNull();
          expect(body.city).toBeNull();
          expect(body.hasActiveListing).toBeNull();
          expect(body.marketState).toBeNull();
        }
      }
    });

    it('should include grouped coordinates as a [lon, lat] tuple', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(typeof body.coordinate[0]).toBe('number');
        expect(typeof body.coordinate[1]).toBe('number');
      }
    });
  });

  describe('zoom-to-radius filtering', () => {
    it('should resolve a grouped feature at high zoom without assuming singles', async () => {
      const highZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=19',
      });

      const lowZoomResp = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=13',
      });

      expect(highZoomResp.statusCode).toBe(200);
      expect(lowZoomResp.statusCode).toBe(200);

      const highZoomBody = JSON.parse(highZoomResp.body);
      const lowZoomBody = JSON.parse(lowZoomResp.body);

      if (highZoomBody !== null) {
        expect(['single', 'cluster']).toContain(highZoomBody.groupKind);
        expect(highZoomBody.pointCount).toBeGreaterThanOrEqual(1);
      }

      if (lowZoomBody !== null && highZoomBody !== null) {
        expect(lowZoomBody.distanceMeters).toBeGreaterThanOrEqual(0);
        expect(highZoomBody.distanceMeters).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should return null for a location in the ocean', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=17',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeNull();
    });

    it('should use default zoom of 17 when not specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body === null || typeof body === 'object').toBe(true);
    });
  });

  describe('grouped nearby fallback', () => {
    it('should return a grouped feature in a populated area', async () => {
      await withHermeticNearbyActiveCluster(async ({ lon, lat, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.nodeClass).toBe('active');
        expect(body.groupKind).toBe('cluster');
        expect(body.pointCount).toBe(propertyIds.length);
        expect(body.propertyIds).toEqual(expect.arrayContaining(propertyIds));
        expect(body.propertyIds).toHaveLength(propertyIds.length);
        expect(body.previewPropertyIds).toEqual(expect.arrayContaining(propertyIds));
        expect(body.previewPropertyIds).toHaveLength(propertyIds.length);
        expect(body.primaryPropertyId).toEqual(expect.any(String));
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
        expect(typeof body.coordinate[0]).toBe('number');
        expect(typeof body.coordinate[1]).toBe('number');
        expect(typeof body.distanceMeters).toBe('number');
        expect(body.bbox).not.toBeNull();
      });
    });

    it('should resolve a grouped feature at high zoom without assuming singles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=18',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(['single', 'cluster']).toContain(body.groupKind);
        expect(body.pointCount).toBeGreaterThanOrEqual(1);
        expect(body).toHaveProperty('primaryPropertyId');
        if (body.groupKind === 'single') {
          expect(body).toHaveProperty('address');
          expect(body).toHaveProperty('city');
        }
        expect(body).toHaveProperty('distanceMeters');
        expect(typeof body.distanceMeters).toBe('number');
      }
    });

    it('should return null for a location with no properties', async () => {
      // Coordinates in the middle of the North Sea
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=3.0&lat=55.0&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeNull();
    });

    it('should expose the canonical grouped shape when the cluster query param is absent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body !== null) {
        expect(body).toHaveProperty('groupKind');
        expect(body).toHaveProperty('pointCount');
      }
    });

    it('matches the canonical tile grouping emitted across the tap tile neighborhood', async () => {
      const direct = await resolveNearbyGroupedFeature(
        SEEDED_GHOST_CLUSTER_FIXTURE.lon,
        SEEDED_GHOST_CLUSTER_FIXTURE.lat,
        SEEDED_GHOST_CLUSTER_FIXTURE.zoom,
      );

      const response = await app.inject({
        method: 'GET',
        url:
          `/properties/nearby?lon=${SEEDED_GHOST_CLUSTER_FIXTURE.lon}` +
          `&lat=${SEEDED_GHOST_CLUSTER_FIXTURE.lat}` +
          `&zoom=${SEEDED_GHOST_CLUSTER_FIXTURE.zoom}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(direct).not.toBeNull();
      const tapTile = tileForCoordinate(
        SEEDED_GHOST_CLUSTER_FIXTURE.lon,
        SEEDED_GHOST_CLUSTER_FIXTURE.lat,
        SEEDED_GHOST_CLUSTER_FIXTURE.zoom,
      );
      const nearbyGroups = (
        await Promise.all(
          getTileNeighborhood(tapTile).map((tile) => buildCanonicalGroupsForTile(tile)),
        )
      ).flat();
      const matchingGroup = nearbyGroups.find(
        (group) => group.primaryPropertyId === direct?.primaryPropertyId,
      );

      expect(matchingGroup).toBeDefined();
      expect(body).not.toBeNull();
      expect(body.nodeClass).toBe('ghost');
      expect(body.groupKind).toBe('cluster');
      expect(body.primaryPropertyId).toBe(matchingGroup?.primaryPropertyId);
      expect(body.pointCount).toBe(matchingGroup?.pointCount);
      expect(body.propertyIds).toEqual(matchingGroup?.propertyIds);
      expect(body.previewPropertyIds).toEqual(matchingGroup?.previewPropertyIds);
      expect(body.bbox).toEqual(matchingGroup?.bbox);
      expect(body.activeListingCount).toBe(0);
      expect(body.socialCount).toBe(0);
      expect(body.recentSocialCount).toBe(0);
      expect(body.socialScoreTotal).toBe(0);
      expect(body.socialScoreMax).toBe(0);
      expect(body.recentSocialScoreTotal).toBe(0);
      expect(body.address).toBeNull();
      expect(body.city).toBeNull();
    });

    it('keeps nearby resolution aligned with the canonical tile group and preview cap rules', async () => {
      const { lon, lat, zoom } = SEEDED_GHOST_CLUSTER_FIXTURE;
      const direct = await resolveNearbyGroupedFeature(lon, lat, zoom);
      expect(direct).not.toBeNull();
      const tileGroup = await buildCanonicalGroupsForTile(direct!.ownerTile);
      const matchingGroup = tileGroup.find(
        (group) => group.primaryPropertyId === direct?.primaryPropertyId,
      );

      expect(matchingGroup).toBeDefined();
      expect(direct?.primaryPropertyId).toBe(matchingGroup?.primaryPropertyId);
      expect(direct?.groupKind).toBe(matchingGroup?.groupKind);
      expect(direct?.nodeClass).toBe(matchingGroup?.nodeClass);
      expect(direct?.pointCount).toBe(matchingGroup?.pointCount);
      expect(direct?.previewPropertyIds).toEqual(matchingGroup?.previewPropertyIds);
      expect(direct?.previewPropertyIds).toHaveLength(
        Math.min(direct?.pointCount ?? 0, PROPERTY_PREVIEW_MEMBER_LIMIT),
      );
      expect(direct?.previewPropertyIds).toEqual(
        direct?.propertyIds.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
      );
      expect(direct?.pointCount).toBeGreaterThanOrEqual(direct?.previewPropertyIds.length ?? 0);
    });

    it('hydrates ghost singles with real single-property fields', async () => {
      const propertyId = crypto.randomUUID();
      const lon = 3.15;
      const lat = 55.05;

      await db.execute(sql`
        INSERT INTO properties (
          id,
          country_code,
          street,
          house_number,
          city,
          postal_code,
          status,
          geometry,
          official_valuation,
          year_built,
          floor_area_m2
        )
        VALUES (
          ${propertyId},
          'NL',
          'Remote Ghost Lane',
          17,
          'Remote City',
          '9999 ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
          123456,
          1994,
          101
        )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=${GHOST_NODE_REVEAL_ZOOM}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.nodeClass).toBe('ghost');
        expect(body.groupKind).toBe('single');
        expect(body.primaryPropertyId).toBe(propertyId);
        expect(body.address).toEqual(expect.any(String));
        expect(body.city).toBe('Remote City');
        expect(body.postalCode).toBe('9999 ZZ');
        expect(body.countryCode).toBe('NL');
        expect(body.officialValuation).toBe(123456);
        expect(body.yearBuilt).toBe(1994);
        expect(body.floorAreaM2).toBe(101);
        expect(body.activeListingCount).toBe(0);
        expect(body.hasActiveListing).toBe(false);
        expect(body.marketState).toBe('not-listed');
        expect(body.askingPrice).toBeNull();
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });

    it('applies market filters before resolving nearby grouped features', async () => {
      const propertyIds = [crypto.randomUUID(), crypto.randomUUID()];
      const listingIds = [crypto.randomUUID(), crypto.randomUUID()];
      const lon = 6.82;
      const lat = 53.24;

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
            'Nearby Filter Street',
            1,
            'Filterdam',
            '9999AB',
            'active',
            ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
          ),
          (
            ${propertyIds[1]},
            'NL',
            'Nearby Filter Street',
            2,
            'Filterdam',
            '9999AB',
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
        VALUES
          (
            ${listingIds[0]},
            ${propertyIds[0]},
            'pararius',
            ${`https://example.com/nearby-filter-${listingIds[0]}`},
            'active',
            1750,
            'rent',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${listingIds[1]},
            ${propertyIds[1]},
            'pararius',
            ${`https://example.com/nearby-filter-${listingIds[1]}`},
            'active',
            2750,
            'rent',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=20&rentPriceTo=2000&marketState=for-rent`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.groupKind).toBe('single');
        expect(body.primaryPropertyId).toBe(propertyIds[0]);
        expect(body.propertyIds).toEqual([propertyIds[0]]);
        expect(body.askingPrice).toBe(1750);
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE id IN (${listingIds[0]}, ${listingIds[1]})`);
        await db.execute(sql`DELETE FROM properties WHERE id IN (${propertyIds[0]}, ${propertyIds[1]})`);
      }
    });

    it('should include valid UUIDs in grouped propertyIds', async () => {
      await withHermeticNearbyActiveCluster(async ({ lon, lat, propertyIds }) => {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/nearby?lon=${lon}&lat=${lat}&zoom=10`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body).not.toBeNull();
        expect(body.groupKind).toBe('cluster');
        expect(body.propertyIds).toHaveLength(propertyIds.length);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const id of body.propertyIds) {
          expect(id).toMatch(uuidRegex);
        }
      });
    });
  });

  describe('OpenAPI documentation', () => {
    it('should include /properties/nearby in swagger', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      expect(swagger.paths).toHaveProperty('/properties/nearby');
      expect(swagger.paths['/properties/nearby']).toHaveProperty('get');
    });

    it('should document query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const swagger = JSON.parse(response.body);
      const nearbyPath = swagger.paths['/properties/nearby'];
      const params = nearbyPath.get.parameters;
      const paramNames = params.map((p: { name: string }) => p.name);

      expect(paramNames).toContain('lon');
      expect(paramNames).toContain('lat');
      expect(paramNames).toContain('zoom');
      expect(paramNames).toContain('salePriceFrom');
      expect(paramNames).toContain('salePriceTo');
      expect(paramNames).toContain('rentPriceFrom');
      expect(paramNames).toContain('rentPriceTo');
      expect(paramNames).toContain('marketState');
      expect(paramNames).not.toContain('cluster');
      expect(paramNames).not.toContain('limit');
    });
  });
});

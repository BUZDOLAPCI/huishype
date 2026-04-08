import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  buildCanonicalGroupsForTile,
  resolveNearbyGroupedFeature,
} from '../services/property-grouping.js';

const SEEDED_GHOST_CLUSTER_FIXTURE = {
  lon: 5.47123505671892,
  lat: 51.4434318245281,
  zoom: 17,
};

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
        expect(body).toHaveProperty('node_class');
        expect(body).toHaveProperty('group_kind');
        expect(body).toHaveProperty('primary_property_id');
        expect(body).toHaveProperty('point_count');
        expect(Array.isArray(body.property_ids)).toBe(true);
        expect(Array.isArray(body.preview_property_ids)).toBe(true);
        expect(Array.isArray(body.coordinate)).toBe(true);
        expect(body.coordinate).toHaveLength(2);
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
        expect(typeof body.primary_property_id).toBe('string');
        expect(typeof body.point_count).toBe('number');
        expect(typeof body.hasListing).toBe('boolean');
        expect(typeof body.activityScore).toBe('number');
        expect(typeof body.activityScoreTotal).toBe('number');
        expect(typeof body.distanceMeters).toBe('number');

        if (body.group_kind === 'single') {
          expect(typeof body.address).toBe('string');
          expect(typeof body.city).toBe('string');
        } else {
          expect(body.bbox).not.toBeNull();
          expect(body.address).toBeNull();
          expect(body.city).toBeNull();
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
        expect(['single', 'cluster']).toContain(highZoomBody.group_kind);
        expect(highZoomBody.point_count).toBeGreaterThanOrEqual(1);
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
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(body).toHaveProperty('node_class');
        expect(body).toHaveProperty('group_kind');
        expect(Array.isArray(body.property_ids)).toBe(true);
        expect(Array.isArray(body.preview_property_ids)).toBe(true);
        expect(typeof body.primary_property_id).toBe('string');
        if (body.group_kind === 'cluster') {
          expect(body.point_count).toBeGreaterThan(1);
          expect(body.property_ids.length).toBe(body.point_count);
          expect(Array.isArray(body.coordinate)).toBe(true);
          expect(body.coordinate).toHaveLength(2);
          expect(typeof body.coordinate[0]).toBe('number');
          expect(typeof body.coordinate[1]).toBe('number');
          expect(typeof body.distanceMeters).toBe('number');
          expect(body.bbox).not.toBeNull();
        } else {
          expect(body.group_kind).toBe('single');
          expect(body.point_count).toBe(1);
          expect(body.address).toEqual(expect.any(String));
        }
      }
    });

    it('should resolve a grouped feature at high zoom without assuming singles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=18',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        expect(['single', 'cluster']).toContain(body.group_kind);
        expect(body.point_count).toBeGreaterThanOrEqual(1);
        expect(body).toHaveProperty('primary_property_id');
        if (body.group_kind === 'single') {
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
        expect(body).toHaveProperty('group_kind');
        expect(body).toHaveProperty('point_count');
      }
    });

    it('matches the canonical tile grouping for the seeded near-edge ghost cluster fixture', async () => {
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
      const tileGroup = await buildCanonicalGroupsForTile(direct!.ownerTile);
      const matchingGroup = tileGroup.find(
        (group) => group.primaryPropertyId === direct?.primaryPropertyId,
      );

      expect(matchingGroup).toBeDefined();
      expect(body).not.toBeNull();
      expect(body.node_class).toBe('ghost');
      expect(body.group_kind).toBe('cluster');
      expect(body.primary_property_id).toBe(matchingGroup?.primaryPropertyId);
      expect(body.point_count).toBe(matchingGroup?.pointCount);
      expect(body.property_ids).toEqual(matchingGroup?.propertyIds);
      expect(body.preview_property_ids).toEqual(matchingGroup?.previewPropertyIds);
      expect(body.bbox).toEqual(matchingGroup?.bbox);
      expect(body.hasListing).toBe(false);
      expect(body.activityScore).toBe(0);
      expect(body.activityScoreTotal).toBe(0);
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

    it('should include valid UUIDs in grouped property_ids', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body !== null) {
        const ids = body.property_ids;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const id of ids) {
          expect(id).toMatch(uuidRegex);
        }
      }
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
      expect(paramNames).not.toContain('cluster');
      expect(paramNames).not.toContain('limit');
    });
  });
});

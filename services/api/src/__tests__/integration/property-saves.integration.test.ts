import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, savedProperties } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import {
  createIntegrationListing,
  createIntegrationOsmBuildingRectangle,
  createIntegrationProperty,
  createIntegrationUser,
} from './helpers/fixtures.js';

/**
 * Integration tests for property save endpoints.
 *
 * Tests POST /properties/:id/save, DELETE /properties/:id/save,
 * GET /saved-properties, and verifies enriched GET /properties/:id isSaved
 * against fixtures owned by this suite.
 */
describe('Property save routes', () => {
  jest.setTimeout(60000);
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  let propertyId2: string;
  const testUserIds: string[] = [];
  const testPropertyIds: string[] = [];
  const testListingIds: string[] = [];
  const testOsmBuildingIds: number[] = [];
  const listingThumbnailUrl = 'https://images.example.com/property-save-primary.jpg';
  const firstSavedAt = '2024-01-01T00:00:00.000Z';

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const auth = await createIntegrationUser(app, { label: 'property-saves' });
    userId = auth.userId;
    accessToken = auth.accessToken;
    testUserIds.push(userId);

    const primaryProperty = await createIntegrationProperty({
      street: 'Property Saves Street',
      houseNumber: 10,
      city: 'Fixturestad',
      postalCode: '9910AA',
      lon: 5.4701,
      lat: 51.4401,
      officialValuation: 410000,
      yearBuilt: 1998,
      floorAreaM2: 128,
    });
    propertyId = primaryProperty.id;
    testPropertyIds.push(primaryProperty.id);

    const secondaryProperty = await createIntegrationProperty({
      street: 'Property Saves Street',
      houseNumber: 12,
      city: 'Fixturestad',
      postalCode: '9910AA',
      lon: 5.4704,
      lat: 51.4404,
      officialValuation: 395000,
      yearBuilt: 2004,
      floorAreaM2: 116,
    });
    propertyId2 = secondaryProperty.id;
    testPropertyIds.push(secondaryProperty.id);

    const primaryListing = await createIntegrationListing({
      propertyId,
      sourceName: 'funda',
      sourceUrl: `https://example.com/property-saves/${propertyId}`,
      askingPrice: 455000,
      thumbnailUrl: listingThumbnailUrl,
    });
    testListingIds.push(primaryListing.id);
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(savedProperties).where(eq(savedProperties.userId, uid));
      } catch {
        // Ignore
      }
    }
    if (testListingIds.length > 0) {
      await db.execute(sql`
        DELETE FROM listings
        WHERE id IN (${sql.join(testListingIds.map((id) => sql`${id}`), sql`, `)})
      `);
    }
    if (testPropertyIds.length > 0) {
      await db.execute(sql`
        DELETE FROM properties
        WHERE id IN (${sql.join(testPropertyIds.map((id) => sql`${id}`), sql`, `)})
      `);
    }
    if (testOsmBuildingIds.length > 0) {
      await db.execute(sql`
        DELETE FROM osm_buildings
        WHERE osm_id IN (${sql.join(testOsmBuildingIds.map((id) => sql`${id}`), sql`, `)})
      `);
    }
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('POST /properties/:id/save', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should save a property successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.saved).toBe(true);

      // Pin the initial save timestamp so saved-properties ordering is stable.
      await db.execute(sql`
        UPDATE saved_properties
        SET created_at = ${firstSavedAt}::timestamptz
        WHERE user_id = ${userId}
          AND property_id = ${propertyId}
      `);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should return 409 when saving again (already saved)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ALREADY_SAVED');
    });
  });

  describe('GET /properties/:id (enriched isSaved after saving)', () => {
    it('should return isSaved=true with auth after saving', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(propertyId);
      expect(body.isSaved).toBe(true);
    });

    it('should return isSaved=false without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('GET /saved-properties', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should return saved properties with auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(propertyId);
      expect(body.data[0].hasListing).toBe(true);
      expect(body.data[0].askingPrice).toBe(455000);
      expect(body.data[0].thumbnailUrl).toBe(listingThumbnailUrl);
      expect(body.data[0]).toHaveProperty('street');
      expect(body.data[0]).toHaveProperty('houseNumber');
      expect(body.data[0]).toHaveProperty('city');
      expect(body.data[0]).toHaveProperty('address');
      expect(body.data[0]).toHaveProperty('savedAt');
      expect(body.data[0]).toHaveProperty('topLevelCommentCount');
      expect(body.data[0]).toHaveProperty('replyCount');
      expect(body.data[0]).toHaveProperty('guessCount');
      expect(body.data[0].savedAt).toBe(firstSavedAt);
    });

    it('should return saved properties ordered by savedAt DESC', async () => {
      // Save a second property
      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId2}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBe(2);
      // Most recently saved should be first
      expect(body.data[0].id).toBe(propertyId2);
      expect(body.data[1].id).toBe(propertyId);

      // Verify savedAt ordering
      const savedAt0 = new Date(body.data[0].savedAt).getTime();
      const savedAt1 = new Date(body.data[1].savedAt).getTime();
      expect(savedAt0).toBeGreaterThanOrEqual(savedAt1);
    });

    it('should respect pagination (limit and offset)', async () => {
      // Get first page with limit=1
      const page1 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=0',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body1 = JSON.parse(page1.body);
      expect(body1.data.length).toBe(1);
      expect(body1.data[0].id).toBe(propertyId2);

      // Get second page with limit=1, offset=1
      const page2 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=1',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body2 = JSON.parse(page2.body);
      expect(body2.data.length).toBe(1);
      expect(body2.data[0].id).toBe(propertyId);

      // Get third page (empty)
      const page3 = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=1&offset=2',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body3 = JSON.parse(page3.body);
      expect(body3.data.length).toBe(0);
    });

    it('should return imageryGeometry for NL properties snapped to a nearby building', async () => {
      const imageryProperty = await createIntegrationProperty({
        countryCode: 'NL',
        street: 'Saved Imagery Street',
        houseNumber: 9,
        city: 'TestCity',
        postalCode: '1234AB',
        lon: 5.47,
        lat: 51.44025,
      });
      testPropertyIds.push(imageryProperty.id);

      const imageryBuilding = await createIntegrationOsmBuildingRectangle({
        minLon: 5.47035,
        minLat: 51.44015,
        maxLon: 5.47065,
        maxLat: 51.44045,
      });
      testOsmBuildingIds.push(imageryBuilding.osmId);

      const saveResponse = await app.inject({
        method: 'POST',
        url: `/properties/${imageryProperty.id}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(saveResponse.statusCode).toBe(201);

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/saved-properties?limit=10&offset=0',
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const savedProperty = body.data.find((item: { id: string }) => item.id === imageryProperty.id);

        expect(savedProperty).toBeDefined();
        expect(savedProperty.geometry.coordinates).toEqual([5.47, 51.44025]);
        expect(savedProperty.imageryGeometry).toBeDefined();
        expect(savedProperty.imageryGeometry.coordinates[0]).toBeGreaterThan(5.4703);
        expect(savedProperty.imageryGeometry.coordinates[0]).toBeLessThan(5.4707);
        expect(savedProperty.imageryGeometry.coordinates[1]).toBeGreaterThan(51.4401);
        expect(savedProperty.imageryGeometry.coordinates[1]).toBeLessThan(51.4405);
      } finally {
        await db.execute(sql`
          DELETE FROM saved_properties
          WHERE user_id = ${userId}
            AND property_id = ${imageryProperty.id}
        `);
      }
    });
  });

  describe('DELETE /properties/:id/save', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should unsave a property successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.saved).toBe(false);
    });

    it('should return 404 when unsaving a property not previously saved', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });
  });

  describe('GET /properties/:id (enriched isSaved after unsaving)', () => {
    it('should return isSaved=false after unsaving', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isSaved).toBe(false);
    });
  });

  describe('GET /saved-properties (after unsaving one)', () => {
    it('should only return the remaining saved property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // propertyId was unsaved, only propertyId2 remains
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(propertyId2);
    });
  });

  describe('GET /saved-properties (empty after unsaving all)', () => {
    it('should return empty array when no properties are saved', async () => {
      // Unsave the second property too
      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId2}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });
  });
});

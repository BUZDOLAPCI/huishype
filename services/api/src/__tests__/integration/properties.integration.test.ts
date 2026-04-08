import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

/**
 * Integration tests for property routes.
 *
 * Tests against the real PostGIS database seeded with Eindhoven data.
 */
describe('Property routes', () => {
  jest.setTimeout(60000);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /properties', () => {
    it('should return paginated data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('page');
      expect(body.meta).toHaveProperty('limit');
      expect(body.meta).toHaveProperty('total');
      expect(body.meta).toHaveProperty('totalPages');
      expect(body.meta.page).toBe(1);
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('should return properties with expected fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);

      const prop = body.data[0];
      expect(prop).toHaveProperty('id');
      expect(prop).toHaveProperty('address');
      expect(prop).toHaveProperty('city');
      expect(prop).toHaveProperty('status');
      expect(prop).toHaveProperty('createdAt');
      expect(prop).toHaveProperty('updatedAt');

      expect(typeof prop.id).toBe('string');
      expect(typeof prop.address).toBe('string');
      expect(typeof prop.city).toBe('string');
    });

    it('should filter by city=Eindhoven', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?city=Eindhoven&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);

      for (const prop of body.data) {
        expect(prop.city).toBe('Eindhoven');
      }
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeLessThanOrEqual(5);
      expect(body.meta.limit).toBe(5);
    });

    it('should support pagination (page 2 returns 200)', async () => {
      const page1Resp = await app.inject({
        method: 'GET',
        url: '/properties?page=1&limit=5',
      });
      const page2Resp = await app.inject({
        method: 'GET',
        url: '/properties?page=2&limit=5',
      });

      expect(page1Resp.statusCode).toBe(200);
      expect(page2Resp.statusCode).toBe(200);

      const page1 = JSON.parse(page1Resp.body);
      const page2 = JSON.parse(page2Resp.body);

      expect(page1.meta.page).toBe(1);
      expect(page2.meta.page).toBe(2);

      // Both pages should have data (DB has thousands of properties)
      expect(page1.data.length).toBeGreaterThan(0);
      expect(page2.data.length).toBeGreaterThan(0);
    });

    it('should filter by bounding box (Eindhoven area)', async () => {
      // Eindhoven bounding box (approx)
      const bbox = '5.43,51.40,5.52,51.47';
      const response = await app.inject({
        method: 'GET',
        url: `/properties?bbox=${bbox}&limit=5`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should support lat/lon radius queries', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?lat=52.3676&lon=4.9041&radius=5000&limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.meta.limit).toBe(10);
      expect(body.meta.total).toBeGreaterThanOrEqual(body.data.length);

      for (const prop of body.data) {
        expect(prop).toHaveProperty('id');
        expect(prop).toHaveProperty('address');
        expect(prop).toHaveProperty('city');
      }
    });

    it('should return 400 for limit > 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=500',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /properties/:id', () => {
    it('should return a single property by ID', async () => {
      // First get any property ID
      const listResp = await app.inject({
        method: 'GET',
        url: '/properties?limit=1',
      });
      const listBody = JSON.parse(listResp.body);
      const propertyId = listBody.data[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(propertyId);
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('city');
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should return imageryGeometry snapped to a nearby building surface point', async () => {
      const propertyId = crypto.randomUUID();
      const osmId = Number(`9${Date.now()}`.slice(0, 12));

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
          'Imagery Test Street',
          1,
          'TestCity',
          '1234AB',
          'active',
          ST_SetSRID(ST_MakePoint(5.47, 51.44025), 4326)
        )
      `);

      await db.execute(sql`
        INSERT INTO osm_buildings (osm_id, geometry)
        VALUES (
          ${osmId},
          ST_GeomFromText(
            'MULTIPOLYGON(((5.4703 51.4401, 5.4707 51.4401, 5.4707 51.4404, 5.4703 51.4404, 5.4703 51.4401)))',
            4326
          )
        )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/${propertyId}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body.geometry.coordinates[0]).toBeCloseTo(5.47, 6);
        expect(body.geometry.coordinates[1]).toBeCloseTo(51.44025, 6);
        expect(body.imageryGeometry.coordinates[0]).toBeGreaterThan(5.4703);
        expect(body.imageryGeometry.coordinates[0]).toBeLessThan(5.4707);
        expect(body.imageryGeometry.coordinates[1]).toBeGreaterThan(51.4401);
        expect(body.imageryGeometry.coordinates[1]).toBeLessThan(51.4405);
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
        await db.execute(sql`DELETE FROM osm_buildings WHERE osm_id = ${osmId}`);
      }
    }, 60000);

    it('returns the latest available active listing thumbnail even when the newest active listing has none', async () => {
      const propertyId = crypto.randomUUID();
      const olderListingId = crypto.randomUUID();
      const latestListingId = crypto.randomUUID();
      const thumbnailUrl = 'https://cdn.example.com/older-listing-thumb.jpg';

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
          'Thumbnail Fallback Street',
          42,
          'TestCity',
          '1234AB',
          'active',
          ST_SetSRID(ST_MakePoint(5.47, 51.44025), 4326)
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
          thumbnail_url,
          created_at,
          updated_at
        )
        VALUES
          (
            ${olderListingId},
            ${propertyId},
            'funda',
            'https://example.com/older-listing',
            'active',
            420000,
            ${thumbnailUrl},
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${latestListingId},
            ${propertyId},
            'funda',
            'https://example.com/latest-listing',
            'active',
            450000,
            NULL,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: `/properties/${propertyId}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body.askingPrice).toBe(450000);
        expect(body.thumbnailUrl).toBe(thumbnailUrl);
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });
  });

  describe('GET /properties/nearby', () => {
    it('should return the nearest grouped feature for Eindhoven center', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4697&lat=51.4416&zoom=14',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).not.toBeNull();
      expect(body).toHaveProperty('primary_property_id');
      expect(body).toHaveProperty('group_kind');
      expect(body).toHaveProperty('distanceMeters');
      expect(body).toHaveProperty('hasListing');
      expect(body).toHaveProperty('activityScore');
    });

    it('should expose thumbnailUrl and fall back to an older active thumbnail when the newest active listing has none', async () => {
      const propertyId = crypto.randomUUID();
      const thumbnailUrl = 'https://cdn.example.com/nearby-fallback-thumb.jpg';

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
          'Nearby Thumbnail Street',
          5,
          'RemoteCity',
          '9999ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(6.75, 53.2), 4326)
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
          thumbnail_url,
          created_at,
          updated_at
        )
        VALUES
          (
            ${crypto.randomUUID()},
            ${propertyId},
            'funda',
            'https://example.com/nearby-fallback-older',
            'active',
            410000,
            ${thumbnailUrl},
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${crypto.randomUUID()},
            ${propertyId},
            'funda',
            'https://example.com/nearby-fallback-latest',
            'active',
            435000,
            NULL,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/properties/nearby?lon=6.75&lat=53.2&zoom=20',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).not.toBeNull();
        expect(body.primary_property_id).toBe(propertyId);
        expect(body.thumbnailUrl).toBe(thumbnailUrl);
        expect(body.askingPrice).toBe(435000);
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      }
    });
  });

  describe('property thumbnailUrl contract on list, batch, and saved endpoints', () => {
    let propertyId: string;
    let userId: string;
    let accessToken: string;
    const thumbnailUrl = 'https://cdn.example.com/property-endpoint-thumb.jpg';

    beforeAll(async () => {
      propertyId = crypto.randomUUID();

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
          'Property Endpoint Street',
          8,
          'SavedCity',
          '8888ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(7.25, 53.45), 4326)
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
          thumbnail_url,
          created_at,
          updated_at
        )
        VALUES
          (
            ${crypto.randomUUID()},
            ${propertyId},
            'funda',
            'https://example.com/property-endpoint-older',
            'active',
            510000,
            ${thumbnailUrl},
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${crypto.randomUUID()},
            ${propertyId},
            'funda',
            'https://example.com/property-endpoint-latest',
            'active',
            545000,
            NULL,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      const uniqueId = `propthumb${Date.now()}`;
      const authResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: {
          idToken: `mock-google-${uniqueId}-gid${uniqueId}`,
        },
      });
      const authBody = JSON.parse(authResp.body);
      userId = authBody.session.user.id;
      accessToken = authBody.session.accessToken;

      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    afterAll(async () => {
      await db.execute(sql`DELETE FROM saved_properties WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM listings WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    });

    it('includes thumbnailUrl on GET /properties with the same active-thumbnail fallback', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?bbox=7.249,53.449,7.251,53.451&limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const property = body.data.find((item: { id: string }) => item.id === propertyId);

      expect(property).toBeDefined();
      expect(property.thumbnailUrl).toBe(thumbnailUrl);
      expect(property.askingPrice).toBe(545000);
    });

    it('includes thumbnailUrl on GET /properties/batch with the same active-thumbnail fallback', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/batch?ids=${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveLength(1);
      expect(body[0].thumbnailUrl).toBe(thumbnailUrl);
      expect(body[0].askingPrice).toBe(545000);
    });

    it('includes thumbnailUrl on GET /saved-properties with the same active-thumbnail fallback', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/saved-properties?limit=10&offset=0',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const property = body.data.find((item: { id: string }) => item.id === propertyId);

      expect(property).toBeDefined();
      expect(property.thumbnailUrl).toBe(thumbnailUrl);
      expect(property.askingPrice).toBe(545000);
    });
  });

  describe('GET /properties/:id enriched values', () => {
    let propertyId: string;
    let listingId: string;
    let userId: string;
    let accessToken: string;
    const extraUserIds: string[] = [];
    const commentIds: string[] = [];
    const guessIds: string[] = [];
    const viewIds: string[] = [];

    beforeAll(async () => {
      // Create a dedicated synthetic property so this test is fully hermetic
      // and doesn't interfere with other tests' seeded data
      propertyId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO properties (id, country_code, street, house_number, city, postal_code, status, geometry)
        VALUES (${propertyId}, 'NL', 'Enrichment Test Street', 99, 'TestCity', '1234AB', 'active', ST_SetSRID(ST_MakePoint(5.47, 51.44), 4326))
      `);

      // Create a listing for the property (some enriched fields may depend on it)
      listingId = crypto.randomUUID();
      const sourceUrl = `https://test.example.com/enrichment-hermetic-${Date.now()}`;
      await db.execute(sql`
        INSERT INTO listings (id, property_id, source_name, source_url, status, asking_price, created_at, updated_at)
        VALUES (${listingId}, ${propertyId}, 'test', ${sourceUrl}, 'active', 350000, NOW(), NOW())
      `);

      // Create primary test user
      const uniqueId = `enrichtest${Date.now()}`;
      const loginResp = await app.inject({
        method: 'POST',
        url: '/auth/google',
        payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
      });
      const loginBody = JSON.parse(loginResp.body);
      userId = loginBody.session.user.id;
      accessToken = loginBody.session.accessToken;

      // Create 2 extra users for price guesses (unique constraint: 1 guess per user per property)
      for (let i = 0; i < 2; i++) {
        const uid = `enrichextra${Date.now()}${i}`;
        const resp = await app.inject({
          method: 'POST',
          url: '/auth/google',
          payload: { idToken: `mock-google-${uid}-gid${uid}` },
        });
        const body = JSON.parse(resp.body);
        extraUserIds.push(body.session.user.id);
      }

      // Seed exactly 2 comments
      for (let i = 0; i < 2; i++) {
        const id = crypto.randomUUID();
        commentIds.push(id);
        await db.execute(sql`
          INSERT INTO comments (id, property_id, user_id, content, created_at, updated_at)
          VALUES (${id}, ${propertyId}, ${userId}, ${'Test comment ' + (i + 1)}, NOW(), NOW())
        `);
      }

      // Seed exactly 3 price guesses (one per user due to unique constraint)
      const allUserIds = [userId, ...extraUserIds];
      const prices = [250000, 300000, 350000];
      for (let i = 0; i < 3; i++) {
        const id = crypto.randomUUID();
        guessIds.push(id);
        await db.execute(sql`
          INSERT INTO price_guesses (id, property_id, user_id, guessed_price, is_meme_guess, created_at, updated_at)
          VALUES (${id}, ${propertyId}, ${allUserIds[i]}, ${prices[i]}, false, NOW(), NOW())
        `);
      }

      // Seed exactly 4 property views (all from the same user)
      for (let i = 0; i < 4; i++) {
        const id = crypto.randomUUID();
        viewIds.push(id);
        await db.execute(sql`
          INSERT INTO property_views (id, property_id, user_id, viewed_at)
          VALUES (${id}, ${propertyId}, ${userId}, NOW())
        `);
      }

      // Seed 1 like reaction from the primary user
      await db.execute(sql`
        INSERT INTO reactions (id, target_type, target_id, user_id, reaction_type, created_at)
        VALUES (${crypto.randomUUID()}, 'property', ${propertyId}, ${userId}, 'like', NOW())
      `);
    });

    afterAll(async () => {
      // Clean up in reverse dependency order
      await db.execute(sql`DELETE FROM reactions WHERE target_type = 'property' AND target_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM price_guesses WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM comments WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
      // Delete the listing and property (listing has ON DELETE CASCADE but explicit is clearer)
      await db.execute(sql`DELETE FROM listings WHERE id = ${listingId}`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);

      // Delete test users (cascade will clean up any remaining refs)
      const allIds = [userId, ...extraUserIds];
      for (const uid of allIds) {
        try {
          await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
        } catch {
          // Ignore — may already be cleaned up via cascade
        }
      }
    });

    it('should return exact enriched values for seeded engagement data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Exact engagement counts
      expect(body.commentCount).toBe(2);
      expect(body.guessCount).toBe(3);
      expect(body.viewCount).toBe(4);
      expect(body.uniqueViewers).toBe(1); // All 4 views from the same user
      expect(body.likeCount).toBe(1);
      expect(body.isLiked).toBe(true); // Requesting user made the like

      // Activity level: recentViews=4, commentCount=2, guessCount=3
      // guessCount(3) > 1 → 'warm'
      expect(body.activityLevel).toBe('warm');

      // FMV assertions
      expect(body.fmv).toBeDefined();
      expect(body.fmv.guessCount).toBe(3);
      expect(body.fmv.confidence).toBe('medium'); // 3-9 guesses → medium
      expect(typeof body.fmv.fmv).toBe('number');

      // Distribution should exist with 3 guesses
      expect(body.fmv.distribution).not.toBeNull();
      expect(body.fmv.distribution).toHaveProperty('p10');
      expect(body.fmv.distribution).toHaveProperty('p25');
      expect(body.fmv.distribution).toHaveProperty('p50');
      expect(body.fmv.distribution).toHaveProperty('p75');
      expect(body.fmv.distribution).toHaveProperty('p90');
      expect(body.fmv.distribution).toHaveProperty('min');
      expect(body.fmv.distribution).toHaveProperty('max');

      // Min/max should reflect seeded prices
      expect(body.fmv.distribution.min).toBe(250000);
      expect(body.fmv.distribution.max).toBe(350000);
    });

    it('should show isLiked=false for unauthenticated request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Counts should still be the same
      expect(body.commentCount).toBe(2);
      expect(body.guessCount).toBe(3);
      expect(body.likeCount).toBe(1);

      // But isLiked should be false for unauthenticated
      expect(body.isLiked).toBe(false);
    });
  });
});

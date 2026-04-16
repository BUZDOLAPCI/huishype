import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, reactions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { createIntegrationProperty } from './helpers/fixtures.js';

describe('Activity routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `acttest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    const property = await createIntegrationProperty({
      street: 'Activity Fixture Street',
      houseNumber: 1,
      city: 'Activity City',
      postalCode: '9020AA',
      lon: 5.4702,
      lat: 51.4402,
    });
    propertyId = property.id;

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    await app.close();
  });

  describe('GET /activity (public)', () => {
    it('should return activity items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('offset');
      expect(body.pagination).toHaveProperty('hasMore');
    });

    it('should not include save events in public activity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=50',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const saveEvents = body.items.filter((i: { eventType: string }) => i.eventType === 'save');
      expect(saveEvents.length).toBe(0);
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(2);
    });

    it('should have proper item structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      if (body.items.length > 0) {
        const item = body.items[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('eventType');
        expect(item).toHaveProperty('actor');
        expect(item.actor).toHaveProperty('id');
        expect(item.actor).toHaveProperty('displayName');
        expect(item.actor).toHaveProperty('handle');
        expect(item).toHaveProperty('property');
        expect(item.property).toHaveProperty('id');
        expect(item.property).toHaveProperty('address');
        expect(item).toHaveProperty('createdAt');
      }
    });
  });

  describe('GET /users/me/activity (personal)', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return personal activity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      // Should include the like we made
      if (propertyId) {
        const likeEvents = body.items.filter(
          (i: { eventType: string }) => i.eventType === 'property_like'
        );
        expect(likeEvents.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should include save events in personal activity', async () => {
      // Save a property first
      if (propertyId) {
        await app.inject({
          method: 'POST',
          url: `/properties/${propertyId}/save`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/users/me/activity',
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const saveEvents = body.items.filter(
          (i: { eventType: string }) => i.eventType === 'save'
        );
        expect(saveEvents.length).toBeGreaterThanOrEqual(1);

        // Clean up save
        await app.inject({
          method: 'DELETE',
          url: `/properties/${propertyId}/save`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
      }
    });

    it('should expose thumbnailUrl using the newest active non-null listing thumbnail fallback', async () => {
      const syntheticPropertyId = crypto.randomUUID();
      const thumbnailUrl = 'https://cdn.example.com/activity-fallback-thumb.jpg';

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
          ${syntheticPropertyId},
          'NL',
          'Activity Thumbnail Street',
          3,
          'ActivityCity',
          '6666ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(5.91, 51.99), 4326)
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
            ${syntheticPropertyId},
            'funda',
            'https://example.com/activity-older',
            'active',
            310000,
            ${thumbnailUrl},
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${crypto.randomUUID()},
            ${syntheticPropertyId},
            'funda',
            'https://example.com/activity-latest',
            'active',
            335000,
            NULL,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      await app.inject({
        method: 'POST',
        url: `/properties/${syntheticPropertyId}/like`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/users/me/activity?limit=50',
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const event = body.items.find(
          (item: { property: { id: string } }) => item.property.id === syntheticPropertyId
        );

        expect(event).toBeDefined();
        expect(event.property.thumbnailUrl).toBe(thumbnailUrl);
      } finally {
        await db.execute(sql`
          DELETE FROM reactions
          WHERE target_type = 'property'
            AND target_id = ${syntheticPropertyId}
            AND user_id = ${userId}
        `);
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${syntheticPropertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${syntheticPropertyId}`);
      }
    });
  });
});

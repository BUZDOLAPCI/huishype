import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  comments,
  priceGuesses,
  reactions,
  savedProperties,
  userFollows,
  users,
} from '../../db/schema.js';
import { createIntegrationProperty, createIntegrationUser } from './helpers/fixtures.js';

describe('Activity routes', () => {
  let app: FastifyInstance;
  let viewerUserId: string;
  let viewerAccessToken: string;
  let followedUserId: string;
  let followedAccessToken: string;
  let otherUserId: string;
  let otherAccessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const viewer = await createIntegrationUser(app, { label: 'activity-viewer' });
    viewerUserId = viewer.userId;
    viewerAccessToken = viewer.accessToken;
    testUserIds.push(viewer.userId);

    const followed = await createIntegrationUser(app, { label: 'activity-followed' });
    followedUserId = followed.userId;
    followedAccessToken = followed.accessToken;
    testUserIds.push(followed.userId);

    const other = await createIntegrationUser(app, { label: 'activity-other' });
    otherUserId = other.userId;
    otherAccessToken = other.accessToken;
    testUserIds.push(other.userId);

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
      headers: { authorization: `Bearer ${viewerAccessToken}` },
    });

    await app.inject({
      method: 'PUT',
      url: `/users/${followedUserId}/follow`,
      headers: { authorization: `Bearer ${viewerAccessToken}` },
    });

    await db.insert(comments).values([
      {
        id: crypto.randomUUID(),
        userId: followedUserId,
        propertyId,
        content: 'Followed user comment',
      },
      {
        id: crypto.randomUUID(),
        userId: otherUserId,
        propertyId,
        content: 'Unfollowed user comment',
      },
    ]);

    await db.insert(priceGuesses).values({
      id: crypto.randomUUID(),
      userId: followedUserId,
      propertyId,
      guessedPrice: 325000,
      isMemeGuess: false,
    });

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/save`,
      headers: { authorization: `Bearer ${followedAccessToken}` },
    });

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${otherAccessToken}` },
    });
  });

  afterAll(async () => {
    for (const userId of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, userId));
        await db.delete(savedProperties).where(eq(savedProperties.userId, userId));
        await db.delete(comments).where(eq(comments.userId, userId));
        await db.delete(priceGuesses).where(eq(priceGuesses.userId, userId));
        await db.delete(userFollows).where(eq(userFollows.followerUserId, userId));
        await db.delete(userFollows).where(eq(userFollows.followedUserId, userId));
        await db.delete(users).where(eq(users.id, userId));
      } catch {
        // Ignore cleanup races from cascading deletes.
      }
    }

    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    await app.close();
  });

  describe('GET /activity', () => {
    it('returns public activity items with the normalized property payload', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toEqual(
        expect.objectContaining({
          limit: 1,
          offset: 0,
          hasMore: expect.any(Boolean),
        })
      );

      if (body.items.length > 0) {
        expect(body.items[0].eventType).not.toBe('save');
        expect(body.items[0].property).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            address: expect.any(String),
            streetName: expect.any(String),
            houseNumber: expect.any(Number),
            houseNumberAddition: null,
            city: expect.any(String),
            postalCode: expect.any(String),
            countryCode: expect.any(String),
          })
        );
      }
    });

    it('keeps public activity newest-first and excludes save events', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?limit=50',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.every((item: { eventType: string }) => item.eventType !== 'save')).toBe(
        true
      );

      const createdAtValues = body.items.map((item: { createdAt: string }) =>
        Date.parse(item.createdAt)
      );
      expect(createdAtValues).toEqual([...createdAtValues].sort((left, right) => right - left));
    });

    it('returns 401 for following scope without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?scope=following',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    });

    it('filters following scope to followed-user activity and still excludes saves', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity?scope=following&limit=50',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThan(0);
      expect(
        body.items.every((item: { actor: { id: string } }) => item.actor.id === followedUserId)
      ).toBe(true);
      expect(body.items.some((item: { eventType: string }) => item.eventType === 'comment')).toBe(
        true
      );
      expect(
        body.items.some((item: { eventType: string }) => item.eventType === 'price_guess')
      ).toBe(true);
      expect(body.items.every((item: { eventType: string }) => item.eventType !== 'save')).toBe(
        true
      );
    });
  });

  describe('GET /users/me/activity', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns personal activity and includes save events only on the self route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/me/activity?limit=50',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      expect(
        body.items.some((item: { eventType: string }) => item.eventType === 'property_like')
      ).toBe(true);

      await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      const withSaveResponse = await app.inject({
        method: 'GET',
        url: '/users/me/activity?limit=50',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      const withSaveBody = JSON.parse(withSaveResponse.body);
      expect(
        withSaveBody.items.some((item: { eventType: string }) => item.eventType === 'save')
      ).toBe(true);

      await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}/save`,
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });
    });

    it('exposes thumbnailUrl using the newest active non-null listing thumbnail fallback', async () => {
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
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/users/me/activity?limit=50',
          headers: { authorization: `Bearer ${viewerAccessToken}` },
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
            AND user_id = ${viewerUserId}
        `);
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${syntheticPropertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${syntheticPropertyId}`);
      }
    });
  });
});

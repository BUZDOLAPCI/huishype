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
import {
  createIntegrationFollow,
  createIntegrationListing,
  createIntegrationProperty,
  createIntegrationUser,
} from './helpers/fixtures.js';

describe('Activity routes', () => {
  let app: FastifyInstance;
  let viewerUserId: string;
  let viewerAccessToken: string;
  let followedUserId: string;
  let otherUserId: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const activityEventIds = {
    viewerLike: crypto.randomUUID(),
    followedComment: crypto.randomUUID(),
    otherComment: crypto.randomUUID(),
    hiddenComment: crypto.randomUUID(),
    viewerFollowedCommentLike: crypto.randomUUID(),
    viewerOtherCommentLike: crypto.randomUUID(),
    followedGuess: crypto.randomUUID(),
    followedSave: crypto.randomUUID(),
    otherLike: crypto.randomUUID(),
  };
  const timeline = {
    followCreatedAt: new Date('2035-01-01T09:00:00.000Z'),
    viewerLikeCreatedAt: new Date('2035-01-01T10:00:00.000Z'),
    followedCommentCreatedAt: new Date('2035-01-01T11:00:00.000Z'),
    otherCommentCreatedAt: new Date('2035-01-01T11:30:00.000Z'),
    hiddenCommentCreatedAt: new Date('2035-01-01T11:45:00.000Z'),
    followedGuessUpdatedAt: new Date('2035-01-01T12:00:00.000Z'),
    followedSaveCreatedAt: new Date('2035-01-01T12:30:00.000Z'),
    otherLikeCreatedAt: new Date('2035-01-01T13:00:00.000Z'),
    viewerSaveCreatedAt: new Date('2035-01-01T14:00:00.000Z'),
  };

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const viewer = await createIntegrationUser(app, { label: 'activity-viewer' });
    viewerUserId = viewer.userId;
    viewerAccessToken = viewer.accessToken;
    testUserIds.push(viewer.userId);

    const followed = await createIntegrationUser(app, { label: 'activity-followed' });
    followedUserId = followed.userId;
    testUserIds.push(followed.userId);

    const other = await createIntegrationUser(app, { label: 'activity-other' });
    otherUserId = other.userId;
    testUserIds.push(other.userId);

    const property = await createIntegrationProperty({
      street: 'Activity Fixture Street',
      houseNumber: 1,
      city: 'Activity City',
      postalCode: '9020AA',
      lon: 5.4702,
      lat: 51.4402,
      officialValuation: 312000,
      officialValuationYear: 2024,
      yearBuilt: 1984,
      floorAreaM2: 91,
    });
    propertyId = property.id;
    await createIntegrationListing({
      propertyId,
      askingPrice: 350000,
      priceType: 'sale',
      createdAt: new Date('2034-12-30T10:00:00.000Z'),
      updatedAt: new Date('2034-12-30T10:00:00.000Z'),
    });

    await db.insert(reactions).values({
      id: activityEventIds.viewerLike,
      targetType: 'property',
      targetId: propertyId,
      userId: viewerUserId,
      reactionType: 'like',
      createdAt: timeline.viewerLikeCreatedAt,
    });

    await createIntegrationFollow({
      followerUserId: viewerUserId,
      followedUserId,
      createdAt: timeline.followCreatedAt,
    });

    await db.insert(comments).values([
      {
        id: activityEventIds.followedComment,
        userId: followedUserId,
        propertyId,
        content: 'Followed user comment',
        createdAt: timeline.followedCommentCreatedAt,
        updatedAt: timeline.followedCommentCreatedAt,
      },
      {
        id: activityEventIds.otherComment,
        userId: otherUserId,
        propertyId,
        content: 'Unfollowed user comment',
        createdAt: timeline.otherCommentCreatedAt,
        updatedAt: timeline.otherCommentCreatedAt,
      },
      {
        id: activityEventIds.hiddenComment,
        userId: followedUserId,
        propertyId,
        content: 'Hidden followed user comment',
        hiddenAt: new Date('2035-01-01T11:50:00.000Z'),
        createdAt: timeline.hiddenCommentCreatedAt,
        updatedAt: timeline.hiddenCommentCreatedAt,
      },
    ]);

    await db.insert(reactions).values([
      {
        id: activityEventIds.viewerFollowedCommentLike,
        targetType: 'comment',
        targetId: activityEventIds.followedComment,
        userId: viewerUserId,
        reactionType: 'like',
        createdAt: new Date('2035-01-01T11:10:00.000Z'),
      },
      {
        id: activityEventIds.viewerOtherCommentLike,
        targetType: 'comment',
        targetId: activityEventIds.otherComment,
        userId: viewerUserId,
        reactionType: 'like',
        createdAt: new Date('2035-01-01T11:40:00.000Z'),
      },
    ]);

    await db.insert(priceGuesses).values({
      id: activityEventIds.followedGuess,
      userId: followedUserId,
      propertyId,
      guessedPrice: 325000,
      isMemeGuess: false,
      createdAt: timeline.followedCommentCreatedAt,
      updatedAt: timeline.followedGuessUpdatedAt,
    });

    await db.insert(savedProperties).values({
      id: activityEventIds.followedSave,
      userId: followedUserId,
      propertyId,
      createdAt: timeline.followedSaveCreatedAt,
    });

    await db.insert(reactions).values({
      id: activityEventIds.otherLike,
      targetType: 'property',
      targetId: propertyId,
      userId: otherUserId,
      reactionType: 'like',
      createdAt: timeline.otherLikeCreatedAt,
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
        url: '/activity?limit=5',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=15, stale-while-revalidate=30'
      );
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toEqual(
        expect.objectContaining({
          limit: 5,
          offset: 0,
          hasMore: expect.any(Boolean),
        })
      );
      expect(body.items.slice(0, 5).map((item: { id: string }) => item.id)).toEqual([
        activityEventIds.otherLike,
        activityEventIds.followedGuess,
        activityEventIds.otherComment,
        activityEventIds.followedComment,
        activityEventIds.viewerLike,
      ]);
      expect(body.items[0].eventType).toBe('property_like');
      expect(body.items[0].property).toEqual(
        expect.objectContaining({
          id: propertyId,
          address: expect.any(String),
          streetName: 'Activity Fixture Street',
          houseNumber: 1,
          houseNumberAddition: null,
          city: 'Activity City',
          postalCode: '9020AA',
          countryCode: 'NL',
          geometry: {
            type: 'Point',
            coordinates: [5.4702, 51.4402],
          },
        })
      );
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
        url: '/activity?scope=following&limit=10',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = JSON.parse(response.body);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        activityEventIds.followedGuess,
        activityEventIds.followedComment,
      ]);
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

  describe('GET /users/:id/activity', () => {
    it('returns only one user public activity, excluding saves and hidden comments', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/users/${followedUserId}/activity?limit=10`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=15, stale-while-revalidate=30'
      );
      const body = JSON.parse(response.body);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        activityEventIds.followedGuess,
        activityEventIds.followedComment,
      ]);
      expect(
        body.items.every((item: { actor: { id: string } }) => item.actor.id === followedUserId)
      ).toBe(true);
      expect(body.items.every((item: { eventType: string }) => item.eventType !== 'save')).toBe(
        true
      );
      expect(body.items.some((item: { id: string }) => item.id === activityEventIds.hiddenComment))
        .toBe(false);
    });

    it('paginates public user activity', async () => {
      const firstPage = await app.inject({
        method: 'GET',
        url: `/users/${followedUserId}/activity?limit=1&offset=0`,
      });
      const secondPage = await app.inject({
        method: 'GET',
        url: `/users/${followedUserId}/activity?limit=1&offset=1`,
      });

      expect(firstPage.statusCode).toBe(200);
      expect(secondPage.statusCode).toBe(200);
      expect(JSON.parse(firstPage.body)).toEqual(
        expect.objectContaining({
          items: [expect.objectContaining({ id: activityEventIds.followedGuess })],
          pagination: {
            limit: 1,
            offset: 0,
            hasMore: true,
          },
        })
      );
      expect(JSON.parse(secondPage.body)).toEqual(
        expect.objectContaining({
          items: [expect.objectContaining({ id: activityEventIds.followedComment })],
          pagination: {
            limit: 1,
            offset: 1,
            hasMore: false,
          },
        })
      );
    });

    it('returns 404 for missing users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/users/a0000000-0000-4000-a000-000000000099/activity',
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    });
  });

  describe('GET /activity/properties', () => {
    it('groups public activity by property with aggregated counts, recent actors, and comment-first previews', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity/properties?limit=10',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=15, stale-while-revalidate=30'
      );

      const body = JSON.parse(response.body);
      const groupedItem = body.items.find(
        (item: { property: { id: string } }) => item.property.id === propertyId
      );

      expect(groupedItem).toBeDefined();
      expect(groupedItem).toEqual(
        expect.objectContaining({
          property: expect.objectContaining({
            id: propertyId,
            streetName: 'Activity Fixture Street',
            askingPrice: 350000,
            officialValuation: 312000,
            officialValuationYear: 2024,
            officialValuationSourceFetch: {
              source: 'woz',
              expectedValuationYear: expect.any(Number),
              supportsClientFetch: {
                web: expect.any(Boolean),
                native: expect.any(Boolean),
              },
            },
            marketState: 'for-sale',
            hasListing: true,
            yearBuilt: 1984,
            floorAreaM2: 91,
            isLiked: false,
            isSaved: false,
          }),
          lastActivityAt: timeline.otherLikeCreatedAt.toISOString(),
          counts: {
            likeCount: 2,
            commentCount: 2,
            guessCount: 1,
          },
        })
      );
      expect(groupedItem.recentActors.map((actor: { id: string }) => actor.id)).toEqual([
        otherUserId,
        followedUserId,
        viewerUserId,
      ]);
      expect(groupedItem.preview).toEqual({
        kind: 'comment',
        commentId: activityEventIds.otherComment,
        createdAt: timeline.otherCommentCreatedAt.toISOString(),
        actor: expect.objectContaining({
          id: otherUserId,
          displayName: expect.any(String),
        }),
        contentPreview: 'Unfollowed user comment',
        likeCount: 1,
        isLiked: false,
      });
    });

    it('returns authenticated public grouped property posts with viewer-specific property and preview state', async () => {
      const viewerSaveId = crypto.randomUUID();

      await db.insert(savedProperties).values({
        id: viewerSaveId,
        userId: viewerUserId,
        propertyId,
        createdAt: new Date('2035-01-01T14:30:00.000Z'),
      });

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/activity/properties?limit=10',
          headers: { authorization: `Bearer ${viewerAccessToken}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('private, no-store');
        const body = JSON.parse(response.body);
        const groupedItem = body.items.find(
          (item: { property: { id: string } }) => item.property.id === propertyId
        );

        expect(groupedItem).toBeDefined();
        expect(groupedItem.property).toEqual(
          expect.objectContaining({
            id: propertyId,
            askingPrice: 350000,
            marketState: 'for-sale',
            hasListing: true,
            isLiked: true,
            isSaved: true,
          })
        );
        expect(groupedItem.preview).toEqual(
          expect.objectContaining({
            kind: 'comment',
            commentId: activityEventIds.otherComment,
            likeCount: 1,
            isLiked: true,
          })
        );
      } finally {
        await db.delete(savedProperties).where(eq(savedProperties.id, viewerSaveId));
      }
    });

    it('returns 401 for following scope without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=following',
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    });

    it('filters following scope to followed-user grouped property posts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=following&limit=10',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = JSON.parse(response.body);

      expect(body.items).toHaveLength(1);
      expect(body.items[0].counts).toEqual({
        likeCount: 0,
        commentCount: 1,
        guessCount: 1,
      });
      expect(body.items[0].property).toEqual(
        expect.objectContaining({
          id: propertyId,
          isLiked: true,
          isSaved: false,
        })
      );
      expect(body.items[0].recentActors).toEqual([
        expect.objectContaining({
          id: followedUserId,
        }),
      ]);
      expect(body.items[0].preview).toEqual({
        kind: 'comment',
        commentId: activityEventIds.followedComment,
        createdAt: timeline.followedCommentCreatedAt.toISOString(),
        actor: expect.objectContaining({
          id: followedUserId,
        }),
        contentPreview: 'Followed user comment',
        likeCount: 1,
        isLiked: true,
      });
    });

    it('applies shared price, status, and area filters to public grouped property posts', async () => {
      const matchingResponse = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=public&limit=10&marketState=for-sale&salePriceTo=360000&area=postcode:NL:9020aa',
      });
      const excludedResponse = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=public&limit=10&marketState=for-sale&salePriceTo=300000',
      });

      expect(matchingResponse.statusCode).toBe(200);
      const matchingBody = JSON.parse(matchingResponse.body);
      expect(
        matchingBody.items.some(
          (item: { property: { id: string } }) => item.property.id === propertyId
        )
      ).toBe(true);

      expect(excludedResponse.statusCode).toBe(200);
      const excludedBody = JSON.parse(excludedResponse.body);
      expect(
        excludedBody.items.some(
          (item: { property: { id: string } }) => item.property.id === propertyId
        )
      ).toBe(false);
    });

    it('applies shared price, status, and area filters to following grouped property posts', async () => {
      const matchingResponse = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=following&limit=10&marketState=for-sale&salePriceTo=360000&area=postcode:NL:9020aa',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });
      const excludedResponse = await app.inject({
        method: 'GET',
        url: '/activity/properties?scope=following&limit=10&marketState=for-sale&salePriceTo=300000',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(matchingResponse.statusCode).toBe(200);
      expect(JSON.parse(matchingResponse.body).items).toEqual([
        expect.objectContaining({
          property: expect.objectContaining({ id: propertyId }),
          counts: {
            likeCount: 0,
            commentCount: 1,
            guessCount: 1,
          },
        }),
      ]);

      expect(excludedResponse.statusCode).toBe(200);
      expect(JSON.parse(excludedResponse.body).items).toHaveLength(0);
    });

    it('orders grouped properties by latest activity and paginates grouped rows', async () => {
      const secondProperty = await createIntegrationProperty({
        street: 'Grouped Activity Avenue',
        houseNumber: 9,
        city: 'Second City',
        postalCode: '9030BB',
        lon: 5.571,
        lat: 51.55,
      });
      const latestGroupEventId = crypto.randomUUID();

      await db.insert(reactions).values({
        id: latestGroupEventId,
        targetType: 'property',
        targetId: secondProperty.id,
        userId: followedUserId,
        reactionType: 'like',
        createdAt: new Date('2035-01-01T15:00:00.000Z'),
      });

      try {
        const firstPageResponse = await app.inject({
          method: 'GET',
          url: '/activity/properties?scope=following&limit=1&offset=0',
          headers: { authorization: `Bearer ${viewerAccessToken}` },
        });
        expect(firstPageResponse.statusCode).toBe(200);
        const firstPageBody = JSON.parse(firstPageResponse.body);
        expect(firstPageBody.pagination).toEqual({
          limit: 1,
          offset: 0,
          hasMore: true,
        });
        expect(firstPageBody.items).toHaveLength(1);
        expect(firstPageBody.items[0].property.id).toBe(secondProperty.id);
        expect(firstPageBody.items[0].preview).toEqual({
          kind: 'summary',
          eventType: 'property_like',
          createdAt: '2035-01-01T15:00:00.000Z',
          actor: expect.objectContaining({
            id: followedUserId,
          }),
          summary: expect.stringContaining('liked this property'),
        });

        const secondPageResponse = await app.inject({
          method: 'GET',
          url: '/activity/properties?scope=following&limit=1&offset=1',
          headers: { authorization: `Bearer ${viewerAccessToken}` },
        });
        expect(secondPageResponse.statusCode).toBe(200);
        const secondPageBody = JSON.parse(secondPageResponse.body);
        expect(secondPageBody.pagination).toEqual({
          limit: 1,
          offset: 1,
          hasMore: false,
        });
        expect(secondPageBody.items).toHaveLength(1);
        expect(secondPageBody.items[0].property.id).toBe(propertyId);
      } finally {
        await db.delete(reactions).where(eq(reactions.id, latestGroupEventId));
        await db.execute(sql`DELETE FROM properties WHERE id = ${secondProperty.id}`);
      }
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
        url: '/users/me/activity?limit=10',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = JSON.parse(response.body);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        activityEventIds.viewerLike,
      ]);

      const viewerSaveId = crypto.randomUUID();
      await db.insert(savedProperties).values({
        id: viewerSaveId,
        userId: viewerUserId,
        propertyId,
        createdAt: timeline.viewerSaveCreatedAt,
      });

      const withSaveResponse = await app.inject({
        method: 'GET',
        url: '/users/me/activity?limit=10',
        headers: { authorization: `Bearer ${viewerAccessToken}` },
      });

      expect(withSaveResponse.headers['cache-control']).toBe('private, no-store');
      const withSaveBody = JSON.parse(withSaveResponse.body);
      expect(withSaveBody.items.map((item: { id: string }) => item.id)).toEqual([
        viewerSaveId,
        activityEventIds.viewerLike,
      ]);
      expect(withSaveBody.items[0].eventType).toBe('save');

      await db.delete(savedProperties).where(eq(savedProperties.id, viewerSaveId));
    });

    it('exposes thumbnailUrl using the listing thumbnail fallback', async () => {
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
        INSERT INTO canonical_listings (
          id,
          property_id,
          source_name,
          canonical_url,
          display_url,
          status,
          status_source,
          verification_state,
          origin_summary,
          asking_price,
          thumbnail_url,
          price_type,
          first_seen_at,
          last_seen_at,
          last_reconciled_at,
          created_at,
          updated_at
        )
        VALUES
          (
            ${crypto.randomUUID()},
            ${syntheticPropertyId},
            'funda',
            'https://example.com/activity-older',
            'https://example.com/activity-older',
            'active',
            'mirror',
            'validated',
            'mirror',
            310000,
            ${thumbnailUrl},
            'sale',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${crypto.randomUUID()},
            ${syntheticPropertyId},
            'funda',
            'https://example.com/activity-latest',
            'https://example.com/activity-latest',
            'active',
            'mirror',
            'validated',
            'mirror',
            335000,
            NULL,
            'sale',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day',
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
        await db.execute(sql`DELETE FROM properties WHERE id = ${syntheticPropertyId}`);
      }
    });

    it('exposes thumbnailUrl from sold listings when no active thumbnail exists', async () => {
      const property = await createIntegrationProperty({
        street: 'Activity Sold Thumbnail Street',
        houseNumber: 4,
        city: 'ActivityCity',
        postalCode: '6666ZY',
        lon: 5.92,
        lat: 52.0,
      });
      const thumbnailUrl = 'https://cdn.example.com/activity-sold-thumb.jpg';

      await createIntegrationListing({
        propertyId: property.id,
        status: 'active',
        askingPrice: 340000,
        thumbnailUrl: null,
        sourceUrl: `https://example.com/activity-active-no-thumb-${property.id}`,
      });
      await createIntegrationListing({
        propertyId: property.id,
        status: 'sold',
        askingPrice: 330000,
        thumbnailUrl,
        sourceUrl: `https://example.com/activity-sold-thumb-${property.id}`,
      });

      await app.inject({
        method: 'POST',
        url: `/properties/${property.id}/like`,
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
          (item: { property: { id: string } }) => item.property.id === property.id
        );

        expect(event).toBeDefined();
        expect(event.property.thumbnailUrl).toBe(thumbnailUrl);
      } finally {
        await db.execute(sql`
          DELETE FROM reactions
          WHERE target_type = 'property'
            AND target_id = ${property.id}
            AND user_id = ${viewerUserId}
        `);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
      }
    });
  });
});

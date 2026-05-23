import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { resetFeedCacheForTests } from '../../routes/feed.js';
import {
  createIntegrationListing,
  createIntegrationProperty,
  createIntegrationUser,
  refreshLatestActiveListingsView,
} from './helpers/fixtures.js';

/**
 * Integration tests for the feed endpoint.
 *
 * This suite owns a dedicated feed slice in the real test database so the
 * feed queries, ordering, pagination, and materialized-view behavior are
 * asserted against explicit fixtures instead of ambient shared listings.
 */
describe('Feed routes', () => {
  jest.setTimeout(60000);

  let app: FastifyInstance;

  const cleanupPropertyIds: string[] = [];
  const cleanupUserIds: string[] = [];
  const runId = Date.now();
  const fixtureBaseTime = new Date(runId);
  fixtureBaseTime.setMilliseconds(0);
  const coordinateSeed = runId + process.pid * 997;
  const slice = {
    // Keep the feed suite out of the heavily used NL integration fixture
    // space so pagination assertions stay hermetic during the full API gate.
    country: 'FI',
    lon: -170 + (coordinateSeed % 100) * 1.5,
    lat: -70 + (Math.floor(coordinateSeed / 100) % 80) * 1.5,
  };

  type FeedFixtureKey = 'recent' | 'hot' | 'warm' | 'like' | 'cold' | 'outsideRadius';
  type FeedFixture = {
    propertyId: string;
    address: string;
    city: string;
    zipCode: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    askingPrice: number;
    officialValuation: number | null;
    officialValuationYear: number | null;
    thumbnailUrl: string | null;
    marketState: 'for-sale' | 'for-rent';
    lastActivityAt: string;
    commentCount: number;
    guessCount: number;
    likeCount: number;
    viewCount: number;
    fmv: number | null;
  };
  const feedFixtures = {} as Record<FeedFixtureKey, FeedFixture>;
  let noListingPropertyId: string;

  beforeEach(() => {
    resetFeedCacheForTests();
  });

  function atOffset({
    days = 0,
    hours = 0,
    minutes = 0,
  }: {
    days?: number;
    hours?: number;
    minutes?: number;
  }) {
    const date = new Date(
      fixtureBaseTime.getTime() - ((days * 24 + hours) * 60 + minutes) * 60 * 1000
    );
    return date;
  }

  function buildAddress(street: string, houseNumber: number, postalCode: string, city: string) {
    return `${street} ${houseNumber}, ${postalCode} ${city}`;
  }

  function buildFeedUrl(params: Record<string, string | number | undefined> = {}) {
    const query = new URLSearchParams({
      country: slice.country,
      lat: String(slice.lat),
      lon: String(slice.lon),
    });

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        query.set(key, String(value));
      }
    }

    return `/feed?${query.toString()}`;
  }

  async function insertComment(
    propertyId: string,
    userId: string,
    createdAt: Date,
    content: string
  ) {
    const commentId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO comments (id, property_id, user_id, content, created_at, updated_at)
      VALUES (${commentId}, ${propertyId}, ${userId}, ${content}, ${createdAt.toISOString()}, ${createdAt.toISOString()})
    `);
    return commentId;
  }

  async function insertGuess(
    propertyId: string,
    userId: string,
    guessedPrice: number,
    createdAt: Date
  ) {
    await db.execute(sql`
      INSERT INTO price_guesses (
        id,
        property_id,
        user_id,
        guessed_price,
        is_meme_guess,
        created_at,
        updated_at
      )
      VALUES (
        ${crypto.randomUUID()},
        ${propertyId},
        ${userId},
        ${guessedPrice},
        false,
        ${createdAt.toISOString()},
        ${createdAt.toISOString()}
      )
    `);
  }

  async function insertPropertyLike(propertyId: string, userId: string, createdAt: Date) {
    await db.execute(sql`
      INSERT INTO reactions (id, target_type, target_id, user_id, reaction_type, created_at)
      VALUES (${crypto.randomUUID()}, 'property', ${propertyId}, ${userId}, 'like', ${createdAt.toISOString()})
    `);
  }

  async function insertCommentLike(commentId: string, userId: string, createdAt: Date) {
    await db.execute(sql`
      INSERT INTO reactions (id, target_type, target_id, user_id, reaction_type, created_at)
      VALUES (${crypto.randomUUID()}, 'comment', ${commentId}, ${userId}, 'like', ${createdAt.toISOString()})
    `);
  }

  async function insertView(
    propertyId: string,
    createdAt: Date,
    options: { userId?: string; sessionId?: string } = {}
  ) {
    await db.execute(sql`
      INSERT INTO property_views (id, property_id, user_id, session_id, viewed_at)
      VALUES (
        ${crypto.randomUUID()},
        ${propertyId},
        ${options.userId ?? null},
        ${options.sessionId ?? null},
        ${createdAt.toISOString()}
      )
    `);
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const viewExists = await db.execute<{ exists: string | null }>(sql`
      SELECT to_regclass('public.mv_latest_active_listings')::text AS exists
    `);
    expect(Array.from(viewExists)[0]?.exists).toBe('mv_latest_active_listings');

    const primaryUser = await createIntegrationUser(app, { label: `feedprimary${runId}` });
    const secondaryUser = await createIntegrationUser(app, { label: `feedsecondary${runId}` });
    const tertiaryUser = await createIntegrationUser(app, { label: `feedtertiary${runId}` });
    cleanupUserIds.push(primaryUser.userId, secondaryUser.userId, tertiaryUser.userId);

    const fixtureDefinitions = [
      {
        key: 'recent' as const,
        street: `Feed Recent ${runId}`,
        houseNumber: 1,
        postalCode: '9811AA',
        city: `Feed City ${runId}`,
        lon: slice.lon,
        lat: slice.lat,
        askingPrice: 410000,
        officialValuation: 405000,
        officialValuationYear: 2021,
        thumbnailUrl: 'https://cdn.example.com/feed-recent.jpg',
        priceType: 'sale',
        marketState: 'for-sale' as const,
        listingCreatedAt: atOffset({ minutes: 5 }),
        lastActivityAt: atOffset({ minutes: 5 }),
        commentCount: 0,
        guessCount: 0,
        likeCount: 0,
        viewCount: 0,
        fmv: null,
      },
      {
        key: 'hot' as const,
        street: `Feed Hot ${runId}`,
        houseNumber: 2,
        postalCode: '9811AB',
        city: `Feed City ${runId}`,
        lon: slice.lon + 0.002,
        lat: slice.lat + 0.002,
        askingPrice: 560000,
        officialValuation: 540000,
        officialValuationYear: 2022,
        thumbnailUrl: 'https://cdn.example.com/feed-hot.jpg',
        priceType: 'sale',
        marketState: 'for-sale' as const,
        listingCreatedAt: atOffset({ days: 2 }),
        lastActivityAt: atOffset({ minutes: 10 }),
        commentCount: 1,
        guessCount: 3,
        likeCount: 1,
        viewCount: 2,
        fmv: 550000,
      },
      {
        key: 'warm' as const,
        street: `Feed Warm ${runId}`,
        houseNumber: 3,
        postalCode: '9811AC',
        city: `Feed City ${runId}`,
        lon: slice.lon + 0.004,
        lat: slice.lat + 0.004,
        askingPrice: 470000,
        officialValuation: 465000,
        officialValuationYear: 2023,
        thumbnailUrl: 'https://cdn.example.com/feed-warm.jpg',
        priceType: 'rent',
        marketState: 'for-rent' as const,
        listingCreatedAt: atOffset({ days: 3 }),
        lastActivityAt: atOffset({ minutes: 20 }),
        commentCount: 2,
        guessCount: 0,
        likeCount: 0,
        viewCount: 1,
        fmv: null,
      },
      {
        key: 'like' as const,
        street: `Feed Like ${runId}`,
        houseNumber: 4,
        postalCode: '9811AD',
        city: `Feed City ${runId}`,
        lon: slice.lon + 0.006,
        lat: slice.lat + 0.006,
        askingPrice: 390000,
        officialValuation: 388000,
        officialValuationYear: 2024,
        thumbnailUrl: 'https://cdn.example.com/feed-like.jpg',
        priceType: 'sale',
        marketState: 'for-sale' as const,
        listingCreatedAt: atOffset({ days: 4 }),
        lastActivityAt: atOffset({ minutes: 30 }),
        commentCount: 0,
        guessCount: 0,
        likeCount: 1,
        viewCount: 0,
        fmv: null,
      },
      {
        key: 'cold' as const,
        street: `Feed Cold ${runId}`,
        houseNumber: 5,
        postalCode: '9811AE',
        city: `Feed City ${runId}`,
        lon: slice.lon + 0.008,
        lat: slice.lat + 0.008,
        askingPrice: 315000,
        officialValuation: 310000,
        officialValuationYear: 2020,
        thumbnailUrl: 'https://cdn.example.com/feed-cold.jpg',
        priceType: 'sale',
        marketState: 'for-sale' as const,
        listingCreatedAt: atOffset({ days: 40 }),
        lastActivityAt: atOffset({ days: 40 }),
        commentCount: 0,
        guessCount: 0,
        likeCount: 0,
        viewCount: 0,
        fmv: null,
      },
      {
        key: 'outsideRadius' as const,
        street: `Feed Remote ${runId}`,
        houseNumber: 6,
        postalCode: '9811AF',
        city: `Feed City ${runId}`,
        lon: slice.lon + 0.4,
        lat: slice.lat + 0.4,
        askingPrice: 999000,
        officialValuation: 998000,
        officialValuationYear: 2019,
        thumbnailUrl: 'https://cdn.example.com/feed-remote.jpg',
        priceType: 'sale',
        marketState: 'for-sale' as const,
        listingCreatedAt: atOffset({ minutes: 15 }),
        lastActivityAt: atOffset({ minutes: 15 }),
        commentCount: 0,
        guessCount: 0,
        likeCount: 0,
        viewCount: 0,
        fmv: null,
      },
    ];

    for (const definition of fixtureDefinitions) {
      const property = await createIntegrationProperty({
        countryCode: slice.country,
        street: definition.street,
        houseNumber: definition.houseNumber,
        city: definition.city,
        postalCode: definition.postalCode,
        lon: definition.lon,
        lat: definition.lat,
        officialValuation: definition.officialValuation,
        officialValuationYear: definition.officialValuationYear,
      });
      cleanupPropertyIds.push(property.id);

      await createIntegrationListing({
        propertyId: property.id,
        askingPrice: definition.askingPrice,
        thumbnailUrl: definition.thumbnailUrl,
        priceType: definition.priceType,
        createdAt: definition.listingCreatedAt,
        updatedAt: definition.listingCreatedAt,
      });

      feedFixtures[definition.key] = {
        propertyId: property.id,
        address: buildAddress(
          definition.street,
          definition.houseNumber,
          definition.postalCode,
          definition.city
        ),
        city: definition.city,
        zipCode: definition.postalCode,
        geometry: {
          type: 'Point',
          coordinates: [definition.lon, definition.lat],
        },
        askingPrice: definition.askingPrice,
        officialValuation: definition.officialValuation,
        officialValuationYear: definition.officialValuationYear,
        thumbnailUrl: definition.thumbnailUrl,
        marketState: definition.marketState,
        lastActivityAt: definition.lastActivityAt.toISOString(),
        commentCount: definition.commentCount,
        guessCount: definition.guessCount,
        likeCount: definition.likeCount,
        viewCount: definition.viewCount,
        fmv: definition.fmv,
      };
    }

    const noListingProperty = await createIntegrationProperty({
      countryCode: slice.country,
      street: `Feed No Listing ${runId}`,
      houseNumber: 7,
      city: `Feed City ${runId}`,
      postalCode: '9811AG',
      lon: slice.lon + 0.01,
      lat: slice.lat + 0.01,
      officialValuation: 280000,
    });
    noListingPropertyId = noListingProperty.id;
    cleanupPropertyIds.push(noListingPropertyId);

    await insertComment(
      feedFixtures.hot.propertyId,
      primaryUser.userId,
      atOffset({ minutes: 10 }),
      'Feed hot comment'
    );
    await insertGuess(
      feedFixtures.hot.propertyId,
      primaryUser.userId,
      500000,
      atOffset({ hours: 3 })
    );
    await insertGuess(
      feedFixtures.hot.propertyId,
      secondaryUser.userId,
      550000,
      atOffset({ hours: 2 })
    );
    await insertGuess(
      feedFixtures.hot.propertyId,
      tertiaryUser.userId,
      600000,
      atOffset({ hours: 1 })
    );
    await insertPropertyLike(
      feedFixtures.hot.propertyId,
      primaryUser.userId,
      atOffset({ hours: 4 })
    );
    await insertView(feedFixtures.hot.propertyId, atOffset({ hours: 5 }), {
      userId: primaryUser.userId,
    });
    await insertView(feedFixtures.hot.propertyId, atOffset({ hours: 6 }), {
      sessionId: `feed-hot-${runId}`,
    });

    await insertComment(
      feedFixtures.warm.propertyId,
      primaryUser.userId,
      atOffset({ minutes: 21 }),
      'Feed warm comment 1'
    );
    await insertComment(
      feedFixtures.warm.propertyId,
      secondaryUser.userId,
      atOffset({ minutes: 20 }),
      'Feed warm comment 2'
    );
    await insertView(feedFixtures.warm.propertyId, atOffset({ hours: 7 }), {
      userId: tertiaryUser.userId,
    });

    await insertPropertyLike(
      feedFixtures.like.propertyId,
      secondaryUser.userId,
      atOffset({ minutes: 30 })
    );

    await refreshLatestActiveListingsView();
  });

  afterAll(async () => {
    try {
      if (cleanupPropertyIds.length > 0) {
        const propertyIds = sql.join(
          cleanupPropertyIds.map((id) => sql`${id}`),
          sql`, `
        );
        await db.execute(sql`
          DELETE FROM reactions
          WHERE target_type = 'property'
            AND target_id IN (${propertyIds})
        `);
        await db.execute(sql`DELETE FROM properties WHERE id IN (${propertyIds})`);
        await refreshLatestActiveListingsView();
      }

      if (cleanupUserIds.length > 0) {
        const userIds = sql.join(
          cleanupUserIds.map((id) => sql`${id}`),
          sql`, `
        );
        await db.execute(sql`DELETE FROM users WHERE id IN (${userIds})`);
      }
    } finally {
      await app.close();
    }
  });

  describe('GET /feed', () => {
    it('defaults to trending order for the owned fixture slice', async () => {
      const response = await app.inject({
        method: 'GET',
        url: buildFeedUrl(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(
        'public, max-age=30, stale-while-revalidate=120'
      );
      expect(response.headers['x-feed-cache']).toBe('miss');
      const body = JSON.parse(response.body);

      expect(body.pagination).toEqual({
        page: 1,
        limit: 20,
        hasMore: false,
      });
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        feedFixtures.hot.propertyId,
        feedFixtures.warm.propertyId,
        feedFixtures.like.propertyId,
        feedFixtures.recent.propertyId,
        feedFixtures.cold.propertyId,
      ]);
    });

    it('serves repeated public feed queries from the short-lived server cache', async () => {
      const url = buildFeedUrl({ filter: 'trending', limit: 5 });
      const firstResponse = await app.inject({
        method: 'GET',
        url,
      });
      const secondResponse = await app.inject({
        method: 'GET',
        url,
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(secondResponse.statusCode).toBe(200);
      expect(firstResponse.headers['x-feed-cache']).toBe('miss');
      expect(secondResponse.headers['x-feed-cache']).toBe('hit');
      expect(secondResponse.headers['cache-control']).toBe(
        'public, max-age=30, stale-while-revalidate=120'
      );
      expect(JSON.parse(secondResponse.body)).toEqual(JSON.parse(firstResponse.body));
    });

    it('returns deterministic feed fields for the hot fixture', async () => {
      const response = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'trending', limit: 5 }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const item = body.items.find(
        (entry: { id: string }) => entry.id === feedFixtures.hot.propertyId
      );

      expect(item).toBeDefined();
      expect(item).toMatchObject({
        id: feedFixtures.hot.propertyId,
        address: feedFixtures.hot.address,
        city: feedFixtures.hot.city,
        zipCode: feedFixtures.hot.zipCode,
        countryCode: slice.country,
        geometry: feedFixtures.hot.geometry,
        askingPrice: feedFixtures.hot.askingPrice,
        fmv: feedFixtures.hot.fmv,
        officialValuation: feedFixtures.hot.officialValuation,
        officialValuationYear: feedFixtures.hot.officialValuationYear,
        thumbnailUrl: feedFixtures.hot.thumbnailUrl,
        likeCount: feedFixtures.hot.likeCount,
        commentCount: feedFixtures.hot.commentCount,
        guessCount: feedFixtures.hot.guessCount,
        viewCount: feedFixtures.hot.viewCount,
        activityLevel: 'hot',
        marketState: 'for-sale',
        lastActivityAt: feedFixtures.hot.lastActivityAt,
        hasListing: true,
      });
    });

    it('keeps zero-engagement active listings cold while exposing listing market state', async () => {
      const response = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', limit: 5 }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const recent = body.items.find(
        (entry: { id: string }) => entry.id === feedFixtures.recent.propertyId
      );
      const rent = body.items.find(
        (entry: { id: string }) => entry.id === feedFixtures.warm.propertyId
      );

      expect(recent).toMatchObject({
        id: feedFixtures.recent.propertyId,
        commentCount: 0,
        guessCount: 0,
        likeCount: 0,
        viewCount: 0,
        activityLevel: 'cold',
        marketState: 'for-sale',
        lastActivityAt: feedFixtures.recent.lastActivityAt,
      });
      expect(rent).toMatchObject({
        id: feedFixtures.warm.propertyId,
        activityLevel: 'warm',
        marketState: 'for-rent',
      });
    });

    it('treats an edited guess as one public guess and uses the latest edit timestamp for recency', async () => {
      const user = await createIntegrationUser(app, { label: `feedguessupdate${runId}` });
      const property = await createIntegrationProperty({
        countryCode: slice.country,
        street: `Feed Guess Edit ${runId}`,
        houseNumber: 31,
        city: `Feed Edit City ${runId}`,
        postalCode: '9811AX',
        lon: slice.lon + 0.015,
        lat: slice.lat + 0.015,
        officialValuation: 430000,
      });

      try {
        const listingCreatedAt = atOffset({ days: 20 });
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 440000,
          createdAt: listingCreatedAt,
          updatedAt: listingCreatedAt,
        });

        const guessCreatedAt = atOffset({ days: 20, hours: 1 });
        const guessUpdatedAt = atOffset({ minutes: 3 });
        await insertGuess(property.id, user.userId, 410000, guessCreatedAt);
        await db.execute(sql`
          UPDATE price_guesses
          SET guessed_price = 445000,
              updated_at = ${guessUpdatedAt.toISOString()}
          WHERE property_id = ${property.id}
            AND user_id = ${user.userId}
        `);

        const response = await app.inject({
          method: 'GET',
          url: `/feed?filter=latest&lat=${slice.lat + 0.015}&lon=${slice.lon + 0.015}&country=${slice.country}&limit=10`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const item = body.items.find((entry: { id: string }) => entry.id === property.id);

        expect(item).toBeDefined();
        expect(item).toMatchObject({
          id: property.id,
          guessCount: 1,
          commentCount: 0,
          likeCount: 0,
          viewCount: 0,
          activityLevel: 'warm',
          lastActivityAt: guessUpdatedAt.toISOString(),
        });
      } finally {
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
        await db.execute(sql`DELETE FROM users WHERE id = ${user.userId}`);
      }
    });

    it('uses the newest comment-like timestamp for lastActivityAt without changing feed counts', async () => {
      const author = await createIntegrationUser(app, { label: `feedcommentauthor${runId}` });
      const liker = await createIntegrationUser(app, { label: `feedcommentliker${runId}` });
      const property = await createIntegrationProperty({
        countryCode: slice.country,
        street: `Feed Comment Like ${runId}`,
        houseNumber: 32,
        city: `Feed Comment Like City ${runId}`,
        postalCode: '9811AW',
        lon: slice.lon + 0.017,
        lat: slice.lat + 0.017,
        officialValuation: 450000,
      });

      try {
        const listingCreatedAt = atOffset({ days: 15 });
        await createIntegrationListing({
          propertyId: property.id,
          askingPrice: 455000,
          createdAt: listingCreatedAt,
          updatedAt: listingCreatedAt,
        });

        const commentCreatedAt = atOffset({ days: 1 });
        const commentId = await insertComment(
          property.id,
          author.userId,
          commentCreatedAt,
          'Comment that later gets liked'
        );
        const commentLikeCreatedAt = atOffset({ minutes: 2 });
        await insertCommentLike(commentId, liker.userId, commentLikeCreatedAt);

        const response = await app.inject({
          method: 'GET',
          url: `/feed?filter=latest&lat=${slice.lat + 0.017}&lon=${slice.lon + 0.017}&country=${slice.country}&limit=10`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const item = body.items.find((entry: { id: string }) => entry.id === property.id);

        expect(item).toBeDefined();
        expect(item).toMatchObject({
          id: property.id,
          commentCount: 1,
          guessCount: 0,
          likeCount: 0,
          viewCount: 0,
          activityLevel: 'warm',
          lastActivityAt: commentLikeCreatedAt.toISOString(),
        });
      } finally {
        const userIds = sql.join([sql`${author.userId}`, sql`${liker.userId}`], sql`, `);
        await db.execute(sql`DELETE FROM properties WHERE id = ${property.id}`);
        await db.execute(sql`DELETE FROM users WHERE id IN (${userIds})`);
      }
    });

    it('applies latest ordering and deterministic pagination without overlap', async () => {
      const page1Res = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', page: 1, limit: 2 }),
      });
      const page2Res = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', page: 2, limit: 2 }),
      });
      const page3Res = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', page: 3, limit: 2 }),
      });

      expect(page1Res.statusCode).toBe(200);
      expect(page2Res.statusCode).toBe(200);
      expect(page3Res.statusCode).toBe(200);

      const page1 = JSON.parse(page1Res.body);
      const page2 = JSON.parse(page2Res.body);
      const page3 = JSON.parse(page3Res.body);

      expect(page1.pagination).toEqual({ page: 1, limit: 2, hasMore: true });
      expect(page2.pagination).toEqual({ page: 2, limit: 2, hasMore: true });
      expect(page3.pagination).toEqual({ page: 3, limit: 2, hasMore: false });

      expect(page1.items.map((item: { id: string }) => item.id)).toEqual([
        feedFixtures.recent.propertyId,
        feedFixtures.hot.propertyId,
      ]);
      expect(page2.items.map((item: { id: string }) => item.id)).toEqual([
        feedFixtures.warm.propertyId,
        feedFixtures.like.propertyId,
      ]);
      expect(page3.items.map((item: { id: string }) => item.id)).toEqual([
        feedFixtures.cold.propertyId,
      ]);
    });

    it('respects limit while staying inside the owned listing-backed slice', async () => {
      const response = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', limit: 3 }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.pagination).toEqual({ page: 1, limit: 3, hasMore: true });
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([
        feedFixtures.recent.propertyId,
        feedFixtures.hot.propertyId,
        feedFixtures.warm.propertyId,
      ]);
    });

    it('applies spatial and country filtering and excludes non-listing properties', async () => {
      const response = await app.inject({
        method: 'GET',
        url: buildFeedUrl({ filter: 'latest', limit: 10 }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const returnedIds = body.items.map((item: { id: string }) => item.id);

      expect(returnedIds).toEqual([
        feedFixtures.recent.propertyId,
        feedFixtures.hot.propertyId,
        feedFixtures.warm.propertyId,
        feedFixtures.like.propertyId,
        feedFixtures.cold.propertyId,
      ]);
      expect(returnedIds).not.toContain(feedFixtures.outsideRadius.propertyId);
      expect(returnedIds).not.toContain(noListingPropertyId);
      expect(body.items.every((item: { hasListing: boolean }) => item.hasListing === true)).toBe(
        true
      );
    });

    it('uses shared listing facts instead of stale mv_latest_active_listings semantics', async () => {
      const property = await createIntegrationProperty({
        countryCode: slice.country,
        street: `Feed Ownership ${runId}`,
        houseNumber: 21,
        city: `Feed Ownership City ${runId}`,
        postalCode: '9811AY',
        lon: slice.lon + 0.12,
        lat: slice.lat + 0.12,
      });
      cleanupPropertyIds.push(property.id);

      const listing = await createIntegrationListing({
        propertyId: property.id,
        askingPrice: 515000,
        createdAt: atOffset({ hours: 2 }),
        updatedAt: atOffset({ hours: 2 }),
      });

      await refreshLatestActiveListingsView();

      await db.execute(sql`
        UPDATE canonical_listings
        SET status = 'withdrawn', updated_at = NOW()
        WHERE id = ${listing.id}
      `);

      const response = await app.inject({
        method: 'GET',
        url: `/feed?filter=latest&lat=${slice.lat + 0.12}&lon=${slice.lon + 0.12}&country=${slice.country}&limit=10`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.map((item: { id: string }) => item.id)).not.toContain(property.id);
    });

    it('returns 400 for limit > 50', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=100',
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for obsolete filter values', async () => {
      for (const filter of ['recent', 'controversial', 'price-mismatch']) {
        const response = await app.inject({
          method: 'GET',
          url: `/feed?filter=${filter}`,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it('falls back to any listing thumbnail while keeping the latest active asking price', async () => {
      const property = await createIntegrationProperty({
        countryCode: slice.country,
        street: `Feed Thumbnail ${runId}`,
        houseNumber: 11,
        city: `Feed Fallback ${runId}`,
        postalCode: '9811AZ',
        lon: slice.lon + 0.2,
        lat: slice.lat + 0.2,
      });
      const thumbnailUrl = 'https://cdn.example.com/feed-fallback-thumb.jpg';
      cleanupPropertyIds.push(property.id);

      await createIntegrationListing({
        propertyId: property.id,
        status: 'sold',
        askingPrice: 610000,
        thumbnailUrl,
        sourceUrl: `https://example.com/feed-sold-thumb-${runId}`,
        createdAt: atOffset({ days: 2 }),
        updatedAt: atOffset({ days: 2 }),
      });
      await createIntegrationListing({
        propertyId: property.id,
        askingPrice: 645000,
        thumbnailUrl: null,
        sourceUrl: `https://example.com/feed-latest-${runId}`,
        createdAt: atOffset({ days: 1 }),
        updatedAt: atOffset({ days: 1 }),
      });

      await refreshLatestActiveListingsView();

      const response = await app.inject({
        method: 'GET',
        url: `/feed?filter=latest&lat=${slice.lat + 0.2}&lon=${slice.lon + 0.2}&country=${slice.country}&limit=10`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const item = body.items.find((entry: { id: string }) => entry.id === property.id);

      expect(item).toBeDefined();
      expect(item.thumbnailUrl).toBe(thumbnailUrl);
      expect(item.askingPrice).toBe(645000);
      expect(item.countryCode).toBe(slice.country);
      expect(item.geometry).toEqual({
        type: 'Point',
        coordinates: [slice.lon + 0.2, slice.lat + 0.2],
      });
    });
  });
});

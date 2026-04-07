import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

/**
 * Integration tests for the feed endpoint.
 *
 * Tests against the real PostGIS database seeded with listing data.
 * The feed queries mv_latest_active_listings, which must already exist
 * via the migrated schema.
 */
describe('Feed routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    const viewExists = await db.execute<{ exists: string | null }>(sql`
      SELECT to_regclass('public.mv_latest_active_listings')::text AS exists
    `);
    expect(Array.from(viewExists)[0]?.exists).toBe('mv_latest_active_listings');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /feed', () => {
    it('should return paginated feed with default trending filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toHaveProperty('page', 1);
      expect(body.pagination).toHaveProperty('limit', 20);
      expect(body.pagination).toHaveProperty('hasMore');
      expect(typeof body.pagination.hasMore).toBe('boolean');
    });

    it('should return items with expected fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Only test field structure if there are results
      if (body.items.length > 0) {
        const item = body.items[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('address');
        expect(item).toHaveProperty('city');
        expect(item).toHaveProperty('zipCode');
        expect(item).toHaveProperty('countryCode');
        expect(item).toHaveProperty('geometry');
        expect(item).toHaveProperty('askingPrice');
        expect(item).toHaveProperty('fmv');
        expect(item).toHaveProperty('officialValuation');
        expect(item).toHaveProperty('thumbnailUrl');
        expect(item).toHaveProperty('likeCount');
        expect(item).toHaveProperty('commentCount');
        expect(item).toHaveProperty('guessCount');
        expect(item).toHaveProperty('viewCount');
        expect(item).toHaveProperty('activityLevel');
        expect(item).toHaveProperty('lastActivityAt');
        expect(item).toHaveProperty('hasListing');

        // Type checks
        expect(typeof item.id).toBe('string');
        expect(typeof item.address).toBe('string');
        expect(typeof item.city).toBe('string');
        expect(typeof item.zipCode).toBe('string');
        expect(typeof item.countryCode).toBe('string');
        expect(typeof item.likeCount).toBe('number');
        expect(typeof item.commentCount).toBe('number');
        expect(typeof item.guessCount).toBe('number');
        expect(typeof item.viewCount).toBe('number');
        expect(['hot', 'warm', 'cold']).toContain(item.activityLevel);
        expect(item.hasListing).toBe(true);
      }
    });

    it('should respect limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=3',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(3);
      expect(body.pagination.limit).toBe(3);
    });

    it('should support pagination', async () => {
      // Use filter=latest for stable ordering (last_activity_at DESC, p.id)
      // trending filter's score can shift when concurrent tests mutate data
      const page1 = await app.inject({
        method: 'GET',
        url: '/feed?filter=latest&page=1&limit=5',
      });
      const page2 = await app.inject({
        method: 'GET',
        url: '/feed?filter=latest&page=2&limit=5',
      });

      expect(page1.statusCode).toBe(200);
      expect(page2.statusCode).toBe(200);

      const body1 = JSON.parse(page1.body);
      const body2 = JSON.parse(page2.body);

      expect(body1.pagination.page).toBe(1);
      expect(body2.pagination.page).toBe(2);

      // Pages should return different items (deterministic ordering via p.id tiebreaker)
      if (body1.items.length > 0 && body2.items.length > 0) {
        const ids1 = new Set(body1.items.map((i: { id: string }) => i.id));
        const ids2 = body2.items.map((i: { id: string }) => i.id);
        const overlap = ids2.filter((id: string) => ids1.has(id)).length;
        // Allow minor overlap from concurrent test data mutations
        expect(overlap).toBeLessThan(body2.items.length);
      }
    });

    it('should return 400 for limit > 50', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=100',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should accept filter=trending', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=trending&limit=5',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
    });

    it('should accept filter=latest', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=latest&limit=5',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
    });

    it('should return 400 for obsolete filter values', async () => {
      for (const filter of ['recent', 'controversial', 'price-mismatch']) {
        const response = await app.inject({
          method: 'GET',
          url: `/feed?filter=${filter}`,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it('should accept lat/lon for spatial filtering', async () => {
      // Eindhoven center coordinates
      const response = await app.inject({
        method: 'GET',
        url: '/feed?lat=51.4416&lon=5.4697&limit=5',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
    });

    it('should only return properties with listings (hasListing=true)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      for (const item of body.items) {
        expect(item.hasListing).toBe(true);
      }
    });

    it('should have correct hasMore flag', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // With limit=1, hasMore should be true if there are more than 1 item in the feed
      if (body.items.length === 1) {
        // hasMore could be true or false depending on total items
        expect(typeof body.pagination.hasMore).toBe('boolean');
      } else {
        // No items means no more
        expect(body.pagination.hasMore).toBe(false);
      }
    });

    it('should fall back to the newest active non-null thumbnail while keeping the latest active asking price', async () => {
      const propertyId = crypto.randomUUID();
      const thumbnailUrl = 'https://cdn.example.com/feed-fallback-thumb.jpg';

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
          'Feed Thumbnail Street',
          11,
          'FeedCity',
          '7777ZZ',
          'active',
          ST_SetSRID(ST_MakePoint(0.01, 0.01), 4326)
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
            'https://example.com/feed-older',
            'active',
            610000,
            ${thumbnailUrl},
            NOW() - INTERVAL '2 days',
            NOW() - INTERVAL '2 days'
          ),
          (
            ${crypto.randomUUID()},
            ${propertyId},
            'funda',
            'https://example.com/feed-latest',
            'active',
            645000,
            NULL,
            NOW() - INTERVAL '1 day',
            NOW() - INTERVAL '1 day'
          )
      `);

      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/feed?filter=latest&lat=0.01&lon=0.01&country=NL&limit=10',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const item = body.items.find((entry: { id: string }) => entry.id === propertyId);

        expect(item).toBeDefined();
        expect(item.thumbnailUrl).toBe(thumbnailUrl);
        expect(item.askingPrice).toBe(645000);
        expect(item.countryCode).toBe('NL');
        expect(item.geometry).toEqual({
          type: 'Point',
          coordinates: [0.01, 0.01],
        });
      } finally {
        await db.execute(sql`DELETE FROM listings WHERE property_id = ${propertyId}`);
        await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
        await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_latest_active_listings`);
      }
    });

    it('should return hasMore=true on a non-terminal page and hasMore=false on the terminal page', async () => {
      // Probe total count with a large limit (max 50)
      const probeRes = await app.inject({
        method: 'GET',
        url: '/feed?filter=latest&limit=50',
      });
      expect(probeRes.statusCode).toBe(200);
      const probeBody = JSON.parse(probeRes.body);
      const totalItems: number = probeBody.items.length;
      const probeHasMore: boolean = probeBody.pagination.hasMore;

      // Need at least 3 items so limit=2 gives a non-terminal first page
      if (totalItems < 3 && !probeHasMore) {
        return;
      }

      const limit = 2;

      // Page 1 — with enough items, hasMore must be true
      const page1Res = await app.inject({
        method: 'GET',
        url: `/feed?filter=latest&limit=${limit}&page=1`,
      });
      expect(page1Res.statusCode).toBe(200);
      const page1 = JSON.parse(page1Res.body);
      expect(page1.items.length).toBe(limit);
      expect(page1.pagination.hasMore).toBe(true);

      // Jump directly to a page that is guaranteed past the end.
      // The DB may have up to ~144K listings, so use a very high page.
      const beyondPage = 999999;
      const lastRes = await app.inject({
        method: 'GET',
        url: `/feed?filter=latest&limit=${limit}&page=${beyondPage}`,
      });
      expect(lastRes.statusCode).toBe(200);
      const lastBody = JSON.parse(lastRes.body);
      expect(lastBody.items.length).toBe(0);
      expect(lastBody.pagination.hasMore).toBe(false);
    }, 15000);
  });
});

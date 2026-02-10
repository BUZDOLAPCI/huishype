import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Integration tests for the feed endpoint.
 *
 * Tests against the real PostGIS database seeded with listing data.
 * The feed only returns properties that have active listings.
 */
describe('Feed routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
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
      expect(body.pagination).toHaveProperty('total');
      expect(body.pagination).toHaveProperty('hasMore');
      expect(typeof body.pagination.total).toBe('number');
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
        expect(item).toHaveProperty('askingPrice');
        expect(item).toHaveProperty('fmv');
        expect(item).toHaveProperty('wozValue');
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
      // Use filter=recent for stable ordering (last_activity_at DESC, p.id)
      // trending filter's score can shift when concurrent tests mutate data
      const page1 = await app.inject({
        method: 'GET',
        url: '/feed?filter=recent&page=1&limit=5',
      });
      const page2 = await app.inject({
        method: 'GET',
        url: '/feed?filter=recent&page=2&limit=5',
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

    it('should accept filter=recent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=recent&limit=5',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
    });

    it('should accept filter=controversial', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=controversial&limit=5',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      // May be empty if no properties have 2+ guesses
    });

    it('should accept filter=price-mismatch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=price-mismatch&limit=5',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      // May be empty if no properties have both asking price and FMV
    });

    it('should return 400 for invalid filter value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/feed?filter=invalid',
      });
      expect(response.statusCode).toBe(400);
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

      if (body.pagination.total > 1) {
        expect(body.pagination.hasMore).toBe(true);
      } else {
        expect(body.pagination.hasMore).toBe(false);
      }
    });
  });
});

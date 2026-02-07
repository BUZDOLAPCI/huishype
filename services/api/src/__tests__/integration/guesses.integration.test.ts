import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, priceGuesses } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

/**
 * Integration tests for guess routes.
 *
 * Creates a test user via auth, fetches a real property from the DB,
 * then exercises the price guess API including cooldown logic.
 */
describe('Guess routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `guesstest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    testUserIds.push(userId);

    // Get a real property
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1',
    });
    const propBody = JSON.parse(propResp.body);
    expect(propBody.data.length).toBeGreaterThan(0);
    propertyId = propBody.data[0].id;
  });

  afterAll(async () => {
    // Clean up test guesses
    for (const uid of testUserIds) {
      try {
        await db.delete(priceGuesses).where(eq(priceGuesses.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('POST /properties/:id/guesses', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/guesses`,
        payload: { guessedPrice: 300000 },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/guesses`,
        headers: { 'x-user-id': userId },
        payload: { guessedPrice: 300000 },
      });
      expect(response.statusCode).toBe(404);
    });

    it('should create a new price guess', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/guesses`,
        headers: { 'x-user-id': userId },
        payload: { guessedPrice: 350000 },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body.propertyId).toBe(propertyId);
      expect(body.userId).toBe(userId);
      expect(body.guessedPrice).toBe(350000);
      expect(body).toHaveProperty('createdAt');
      expect(body).toHaveProperty('updatedAt');
      expect(body.message).toContain('submitted');
    });

    it('should return 400 with cooldown when guessing again immediately', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/guesses`,
        headers: { 'x-user-id': userId },
        payload: { guessedPrice: 400000 },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('COOLDOWN_ACTIVE');
      expect(body).toHaveProperty('cooldownEndsAt');
      expect(typeof body.cooldownEndsAt).toBe('string');
    });
  });

  describe('GET /properties/:id/guesses', () => {
    it('should return guesses with stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/guesses`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body).toHaveProperty('stats');
      expect(Array.isArray(body.data)).toBe(true);

      // We submitted at least 1 guess
      expect(body.stats.totalGuesses).toBeGreaterThanOrEqual(1);

      if (body.stats.totalGuesses > 0) {
        expect(body.stats.averageGuess).not.toBeNull();
        expect(body.stats.medianGuess).not.toBeNull();
        expect(typeof body.stats.averageGuess).toBe('number');
        expect(typeof body.stats.medianGuess).toBe('number');
      }

      // Check each guess has user info
      if (body.data.length > 0) {
        const guess = body.data[0];
        expect(guess).toHaveProperty('id');
        expect(guess).toHaveProperty('guessedPrice');
        expect(guess).toHaveProperty('user');
        expect(guess.user).toHaveProperty('username');
      }
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${fakeId}/guesses`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/guesses?page=1&limit=5`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(5);
      expect(body.data.length).toBeLessThanOrEqual(5);
    });
  });
});

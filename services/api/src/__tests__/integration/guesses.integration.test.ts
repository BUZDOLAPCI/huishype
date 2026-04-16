import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, priceGuesses } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for guess routes.
 *
 * Creates a test user via auth, fetches a real property from the DB,
 * then exercises the price guess API including immediate guess updates.
 */
describe('Guess routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
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
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    const property = await createIntegrationProperty({
      street: 'Guesses Fixture Street',
      houseNumber: 1,
      city: 'Guesses City',
      postalCode: '9040AA',
      lon: 5.4704,
      lat: 51.4404,
    });
    propertyId = property.id;
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
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
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
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { guessedPrice: 300000 },
      });
      expect(response.statusCode).toBe(404);
    });

    it('should create a new price guess', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/guesses`,
        headers: { authorization: `Bearer ${accessToken}` },
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

    it('should update an existing guess immediately when guessing again', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/guesses`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { guessedPrice: 400000 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.guessedPrice).toBe(400000);
      expect(body.message).toContain('updated');
    });
  });

  describe('GET /properties/:id/guesses', () => {
    it('should return guesses with fmv data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}/guesses`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body).toHaveProperty('fmv');
      expect(Array.isArray(body.data)).toBe(true);

      // FMV section should contain guess count
      expect(body.fmv).toHaveProperty('guessCount');
      expect(body.fmv.guessCount).toBeGreaterThanOrEqual(1);

      if (body.fmv.guessCount >= 3) {
        // With enough guesses, FMV should be calculated
        expect(body.fmv.fmv).not.toBeNull();
        expect(typeof body.fmv.fmv).toBe('number');
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

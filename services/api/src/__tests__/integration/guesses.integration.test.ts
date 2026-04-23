import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, priceGuesses, properties } from '../../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { createIntegrationListing, createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for guess routes.
 *
 * Creates a test user via auth, inserts a suite-owned property fixture,
 * then exercises the price guess API including immediate guess updates.
 */
describe('Guess routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  const cleanupPropertyIds: string[] = [];

  async function refreshPriceGuessMarketSummaries() {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_price_guess_start_market_summaries`);
  }

  async function createPostalSummaryFixtures(postalCode: string, count = 8) {
    for (let index = 0; index < count; index += 1) {
      const property = await createIntegrationProperty({
        street: `Guesses Comparable ${postalCode} ${index}`,
        houseNumber: 100 + index,
        city: 'Guesses Hint City',
        region: 'Guesses Hint Region',
        postalCode,
        officialValuation: 300_000,
        floorAreaM2: 100,
      });
      cleanupPropertyIds.push(property.id);

      await createIntegrationListing({
        propertyId: property.id,
        sourceName: 'funda',
        status: 'active',
        priceType: 'buy',
        askingPrice: 390_000,
      });
    }
  }

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
    cleanupPropertyIds.push(property.id);
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
    if (cleanupPropertyIds.length > 0) {
      await db.delete(properties).where(inArray(properties.id, cleanupPropertyIds));
      await refreshPriceGuessMarketSummaries();
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
      expect(body).toHaveProperty('activeListingAskingPrice');
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

    it('returns active sale asking price and omits priceGuessStart for active sale listings', async () => {
      const property = await createIntegrationProperty({
        street: 'Guesses Active Sale Street',
        houseNumber: 2,
        city: 'Guesses Sale City',
        postalCode: '9071AA',
        officialValuation: 300_000,
      });
      cleanupPropertyIds.push(property.id);
      await createIntegrationListing({
        propertyId: property.id,
        sourceName: 'funda',
        status: 'active',
        priceType: 'buy',
        askingPrice: 450_000,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${property.id}/guesses`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.activeListingAskingPrice).toBe(450_000);
      expect(body.priceGuessStart).toBeUndefined();
    });

    it('does not expose active rent asking price as activeListingAskingPrice', async () => {
      const property = await createIntegrationProperty({
        street: 'Guesses Active Rent Street',
        houseNumber: 3,
        city: 'Guesses Rent City',
        postalCode: '9072AA',
        officialValuation: 310_000,
      });
      cleanupPropertyIds.push(property.id);
      await createIntegrationListing({
        propertyId: property.id,
        sourceName: 'pararius',
        status: 'active',
        priceType: 'rent',
        askingPrice: 1_800,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${property.id}/guesses`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.activeListingAskingPrice).toBeNull();
      expect(body.priceGuessStart).toMatchObject({
        price: 310_000,
        source: 'official_valuation',
        confidence: 'weak',
      });
    });

    it('returns a local market summary hint when no active sale listing exists', async () => {
      const postalCode = '9977AA';
      await createPostalSummaryFixtures(postalCode);
      await refreshPriceGuessMarketSummaries();

      const property = await createIntegrationProperty({
        street: 'Guesses Hint Target Street',
        houseNumber: 4,
        city: 'Guesses Hint City',
        region: 'Guesses Hint Region',
        postalCode,
        officialValuation: 300_000,
        floorAreaM2: 100,
      });
      cleanupPropertyIds.push(property.id);

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${property.id}/guesses`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.activeListingAskingPrice).toBeNull();
      expect(body.priceGuessStart).toMatchObject({
        price: 325_000,
        source: 'official_valuation_adjusted',
        confidence: 'usable',
        sampleSize: 8,
      });
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, priceGuesses, comments, properties, savedProperties, reactions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for user profile routes.
 *
 * Creates test users via the mock auth flow, then exercises:
 *   GET /users/:id/profile   (public)
 *   GET /users/me             (authenticated)
 *   PUT /users/me/profile     (authenticated)
 *   GET /users/me/guesses     (authenticated)
 */
describe('User profile routes', () => {
  let app: FastifyInstance;
  const cleanupIds: { users: string[]; properties: string[] } = { users: [], properties: [] };

  /** Helper: create a user via mock google auth, return { userId, accessToken } */
  async function createTestUser(label: string) {
    // Token format: mock-google-{email}-{googleId}
    // Must avoid extra dashes in email/googleId segments
    const unique = `${label}${Date.now()}`;
    const resp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${unique}-gid${unique}` },
    });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body);
    cleanupIds.users.push(body.session.user.id);
    return {
      userId: body.session.user.id as string,
      accessToken: body.session.accessToken as string,
    };
  }

  /** Helper: create a minimal test property, return its id */
  async function createTestProperty() {
    const [prop] = await db
      .insert(properties)
      .values({
        street: 'Teststraat',
        houseNumber: Math.floor(Math.random() * 9000) + 1,
        city: 'Teststad',
        postalCode: '1234AB',
        status: 'active',
      })
      .returning({ id: properties.id });
    cleanupIds.properties.push(prop.id);
    return prop.id;
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Clean up in dependency order
    for (const uid of cleanupIds.users) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(savedProperties).where(eq(savedProperties.userId, uid));
        await db.delete(comments).where(eq(comments.userId, uid));
        await db.delete(priceGuesses).where(eq(priceGuesses.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch { /* ignore */ }
    }
    for (const pid of cleanupIds.properties) {
      try {
        await db.delete(properties).where(eq(properties.id, pid));
      } catch { /* ignore */ }
    }
    await app.close();
  });

  // ---------- GET /users/:id/profile ----------

  describe('GET /users/:id/profile', () => {
    it('should return a public profile for an existing user', async () => {
      const { userId } = await createTestUser('public');

      const resp = await app.inject({
        method: 'GET',
        url: `/users/${userId}/profile`,
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body.id).toBe(userId);
      expect(body).toHaveProperty('displayName');
      expect(body).toHaveProperty('handle');
      expect(body).toHaveProperty('karma');
      expect(body).toHaveProperty('karmaRank');
      expect(body.karmaRank).toHaveProperty('title');
      expect(body.karmaRank).toHaveProperty('level');
      expect(body).toHaveProperty('guessCount');
      expect(body).toHaveProperty('commentCount');
      expect(body).toHaveProperty('joinedAt');

      // Public profile should NOT include email
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('savedCount');
    });

    it('should return 404 for a non-existent user', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const resp = await app.inject({
        method: 'GET',
        url: `/users/${fakeId}/profile`,
      });
      expect(resp.statusCode).toBe(404);
    });

    it('should return correct guess and comment counts', async () => {
      const { userId } = await createTestUser('counts');
      const propId = await createTestProperty();

      // Insert a guess and a comment
      await db.insert(priceGuesses).values({
        userId,
        propertyId: propId,
        guessedPrice: 300000,
      });
      await db.insert(comments).values({
        userId,
        propertyId: propId,
        content: 'Test comment',
      });

      const resp = await app.inject({
        method: 'GET',
        url: `/users/${userId}/profile`,
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.guessCount).toBe(1);
      expect(body.commentCount).toBe(1);
    });
  });

  // ---------- GET /users/me ----------

  describe('GET /users/me', () => {
    it('should return full profile for authenticated user', async () => {
      const { accessToken } = await createTestUser('me');

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('email');
      expect(body).toHaveProperty('handle');
      expect(body).toHaveProperty('savedCount');
      expect(body).toHaveProperty('likedCount');
      expect(body).toHaveProperty('lastNameChangeAt');
      expect(body).toHaveProperty('karmaRank');
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me',
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  // ---------- PUT /users/me/profile ----------

  describe('PUT /users/me/profile', () => {
    it('should update display name', async () => {
      const { accessToken } = await createTestUser('update');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'Nieuwe Naam' },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.displayName).toBe('Nieuwe Naam');
      expect(body.lastNameChangeAt).toBeTruthy();
    });

    it('should enforce 30-day cooldown on display name change', async () => {
      const { accessToken } = await createTestUser('cooldown');

      // First change — should succeed
      const first = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'Eerste' },
      });
      expect(first.statusCode).toBe(200);

      // Second change within cooldown — should be rejected
      const second = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'Tweede' },
      });
      expect(second.statusCode).toBe(429);
      const body = JSON.parse(second.body);
      expect(body.error).toBe('DISPLAY_NAME_COOLDOWN');
    });

    it('should allow updating profile photo without cooldown', async () => {
      const { accessToken } = await createTestUser('photo');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { profilePhotoUrl: 'https://example.com/photo.jpg' },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.profilePhotoUrl).toBe('https://example.com/photo.jpg');
    });

    it('should reject too-short display name', async () => {
      const { accessToken } = await createTestUser('short');

      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { displayName: 'A' },
      });
      expect(resp.statusCode).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'PUT',
        url: '/users/me/profile',
        payload: { displayName: 'Test' },
      });
      expect(resp.statusCode).toBe(401);
    });
  });

  // ---------- GET /users/me/guesses ----------

  describe('GET /users/me/guesses', () => {
    it('should return guess history for authenticated user', async () => {
      const { userId, accessToken } = await createTestUser('guesses');
      const propId = await createTestProperty();

      // Insert a guess
      await db.insert(priceGuesses).values({
        userId,
        propertyId: propId,
        guessedPrice: 450000,
      });

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);

      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('hasMore');
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);

      const item = body.items[0];
      expect(item.propertyId).toBe(propId);
      expect(item.guessAmount).toBe(450000);
      expect(item.outcome).toBe('pending');
      expect(item.actualPrice).toBeNull();
      expect(item).toHaveProperty('propertyAddress');
      expect(item).toHaveProperty('guessedAt');
    });

    it('should return empty list for user with no guesses', async () => {
      const { accessToken } = await createTestUser('noguesses');

      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
      expect(body.hasMore).toBe(false);
    });

    it('should support pagination', async () => {
      const { userId, accessToken } = await createTestUser('pagination');

      // Create 3 properties and guesses
      for (let i = 0; i < 3; i++) {
        const pid = await createTestProperty();
        await db.insert(priceGuesses).values({
          userId,
          propertyId: pid,
          guessedPrice: 200000 + i * 50000,
        });
      }

      // Get page with limit 2
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses?limit=2&offset=0',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(resp.statusCode).toBe(200);
      const body = JSON.parse(resp.body);
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.hasMore).toBe(true);

      // Get second page
      const resp2 = await app.inject({
        method: 'GET',
        url: '/users/me/guesses?limit=2&offset=2',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body2 = JSON.parse(resp2.body);
      expect(body2.items).toHaveLength(1);
      expect(body2.hasMore).toBe(false);
    });

    it('should return 401 without auth', async () => {
      const resp = await app.inject({
        method: 'GET',
        url: '/users/me/guesses',
      });
      expect(resp.statusCode).toBe(401);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, reactions } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for the likes routes (renamed from reactions.ts).
 * Verifies that the route file rename didn't break existing endpoints.
 */
describe('Likes routes (renamed from reactions)', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `liketest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/token/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
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
    for (const uid of testUserIds) {
      try {
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  it('POST /properties/:id/like should still work after rename', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.liked).toBe(true);
  });

  it('DELETE /properties/:id/like should still work after rename', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.liked).toBe(false);
  });
});

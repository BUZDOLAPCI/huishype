import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, propertyViews } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

/**
 * Integration tests for property view tracking endpoints.
 *
 * Tests POST /properties/:id/view and verifies the enriched
 * GET /properties/:id response includes view counts and activity level.
 *
 * Uses a dedicated property per test run and cleans up views to avoid
 * count collisions when Jest runs tests in parallel.
 */
describe('Property view routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  const testUserIds: string[] = [];
  // Use unique session IDs per test run to avoid collisions
  const sessionPrefix = `test-${Date.now()}`;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `viewtest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    // Get a real property — use offset to reduce collision with other tests
    const propResp = await app.inject({
      method: 'GET',
      url: '/properties?limit=1&page=3',
    });
    const propBody = JSON.parse(propResp.body);
    expect(propBody.data.length).toBeGreaterThan(0);
    propertyId = propBody.data[0].id;

    // Clean any existing views for this property from prior test runs
    await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
  });

  afterAll(async () => {
    // Clean up
    await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
    for (const uid of testUserIds) {
      try {
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await app.close();
  });

  describe('POST /properties/:id/view', () => {
    it('should record an anonymous view and increment count', async () => {
      // Get baseline
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': `${sessionPrefix}-anon1` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.viewCount).toBe(baseCount + 1);
      expect(body.uniqueViewers).toBeGreaterThanOrEqual(1);
    });

    it('should record an authenticated view and increment count', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.viewCount).toBe(baseCount + 1);
    });

    it('should deduplicate authenticated view within 1 hour', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should NOT increment — same user within 1 hour
      expect(body.viewCount).toBe(baseCount);
    });

    it('should deduplicate anonymous view within 1 hour', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': `${sessionPrefix}-anon1` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should NOT increment — same session within 1 hour
      expect(body.viewCount).toBe(baseCount);
    });

    it('should allow a different anonymous session to view', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': `${sessionPrefix}-anon2` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.viewCount).toBe(baseCount + 1);
    });

    it('should return 404 for non-existent property', async () => {
      const fakeId = 'a0000000-0000-4000-a000-000000000099';
      const response = await app.inject({
        method: 'POST',
        url: `/properties/${fakeId}/view`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should handle fully anonymous view (no user, no session)', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should always create a new view since there's no user/session to dedup
      expect(body.viewCount).toBe(baseCount + 1);
    });
  });

  describe('GET /properties/:id (enriched with views)', () => {
    it('should include viewCount, uniqueViewers, commentCount, guessCount, and activityLevel', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('viewCount');
      expect(body).toHaveProperty('uniqueViewers');
      expect(body).toHaveProperty('commentCount');
      expect(body).toHaveProperty('guessCount');
      expect(body).toHaveProperty('activityLevel');
      expect(typeof body.viewCount).toBe('number');
      expect(typeof body.uniqueViewers).toBe('number');
      expect(typeof body.commentCount).toBe('number');
      expect(typeof body.guessCount).toBe('number');
      expect(['hot', 'warm', 'cold']).toContain(body.activityLevel);
    });
  });
});

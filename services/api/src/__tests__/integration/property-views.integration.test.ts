import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

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

    const property = await createIntegrationProperty({
      street: 'Property Views Fixture Street',
      houseNumber: 1,
      city: 'Views City',
      postalCode: '9080AA',
      lon: 5.4709,
      lat: 51.4409,
    });
    propertyId = property.id;

    // Clean any existing views for this property from prior test runs
    await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
  });

  afterAll(async () => {
    // Clean up
    await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
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
        headers: { 'x-session-id': `${sessionPrefix}-missing` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should reject view writes without a stable viewer identity', async () => {
      const baseline = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      const baseCount = Array.from(baseline)[0]?.cnt ?? 0;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'BAD_REQUEST',
        message: 'Authenticated user or x-session-id header is required.',
      });

      const counts = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt FROM property_views WHERE property_id = ${propertyId}
      `);
      expect(Array.from(counts)[0]?.cnt ?? 0).toBe(baseCount);
    });
  });

  describe('view identity persistence', () => {
    it('stores unique viewers using user/session identity only', async () => {
      const counts = await db.execute<{ view_count: number; unique_viewers: number }>(sql`
        SELECT
          COUNT(*)::int AS view_count,
          COUNT(DISTINCT COALESCE(user_id::text, session_id))::int AS unique_viewers
        FROM property_views
        WHERE property_id = ${propertyId}
      `);

      const row = Array.from(counts)[0];
      expect(row?.view_count ?? 0).toBeGreaterThanOrEqual(row?.unique_viewers ?? 0);
      expect(row?.unique_viewers ?? 0).toBeGreaterThan(0);
    });
  });
});

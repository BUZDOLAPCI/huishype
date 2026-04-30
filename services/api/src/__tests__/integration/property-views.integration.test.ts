import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import {
  createIntegrationProperty,
  createIntegrationUser,
  refreshIntegrationMapProjection,
} from './helpers/fixtures.js';
import {
  advancePropertyChangeVersion,
  ensurePropertyChangeState,
} from '../../services/property-read-state.js';

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
    await db.execute(sql`DELETE FROM property_read_state WHERE property_id = ${propertyId}`);
    await db.execute(sql`DELETE FROM property_change_state WHERE property_id = ${propertyId}`);
    await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
    await refreshIntegrationMapProjection(propertyId);
  });

  afterAll(async () => {
    // Clean up
    await db.execute(sql`DELETE FROM property_read_state WHERE property_id = ${propertyId}`);
    await db.execute(sql`DELETE FROM property_change_state WHERE property_id = ${propertyId}`);
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

  describe('read-state marking', () => {
    it('marks the current change version as read for an anonymous viewer', async () => {
      await advancePropertyChangeVersion(propertyId);
      const current = await ensurePropertyChangeState(propertyId);
      const sessionId = `${sessionPrefix}-read-anon`;

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': sessionId },
      });

      expect(response.statusCode).toBe(200);
      const rows = await db.execute<{ seen_change_version: number }>(sql`
        SELECT seen_change_version
        FROM property_read_state
        WHERE property_id = ${propertyId}
          AND session_id = ${sessionId}
          AND user_id IS NULL
      `);
      expect(Number(Array.from(rows)[0]?.seen_change_version)).toBe(current.changeVersion);
    });

    it('marks read state for authenticated viewers independently from other viewers', async () => {
      const other = await createIntegrationUser(app, { label: 'read-state-other-viewer' });

      try {
        await advancePropertyChangeVersion(propertyId);
        const current = await ensurePropertyChangeState(propertyId);

        const response = await app.inject({
          method: 'POST',
          url: `/properties/${propertyId}/view`,
          headers: { authorization: `Bearer ${accessToken}` },
        });

        expect(response.statusCode).toBe(200);

        const rows = await db.execute<{
          user_seen: number | null;
          other_seen: number | null;
        }>(sql`
          SELECT
            (
              SELECT seen_change_version
              FROM property_read_state
              WHERE property_id = ${propertyId}
                AND user_id = ${userId}
                AND session_id IS NULL
            ) AS user_seen,
            (
              SELECT seen_change_version
              FROM property_read_state
              WHERE property_id = ${propertyId}
                AND user_id = ${other.userId}
                AND session_id IS NULL
            ) AS other_seen
        `);

        const row = Array.from(rows)[0];
        expect(Number(row?.user_seen)).toBe(current.changeVersion);
        expect(row?.other_seen).toBeNull();
      } finally {
        await db.execute(sql`DELETE FROM users WHERE id = ${other.userId}`);
      }
    });

    it('updates read state to the latest version even when analytics view insertion is deduped', async () => {
      const sessionId = `${sessionPrefix}-dedup-read`;
      const firstView = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': sessionId },
      });
      expect(firstView.statusCode).toBe(200);

      await advancePropertyChangeVersion(propertyId);
      const current = await ensurePropertyChangeState(propertyId);
      const countBefore = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM property_views
        WHERE property_id = ${propertyId}
          AND session_id = ${sessionId}
      `);

      const dedupedView = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': sessionId },
      });

      expect(dedupedView.statusCode).toBe(200);

      const countAfter = await db.execute<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM property_views
        WHERE property_id = ${propertyId}
          AND session_id = ${sessionId}
      `);
      expect(Array.from(countAfter)[0]?.cnt).toBe(Array.from(countBefore)[0]?.cnt);

      const readRows = await db.execute<{ seen_change_version: number }>(sql`
        SELECT seen_change_version
        FROM property_read_state
        WHERE property_id = ${propertyId}
          AND session_id = ${sessionId}
      `);
      expect(Number(Array.from(readRows)[0]?.seen_change_version)).toBe(current.changeVersion);
    });

    it('does not advance the property change version when recording a view', async () => {
      const before = await ensurePropertyChangeState(propertyId);

      const response = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': `${sessionPrefix}-no-change-advance` },
      });

      expect(response.statusCode).toBe(200);
      const after = await ensurePropertyChangeState(propertyId);
      expect(after.changeVersion).toBe(before.changeVersion);
    });

    it('exposes read state on nearby, batch, and detail reads for the same viewer', async () => {
      const sessionId = `${sessionPrefix}-nearby-read`;

      const viewResponse = await app.inject({
        method: 'POST',
        url: `/properties/${propertyId}/view`,
        headers: { 'x-session-id': sessionId },
      });
      expect(viewResponse.statusCode).toBe(200);

      const detailResponse = await app.inject({
        method: 'GET',
        url: `/properties/${propertyId}`,
        headers: { 'x-session-id': sessionId },
      });
      expect(detailResponse.statusCode).toBe(200);
      expect(JSON.parse(detailResponse.body).isRead).toBe(true);

      const batchResponse = await app.inject({
        method: 'GET',
        url: `/properties/batch?ids=${propertyId}`,
        headers: { 'x-session-id': sessionId },
      });
      expect(batchResponse.statusCode).toBe(200);
      expect(JSON.parse(batchResponse.body)[0].isRead).toBe(true);

      const nearbyResponse = await app.inject({
        method: 'GET',
        url: '/properties/nearby?lon=5.4709&lat=51.4409&zoom=20',
        headers: { 'x-session-id': sessionId },
      });
      expect(nearbyResponse.statusCode).toBe(200);
      const nearbyBody = JSON.parse(nearbyResponse.body);
      expect(nearbyBody.primaryPropertyId).toBe(propertyId);
      expect(nearbyBody.isRead).toBe(true);
    });
  });
});

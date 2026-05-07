import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import {
  users,
  comments,
  reactions,
  propertyTilePyramidSourceWatermarks,
} from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { createIntegrationProperty } from './helpers/fixtures.js';

/**
 * Integration tests for the likes routes (renamed from reactions.ts).
 * Verifies that the route file rename didn't break existing endpoints.
 */
describe('Likes routes (renamed from reactions)', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  let commentId: string;
  const testUserIds: string[] = [];

  async function readPyramidMutationState() {
    const [watermark] = await db
      .select({ watermarkValue: propertyTilePyramidSourceWatermarks.watermarkValue })
      .from(propertyTilePyramidSourceWatermarks)
      .where(eq(propertyTilePyramidSourceWatermarks.scope, 'social_inputs'))
      .limit(1);

    return {
      socialInputsWatermark: watermark?.watermarkValue ?? 0n,
    };
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user
    const uniqueId = `liketest${Date.now()}`;
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
      street: 'Likes Fixture Street',
      houseNumber: 1,
      city: 'Likes City',
      postalCode: '9050AA',
      lon: 5.4705,
      lat: 51.4405,
    });
    propertyId = property.id;

    const [comment] = await db
      .insert(comments)
      .values({
        propertyId,
        userId,
        content: 'Like route pyramid invalidation fixture',
      })
      .returning({ id: comments.id });
    commentId = comment.id;
  });

  afterAll(async () => {
    for (const uid of testUserIds) {
      try {
        await db.delete(comments).where(eq(comments.id, commentId));
        await db.delete(reactions).where(eq(reactions.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    await app.close();
  });

  it('POST /properties/:id/like should still work after rename', async () => {
    const before = await readPyramidMutationState();
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.liked).toBe(true);

    const after = await readPyramidMutationState();
    expect(after.socialInputsWatermark > before.socialInputsWatermark).toBe(true);
  });

  it('DELETE /properties/:id/like should still work after rename', async () => {
    const before = await readPyramidMutationState();
    const response = await app.inject({
      method: 'DELETE',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.liked).toBe(false);

    const after = await readPyramidMutationState();
    expect(after.socialInputsWatermark > before.socialInputsWatermark).toBe(true);
  });

  it('POST /comments/:id/like requests a pyramid rebuild', async () => {
    const before = await readPyramidMutationState();
    const response = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ liked: true });

    const after = await readPyramidMutationState();
    expect(after.socialInputsWatermark > before.socialInputsWatermark).toBe(true);
  });

  it('DELETE /comments/:id/like requests a pyramid rebuild', async () => {
    const before = await readPyramidMutationState();
    const response = await app.inject({
      method: 'DELETE',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ liked: false });

    const after = await readPyramidMutationState();
    expect(after.socialInputsWatermark > before.socialInputsWatermark).toBe(true);
  });
});

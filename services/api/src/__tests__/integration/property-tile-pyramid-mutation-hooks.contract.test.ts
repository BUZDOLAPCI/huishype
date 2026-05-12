import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { comments, reactions, users } from '../../db/schema.js';
import { createIntegrationProperty, createIntegrationUser } from './helpers/fixtures.js';

const TEST_COVERAGE_ID = `mutation_hooks_${Date.now()}`;

describe('property tile pyramid mutation invalidation hooks', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  let commentId: string;
  let previousCoverageId: string | undefined;

  beforeAll(async () => {
    previousCoverageId = process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID;
    process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID = TEST_COVERAGE_ID;

    const { buildApp } = await import('../../app.js');
    app = await buildApp({ logger: false });

    const user = await createIntegrationUser(app, { label: 'pyramid-mutation-hooks' });
    userId = user.userId;
    accessToken = user.accessToken;

    const property = await createIntegrationProperty({
      street: 'Pyramid Mutation Hook Street',
      houseNumber: 1,
      city: 'Hook City',
      postalCode: '9070AA',
      lon: 5.4707,
      lat: 51.4407,
    });
    propertyId = property.id;

    const [comment] = await db
      .insert(comments)
      .values({
        propertyId,
        userId,
        content: 'Pyramid mutation hook fixture',
      })
      .returning({ id: comments.id });
    commentId = comment.id;
  });

  beforeEach(async () => {
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_versions
      WHERE coverage_id = ${TEST_COVERAGE_ID}
    `);
    await db.execute(sql`
      UPDATE property_tile_pyramid_source_watermarks
      SET watermark_json = watermark_json
        - 'mutationBuildCoalescing:social'
        - 'mutationBuildCoalescing:views'
        - 'mutationBuildCoalescing:listing'
      WHERE scope_key = 'global'
    `);
  });

  afterAll(async () => {
    if (propertyId) {
      await db.delete(reactions).where(eq(reactions.userId, userId));
      await db.delete(comments).where(eq(comments.id, commentId));
      await db.execute(sql`DELETE FROM property_views WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM property_read_state WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM property_change_state WHERE property_id = ${propertyId}`);
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
    }
    await db.execute(sql`
      DELETE FROM property_tile_pyramid_versions
      WHERE coverage_id = ${TEST_COVERAGE_ID}
    `);
    if (previousCoverageId == null) {
      delete process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID;
    } else {
      process.env.PROPERTY_TILE_PYRAMID_COVERAGE_ID = previousCoverageId;
    }
    if (app) {
      await app.close();
    }
  });

  async function readWatermark(scope: string, policy: string) {
    const rows = await db.execute<{
      watermark_value: string;
      last_requested_watermark_value: string | null;
    }>(sql`
      SELECT
        watermark_value::text,
        watermark_json->${`mutationBuildCoalescing:${policy}`}->>'lastRequestedWatermarkValue'
          AS last_requested_watermark_value
      FROM property_tile_pyramid_source_watermarks
      WHERE scope = ${scope}::property_tile_pyramid_watermark_scope
        AND scope_key = 'global'
      LIMIT 1
    `);
    const row = Array.from(rows)[0];
    return {
      value: BigInt(row?.watermark_value ?? '0'),
      lastRequestedValue: BigInt(row?.last_requested_watermark_value ?? '0'),
    };
  }

  async function countRequestedPyramidVersions() {
    const rows = await db.execute<{ version_count: number }>(sql`
      SELECT count(*)::int AS version_count
      FROM property_tile_pyramid_versions
      WHERE coverage_id = ${TEST_COVERAGE_ID}
    `);
    return Array.from(rows)[0]?.version_count ?? 0;
  }

  it('comments advance social inputs but immediate repeats coalesce before a second build request', async () => {
    const before = await readWatermark('social_inputs', 'social');
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Route hook comment one' },
    });

    expect(firstResponse.statusCode).toBe(201);
    const firstBody = JSON.parse(firstResponse.body);
    await db.delete(comments).where(eq(comments.id, firstBody.id));

    const afterFirst = await readWatermark('social_inputs', 'social');
    expect(afterFirst.value > before.value).toBe(true);
    expect(afterFirst.lastRequestedValue).toBe(afterFirst.value);
    expect(await countRequestedPyramidVersions()).toBe(1);

    const secondResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Route hook comment two' },
    });

    expect(secondResponse.statusCode).toBe(201);
    const secondBody = JSON.parse(secondResponse.body);
    await db.delete(comments).where(eq(comments.id, secondBody.id));

    const afterSecond = await readWatermark('social_inputs', 'social');
    expect(afterSecond.value > afterFirst.value).toBe(true);
    expect(afterSecond.lastRequestedValue).toBe(afterFirst.lastRequestedValue);
    expect(await countRequestedPyramidVersions()).toBe(1);
  });

  it('property views advance engagement inputs but keep the view coalescing floor', async () => {
    const before = await readWatermark('views_engagement', 'views');
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/view`,
      headers: { 'x-session-id': 'pyramid-mutation-hook-viewer-one' },
    });

    expect(firstResponse.statusCode).toBe(200);
    const afterFirst = await readWatermark('views_engagement', 'views');
    expect(afterFirst.value > before.value).toBe(true);
    expect(afterFirst.lastRequestedValue).toBe(afterFirst.value);
    expect(await countRequestedPyramidVersions()).toBe(1);

    const secondResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/view`,
      headers: { 'x-session-id': 'pyramid-mutation-hook-viewer-two' },
    });

    expect(secondResponse.statusCode).toBe(200);
    const afterSecond = await readWatermark('views_engagement', 'views');
    expect(afterSecond.value > afterFirst.value).toBe(true);
    expect(afterSecond.lastRequestedValue).toBe(afterFirst.lastRequestedValue);
    expect(await countRequestedPyramidVersions()).toBe(1);
  });

  it('property and comment reactions advance social inputs through the same coalesced boundary', async () => {
    const before = await readWatermark('social_inputs', 'social');
    const propertyLikeResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(propertyLikeResponse.statusCode).toBe(201);
    const afterPropertyLike = await readWatermark('social_inputs', 'social');
    expect(afterPropertyLike.value > before.value).toBe(true);
    expect(await countRequestedPyramidVersions()).toBe(1);

    const likeResponse = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(likeResponse.statusCode).toBe(201);
    const afterCommentLike = await readWatermark('social_inputs', 'social');
    expect(afterCommentLike.value > afterPropertyLike.value).toBe(true);
    expect(afterCommentLike.lastRequestedValue).toBe(afterPropertyLike.lastRequestedValue);
    expect(await countRequestedPyramidVersions()).toBe(1);

    const unlikeResponse = await app.inject({
      method: 'DELETE',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(unlikeResponse.statusCode).toBe(200);
    const afterCommentUnlike = await readWatermark('social_inputs', 'social');
    expect(afterCommentUnlike.value > afterCommentLike.value).toBe(true);
    expect(afterCommentUnlike.lastRequestedValue).toBe(afterPropertyLike.lastRequestedValue);
    expect(await countRequestedPyramidVersions()).toBe(1);
  });
});

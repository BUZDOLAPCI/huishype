import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { comments, reactions, users } from '../../db/schema.js';
import { createIntegrationProperty, createIntegrationUser } from './helpers/fixtures.js';

const advancePropertyTilePyramidSourceWatermarkMock = jest.fn(async () => undefined);
const safeRequestPropertyTilePyramidBuildMock = jest.fn(async () => ({ status: 'queued' }));

jest.unstable_mockModule('../../services/property-tile-pyramid.js', () => ({
  advancePropertyTilePyramidSourceWatermark: advancePropertyTilePyramidSourceWatermarkMock,
  safeRequestPropertyTilePyramidBuild: safeRequestPropertyTilePyramidBuildMock,
  getDefaultPropertyTilePyramidSlot: () => ({
    coverageId: 'public_default_low_zoom',
    filterSignature: 'default',
    maxZoom: 14,
    pyramidKind: 'public_default_low_zoom',
  }),
  getPropertyTilePyramidMaxZoom: () => 14,
  isDefaultPropertyTilePyramidPointCovered: () => false,
  isDefaultPropertyTilePyramidTileCovered: () => false,
  buildPropertyTilePyramidCacheKey: () => 'pyramid:contract-test',
  lookupCurrentPropertyTilePyramidVersion: async () => ({
    state: 'none',
    tileStatus: 'pyramid-unavailable',
    reason: 'contract-test',
  }),
  lookupPromotedPropertyTilePyramidTile: async () => ({
    state: 'missing',
    tileStatus: 'pyramid-missing',
    reason: 'contract-test',
  }),
  markPropertyTilePyramidVersionDegraded: async () => undefined,
  requestPropertyTilePyramidBuild: async () => ({ status: 'queued' }),
  getPropertyTilePyramidHealthSummary: async () => ({
    enabled: true,
    status: 'degraded',
    currentVersionId: null,
    currentPromotedAt: null,
    degradedReason: 'no-current-promoted-pyramid',
    activeCandidateVersionId: null,
    activeCandidateStatus: null,
    retryableFailureDueAt: null,
    terminalFailureCount: 0,
    encodedCoverageRatio: null,
    lastSuccessfulPromotionAt: null,
    resourceControls: {
      chunkTileLimit: 128,
      memberPageSize: 500,
      statementTimeoutMs: 30_000,
      leaseSeconds: 600,
      maxHeapMb: 1024,
      maxWalBytesPerChunk: 10_000_000,
    },
  }),
  getPropertyTilePyramidOpsSummary: async () => ({
    status: 'degraded',
    currentVersionId: null,
    currentPromotedAt: null,
    previousVersionId: null,
    degradedReason: 'no-current-promoted-pyramid',
    activeCandidateVersionId: null,
    activeCandidateStatus: null,
    retryableFailureDueAt: null,
    terminalFailureCount: 0,
    encodedCoverageRatio: null,
    manifestTileCount: null,
    encodedTileCount: null,
    nodeCount: null,
    memberCount: null,
    activeLeaseOwner: null,
    activeLeaseAgeSeconds: null,
    lastSuccessfulPromotionAt: null,
    lastAuditAction: null,
    lastAuditReason: null,
    resourceControls: {
      chunkTileLimit: 128,
      memberPageSize: 500,
      statementTimeoutMs: 30_000,
      leaseSeconds: 600,
      maxHeapMb: 1024,
      maxWalBytesPerChunk: 10_000_000,
    },
  }),
}));

describe('property tile pyramid mutation invalidation hooks', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let propertyId: string;
  let commentId: string;

  beforeAll(async () => {
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

  beforeEach(() => {
    advancePropertyTilePyramidSourceWatermarkMock.mockClear();
    safeRequestPropertyTilePyramidBuildMock.mockClear();
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
    if (app) {
      await app.close();
    }
  });

  it('comments advance social pyramid inputs and request a comment-create rebuild', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { content: 'Route hook comment' },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    await db.delete(comments).where(eq(comments.id, body.id));

    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenCalledWith(
      ['social_inputs'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenCalledWith(
      { reason: 'comment-create' },
      expect.anything(),
      expect.objectContaining({ propertyId, commentId: body.id }),
    );
  });

  it('property views advance view engagement inputs and request a property-view rebuild', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/view`,
      headers: { 'x-session-id': 'pyramid-mutation-hook-viewer' },
    });

    expect(response.statusCode).toBe(200);
    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenCalledWith(
      ['views_engagement'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenCalledWith(
      { reason: 'property-view' },
      expect.anything(),
      expect.objectContaining({
        propertyId,
        viewerScope: expect.stringMatching(/^session-hash:/),
      }),
    );
  });

  it('property likes and unlikes advance social inputs and request rebuilds', async () => {
    const likeResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(likeResponse.statusCode).toBe(201);
    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenLastCalledWith(
      ['social_inputs'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenLastCalledWith(
      { reason: 'property-like' },
      expect.anything(),
      expect.objectContaining({ propertyId }),
    );

    const unlikeResponse = await app.inject({
      method: 'DELETE',
      url: `/properties/${propertyId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(unlikeResponse.statusCode).toBe(200);
    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenLastCalledWith(
      ['social_inputs'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenLastCalledWith(
      { reason: 'property-unlike' },
      expect.anything(),
      expect.objectContaining({ propertyId }),
    );
  });

  it('comment likes and unlikes advance social inputs and request rebuilds', async () => {
    const likeResponse = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(likeResponse.statusCode).toBe(201);
    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenLastCalledWith(
      ['social_inputs'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenLastCalledWith(
      { reason: 'comment-like' },
      expect.anything(),
      expect.objectContaining({ commentId }),
    );

    const unlikeResponse = await app.inject({
      method: 'DELETE',
      url: `/comments/${commentId}/like`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(unlikeResponse.statusCode).toBe(200);
    expect(advancePropertyTilePyramidSourceWatermarkMock).toHaveBeenLastCalledWith(
      ['social_inputs'],
      expect.anything(),
    );
    expect(safeRequestPropertyTilePyramidBuildMock).toHaveBeenLastCalledWith(
      { reason: 'comment-unlike' },
      expect.anything(),
      expect.objectContaining({ commentId }),
    );
  });
});

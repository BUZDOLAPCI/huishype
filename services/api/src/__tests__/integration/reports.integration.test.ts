import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { adminLogs, comments, users } from '../../db/schema.js';
import { db } from '../../db/index.js';
import { createIntegrationProperty, createIntegrationUser } from './helpers/fixtures.js';

describe('Report and admin moderation routes', () => {
  let app: FastifyInstance;
  let propertyId: string;
  let adminUserId: string;
  let adminAccessToken: string;
  let userId: string;
  let userAccessToken: string;
  let nonAdminAccessToken: string;
  const createdCommentIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createComment(content: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/comments`,
      headers: { authorization: `Bearer ${userAccessToken}` },
      payload: { content },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { id: string };
    createdCommentIds.push(body.id);
    return body.id;
  }

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    const reporter = await createIntegrationUser(app, { label: 'reports-reporter' });
    userId = reporter.userId;
    userAccessToken = reporter.accessToken;
    createdUserIds.push(reporter.userId);

    const admin = await createIntegrationUser(app, { label: 'reports-admin' });
    adminUserId = admin.userId;
    adminAccessToken = admin.accessToken;
    createdUserIds.push(admin.userId);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.userId));

    const nonAdmin = await createIntegrationUser(app, { label: 'reports-non-admin' });
    nonAdminAccessToken = nonAdmin.accessToken;
    createdUserIds.push(nonAdmin.userId);

    const property = await createIntegrationProperty({
      street: 'Report Fixture Street',
      houseNumber: 42,
      city: 'Report City',
      postalCode: '9040AA',
      lon: 5.4711,
      lat: 51.4411,
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    if (propertyId) {
      const commentTargetPredicate =
        createdCommentIds.length > 0
          ? sql`OR target_id IN (${sql.join(createdCommentIds.map((id) => sql`${id}`), sql`, `)})`
          : sql``;

      await db.execute(sql`
        DELETE FROM admin_logs
        WHERE target_id = ${propertyId}
          ${commentTargetPredicate}
      `);
      await db.execute(sql`
        DELETE FROM content_reports
        WHERE target_id = ${propertyId}
          ${commentTargetPredicate}
      `);
    }
    for (const commentId of createdCommentIds) {
      await db.delete(comments).where(eq(comments.id, commentId));
    }
    for (const uid of createdUserIds) {
      await db.delete(users).where(eq(users.id, uid));
    }
    if (propertyId) {
      await db.execute(sql`DELETE FROM properties WHERE id = ${propertyId}`);
    }
    await app.close();
  });

  it('creates anonymous property reports with a device id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/report`,
      payload: {
        reason: 'wrong_location',
        details: 'Marker is offset.',
        reporterDeviceId: 'device-report-anonymous',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.report.targetType).toBe('property');
    expect(body.report.targetId).toBe(propertyId);
    expect(body.report.reporterUserId).toBeNull();
    expect(body.report.reporterDeviceId).toBe('device-report-anonymous');
    expect(body.report.status).toBe('unresolved');
  });

  it('creates authenticated comment reports with reporter user id', async () => {
    const commentId = await createComment('Reportable comment');

    const response = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/report`,
      headers: { authorization: `Bearer ${userAccessToken}` },
      payload: {
        reason: 'harassment_hate',
        details: 'Contains harassment.',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.report.targetType).toBe('comment');
    expect(body.report.targetId).toBe(commentId);
    expect(body.report.reporterUserId).toBe(userId);
  });

  it('validates report details and target existence', async () => {
    const tooLong = 'x'.repeat(141);
    const invalidDetailsResponse = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/report`,
      payload: {
        reason: 'other',
        details: tooLong,
      },
    });
    expect(invalidDetailsResponse.statusCode).toBe(400);

    const missingPropertyResponse = await app.inject({
      method: 'POST',
      url: '/properties/00000000-0000-0000-0000-000000000000/report',
      payload: {
        reason: 'other',
      },
    });
    expect(missingPropertyResponse.statusCode).toBe(404);

    const missingCommentResponse = await app.inject({
      method: 'POST',
      url: '/comments/00000000-0000-0000-0000-000000000000/report',
      payload: {
        reason: 'other',
      },
    });
    expect(missingCommentResponse.statusCode).toBe(404);
  });

  it('denies admin queues without admin authorization', async () => {
    const noAuthResponse = await app.inject({
      method: 'GET',
      url: '/admin/reports/properties',
    });
    expect(noAuthResponse.statusCode).toBe(401);

    const nonAdminResponse = await app.inject({
      method: 'GET',
      url: '/admin/reports/properties',
      headers: { authorization: `Bearer ${nonAdminAccessToken}` },
    });
    expect(nonAdminResponse.statusCode).toBe(403);
  });

  it('lists and resolves property reports with admin logs', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/report`,
      payload: { reason: 'incorrect_property_data' },
    });
    const firstBody = JSON.parse(first.body);

    await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/report`,
      payload: { reason: 'wrong_listing' },
    });

    const queueResponse = await app.inject({
      method: 'GET',
      url: '/admin/reports/properties',
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(queueResponse.statusCode).toBe(200);
    const queueBody = JSON.parse(queueResponse.body);
    expect(queueBody.data.some((report: { id: string }) => report.id === firstBody.report.id)).toBe(true);
    const queuedReport = queueBody.data.find((report: { id: string }) => report.id === firstBody.report.id);
    expect(queuedReport.property).toMatchObject({
      id: propertyId,
      address: expect.stringContaining('Report Fixture Street'),
      city: 'Report City',
    });
    expect(queuedReport.reporter).toBeNull();

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/admin/reports/${firstBody.report.id}`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = JSON.parse(detailResponse.body);
    expect(detailBody.report.id).toBe(firstBody.report.id);
    expect(detailBody.target).toMatchObject({ id: propertyId });
    expect(detailBody.activeReports.length).toBeGreaterThanOrEqual(2);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${firstBody.report.id}`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { action: 'dismiss_reports' },
    });
    expect(patchResponse.statusCode).toBe(200);
    const patchBody = JSON.parse(patchResponse.body);
    expect(patchBody.report.status).toBe('resolved');
    expect(patchBody.report.reviewAction).toBe('dismiss_reports');
    expect(patchBody.report.reviewedBy).toBe(adminUserId);
    expect(patchBody.resolvedCount).toBeGreaterThanOrEqual(2);

    const [logCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminLogs)
      .where(eq(adminLogs.reportId, firstBody.report.id));
    expect(logCount?.count).toBe(1);
  });

  it('marks a property reviewed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/report`,
      payload: { reason: 'privacy_safety' },
    });
    const body = JSON.parse(response.body);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${body.report.id}`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { action: 'mark_property_reviewed' },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patchBody = JSON.parse(patchResponse.body);
    expect(patchBody.report.reviewAction).toBe('mark_property_reviewed');
  });

  it('hides reported comments from public comment queries and logs the action', async () => {
    const commentId = await createComment('Comment that should be hidden');
    const beforeResponse = await app.inject({
      method: 'GET',
      url: `/properties/${propertyId}/comments?limit=50`,
    });
    const beforeBody = JSON.parse(beforeResponse.body);
    expect(beforeBody.data.some((comment: { id: string }) => comment.id === commentId)).toBe(true);

    const reportResponse = await app.inject({
      method: 'POST',
      url: `/comments/${commentId}/report`,
      payload: { reason: 'spam', reporterDeviceId: 'device-hide-comment' },
    });
    const reportBody = JSON.parse(reportResponse.body);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/reports/${reportBody.report.id}`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: {
        action: 'hide_comment',
        moderationReason: 'Spam report verified',
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    const patchBody = JSON.parse(patchResponse.body);
    expect(patchBody.hiddenCommentId).toBe(commentId);
    expect(patchBody.report.comment).toMatchObject({
      id: commentId,
      text: 'Comment that should be hidden',
    });

    const [hiddenComment] = await db
      .select({
        hiddenAt: comments.hiddenAt,
        hiddenBy: comments.hiddenBy,
        moderationReason: comments.moderationReason,
      })
      .from(comments)
      .where(eq(comments.id, commentId));
    expect(hiddenComment.hiddenAt).toBeInstanceOf(Date);
    expect(hiddenComment.hiddenBy).toBe(adminUserId);
    expect(hiddenComment.moderationReason).toBe('Spam report verified');

    const afterResponse = await app.inject({
      method: 'GET',
      url: `/properties/${propertyId}/comments?limit=50`,
    });
    const afterBody = JSON.parse(afterResponse.body);
    expect(afterBody.data.some((comment: { id: string }) => comment.id === commentId)).toBe(false);

    const [logCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminLogs)
      .where(eq(adminLogs.reportId, reportBody.report.id));
    expect(logCount?.count).toBe(1);
  });
});

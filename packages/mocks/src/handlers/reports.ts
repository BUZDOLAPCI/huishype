/**
 * Report/admin moderation mock handlers.
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 */

import { http, HttpResponse } from 'msw';
import {
  commentReportCategories,
  propertyReportCategories,
  type AdminPatchReportResponse,
  type AdminReportListResponse,
  type ContentReportReviewAction,
  type ContentReportResponse,
  type ReportCommentRequest,
  type ReportPropertyRequest,
} from '@huishype/shared';
import { mockComments, getMockProperty, mockUsers } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

const sessionReports: ContentReportResponse[] = [];
const hiddenCommentIds = new Set<string>();
const sessionLogs: Array<{
  id: string;
  createdAt: string;
  action: ContentReportReviewAction;
  targetType: 'property' | 'comment';
  targetId: string;
  details: Record<string, unknown>;
}> = [];

function createMockId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return '10000000-0000-4000-8000-' + Math.floor(Math.random() * 1e12).toString().padStart(12, '0');
}

function isAdminRequest(authHeader: string | null) {
  return authHeader === 'Bearer mock-admin-token';
}

function requireAdmin(authHeader: string | null) {
  if (!authHeader) {
    return HttpResponse.json(
      { error: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 }
    );
  }

  if (!isAdminRequest(authHeader)) {
    return HttpResponse.json(
      { error: 'FORBIDDEN', message: 'Admin access required' },
      { status: 403 }
    );
  }

  return null;
}

function createReport(
  targetType: 'property' | 'comment',
  targetId: string,
  reason: ContentReportResponse['reason'],
  details: string | undefined,
  reporterDeviceId: string | undefined,
  reporterUserId: string | null
) {
  const now = new Date().toISOString();
  const property = targetType === 'property' ? getMockProperty(targetId) : undefined;
  const comment = targetType === 'comment' ? findComment(targetId) : undefined;
  const commentProperty = comment ? getMockProperty(comment.propertyId) : undefined;
  const report: ContentReportResponse = {
    id: createMockId(),
    targetType,
    targetId,
    reporterUserId,
    reporterDeviceId: reporterDeviceId ?? null,
    reason,
    details: details ?? null,
    status: 'unresolved',
    reviewAction: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    property: property
      ? {
          id: property.id,
          address: property.address,
          street: property.streetName,
          city: property.city,
          postalCode: property.postalCode,
          houseNumber: Number(property.houseNumber),
          houseNumberAddition: property.houseNumberAddition ?? null,
          countryCode: property.countryCode,
        }
      : null,
    comment: comment
      ? {
          id: comment.id,
          text: comment.content,
          author: {
            id: comment.user.id,
            username: comment.user.username,
            displayName: comment.user.displayName,
            karma: comment.user.karma,
          },
          property: commentProperty
            ? {
                id: commentProperty.id,
                address: commentProperty.address,
                street: commentProperty.streetName,
                city: commentProperty.city,
                postalCode: commentProperty.postalCode,
                houseNumber: Number(commentProperty.houseNumber),
                houseNumberAddition: commentProperty.houseNumberAddition ?? null,
                countryCode: commentProperty.countryCode,
              }
            : null,
        }
      : null,
    reporter: reporterUserId
      ? (() => {
          const user = mockUsers.find((item) => item.id === reporterUserId);
          return user
            ? {
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                email: null,
                karma: user.karma,
              }
            : null;
        })()
      : null,
  };
  sessionReports.unshift(report);
  return report;
}

function findComment(commentId: string) {
  return (
    mockComments.find((comment) => comment.id === commentId) ??
    mockComments.flatMap((comment) => comment.replies).find((comment) => comment.id === commentId)
  );
}

function listReports(
  targetType: 'property' | 'comment',
  status: 'unresolved' | 'resolved' | 'all',
  limit: number,
  offset: number
): AdminReportListResponse {
  const filtered = sessionReports.filter(
    (report) => report.targetType === targetType && (status === 'all' || report.status === status)
  );

  return {
    data: filtered.slice(offset, offset + limit),
    meta: {
      limit,
      offset,
      total: filtered.length,
    },
    recentModerationActions: sessionLogs.slice(0, 20),
  };
}

export function isMockCommentHidden(commentId: string) {
  return hiddenCommentIds.has(commentId);
}

export function resetMockReports() {
  sessionReports.length = 0;
  hiddenCommentIds.clear();
  sessionLogs.length = 0;
}

export const reportHandlers = [
  http.post('*/properties/:propertyId/report', async ({ params, request }) => {
    const { propertyId } = params;
    const property = getMockProperty(String(propertyId));
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found.' },
        { status: 404 }
      );
    }

    const body = (await request.json()) as ReportPropertyRequest;
    if (!propertyReportCategories.includes(body.reason)) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid property report reason.' },
        { status: 400 }
      );
    }
    if (body.details && body.details.length > 140) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Details must be at most 140 characters.' },
        { status: 400 }
      );
    }

    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    const report = createReport(
      'property',
      String(propertyId),
      body.reason,
      body.details,
      body.reporterDeviceId,
      authUser?.id ?? null
    );

    return HttpResponse.json({ report }, { status: 201 });
  }),

  http.post('*/comments/:commentId/report', async ({ params, request }) => {
    const { commentId } = params;
    const comment = findComment(String(commentId));
    if (!comment) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Comment not found.' },
        { status: 404 }
      );
    }

    const body = (await request.json()) as ReportCommentRequest;
    if (!commentReportCategories.includes(body.reason)) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid comment report reason.' },
        { status: 400 }
      );
    }
    if (body.details && body.details.length > 140) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Details must be at most 140 characters.' },
        { status: 400 }
      );
    }

    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    const report = createReport(
      'comment',
      String(commentId),
      body.reason,
      body.details,
      body.reporterDeviceId,
      authUser?.id ?? null
    );

    return HttpResponse.json({ report }, { status: 201 });
  }),

  http.get('*/admin/reports/properties', ({ request }) => {
    const denied = requireAdmin(request.headers.get('Authorization'));
    if (denied) return denied;

    const url = new URL(request.url);
    const status = (url.searchParams.get('status') ?? 'unresolved') as
      | 'unresolved'
      | 'resolved'
      | 'all';
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);

    return HttpResponse.json(listReports('property', status, limit, offset));
  }),

  http.get('*/admin/reports/comments', ({ request }) => {
    const denied = requireAdmin(request.headers.get('Authorization'));
    if (denied) return denied;

    const url = new URL(request.url);
    const status = (url.searchParams.get('status') ?? 'unresolved') as
      | 'unresolved'
      | 'resolved'
      | 'all';
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);

    return HttpResponse.json(listReports('comment', status, limit, offset));
  }),

  http.get('*/admin/reports/:reportId', ({ params, request }) => {
    const denied = requireAdmin(request.headers.get('Authorization'));
    if (denied) return denied;

    const report = sessionReports.find((item) => item.id === params.reportId);
    if (!report) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Report not found.' },
        { status: 404 }
      );
    }

    const activeReports = sessionReports.filter(
      (item) =>
        item.targetType === report.targetType &&
        item.targetId === report.targetId &&
        item.status === 'unresolved'
    );

    return HttpResponse.json({
      report,
      target: report.comment ?? report.property ?? null,
      activeReports,
      recentModerationActions: sessionLogs.filter(
        (entry) => entry.targetType === report.targetType && entry.targetId === report.targetId
      ),
    });
  }),

  http.patch('*/admin/reports/:reportId', async ({ params, request }) => {
    const denied = requireAdmin(request.headers.get('Authorization'));
    if (denied) return denied;

    const report = sessionReports.find((item) => item.id === params.reportId);
    if (!report) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Report not found.' },
        { status: 404 }
      );
    }

    const body = (await request.json()) as { action: ContentReportResponse['reviewAction'] };
    if (!body.action) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Action is required.' },
        { status: 400 }
      );
    }

    if (body.action === 'mark_property_reviewed' && report.targetType !== 'property') {
      return HttpResponse.json(
        { error: 'INVALID_ACTION', message: 'Action requires a property report.' },
        { status: 400 }
      );
    }
    if (body.action === 'hide_comment' && report.targetType !== 'comment') {
      return HttpResponse.json(
        { error: 'INVALID_ACTION', message: 'Action requires a comment report.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let resolvedCount = 0;
    for (const item of sessionReports) {
      if (
        item.targetType === report.targetType &&
        item.targetId === report.targetId &&
        item.status === 'unresolved'
      ) {
        item.status = 'resolved';
        item.reviewAction = body.action;
        item.reviewedBy = 'mock-admin-user';
        item.reviewedAt = now;
        item.updatedAt = now;
        resolvedCount += 1;
      }
    }

    const response: AdminPatchReportResponse = {
      report,
      resolvedCount,
      ...(body.action === 'hide_comment' ? { hiddenCommentId: report.targetId } : {}),
    };

    sessionLogs.unshift({
      id: createMockId(),
      createdAt: now,
      action: body.action,
      targetType: report.targetType,
      targetId: report.targetId,
      details: { resolvedCount },
    });

    if (body.action === 'hide_comment') {
      hiddenCommentIds.add(report.targetId);
    }

    return HttpResponse.json(response);
  }),
];

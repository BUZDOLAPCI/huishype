import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  commentReportCategories,
  propertyReportCategories,
  type CountryCode,
} from '@huishype/shared';
import { db, adminLogs, comments, contentReports, properties, users } from '../db/index.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { advancePropertyChangeVersion } from '../services/property-read-state.js';
import {
  advancePropertyTilePyramidSourceWatermark,
  safeRequestPropertyTilePyramidBuildAfterMutation,
} from '../services/property-tile-pyramid.js';
import { formatDisplayAddress } from '../utils/address.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const propertyReportBodySchema = z.object({
  reason: z.enum(propertyReportCategories),
  details: z.string().trim().max(140).optional(),
  reporterDeviceId: z.string().trim().min(1).max(128).optional(),
});

const commentReportBodySchema = z.object({
  reason: z.enum(commentReportCategories),
  details: z.string().trim().max(140).optional(),
  reporterDeviceId: z.string().trim().min(1).max(128).optional(),
});

const reportStatusSchema = z.enum(['unresolved', 'resolved']);
const adminReportActionSchema = z.enum([
  'dismiss_reports',
  'mark_property_reviewed',
  'hide_comment',
]);

const reportResponseSchema = z.object({
  id: z.string().uuid(),
  targetType: z.enum(['property', 'comment']),
  targetId: z.string().uuid(),
  reporterUserId: z.string().uuid().nullable(),
  reporterDeviceId: z.string().nullable(),
  reason: z.string(),
  details: z.string().nullable(),
  status: reportStatusSchema,
  reviewAction: adminReportActionSchema.nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reporter: z
    .object({
      id: z.string().uuid(),
      username: z.string(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      karma: z.number().nullable(),
    })
    .nullable()
    .optional(),
  property: z
    .object({
      id: z.string().uuid(),
      address: z.string(),
      street: z.string(),
      city: z.string(),
      postalCode: z.string().nullable(),
      houseNumber: z.number(),
      houseNumberAddition: z.string().nullable(),
      countryCode: z.string(),
    })
    .nullable()
    .optional(),
  comment: z
    .object({
      id: z.string().uuid(),
      text: z.string(),
      author: z
        .object({
          id: z.string().uuid(),
          username: z.string(),
          displayName: z.string().nullable(),
          karma: z.number().nullable(),
        })
        .nullable()
        .optional(),
      property: z
        .object({
          id: z.string().uuid(),
          address: z.string(),
          street: z.string(),
          city: z.string(),
          postalCode: z.string().nullable(),
          houseNumber: z.number(),
          houseNumberAddition: z.string().nullable(),
          countryCode: z.string(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const adminLogResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  action: adminReportActionSchema,
  targetType: z.enum(['property', 'comment']),
  targetId: z.string().uuid(),
  details: z.record(z.string(), z.unknown()),
  admin: z
    .object({
      id: z.string().uuid(),
      username: z.string(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

const createReportResponseSchema = z.object({
  report: reportResponseSchema,
});

const adminReportListQuerySchema = z.object({
  status: z.enum(['unresolved', 'resolved', 'all']).default('unresolved'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const adminReportListResponseSchema = z.object({
  data: z.array(reportResponseSchema),
  meta: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
  recentModerationActions: z.array(adminLogResponseSchema).optional(),
});

const adminReportDetailResponseSchema = z.object({
  report: reportResponseSchema,
  target: z.union([reportResponseSchema.shape.property.unwrap(), reportResponseSchema.shape.comment.unwrap()]).nullable(),
  activeReports: z.array(reportResponseSchema),
  recentModerationActions: z.array(adminLogResponseSchema),
});

const adminPatchReportBodySchema = z.object({
  action: adminReportActionSchema,
  moderationReason: z.string().trim().max(140).optional(),
});

const adminPatchReportResponseSchema = z.object({
  report: reportResponseSchema,
  resolvedCount: z.number(),
  hiddenCommentId: z.string().uuid().optional(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

type ContentReportRow = typeof contentReports.$inferSelect;
type PropertyPreview = {
  id: string;
  address: string;
  street: string;
  city: string;
  postalCode: string | null;
  houseNumber: number;
  houseNumberAddition: string | null;
  countryCode: string;
};
type ReporterPreview = {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  karma: number | null;
};
type CommentPreview = {
  id: string;
  text: string;
  author: Omit<ReporterPreview, 'email'> | null;
  property: PropertyPreview | null;
};
type ReportContext = {
  reporters: Map<string, ReporterPreview>;
  properties: Map<string, PropertyPreview>;
  comments: Map<string, CommentPreview>;
};

function formatPropertyPreview(property: {
  id: string;
  countryCode: string;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  postalCode: string | null;
  city: string;
}): PropertyPreview {
  return {
    id: property.id,
    address: formatDisplayAddress({
      street: property.street,
      houseNumber: property.houseNumber,
      houseNumberAddition: property.houseNumberAddition,
      city: property.city,
      postalCode: property.postalCode ?? '',
    }, property.countryCode as CountryCode),
    street: property.street,
    city: property.city,
    postalCode: property.postalCode,
    houseNumber: property.houseNumber,
    houseNumberAddition: property.houseNumberAddition,
    countryCode: property.countryCode,
  };
}

function formatReport(report: ContentReportRow, context?: ReportContext) {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reporterUserId: report.reporterUserId,
    reporterDeviceId: report.reporterDeviceId,
    reason: report.reason,
    details: report.details,
    status: report.status,
    reviewAction: report.reviewAction,
    reviewedBy: report.reviewedBy,
    reviewedAt: report.reviewedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    reporter: report.reporterUserId ? context?.reporters.get(report.reporterUserId) ?? null : null,
    property: report.targetType === 'property'
      ? context?.properties.get(report.targetId) ?? null
      : context?.comments.get(report.targetId)?.property ?? null,
    comment: report.targetType === 'comment'
      ? context?.comments.get(report.targetId) ?? null
      : null,
  };
}

async function buildReportContext(reports: ContentReportRow[]): Promise<ReportContext> {
  const reporterIds = Array.from(
    new Set(reports.map((report) => report.reporterUserId).filter((id): id is string => !!id)),
  );
  const propertyTargetIds = reports
    .filter((report) => report.targetType === 'property')
    .map((report) => report.targetId);
  const commentTargetIds = reports
    .filter((report) => report.targetType === 'comment')
    .map((report) => report.targetId);

  const commentRows = commentTargetIds.length > 0
    ? await db
        .select({
          id: comments.id,
          content: comments.content,
          userId: comments.userId,
          propertyId: comments.propertyId,
        })
        .from(comments)
        .where(inArray(comments.id, commentTargetIds))
    : [];

  const propertyIds = Array.from(
    new Set([...propertyTargetIds, ...commentRows.map((comment) => comment.propertyId)]),
  );
  const authorIds = Array.from(new Set(commentRows.map((comment) => comment.userId)));
  const userIds = Array.from(new Set([...reporterIds, ...authorIds]));

  const propertyRows = propertyIds.length > 0
    ? await db
        .select({
          id: properties.id,
          countryCode: properties.countryCode,
          street: properties.street,
          houseNumber: properties.houseNumber,
          houseNumberAddition: properties.houseNumberAddition,
          postalCode: properties.postalCode,
          city: properties.city,
        })
        .from(properties)
        .where(inArray(properties.id, propertyIds))
    : [];

  const userRows = userIds.length > 0
    ? await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          karma: users.karma,
        })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];

  const reporters = new Map<string, ReporterPreview>();
  for (const user of userRows) {
    reporters.set(user.id, {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      karma: user.karma,
    });
  }

  const propertyMap = new Map<string, PropertyPreview>();
  for (const property of propertyRows) {
    propertyMap.set(property.id, formatPropertyPreview(property));
  }

  const commentsMap = new Map<string, CommentPreview>();
  for (const comment of commentRows) {
    const author = reporters.get(comment.userId);
    commentsMap.set(comment.id, {
      id: comment.id,
      text: comment.content,
      author: author
        ? {
            id: author.id,
            username: author.username,
            displayName: author.displayName,
            karma: author.karma,
          }
        : null,
      property: propertyMap.get(comment.propertyId) ?? null,
    });
  }

  return { reporters, properties: propertyMap, comments: commentsMap };
}

async function listRecentModerationActions(targetType?: 'property' | 'comment', targetId?: string) {
  const rows = await db
    .select({
      id: adminLogs.id,
      action: adminLogs.action,
      targetType: adminLogs.targetType,
      targetId: adminLogs.targetId,
      metadata: adminLogs.metadata,
      createdAt: adminLogs.createdAt,
      adminId: users.id,
      adminUsername: users.username,
      adminDisplayName: users.displayName,
      adminEmail: users.email,
    })
    .from(adminLogs)
    .leftJoin(users, eq(users.id, adminLogs.adminUserId))
    .where(targetType && targetId ? and(eq(adminLogs.targetType, targetType), eq(adminLogs.targetId, targetId)) : undefined)
    .orderBy(desc(adminLogs.createdAt))
    .limit(20);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details: row.metadata,
    createdAt: row.createdAt.toISOString(),
    admin: row.adminId
      ? {
          id: row.adminId,
          username: row.adminUsername!,
          displayName: row.adminDisplayName,
          email: row.adminEmail,
        }
      : null,
  }));
}

async function createReport(
  targetType: 'property' | 'comment',
  targetId: string,
  reason: string,
  reporterUserId: string | null,
  reporterDeviceId: string | null,
  details: string | null,
) {
  const [report] = await db
    .insert(contentReports)
    .values({
      targetType,
      targetId,
      reporterUserId,
      reporterDeviceId,
      reason,
      details,
    })
    .returning();

  return report;
}

export async function reportRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/properties/:id/report',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['reports'],
        summary: 'Report a property',
        params: uuidParamSchema,
        body: propertyReportBodySchema,
        response: {
          201: createReportResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const { reason, details, reporterDeviceId } = request.body;

      const [property] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (!property) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Property not found.',
        });
      }

      const report = await createReport(
        'property',
        propertyId,
        reason,
        request.userId ?? null,
        reporterDeviceId ?? null,
        details ?? null,
      );

      return reply.status(201).send({ report: formatReport(report) });
    },
  );

  typedApp.post(
    '/comments/:id/report',
    {
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['reports'],
        summary: 'Report a comment',
        params: uuidParamSchema,
        body: commentReportBodySchema,
        response: {
          201: createReportResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: commentId } = request.params;
      const { reason, details, reporterDeviceId } = request.body;

      const [comment] = await db
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (!comment) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Comment not found.',
        });
      }

      const report = await createReport(
        'comment',
        commentId,
        reason,
        request.userId ?? null,
        reporterDeviceId ?? null,
        details ?? null,
      );

      return reply.status(201).send({ report: formatReport(report) });
    },
  );

  async function listReports(targetType: 'property' | 'comment', status: 'unresolved' | 'resolved' | 'all', limit: number, offset: number) {
    const predicate =
      status === 'all'
        ? eq(contentReports.targetType, targetType)
        : and(eq(contentReports.targetType, targetType), eq(contentReports.status, status));

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentReports)
      .where(predicate);

    const rows = await db
      .select()
      .from(contentReports)
      .where(predicate)
      .orderBy(desc(contentReports.createdAt))
      .limit(limit)
      .offset(offset);
    const context = await buildReportContext(rows);

    return {
      data: rows.map((report) => formatReport(report, context)),
      meta: {
        limit,
        offset,
        total: totalRow?.count ?? 0,
      },
      recentModerationActions: await listRecentModerationActions(targetType),
    };
  }

  typedApp.get(
    '/admin/reports/properties',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['admin', 'reports'],
        summary: 'List property reports',
        querystring: adminReportListQuerySchema,
        response: {
          200: adminReportListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { status, limit, offset } = request.query;
      return listReports('property', status, limit, offset);
    },
  );

  typedApp.get(
    '/admin/reports/comments',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['admin', 'reports'],
        summary: 'List comment reports',
        querystring: adminReportListQuerySchema,
        response: {
          200: adminReportListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { status, limit, offset } = request.query;
      return listReports('comment', status, limit, offset);
    },
  );

  typedApp.get(
    '/admin/reports/:id',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['admin', 'reports'],
        summary: 'Get a report',
        params: uuidParamSchema,
        response: {
          200: adminReportDetailResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const [report] = await db
        .select()
        .from(contentReports)
        .where(eq(contentReports.id, id))
        .limit(1);

      if (!report) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Report not found.',
        });
      }

      const activeReports = await db
        .select()
        .from(contentReports)
        .where(
          and(
            eq(contentReports.targetType, report.targetType),
            eq(contentReports.targetId, report.targetId),
            eq(contentReports.status, 'unresolved'),
          ),
        )
        .orderBy(desc(contentReports.createdAt));
      const reportsForContext = activeReports.some((activeReport) => activeReport.id === report.id)
        ? activeReports
        : [report, ...activeReports];
      const context = await buildReportContext(reportsForContext);
      const formattedReport = formatReport(report, context);

      return reply.send({
        report: formattedReport,
        target: formattedReport.comment ?? formattedReport.property ?? null,
        activeReports: activeReports.map((activeReport) => formatReport(activeReport, context)),
        recentModerationActions: await listRecentModerationActions(report.targetType, report.targetId),
      });
    },
  );

  typedApp.patch(
    '/admin/reports/:id',
    {
      onRequest: [app.requireAdmin],
      schema: {
        tags: ['admin', 'reports'],
        summary: 'Resolve a report with a moderation action',
        params: uuidParamSchema,
        body: adminPatchReportBodySchema,
        response: {
          200: adminPatchReportResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { action, moderationReason } = request.body;
      const adminUserId = request.userId!;

      const outcome = await db.transaction(async (tx) => {
        const [report] = await tx
          .select()
          .from(contentReports)
          .where(eq(contentReports.id, id))
          .limit(1);

        if (!report) {
          return { status: 'not_found' as const };
        }

        if (action === 'mark_property_reviewed' && report.targetType !== 'property') {
          return { status: 'wrong_target' as const, message: 'Action requires a property report.' };
        }

        if (action === 'hide_comment' && report.targetType !== 'comment') {
          return { status: 'wrong_target' as const, message: 'Action requires a comment report.' };
        }

        let hiddenCommentId: string | undefined;
        let hiddenPropertyId: string | undefined;

        if (action === 'hide_comment') {
          const [comment] = await tx
            .select({ id: comments.id, propertyId: comments.propertyId })
            .from(comments)
            .where(eq(comments.id, report.targetId))
            .limit(1);

          if (!comment) {
            return { status: 'target_missing' as const, message: 'Comment not found.' };
          }

          await tx
            .update(comments)
            .set({
              hiddenAt: new Date(),
              hiddenBy: adminUserId,
              moderationReason: moderationReason ?? null,
              updatedAt: new Date(),
            })
            .where(eq(comments.id, comment.id));

          await advancePropertyChangeVersion(comment.propertyId, tx);
          await advancePropertyTilePyramidSourceWatermark(['social_inputs'], tx);
          hiddenCommentId = comment.id;
          hiddenPropertyId = comment.propertyId;
        }

        const resolved = await tx
          .update(contentReports)
          .set({
            status: 'resolved',
            reviewAction: action,
            reviewedBy: adminUserId,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(contentReports.targetType, report.targetType),
              eq(contentReports.targetId, report.targetId),
              eq(contentReports.status, 'unresolved'),
            ),
          )
          .returning();

        const [updatedReport] = await tx
          .select()
          .from(contentReports)
          .where(eq(contentReports.id, id))
          .limit(1);

        await tx.insert(adminLogs).values({
          adminUserId,
          action,
          reportId: id,
          targetType: report.targetType,
          targetId: report.targetId,
          metadata: {
            resolvedCount: resolved.length,
            moderationReason: moderationReason ?? null,
            hiddenCommentId: hiddenCommentId ?? null,
          },
        });

        return {
          status: 'ok' as const,
          report: updatedReport ?? report,
          resolvedCount: resolved.length,
          hiddenCommentId,
          hiddenPropertyId,
        };
      });

      if (outcome.status === 'not_found') {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Report not found.',
        });
      }

      if (outcome.status === 'wrong_target' || outcome.status === 'target_missing') {
        return reply.status(400).send({
          error: 'INVALID_ACTION',
          message: outcome.message,
        });
      }

      if (outcome.hiddenPropertyId) {
        await safeRequestPropertyTilePyramidBuildAfterMutation(
          { reason: 'comment-hide', policy: 'social', watermarkScopes: ['social_inputs'] },
          request.log,
          { propertyId: outcome.hiddenPropertyId, commentId: outcome.hiddenCommentId },
        );
      }

      const context = await buildReportContext([outcome.report]);

      return reply.send({
        report: formatReport(outcome.report, context),
        resolvedCount: outcome.resolvedCount,
        ...(outcome.hiddenCommentId ? { hiddenCommentId: outcome.hiddenCommentId } : {}),
      });
    },
  );
}

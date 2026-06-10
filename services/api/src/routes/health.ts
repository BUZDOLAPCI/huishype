import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  getPropertyTilePyramidHealthSummary,
  getPropertyTilePyramidOpsSummary,
} from '../services/property-tile-pyramid.js';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string().datetime(),
  version: z.string(),
  uptime: z.number().describe('Server uptime in seconds'),
  propertyTilePyramid: z.object({
    status: z.enum(['ok', 'degraded']),
    currentVersionId: z.string().nullable(),
    degradedReason: z.string().nullable(),
    activeCandidateVersionId: z.string().nullable(),
    retryableFailureDueAt: z.string().nullable(),
    terminalFailureCount: z.number(),
    encodedCoverageRatio: z.number().nullable(),
    closedWatermarkMaxUpdatedAt: z.string().nullable(),
    currentWatermarkMaxUpdatedAt: z.string().nullable(),
    closedToCurrentWatermarkLagSeconds: z.number().nullable(),
    lastSuccessfulPromotionAt: z.string().nullable(),
  }),
});

const healthQuerySchema = z.object({
  allowDegraded: z.preprocess((value) => value === true || value === 'true', z.boolean()).optional(),
  strictPyramid: z.preprocess((value) => value === true || value === 'true', z.boolean()).optional(),
});

const opsPropertyTilePyramidResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  currentVersionId: z.string().nullable(),
  currentPromotedAt: z.string().nullable(),
  previousVersionId: z.string().nullable(),
  degradedReason: z.string().nullable(),
  activeCandidateVersionId: z.string().nullable(),
  activeCandidateStatus: z.string().nullable(),
  retryableFailureDueAt: z.string().nullable(),
  terminalFailureCount: z.number(),
  encodedCoverageRatio: z.number().nullable(),
  closedWatermarkMaxUpdatedAt: z.string().nullable(),
  currentWatermarkMaxUpdatedAt: z.string().nullable(),
  closedToCurrentWatermarkLagSeconds: z.number().nullable(),
  manifestTileCount: z.number().nullable(),
  encodedTileCount: z.number().nullable(),
  nodeCount: z.number().nullable(),
  memberCount: z.number().nullable(),
  generationCounts: z.record(z.string(), z.number()),
  activeBuildCount: z.number(),
  retainedGenerationCount: z.number(),
  relationStats: z.array(
    z.object({
      relationName: z.string(),
      rowEstimate: z.number().nullable(),
      totalBytes: z.number().nullable(),
    })
  ),
  currentBuildDurationMs: z.number().nullable(),
  currentObservedWalBytes: z.number().nullable(),
  activeCandidateStage: z.string().nullable(),
  activeCandidateBuildDurationMs: z.number().nullable(),
  activeCandidateChunkProgress: z.record(z.string(), z.unknown()).nullable(),
  activeCandidateObservedWalBytes: z.number().nullable(),
  activeLeaseOwner: z.string().nullable(),
  activeLeaseAgeSeconds: z.number().nullable(),
  lastSuccessfulPromotionAt: z.string().nullable(),
  lastAuditAction: z.string().nullable(),
  lastAuditReason: z.string().nullable(),
  lastRetentionResult: z.object({
    action: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: z.string().nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
  }),
  lastEligibilityVerdict: z.string().nullable(),
  lastEligibilityBlockReason: z.string().nullable(),
  resourceControls: z.object({
    chunkTileLimit: z.number(),
    memberPageSize: z.number(),
    statementTimeoutMs: z.number(),
    leaseSeconds: z.number(),
    maxHeapMb: z.number(),
    maxMemberRows: z.number(),
    maxWalBytesPerChunk: z.number(),
    maxWalBytesPerBuild: z.number(),
  }),
});

export async function healthRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        description: 'Returns the health status of the API server',
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
        querystring: healthQuerySchema,
      },
    },
    async (request, reply) => {
      const pyramid = await getPropertyTilePyramidHealthSummary();
      const status = request.query.strictPyramid && pyramid.status !== 'ok'
        ? ('degraded' as const)
        : ('ok' as const);
      const statusCode = request.query.strictPyramid && pyramid.status !== 'ok' ? 503 : 200;

      return reply.code(statusCode).send({
        status,
        timestamp: new Date().toISOString(),
        version: '0.1.0',
        uptime: process.uptime(),
        propertyTilePyramid: {
          status: pyramid.status,
          currentVersionId: pyramid.currentVersionId,
          degradedReason: pyramid.degradedReason,
          activeCandidateVersionId: pyramid.activeCandidateVersionId,
          retryableFailureDueAt: pyramid.retryableFailureDueAt,
          terminalFailureCount: pyramid.terminalFailureCount,
          encodedCoverageRatio: pyramid.encodedCoverageRatio,
          closedWatermarkMaxUpdatedAt: pyramid.closedWatermarkMaxUpdatedAt,
          currentWatermarkMaxUpdatedAt: pyramid.currentWatermarkMaxUpdatedAt,
          closedToCurrentWatermarkLagSeconds: pyramid.closedToCurrentWatermarkLagSeconds,
          lastSuccessfulPromotionAt: pyramid.lastSuccessfulPromotionAt,
        },
      });
    }
  );

  typedApp.get(
    '/health/property-tile-pyramid',
    {
      schema: {
        tags: ['health'],
        summary: 'Strict property tile pyramid readiness check',
        description: 'Returns 503 when the API is healthy but the materialized property tile pyramid is not ready.',
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const pyramid = await getPropertyTilePyramidHealthSummary();
      const status = pyramid.status === 'ok' ? ('ok' as const) : ('degraded' as const);
      const statusCode = status === 'ok' ? 200 : 503;

      return reply.code(statusCode).send({
        status,
        timestamp: new Date().toISOString(),
        version: '0.1.0',
        uptime: process.uptime(),
        propertyTilePyramid: {
          status: pyramid.status,
          currentVersionId: pyramid.currentVersionId,
          degradedReason: pyramid.degradedReason,
          activeCandidateVersionId: pyramid.activeCandidateVersionId,
          retryableFailureDueAt: pyramid.retryableFailureDueAt,
          terminalFailureCount: pyramid.terminalFailureCount,
          encodedCoverageRatio: pyramid.encodedCoverageRatio,
          closedWatermarkMaxUpdatedAt: pyramid.closedWatermarkMaxUpdatedAt,
          currentWatermarkMaxUpdatedAt: pyramid.currentWatermarkMaxUpdatedAt,
          closedToCurrentWatermarkLagSeconds: pyramid.closedToCurrentWatermarkLagSeconds,
          lastSuccessfulPromotionAt: pyramid.lastSuccessfulPromotionAt,
        },
      });
    }
  );

  typedApp.get(
    '/ops/property-tile-pyramid',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['ops'],
        summary: 'Property tile pyramid operational state',
        response: {
          200: opsPropertyTilePyramidResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const summary = await getPropertyTilePyramidOpsSummary();
      return reply.send(summary);
    }
  );
}

// Export response type for client usage
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
    lastSuccessfulPromotionAt: z.string().nullable(),
  }),
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
  manifestTileCount: z.number().nullable(),
  encodedTileCount: z.number().nullable(),
  nodeCount: z.number().nullable(),
  memberCount: z.number().nullable(),
  activeLeaseOwner: z.string().nullable(),
  activeLeaseAgeSeconds: z.number().nullable(),
  lastSuccessfulPromotionAt: z.string().nullable(),
  lastAuditAction: z.string().nullable(),
  lastAuditReason: z.string().nullable(),
  resourceControls: z.object({
    chunkTileLimit: z.number(),
    memberPageSize: z.number(),
    statementTimeoutMs: z.number(),
    leaseSeconds: z.number(),
    maxHeapMb: z.number(),
    maxWalBytesPerChunk: z.number(),
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
        },
      },
    },
    async (_request, reply) => {
      const pyramid = await getPropertyTilePyramidHealthSummary();
      return reply.send({
        status: pyramid.status === 'ok' ? 'ok' as const : 'degraded' as const,
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
    },
  );
}

// Export response type for client usage
export type HealthResponse = z.infer<typeof healthResponseSchema>;

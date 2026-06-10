import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

const getPropertyTilePyramidHealthSummaryMock = jest.fn<() => Promise<unknown>>();
const getPropertyTilePyramidOpsSummaryMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('../../services/property-tile-pyramid.js', () => ({
  getPropertyTilePyramidHealthSummary: getPropertyTilePyramidHealthSummaryMock,
  getPropertyTilePyramidOpsSummary: getPropertyTilePyramidOpsSummaryMock,
}));

const promotedVersionId = 'a0000000-0000-4000-a000-000000000101';
const activeCandidateVersionId = 'a0000000-0000-4000-a000-000000000102';

function baseHealthSummary(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'ok',
    currentVersionId: promotedVersionId,
    currentPromotedAt: '2026-05-07T08:00:00.000Z',
    degradedReason: null,
    activeCandidateVersionId: null,
    activeCandidateStatus: null,
    retryableFailureDueAt: null,
    terminalFailureCount: 0,
    encodedCoverageRatio: 1,
    closedWatermarkMaxUpdatedAt: '2026-05-07T07:58:00.000Z',
    currentWatermarkMaxUpdatedAt: '2026-05-07T08:03:00.000Z',
    closedToCurrentWatermarkLagSeconds: 300,
    lastSuccessfulPromotionAt: '2026-05-07T08:00:00.000Z',
    resourceControls: {
      chunkTileLimit: 128,
      memberPageSize: 500,
      statementTimeoutMs: 30_000,
      leaseSeconds: 600,
      maxHeapMb: 1024,
      maxMemberRows: 5_000_000,
      maxWalBytesPerChunk: 10_000_000,
      maxWalBytesPerBuild: 10_737_418_240,
    },
    ...overrides,
  };
}

async function buildHealthRouteApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);

  const { healthRoutes } = await import('../../routes/health.js');
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

describe('property tile pyramid health and ops contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    getPropertyTilePyramidHealthSummaryMock.mockReset();
    getPropertyTilePyramidOpsSummaryMock.mockReset();
    app = await buildHealthRouteApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports /health ok and includes promoted pyramid state', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(baseHealthSummary());

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'ok',
      currentVersionId: promotedVersionId,
      degradedReason: null,
      activeCandidateVersionId: null,
      retryableFailureDueAt: null,
      terminalFailureCount: 0,
      encodedCoverageRatio: 1,
      closedWatermarkMaxUpdatedAt: '2026-05-07T07:58:00.000Z',
      currentWatermarkMaxUpdatedAt: '2026-05-07T08:03:00.000Z',
      closedToCurrentWatermarkLagSeconds: 300,
      lastSuccessfulPromotionAt: '2026-05-07T08:00:00.000Z',
    });
  });

  it('keeps /health non-gating when no current promoted pyramid exists', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        currentVersionId: null,
        currentPromotedAt: null,
        degradedReason: 'no-current-promoted-pyramid',
        encodedCoverageRatio: null,
        lastSuccessfulPromotionAt: null,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: null,
      degradedReason: 'no-current-promoted-pyramid',
      terminalFailureCount: 0,
    });
  });

  it('keeps /health non-gating when no current pyramid also has retryable failure state', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        currentVersionId: null,
        currentPromotedAt: null,
        degradedReason: 'no-current-promoted-pyramid',
        activeCandidateVersionId,
        activeCandidateStatus: 'failed_retryable',
        retryableFailureDueAt: '2026-05-07T08:15:00.000Z',
        encodedCoverageRatio: null,
        lastSuccessfulPromotionAt: null,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: null,
      degradedReason: 'no-current-promoted-pyramid',
      activeCandidateVersionId,
      retryableFailureDueAt: '2026-05-07T08:15:00.000Z',
    });
  });

  it('allows degraded /health when explicitly marked non-gating', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        currentVersionId: promotedVersionId,
        degradedReason: 'current-pyramid-degraded',
        encodedCoverageRatio: null,
      })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/health?allowDegraded=true',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: promotedVersionId,
      degradedReason: 'current-pyramid-degraded',
    });
  });

  it('keeps /health non-gating when pyramid terminal failures are present', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        terminalFailureCount: 2,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: promotedVersionId,
      terminalFailureCount: 2,
    });
  });

  it('exposes strict pyramid readiness separately from API health', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        currentVersionId: null,
        currentPromotedAt: null,
        degradedReason: 'no-current-promoted-pyramid',
        encodedCoverageRatio: null,
        lastSuccessfulPromotionAt: null,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health/property-tile-pyramid' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: null,
      degradedReason: 'no-current-promoted-pyramid',
    });
  });

  it('supports legacy strict pyramid gating through /health query parameters', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        terminalFailureCount: 1,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health?strictPyramid=true' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.propertyTilePyramid.terminalFailureCount).toBe(1);
  });

  it('exposes the authenticated ops readiness and resource-control contract', async () => {
    getPropertyTilePyramidOpsSummaryMock.mockResolvedValueOnce({
      ...baseHealthSummary({
        status: 'degraded',
        activeCandidateVersionId,
        activeCandidateStatus: 'failed_retryable',
        retryableFailureDueAt: '2026-05-07T08:15:00.000Z',
      }),
      previousVersionId: 'a0000000-0000-4000-a000-000000000099',
      manifestTileCount: 14,
      encodedTileCount: 12,
      nodeCount: 41,
      memberCount: 140,
      generationCounts: {
        queued: 1,
        building: 1,
        promoted: 2,
        failed_retryable: 1,
      },
      activeBuildCount: 2,
      generatedPyramidGenerationCount: 3,
      generatedCandidateSnapshotCount: 2,
      retainedGenerationCount: 3,
      relationStats: [
        {
          relationName: 'property_tile_pyramid_tiles',
          rowEstimate: 8192,
          totalBytes: 48_000_000,
        },
      ],
      currentBuildDurationMs: 120_000,
      currentObservedWalBytes: 8_000_000,
      activeCandidateStage: 'resource-validation',
      activeCandidateBuildDurationMs: 42_000,
      activeCandidateChunkProgress: { completedTiles: 64, totalTiles: 128 },
      activeCandidateObservedWalBytes: 4_000_000,
      activeLeaseOwner: 'worker-1',
      activeLeaseAgeSeconds: 42,
      lastAuditAction: 'promoted',
      lastAuditReason: 'contract-test',
      lastRetentionResult: {
        action: 'retention_deleted',
        reason: 'completed',
        createdAt: '2026-05-07T08:10:00.000Z',
        details: { deletedVersions: 1, deletedTiles: 128 },
      },
      lastEligibilityVerdict: 'blocked',
      lastEligibilityBlockReason: 'guardrail-generated-generations-high',
      pendingFullBuildDemand: {
        requestReason: 'source-watermark',
        denialReason: 'guardrail-generated-generations-high',
        deniedAt: '2026-05-07T08:14:00.000Z',
        nextEligibleAt: null,
        due: true,
        sourceWatermarkHash: 'pending-watermarks',
        buildInputsHash: 'pending-inputs',
      },
      guardrails: {
        verdict: 'blocked',
        automaticBuildsBlocked: true,
        violations: [
          {
            reason: 'guardrail-generated-generations-high',
            message: 'Generated property tile generations are pyramid=4, candidateSnapshots=2.',
          },
        ],
        thresholds: {
          hostObservationMaxAgeMs: 300_000,
          rootMaxUsedPercent: 75,
          rootMinFreeBytes: 42_949_672_960,
          dbMaxBytes: 139_586_437_120,
          generatedMaxBytes: 42_949_672_960,
          generatedGenerationMax: 3,
          retainedGenerationMax: 3,
        },
        enabled: true,
        unsafeOperatorBypass: false,
        hostObservation: {
          source: 'host-watchdog',
          observedAt: '2026-05-07T08:14:30.000Z',
          rootFilesystemBytes: 323_196_289_024,
          rootFilesystemUsedBytes: 155_692_564_480,
          rootFilesystemFreeBytes: 154_618_822_656,
          rootFilesystemUsedPercent: 49,
          postgresVolumeBytes: 91_268_055_040,
          photonVolumeBytes: 50_251_117_363,
          dockerVolumes: {},
        },
        hostObservationAgeMs: 30_000,
        dbBytes: 83_751_862_272,
        generatedBytes: 12_884_901_888,
        generatedPyramidGenerationCount: 3,
        generatedCandidateSnapshotCount: 2,
        retainedGenerationCount: 3,
        evaluatedAt: '2026-05-07T08:15:00.000Z',
      },
    });

    const response = await app.inject({ method: 'GET', url: '/ops/property-tile-pyramid' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      status: 'degraded',
      currentVersionId: promotedVersionId,
      previousVersionId: 'a0000000-0000-4000-a000-000000000099',
      activeCandidateVersionId,
      activeCandidateStatus: 'failed_retryable',
      retryableFailureDueAt: '2026-05-07T08:15:00.000Z',
      manifestTileCount: 14,
      encodedTileCount: 12,
      nodeCount: 41,
      memberCount: 140,
      generationCounts: {
        queued: 1,
        building: 1,
        promoted: 2,
        failed_retryable: 1,
      },
      activeBuildCount: 2,
      generatedPyramidGenerationCount: 3,
      generatedCandidateSnapshotCount: 2,
      retainedGenerationCount: 3,
      relationStats: [
        {
          relationName: 'property_tile_pyramid_tiles',
          rowEstimate: 8192,
          totalBytes: 48_000_000,
        },
      ],
      closedWatermarkMaxUpdatedAt: '2026-05-07T07:58:00.000Z',
      currentWatermarkMaxUpdatedAt: '2026-05-07T08:03:00.000Z',
      closedToCurrentWatermarkLagSeconds: 300,
      currentBuildDurationMs: 120_000,
      currentObservedWalBytes: 8_000_000,
      activeCandidateStage: 'resource-validation',
      activeCandidateBuildDurationMs: 42_000,
      activeCandidateChunkProgress: { completedTiles: 64, totalTiles: 128 },
      activeCandidateObservedWalBytes: 4_000_000,
      activeLeaseOwner: 'worker-1',
      activeLeaseAgeSeconds: 42,
      lastAuditAction: 'promoted',
      lastAuditReason: 'contract-test',
      lastRetentionResult: {
        action: 'retention_deleted',
        reason: 'completed',
        createdAt: '2026-05-07T08:10:00.000Z',
        details: { deletedVersions: 1, deletedTiles: 128 },
      },
      lastEligibilityVerdict: 'blocked',
      lastEligibilityBlockReason: 'guardrail-generated-generations-high',
      pendingFullBuildDemand: {
        requestReason: 'source-watermark',
        denialReason: 'guardrail-generated-generations-high',
        deniedAt: '2026-05-07T08:14:00.000Z',
        nextEligibleAt: null,
        due: true,
        sourceWatermarkHash: 'pending-watermarks',
        buildInputsHash: 'pending-inputs',
      },
      guardrails: {
        verdict: 'blocked',
        automaticBuildsBlocked: true,
        violations: [
          {
            reason: 'guardrail-generated-generations-high',
            message: 'Generated property tile generations are pyramid=4, candidateSnapshots=2.',
          },
        ],
        generatedPyramidGenerationCount: 3,
        generatedCandidateSnapshotCount: 2,
        retainedGenerationCount: 3,
      },
      resourceControls: {
        chunkTileLimit: 128,
        memberPageSize: 500,
        statementTimeoutMs: 30_000,
        leaseSeconds: 600,
        maxHeapMb: 1024,
        maxMemberRows: 5_000_000,
        maxWalBytesPerChunk: 10_000_000,
        maxWalBytesPerBuild: 10_737_418_240,
      },
    });
  });
});

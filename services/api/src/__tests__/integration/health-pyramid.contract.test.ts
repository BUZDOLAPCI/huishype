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
    lastSuccessfulPromotionAt: '2026-05-07T08:00:00.000Z',
    resourceControls: {
      chunkTileLimit: 128,
      memberPageSize: 500,
      statementTimeoutMs: 30_000,
      leaseSeconds: 600,
      maxHeapMb: 1024,
      maxWalBytesPerChunk: 10_000_000,
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

  it('reports /health ok only when a promoted pyramid is ready', async () => {
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
      lastSuccessfulPromotionAt: '2026-05-07T08:00:00.000Z',
    });
  });

  it('fails required /health readiness when no current promoted pyramid exists', async () => {
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

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: null,
      degradedReason: 'no-current-promoted-pyramid',
      terminalFailureCount: 0,
    });
  });

  it('allows degraded /health only when explicitly marked non-gating', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/health?allowDegraded=true',
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: null,
      degradedReason: 'no-current-promoted-pyramid',
    });
  });

  it('fails required /health readiness when pyramid terminal failures are present', async () => {
    getPropertyTilePyramidHealthSummaryMock.mockResolvedValueOnce(
      baseHealthSummary({
        status: 'degraded',
        terminalFailureCount: 2,
      })
    );

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.propertyTilePyramid).toMatchObject({
      status: 'degraded',
      currentVersionId: promotedVersionId,
      terminalFailureCount: 2,
    });
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
      memberCount: 1,
      activeLeaseOwner: 'worker-1',
      activeLeaseAgeSeconds: 42,
      lastAuditAction: 'promote',
      lastAuditReason: 'contract-test',
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
      memberCount: 1,
      activeLeaseOwner: 'worker-1',
      activeLeaseAgeSeconds: 42,
      lastAuditAction: 'promote',
      lastAuditReason: 'contract-test',
      resourceControls: {
        chunkTileLimit: 128,
        memberPageSize: 500,
        statementTimeoutMs: 30_000,
        leaseSeconds: 600,
        maxHeapMb: 1024,
        maxWalBytesPerChunk: 10_000_000,
      },
    });
  });
});

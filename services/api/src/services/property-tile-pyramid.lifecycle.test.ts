import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type ExecuteMock = (...args: unknown[]) => Promise<unknown>;
type TransactionMock = (
  run: (tx: { execute: ExecuteMock }) => Promise<unknown>,
) => Promise<unknown>;

const executeMock = jest.fn<ExecuteMock>();
const txExecuteMock = jest.fn<ExecuteMock>();
const transactionMock = jest.fn<TransactionMock>();
const enqueuePropertyTilePyramidBuildMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const buildGroupsMock = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule('../db/index.js', () => ({
  db: {
    execute: executeMock,
    transaction: transactionMock,
  },
  closeConnection: async () => undefined,
}));

jest.unstable_mockModule('./ingest/queue.js', () => ({
  enqueuePropertyTilePyramidBuild: enqueuePropertyTilePyramidBuildMock,
}));

jest.unstable_mockModule('./property-grouping.js', () => ({
  PROPERTY_TILE_EXTENT: 4096,
  buildCanonicalGroupsForTileUncached: buildGroupsMock,
}));

jest.unstable_mockModule('./property-tile-snapshots.js', () => ({
  computePropertyTileSnapshotCoordinatesFromCoverage: () => [{ z: 0, x: 0, y: 0 }],
  computePropertyTileSnapshotConfigHash: () => 'snapshot-config-hash',
  getExpectedDefaultPropertyTileSnapshotCoverageDefinition: () => ({
    coverageId: 'public_default_low_zoom',
    boundsSource: 'unit-test',
    minLon: 0,
    minLat: 0,
    maxLon: 1,
    maxLat: 1,
    countries: ['NL'],
    dataSources: ['funda'],
    minZoom: 0,
    maxZoom: 0,
    filterSignature: 'default',
  }),
}));

function withTemporaryEnv<T>(
  updates: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map(
    Object.keys(updates).map((key) => [key, process.env[key]] as const),
  );

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

describe('property tile pyramid build lifecycle', () => {
  beforeEach(() => {
    executeMock.mockReset();
    transactionMock.mockReset();
    txExecuteMock.mockReset();
    enqueuePropertyTilePyramidBuildMock.mockReset();
    buildGroupsMock.mockReset();
    buildGroupsMock.mockResolvedValue([]);
    transactionMock.mockImplementation(async (run) => run({ execute: txExecuteMock }));
  });

  it('does not dispatch BullMQ when an existing build identity is already promoted', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'promoted-version',
          status: 'promoted',
          next_retry_at: null,
        },
      ]);

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
      sourceWatermarkHash: 'watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'coalesced',
      versionId: 'promoted-version',
      existingStatus: 'promoted',
    });
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
  });

  it('dispatches BullMQ only after Postgres returns a queue-eligible version', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'queued-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
        },
      ]);
    enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
      status: 'enqueued',
      jobId: 'job-1',
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
      sourceWatermarkHash: 'watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'enqueued',
      versionId: 'queued-version',
      existingStatus: 'queued',
      queueJobId: expect.stringMatching(/^property-tile-pyramid-[a-f0-9]{40}$/),
    });
    expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['expired active'],
    ['legacy validated'],
  ])('enqueues a recovered %s build identity instead of coalescing', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'recovered-version',
          status: 'failed_retryable',
          next_retry_at: null,
          queue_eligible: true,
        },
      ]);
    enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
      status: 'enqueued',
      jobId: 'job-1',
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
      sourceWatermarkHash: 'watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'enqueued',
      versionId: 'recovered-version',
      existingStatus: 'failed_retryable',
      queueJobId: expect.stringMatching(/^property-tile-pyramid-[a-f0-9]{40}$/),
    });
    expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
    const recoveryQuery = JSON.stringify(executeMock.mock.calls[0]?.[0]);
    expect(recoveryQuery).toContain("status IN ('building', 'validating')");
    expect(recoveryQuery).toContain("status = 'validated'");
    expect(recoveryQuery).toContain('lease_until IS NULL');
  });

  it('keeps validation and promotion in one transaction so promotion failure is recoverable', async () => {
    await withTemporaryEnv({
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1000000',
    }, async () => {
      executeMock
        .mockResolvedValueOnce([{ retryable_version_count: 0 }])
        .mockResolvedValueOnce([
          {
            id: 'build-version',
            status: 'building',
            coverage_id: 'public_default_low_zoom',
            filter_signature: 'default',
            max_zoom: 0,
            pyramid_kind: 'public_default_low_zoom',
            build_inputs_hash: 'inputs',
            source_watermark_hash: 'watermarks',
          },
        ])
        .mockResolvedValue([]);
      txExecuteMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ current_version_id: null }])
        .mockRejectedValueOnce(new Error('current pointer compare-and-swap failed'));

      const { executeDuePropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
      await expect(executeDuePropertyTilePyramidBuild({
        leaseOwner: 'unit-test',
        reason: 'worker-build',
      })).rejects.toThrow('current pointer compare-and-swap failed');

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(txExecuteMock).toHaveBeenCalledTimes(3);
      const failureQuery = JSON.stringify(executeMock.mock.calls.at(-1)?.[0]);
      expect(failureQuery).toContain('failed_retryable');
      expect(failureQuery).toContain('build_error');
    });
  });

  it('uses the configured WAL limit when validating build resources', async () => {
    await withTemporaryEnv({
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1',
    }, async () => {
      executeMock
        .mockResolvedValueOnce([{ retryable_version_count: 0 }])
        .mockResolvedValueOnce([
          {
            id: 'build-version',
            status: 'building',
            coverage_id: 'public_default_low_zoom',
            filter_signature: 'default',
            max_zoom: 0,
            pyramid_kind: 'public_default_low_zoom',
            build_inputs_hash: 'inputs',
            source_watermark_hash: 'watermarks',
          },
        ])
        .mockResolvedValue([]);

      const { executeDuePropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
      const result = await executeDuePropertyTilePyramidBuild({
        leaseOwner: 'unit-test',
        reason: 'worker-build',
      });

      expect(result).toMatchObject({
        status: 'failed_retryable',
        versionId: 'build-version',
        failureCategory: 'resource_limit',
      });
      expect(transactionMock).not.toHaveBeenCalled();
    });
  });
});

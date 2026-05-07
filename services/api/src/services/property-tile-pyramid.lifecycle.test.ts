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
    jest.useRealTimers();
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

  it('creates a repair replacement when a promoted version has corrupt tile state but source watermarks are unchanged', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'repair-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ]);
    enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
      status: 'enqueued',
      jobId: 'job-1',
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'manifest-missing',
      sourceWatermarkHash: 'watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'enqueued',
      versionId: 'repair-version',
      existingStatus: 'queued',
    });
    expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
  });

  it('reports enqueue failure instead of claiming the durable request was enqueued', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'queued-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ])
      .mockResolvedValueOnce([]);
    enqueuePropertyTilePyramidBuildMock.mockRejectedValueOnce(new Error('redis unavailable'));

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
      sourceWatermarkHash: 'watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'enqueue_failed',
      versionId: 'queued-version',
      existingStatus: 'queued',
      reason: 'redis unavailable',
    });
    expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
    const failureQuery = JSON.stringify(executeMock.mock.calls.at(-1)?.[0]);
    expect(failureQuery).toContain('queue_dispatch');
    expect(failureQuery).toContain('failure_message');
  });

  it('records pending replacement metadata instead of dispatching a duplicate active build for the slot', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'active-version',
          status: 'building',
          next_retry_at: null,
          queue_eligible: false,
          pending_replacement: true,
        },
      ]);

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'source-watermark',
      sourceWatermarkHash: 'new-watermarks',
      sourceWatermarksJson: { sources: [{ source: 'unit' }] },
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'coalesced',
      versionId: 'active-version',
      existingStatus: 'building',
      reason: 'pending-replacement-recorded',
    });
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    const requestQuery = JSON.stringify(executeMock.mock.calls[1]?.[0]);
    expect(requestQuery).toContain('active_replacement');
    expect(requestQuery).toContain('pending_replacement_watermarks_json');
    expect(requestQuery).toContain("status IN ('queued', 'building', 'validating')");
    expect(requestQuery).toContain('lease_until > now()');
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
    expect(recoveryQuery).not.toContain('source_watermark_hash =');
  });

  it('keeps validation and promotion in one transaction so promotion failure is recoverable', async () => {
    await withTemporaryEnv({
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1000000',
    }, async () => {
      const pyramid = await import('./property-tile-pyramid.js');
      const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
        coverageId: 'public_default_low_zoom',
        filterSignature: 'default',
        maxZoom: 0,
        pyramidKind: 'public_default_low_zoom',
      });
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
            config_hash: identity.configHash,
            build_inputs_hash: identity.buildInputsHash,
            source_watermark_hash: 'watermarks',
            coverage_snapshot_json: identity.coverageSnapshot,
            config_snapshot_json: identity.configSnapshot,
            grouping_constants_json: identity.groupingConstants,
            pending_replacement_watermarks_json: {},
            lease_token: 'lease-token',
          },
        ])
        .mockResolvedValueOnce([{ ok: true }])
        .mockResolvedValue([{ affected: 1 }]);
      txExecuteMock
        .mockResolvedValueOnce([{ affected: 1 }])
        .mockResolvedValueOnce([{ current_version_id: null }])
        .mockRejectedValueOnce(new Error('current pointer compare-and-swap failed'));

      await expect(pyramid.executeDuePropertyTilePyramidBuild({
        leaseOwner: 'unit-test',
        reason: 'worker-build',
      })).rejects.toThrow('current pointer compare-and-swap failed');

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(txExecuteMock).toHaveBeenCalledTimes(3);
      const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
      const failureIndex = executedQueries.findIndex((query) => query.includes('build_error'));
      const successorRequestIndex = executedQueries.findIndex((query) => query.includes('active_replacement'));
      const failureQuery = executedQueries[failureIndex] ?? '';
      expect(failureIndex).toBeGreaterThanOrEqual(0);
      expect(successorRequestIndex).toBeGreaterThan(failureIndex);
      expect(failureQuery).toContain('failed_retryable');
      expect(failureQuery).toContain('build_error');
    });
  });

  it('restricts a worker job to the intended version id when provided', async () => {
    executeMock
      .mockResolvedValueOnce([{ retryable_version_count: 0 }])
      .mockResolvedValueOnce([]);

    const { executeDuePropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await executeDuePropertyTilePyramidBuild({
      leaseOwner: 'unit-test',
      versionId: '00000000-0000-0000-0000-000000000123',
      reason: 'worker-build',
    });

    expect(result).toMatchObject({
      status: 'noop',
      reason: 'no-eligible-pyramid-version',
    });
    const leaseQuery = JSON.stringify(executeMock.mock.calls[1]?.[0]);
    expect(leaseQuery).toContain('id =');
    expect(leaseQuery).toContain('00000000-0000-0000-0000-000000000123');
    expect(leaseQuery).toContain('property_tile_pyramid_backfill');
  });

  it('uses the configured WAL limit when validating build resources', async () => {
    await withTemporaryEnv({
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1',
    }, async () => {
      const pyramid = await import('./property-tile-pyramid.js');
      const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
        coverageId: 'public_default_low_zoom',
        filterSignature: 'default',
        maxZoom: 0,
        pyramidKind: 'public_default_low_zoom',
      });
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
            config_hash: identity.configHash,
            build_inputs_hash: identity.buildInputsHash,
            source_watermark_hash: 'watermarks',
            coverage_snapshot_json: identity.coverageSnapshot,
            config_snapshot_json: identity.configSnapshot,
            grouping_constants_json: identity.groupingConstants,
            pending_replacement_watermarks_json: {},
            lease_token: 'lease-token',
          },
        ])
        .mockResolvedValue([{ affected: 1 }]);

      const result = await pyramid.executeDuePropertyTilePyramidBuild({
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

  it('builds source watermark snapshots from named durable sources', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T10:30:00.000Z'));
    executeMock
      .mockResolvedValueOnce([
        {
          scope: 'listing_facts',
          scope_key: 'global',
          watermark_value: '3',
          watermark_timestamp: '2026-05-07T10:00:00.000Z',
          updated_at: '2026-05-07T10:01:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'public_default_low_zoom',
          listing_watermark: '4',
          social_watermark: '5',
          property_watermark: '6',
          coverage_watermark: '7',
          updated_at: '2026-05-07T10:02:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_name: 'funda',
          last_committed_cursor: 'cursor-1',
          last_committed_changed_at: '2026-05-07T09:00:00.000Z',
          last_committed_listing_key: 'listing-1',
          last_batch_id: 'batch-1',
          last_run_completed_at: '2026-05-07T09:05:00.000Z',
          last_run_status: 'completed',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_name: 'funda',
          scope_key: 'nl',
          listing_type: 'sale',
          source_high_watermark: '2026-05-07T09:10:00.000Z',
          ingest_batch_id: 'batch-2',
          updated_at: '2026-05-07T09:11:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          source_name: 'funda',
          scope_key: 'nl',
          listing_type: 'sale',
          source_high_watermark: '2026-05-07T09:12:00.000Z',
          source_run_completed_at: '2026-05-07T09:13:00.000Z',
          coverage_status: 'complete',
          observed_listing_count: '42',
          stale_for_projection: false,
          repair_mode: false,
        },
      ])
      .mockResolvedValueOnce([{ row_count: '10', max_updated_at: '2026-05-07T09:14:00.000Z' }])
      .mockResolvedValueOnce([{ row_count: '11', max_updated_at: '2026-05-07T09:15:00.000Z' }]);

    const { readPropertyTilePyramidSourceWatermarkSnapshot } = await import('./property-tile-pyramid.js');
    const snapshot = await readPropertyTilePyramidSourceWatermarkSnapshot();
    const sources = (snapshot.sourceWatermarksJson as { sources: unknown[] }).sources;

    expect(snapshot.sourceWatermarkHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'property_tile_snapshot_watermarks' }),
      expect.objectContaining({ source: 'ingest_sources' }),
      expect.objectContaining({ source: 'listing_source_scope_watermarks' }),
      expect.objectContaining({ source: 'listing_scope_completions' }),
      expect.objectContaining({ source: 'property_tile_listing_candidates' }),
      expect.objectContaining({ source: 'property_tile_listing_facts' }),
      expect.objectContaining({ source: 'rolling_social_window', bucket: 493930 }),
    ]));
  });

  it('uses the regenerated payload etag when a promoted tile payload is rebuilt from nodes', async () => {
    executeMock
      .mockResolvedValueOnce([
        {
          payload: null,
          etag: '"pyramid-old-empty-seed"',
          node_count: 1,
          tile_status: 'valid_nodes',
          validation_status: 'validated',
        },
      ])
      .mockResolvedValueOnce([{ mvt: Buffer.from('new-payload') }])
      .mockResolvedValueOnce([]);

    const {
      buildPropertyTilePyramidEtag,
      lookupPromotedPropertyTilePyramidTile,
    } = await import('./property-tile-pyramid.js');
    const version = {
      versionId: '00000000-0000-0000-0000-000000000001',
      coverageId: 'public_default_low_zoom',
      filterSignature: 'default',
      maxZoom: 0,
      pyramidKind: 'public_default_low_zoom',
      buildInputsHash: 'inputs',
      sourceWatermarkHash: 'watermarks',
      status: 'promoted' as const,
      promotedAt: null,
      degradedAt: null,
      degradedReason: null,
      coverage: {
        minLon: -180,
        minLat: -85,
        maxLon: 180,
        maxLat: 85,
        maxZoom: 0,
      },
    };

    const result = await lookupPromotedPropertyTilePyramidTile({
      version,
      z: 0,
      x: 0,
      y: 0,
    });

    expect(result).toMatchObject({
      state: 'hit',
      encodedFromNodes: true,
      statusCode: 200,
    });
    expect(result.state === 'hit' ? result.etag : null).toBe(buildPropertyTilePyramidEtag({
      versionId: version.versionId,
      z: 0,
      x: 0,
      y: 0,
      payload: Buffer.from('new-payload'),
    }));
    expect(result.state === 'hit' ? result.etag : null).not.toBe('"pyramid-old-empty-seed"');
  });

  it('does not serve promoted tile manifests unless their validation status is validated', async () => {
    executeMock.mockResolvedValueOnce([
      {
        payload: Buffer.from('stale-payload'),
        etag: '"pyramid-stale"',
        node_count: 1,
        tile_status: 'valid_encoded',
        validation_status: 'pending',
      },
    ]);

    const { lookupPromotedPropertyTilePyramidTile } = await import('./property-tile-pyramid.js');
    const result = await lookupPromotedPropertyTilePyramidTile({
      version: {
        versionId: '00000000-0000-0000-0000-000000000001',
        coverageId: 'public_default_low_zoom',
        filterSignature: 'default',
        maxZoom: 0,
        pyramidKind: 'public_default_low_zoom',
        buildInputsHash: 'inputs',
        sourceWatermarkHash: 'watermarks',
        status: 'promoted',
        promotedAt: null,
        degradedAt: null,
        degradedReason: null,
        coverage: {
          minLon: -180,
          minLat: -85,
          maxLon: 180,
          maxLat: 85,
          maxZoom: 0,
        },
      },
      z: 0,
      x: 0,
      y: 0,
    });

    expect(result).toMatchObject({
      state: 'missing',
      tileStatus: 'pyramid-missing',
      reason: 'tile-valid_encoded-pending',
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('runs retention through chunked child-table cleanup before deleting versions', async () => {
    executeMock
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([]);

    const { runPropertyTilePyramidRetention } = await import('./property-tile-pyramid.js');
    const result = await runPropertyTilePyramidRetention();

    expect(result).toMatchObject({
      status: 'completed',
      resetPayloads: 0,
      deletedMembers: 0,
      deletedNodes: 0,
      deletedTiles: 0,
      deletedVersions: 0,
    });
    const retentionQueries = executeMock.mock.calls
      .slice(1, -1)
      .map((call) => JSON.stringify(call[0]))
      .join('\n');
    expect(retentionQueries).toContain('LIMIT 10000');
    expect(retentionQueries).toContain('FOR UPDATE SKIP LOCKED');
    expect(retentionQueries).toContain('property_tile_pyramid_members');
    expect(retentionQueries).toContain('previous_version_id');
    expect(retentionQueries).toContain("interval '7 days'");
    expect(retentionQueries).toContain('property_tile_pyramid_audit');
  });
});

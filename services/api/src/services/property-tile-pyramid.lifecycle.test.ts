import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type ExecuteMock = (...args: unknown[]) => Promise<unknown>;
type TransactionMock = (
  run: (tx: { execute: ExecuteMock }) => Promise<unknown>
) => Promise<unknown>;

const executeMock = jest.fn<ExecuteMock>();
const txExecuteMock = jest.fn<ExecuteMock>();
const transactionMock = jest.fn<TransactionMock>();
const enqueuePropertyTilePyramidBuildMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const buildGroupsMock = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const reserveDbConnectionMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('../db/index.js', () => ({
  db: {
    execute: executeMock,
    transaction: transactionMock,
  },
  reserveDbConnection: reserveDbConnectionMock,
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
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map(Object.keys(updates).map((key) => [key, process.env[key]] as const));

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

function makePyramidBuildRow(input: {
  identity: {
    configHash: string;
    buildInputsHash: string;
    coverageSnapshot: Record<string, unknown>;
    configSnapshot: Record<string, unknown>;
    groupingConstants: Record<string, unknown>;
  };
  sourceWatermarkHash: string;
  sourceWatermarksJson?: Record<string, unknown>;
  status?: 'queued' | 'building';
  candidateSnapshotId?: string | null;
  pendingReplacementWatermarksJson?: Record<string, unknown>;
}) {
  return {
    id: 'build-version',
    status: input.status ?? 'building',
    coverage_id: 'public_default_low_zoom',
    filter_signature: 'default',
    max_zoom: 0,
    pyramid_kind: 'public_default_low_zoom',
    config_hash: input.identity.configHash,
    build_inputs_hash: input.identity.buildInputsHash,
    source_watermark_hash: input.sourceWatermarkHash,
    source_watermarks_json: input.sourceWatermarksJson ?? {},
    candidate_snapshot_id:
      input.candidateSnapshotId === undefined
        ? '00000000-0000-0000-0000-0000000000c1'
        : input.candidateSnapshotId,
    coverage_snapshot_json: input.identity.coverageSnapshot,
    config_snapshot_json: input.identity.configSnapshot,
    grouping_constants_json: input.identity.groupingConstants,
    pending_replacement_watermarks_json: input.pendingReplacementWatermarksJson ?? {},
    requested_at: '2026-05-07T09:59:00.000Z',
    lease_token: 'lease-token',
    backfill_lock_required: false,
    backfill_lock_acquired: true,
  };
}

function makeCandidateSnapshotRow(input: {
  sourceWatermarkHash: string;
  sourceWatermarksJson?: Record<string, unknown>;
}) {
  return {
    id: '00000000-0000-0000-0000-0000000000c1',
    coverage_id: 'public_default_low_zoom',
    filter_signature: 'default',
    pyramid_kind: 'public_default_low_zoom',
    source_watermark_hash: input.sourceWatermarkHash,
    comparable_source_watermark_hash:
      typeof input.sourceWatermarksJson?.comparableSourceWatermarkHash === 'string'
        ? input.sourceWatermarksJson.comparableSourceWatermarkHash
        : input.sourceWatermarkHash,
    source_watermarks_json: input.sourceWatermarksJson ?? {},
    status: 'ready',
  };
}

function isPyramidCandidateSelectionQuery(queryText: string): boolean {
  return (
    queryText.includes('FROM property_tile_pyramid_versions v') &&
    queryText.includes('JOIN backfill_gate')
  );
}

function collectSqlValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSqlValues(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectSqlValues(item));
  }
  return [value];
}

function isPyramidBuildingClaimQuery(queryText: string): boolean {
  return (
    queryText.includes('UPDATE property_tile_pyramid_versions') &&
    queryText.includes("status = 'building'") &&
    queryText.includes('attempt_count = COALESCE(attempt_count, 0) + 1') &&
    queryText.includes('lease_token')
  );
}

function isCandidateSourceSnapshotAttachQuery(queryText: string): boolean {
  return (
    queryText.includes('UPDATE property_tile_pyramid_versions') &&
    queryText.includes('candidate_snapshot_id =') &&
    queryText.includes('RETURNING candidate_snapshot_id::text')
  );
}

function isCandidateSourceSnapshotInsertQuery(queryText: string): boolean {
  return queryText.includes('INSERT INTO property_tile_candidate_source_snapshots');
}

function isCandidateSourceSnapshotProgressQuery(queryText: string): boolean {
  return (
    queryText.includes('candidateSourceSnapshotProgress') &&
    queryText.includes('lease_owner') &&
    queryText.includes('lease_token') &&
    queryText.includes("status = 'building'")
  );
}

function makeUsableCurrentGenerationRow(
  input: {
    sourceWatermarkHash?: string;
    sourceWatermarksJson?: Record<string, unknown>;
    currentPromotedAt?: string;
  } = {}
) {
  return {
    current_version_id: '00000000-0000-0000-0000-0000000000aa',
    current_promoted_at: input.currentPromotedAt ?? '2026-06-10T00:00:00.000Z',
    source_watermark_hash: input.sourceWatermarkHash ?? 'current-watermarks',
    source_watermarks_json: input.sourceWatermarksJson ?? {},
    status: 'promoted',
    degraded_at: null,
    degraded_reason: null,
    expected_tile_count: 1,
    validated_tile_count: 1,
    node_count: 10,
    encoded_payload_bytes: '100',
    wal_bytes: '200',
    tile_count: '1',
    invalid_tile_count: '0',
  };
}

function makeGuardrailRow(
  input: {
    observedAt?: string | null;
    rootUsedPercent?: string;
    rootFreeBytes?: string;
    dbBytes?: string;
    generatedBytes?: string;
    retainedGenerationCount?: string;
  } = {}
) {
  const observedAt =
    input.observedAt === undefined ? '2026-06-10T11:59:00.000Z' : input.observedAt;
  return {
    observation_source: observedAt == null ? null : 'host-watchdog',
    observation_observed_at: observedAt,
    root_filesystem_bytes: observedAt == null ? null : '323196289024',
    root_filesystem_used_bytes: observedAt == null ? null : '155692564480',
    root_filesystem_free_bytes:
      observedAt == null ? null : (input.rootFreeBytes ?? '154618822656'),
    root_filesystem_used_percent: observedAt == null ? null : (input.rootUsedPercent ?? '49'),
    postgres_volume_bytes: observedAt == null ? null : '91268055040',
    photon_volume_bytes: observedAt == null ? null : '50251117363',
    docker_volumes_json: observedAt == null ? null : {},
    db_bytes: input.dbBytes ?? '83751862272',
    generated_bytes: input.generatedBytes ?? '12884901888',
    retained_generation_count: input.retainedGenerationCount ?? '2',
  };
}

function isFullBuildCurrentGenerationQuery(queryText: string): boolean {
  return (
    queryText.includes('FROM property_tile_pyramid_current c') &&
    queryText.includes('tile_stats.invalid_tile_count')
  );
}

function isGuardrailSummaryQuery(queryText: string): boolean {
  return (
    queryText.includes('property_tile_pyramid_guardrail_observations') &&
    queryText.includes('generated_storage') &&
    queryText.includes('retained_generations')
  );
}

function isRecoverStaleBuildRequestQuery(queryText: string): boolean {
  return queryText.includes('recovered_count') && queryText.includes('lease_expired');
}

function isLeasedActiveBuildLookupQuery(queryText: string): boolean {
  return (
    queryText.includes('SELECT id::text, status, next_retry_at::text') &&
    queryText.includes("status IN ('building', 'validating')") &&
    queryText.includes('lease_until > now()') &&
    !queryText.includes('active_replacement')
  );
}

function isLeasedActiveCoalesceQuery(queryText: string): boolean {
  return (
    queryText.includes('WITH active_replacement AS MATERIALIZED') &&
    queryText.includes('pending_replacement_watermarks_json') &&
    queryText.includes('active_same') &&
    !queryText.includes('INSERT INTO property_tile_pyramid_versions')
  );
}

function isQueuedBuildSupersedeQuery(queryText: string): boolean {
  return (
    queryText.includes("status = 'superseded'") &&
    queryText.includes('Superseded by newer property tile pyramid build request before work started')
  );
}

function isDurableBuildRequestQuery(queryText: string): boolean {
  return (
    queryText.includes('WITH active_replacement AS MATERIALIZED') &&
    queryText.includes('INSERT INTO property_tile_pyramid_versions') &&
    queryText.includes('RETURNING id::text, status, next_retry_at::text')
  );
}

function isExistingBuildIdentityLookupQuery(queryText: string): boolean {
  return (
    queryText.includes('SELECT id::text, status, next_retry_at::text') &&
    queryText.includes('build_inputs_hash =') &&
    queryText.includes('source_watermark_hash =') &&
    !queryText.includes("status IN ('building', 'validating')")
  );
}

function isQueueDispatchFailureUpdateQuery(queryText: string): boolean {
  return queryText.includes('queue_dispatch') && queryText.includes('failure_message');
}

type RequestBuildLifecycleMockOptions = {
  currentRows?: unknown[];
  activeLookupRows?: unknown[];
  activeCoalesceRows?: unknown[];
  recoveryRows?: unknown[];
  guardrailRows?: unknown[];
  durableRows?: unknown[];
  existingRows?: unknown[];
  durableError?: unknown;
};

function mockRequestBuildLifecycle(options: RequestBuildLifecycleMockOptions): void {
  executeMock.mockImplementation(async (query) => {
    const queryText = JSON.stringify(query);
    if (isLeasedActiveBuildLookupQuery(queryText)) {
      return options.activeLookupRows ?? [];
    }
    if (isLeasedActiveCoalesceQuery(queryText)) {
      return options.activeCoalesceRows ?? [];
    }
    if (isFullBuildCurrentGenerationQuery(queryText)) {
      return options.currentRows ?? [];
    }
    if (isGuardrailSummaryQuery(queryText)) {
      return options.guardrailRows ?? [];
    }
    if (queryText.includes('propertyTilePyramidFullBuildPending')) {
      return [];
    }
    if (isRecoverStaleBuildRequestQuery(queryText)) {
      return options.recoveryRows ?? [{ recovered_count: 0 }];
    }
    if (isQueuedBuildSupersedeQuery(queryText)) {
      return [];
    }
    if (isDurableBuildRequestQuery(queryText)) {
      if (options.durableError) {
        throw options.durableError;
      }
      return options.durableRows ?? [];
    }
    if (isExistingBuildIdentityLookupQuery(queryText)) {
      return options.existingRows ?? [];
    }
    if (isQueueDispatchFailureUpdateQuery(queryText)) {
      return [];
    }
    throw new Error(`Unexpected query: ${queryText}`);
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
    reserveDbConnectionMock.mockReset();
    buildGroupsMock.mockResolvedValue([]);
    reserveDbConnectionMock.mockResolvedValue(
      Object.assign(async () => [{ locked: true, required: false }], { release: jest.fn() })
    );
    transactionMock.mockImplementation(async (run) => run({ execute: txExecuteMock }));
  });

  it('records denied full-build demand without creating a version row before cadence', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    executeMock.mockImplementation(async (query) => {
      const queryText = JSON.stringify(query);
      if (queryText.includes('active_replacement')) {
        return [];
      }
      if (isFullBuildCurrentGenerationQuery(queryText)) {
        return [makeUsableCurrentGenerationRow()];
      }
      if (queryText.includes('propertyTilePyramidFullBuildPending')) {
        return [];
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'source-watermark',
      sourceWatermarkHash: 'current-watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toEqual({
      status: 'coalesced',
      reason: 'full-build-eligibility-denied:cadence-not-due',
    });
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    const queries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(
      queries.some((query) => query.includes('INSERT INTO property_tile_pyramid_versions'))
    ).toBe(false);
    const pendingQuery = queries.find((query) =>
      query.includes('propertyTilePyramidFullBuildPending')
    );
    expect(pendingQuery).toContain('property_tile_pyramid_source_watermarks');
    expect(pendingQuery).toContain('full-build-eligibility');
    expect(pendingQuery).toContain('cadence-not-due');
  });

  it('blocks production full-build requests when the host guardrail observation is missing', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    mockRequestBuildLifecycle({
      currentRows: [
        makeUsableCurrentGenerationRow({ currentPromotedAt: '2026-06-09T00:00:00.000Z' }),
      ],
      guardrailRows: [makeGuardrailRow({ observedAt: null })],
    });

    await withTemporaryEnv(
      {
        NODE_ENV: 'production',
        PROPERTY_TILE_PYRAMID_GUARDRAILS_ENABLED: undefined,
        PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS: undefined,
      },
      async () => {
        const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
        const result = await requestPropertyTilePyramidBuild({
          reason: 'source-watermark',
          sourceWatermarkHash: 'new-watermarks',
          sourceWatermarksJson: { sources: [{ source: 'unit' }] },
          buildInputsHash: 'inputs',
        });

        expect(result).toEqual({
          status: 'coalesced',
          reason: 'full-build-eligibility-denied:guardrail-host-observation-missing',
        });
        expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(executedQueries.some((query) => isGuardrailSummaryQuery(query))).toBe(true);
        expect(executedQueries.some((query) => isDurableBuildRequestQuery(query))).toBe(false);
        const pendingQuery =
          executedQueries.find((query) => query.includes('propertyTilePyramidFullBuildPending')) ??
          '';
        expect(pendingQuery).toContain('guardrail-host-observation-missing');
      }
    );
  });

  it('does not let operator cadence override bypass hard guardrails by default', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    mockRequestBuildLifecycle({
      currentRows: [
        makeUsableCurrentGenerationRow({ currentPromotedAt: '2026-06-10T00:00:00.000Z' }),
      ],
      guardrailRows: [makeGuardrailRow({ rootUsedPercent: '80' })],
    });

    await withTemporaryEnv(
      {
        NODE_ENV: 'production',
        PROPERTY_TILE_PYRAMID_GUARDRAILS_ENABLED: undefined,
        PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS: undefined,
      },
      async () => {
        const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
        const result = await requestPropertyTilePyramidBuild({
          reason: 'operator',
          sourceWatermarkHash: 'operator-watermarks',
          sourceWatermarksJson: {},
          buildInputsHash: 'inputs',
        });

        expect(result).toEqual({
          status: 'coalesced',
          reason: 'full-build-eligibility-denied:guardrail-root-disk-high',
        });
        expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
      }
    );
  });

  it('allows a due production full-build request when hard guardrails are healthy', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    mockRequestBuildLifecycle({
      currentRows: [
        makeUsableCurrentGenerationRow({ currentPromotedAt: '2026-06-09T00:00:00.000Z' }),
      ],
      guardrailRows: [makeGuardrailRow()],
      durableRows: [
        {
          id: 'queued-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ],
    });
    enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
      status: 'enqueued',
      jobId: 'job-1',
    });

    await withTemporaryEnv(
      {
        NODE_ENV: 'production',
        PROPERTY_TILE_PYRAMID_GUARDRAILS_ENABLED: undefined,
        PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS: undefined,
      },
      async () => {
        const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
        const result = await requestPropertyTilePyramidBuild({
          reason: 'source-watermark',
          sourceWatermarkHash: 'new-watermarks',
          sourceWatermarksJson: { sources: [{ source: 'unit' }] },
          buildInputsHash: 'inputs',
        });

        expect(result).toMatchObject({
          status: 'enqueued',
          versionId: 'queued-version',
          existingStatus: 'queued',
        });
        expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('records canonical source-watermark advances until cadence is due', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    executeMock.mockImplementation(async (query) => {
      const queryText = JSON.stringify(query);
      if (
        queryText.includes('active_replacement') &&
        !queryText.includes('INSERT INTO property_tile_pyramid_versions')
      ) {
        return [];
      }
      if (isFullBuildCurrentGenerationQuery(queryText)) {
        return [makeUsableCurrentGenerationRow({ sourceWatermarkHash: 'current-watermarks' })];
      }
      if (queryText.includes('propertyTilePyramidFullBuildPending')) {
        return [];
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'source-watermark',
      sourceWatermarkHash: 'new-canonical-watermarks',
      sourceWatermarksJson: {},
      buildInputsHash: 'inputs',
    });

    expect(result).toEqual({
      status: 'coalesced',
      reason: 'full-build-eligibility-denied:cadence-not-due',
    });
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    const queries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
    const pendingQuery = queries.find((query) =>
      query.includes('propertyTilePyramidFullBuildPending')
    );
    expect(pendingQuery).toContain('new-canonical-watermarks');
    expect(pendingQuery).toContain('cadence-not-due');
    expect(queries.some((query) => query.includes('INSERT INTO property_tile_pyramid_versions'))).toBe(
      false
    );
  });

  it('does not dispatch BullMQ when an existing build identity is already promoted', async () => {
    mockRequestBuildLifecycle({
      durableRows: [],
      existingRows: [
        {
          id: 'promoted-version',
          status: 'promoted',
          next_retry_at: null,
        },
      ],
    });

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
    mockRequestBuildLifecycle({
      durableRows: [
        {
          id: 'queued-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
        },
      ],
    });
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
    mockRequestBuildLifecycle({
      currentRows: [
        {
          ...makeUsableCurrentGenerationRow({ sourceWatermarkHash: 'watermarks' }),
          invalid_tile_count: '1',
        },
      ],
      durableRows: [
        {
          id: 'repair-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ],
    });
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
    mockRequestBuildLifecycle({
      durableRows: [
        {
          id: 'queued-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ],
    });
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
    mockRequestBuildLifecycle({
      activeCoalesceRows: [
        {
          id: 'active-version',
          status: 'building',
          next_retry_at: null,
          queue_eligible: false,
          pending_replacement: true,
        },
      ],
    });

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
    const requestQuery =
      executeMock.mock.calls
        .map((call) => JSON.stringify(call[0]))
        .find((query) => isLeasedActiveCoalesceQuery(query)) ?? '';
    expect(requestQuery).toContain('active_replacement');
    expect(requestQuery).toContain('pending_replacement_watermarks_json');
    expect(requestQuery).toContain("status IN ('building', 'validating')");
    expect(requestQuery).toContain('lease_until > now()');
    expect(requestQuery).not.toContain('FOR UPDATE SKIP LOCKED');
  });

  it('short-circuits worker recovery when an active leased build is in progress', async () => {
    mockRequestBuildLifecycle({
      activeLookupRows: [
        {
          id: 'active-version',
          status: 'building',
          next_retry_at: null,
          queue_eligible: false,
          pending_replacement: false,
          active_build_in_progress: true,
        },
      ],
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
      sourceWatermarkHash: 'new-watermarks',
      sourceWatermarksJson: { sources: [{ source: 'unit' }] },
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'coalesced',
      versionId: 'active-version',
      existingStatus: 'building',
      reason: 'active-build-in-progress',
    });
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(1);
    const activeLookupQuery =
      executeMock.mock.calls
        .map((call) => JSON.stringify(call[0]))
        .find((query) => isLeasedActiveBuildLookupQuery(query)) ?? '';
    expect(activeLookupQuery).toContain("status IN ('building', 'validating')");
    expect(activeLookupQuery).toContain('lease_until > now()');
    expect(activeLookupQuery).not.toContain('INSERT INTO property_tile_pyramid_versions');
    expect(activeLookupQuery).not.toContain('pending_replacement_watermarks_json');
  });

  it.each([
    ['constraint', { constraint: 'property_tile_pyramid_versions_active_slot_idx' }],
    ['constraint_name', { constraint_name: 'property_tile_pyramid_versions_active_slot_idx' }],
  ])(
    'records pending replacement metadata after an active slot conflict exposes a skipped active build via %s',
    async (_field, errorShape) => {
      const activeSlotConflict = Object.assign(new Error('duplicate active slot'), {
        code: '23505',
        ...errorShape,
      });
      let activeReplacementQueryCount = 0;
      executeMock.mockImplementation(async (query) => {
        const queryText = JSON.stringify(query);
        if (isLeasedActiveCoalesceQuery(queryText)) {
          activeReplacementQueryCount += 1;
          return activeReplacementQueryCount === 1
            ? []
            : [
                {
                  id: 'active-version',
                  status: 'building',
                  next_retry_at: null,
                  pending_replacement: true,
                },
              ];
        }
        if (isFullBuildCurrentGenerationQuery(queryText)) {
          return [];
        }
        if (isRecoverStaleBuildRequestQuery(queryText) || isQueuedBuildSupersedeQuery(queryText)) {
          return [];
        }
        if (isDurableBuildRequestQuery(queryText)) {
          throw activeSlotConflict;
        }
        throw new Error(`Unexpected query: ${queryText}`);
      });

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
      const conflictRecoveryQuery =
        executeMock.mock.calls
          .map((call) => JSON.stringify(call[0]))
          .filter((query) => isLeasedActiveCoalesceQuery(query))
          .at(-1) ?? '';
      expect(conflictRecoveryQuery).toContain('active_replacement');
      expect(conflictRecoveryQuery).toContain('pending_replacement_watermarks_json');
      expect(conflictRecoveryQuery).toContain("status IN ('building', 'validating')");
      expect(conflictRecoveryQuery).not.toContain('SKIP LOCKED');
    }
  );

  it.each([
    ['constraint', { constraint: 'property_tile_pyramid_versions_active_slot_idx' }],
    ['constraint_name', { constraint_name: 'property_tile_pyramid_versions_active_slot_idx' }],
  ])(
    'does not record pending replacement metadata during worker recovery after an active slot conflict via %s',
    async (_field, errorShape) => {
      const activeSlotConflict = Object.assign(new Error('duplicate active slot'), {
        code: '23505',
        ...errorShape,
      });
      executeMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(activeSlotConflict)
        .mockResolvedValueOnce([
          {
            id: 'active-version',
            status: 'validating',
            next_retry_at: null,
            pending_replacement: false,
            active_build_in_progress: true,
          },
        ]);

      const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
      const result = await requestPropertyTilePyramidBuild({
        reason: 'worker-recovery',
        sourceWatermarkHash: 'new-watermarks',
        sourceWatermarksJson: { sources: [{ source: 'unit' }] },
        buildInputsHash: 'inputs',
      });

      expect(result).toMatchObject({
        status: 'coalesced',
        versionId: 'active-version',
        existingStatus: 'validating',
        reason: 'active-build-in-progress',
      });
      expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
      const conflictRecoveryQuery = JSON.stringify(executeMock.mock.calls[4]?.[0]);
      expect(conflictRecoveryQuery).toContain('active_replacement');
      expect(conflictRecoveryQuery).toContain('active_build_in_progress');
      expect(conflictRecoveryQuery).toContain("status IN ('building', 'validating')");
      expect(conflictRecoveryQuery).not.toContain('pending_replacement_watermarks_json');
      expect(conflictRecoveryQuery).not.toContain('SKIP LOCKED');
    }
  );

  it('does not record pending replacement metadata for same comparable source watermarks', async () => {
    mockRequestBuildLifecycle({
      activeCoalesceRows: [
        {
          id: 'active-version',
          status: 'building',
          next_retry_at: null,
          queue_eligible: false,
          pending_replacement: false,
        },
      ],
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'source-watermark',
      sourceWatermarkHash: 'same-watermarks',
      sourceWatermarksJson: { sources: [{ source: 'unit' }] },
      buildInputsHash: 'inputs',
    });

    expect(result).toMatchObject({
      status: 'coalesced',
      versionId: 'active-version',
      existingStatus: 'building',
    });
    expect(result.reason).toBeUndefined();
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    const requestQuery =
      executeMock.mock.calls
        .map((call) => JSON.stringify(call[0]))
        .find((query) => isLeasedActiveCoalesceQuery(query)) ?? '';
    expect(requestQuery).toContain('active_same');
    expect(requestQuery).toContain('comparable_source_watermark_hash');
    expect(requestQuery).toContain('pending_replacement_watermarks_json');
    expect(requestQuery).toContain('IS DISTINCT FROM');
  });

  it('supersedes a stale queued candidate before inserting newer queued inputs for the same slot', async () => {
    mockRequestBuildLifecycle({
      durableRows: [
        {
          id: 'newer-version',
          status: 'queued',
          next_retry_at: null,
          queue_eligible: true,
          pending_replacement: false,
        },
      ],
    });
    enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
      status: 'enqueued',
      jobId: 'job-1',
    });

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'source-watermark',
      sourceWatermarkHash: 'newer-watermarks',
      sourceWatermarksJson: { sources: [{ source: 'unit-newer' }] },
      buildInputsHash: 'newer-inputs',
    });

    expect(result).toMatchObject({
      status: 'enqueued',
      versionId: 'newer-version',
      existingStatus: 'queued',
    });
    expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
    const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
    const supersedeQuery = executedQueries.find((query) => isQueuedBuildSupersedeQuery(query)) ?? '';
    const requestQuery = executedQueries.find((query) => isDurableBuildRequestQuery(query)) ?? '';
    expect(supersedeQuery).toContain("status = 'queued'");
    expect(supersedeQuery).toContain("status = 'failed_retryable'");
    expect(supersedeQuery).toContain('build_started_at IS NULL');
    expect(supersedeQuery).toContain("status = 'superseded'");
    expect(supersedeQuery).toContain('source_watermark_hash =');
    expect(supersedeQuery).toContain('NOT EXISTS');
    expect(requestQuery).toContain('active_replacement');
  });

  it('throttles worker recovery build requests through mutation coalescing when there is no active recovery work', async () => {
    executeMock
      .mockResolvedValueOnce([{ recovered_count: 0 }])
      .mockResolvedValueOnce([{ has_recovery_work: false }]);
    txExecuteMock
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([]);

    const { requestPropertyTilePyramidBuild } = await import('./property-tile-pyramid.js');
    const result = await requestPropertyTilePyramidBuild({
      reason: 'worker-recovery',
    });

    expect(result).toEqual({
      status: 'coalesced',
      reason: 'mutation-build-throttled',
    });
    expect(transactionMock).toHaveBeenCalledTimes(3);
    expect(enqueuePropertyTilePyramidBuildMock).not.toHaveBeenCalled();
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it.each([['expired active'], ['legacy validated']])(
    'enqueues a recovered %s build identity instead of coalescing',
    async () => {
      mockRequestBuildLifecycle({
        durableRows: [
          {
            id: 'recovered-version',
            status: 'failed_retryable',
            next_retry_at: null,
            queue_eligible: true,
          },
        ],
      });
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
      const recoveryQuery =
        executeMock.mock.calls
          .map((call) => JSON.stringify(call[0]))
          .find((query) => isRecoverStaleBuildRequestQuery(query)) ?? '';
      expect(recoveryQuery).toContain("status IN ('building', 'validating')");
      expect(recoveryQuery).toContain("status = 'validated'");
      expect(recoveryQuery).toContain('lease_until IS NULL');
      expect(recoveryQuery).not.toContain('build_inputs_hash =');
      expect(recoveryQuery).not.toContain('source_watermark_hash =');
    }
  );

  it('keeps validation and promotion in one transaction so promotion failure is recoverable', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
        PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1000000',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const emptySourceWatermarks =
          await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });
        let callIndex = 0;
        let sourceWatermarkSnapshotCount = 0;
        executeMock.mockImplementation(async (query) => {
          callIndex += 1;
          const queryText = JSON.stringify(query);
          if (callIndex === 1) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: emptySourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: emptySourceWatermarks.sourceWatermarksJson,
                status: 'queued',
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: emptySourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: emptySourceWatermarks.sourceWatermarksJson,
                status: 'building',
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: emptySourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: emptySourceWatermarks.sourceWatermarksJson,
              }),
            ];
          }
          if (
            queryText.includes('EXPLAIN (FORMAT JSON)') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('WITH current_snapshot AS MATERIALIZED') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          if (queryText.includes('FROM property_tile_pyramid_source_watermarks')) {
            sourceWatermarkSnapshotCount += 1;
            return sourceWatermarkSnapshotCount === 1
              ? []
              : [
                  {
                    scope: 'listing_facts',
                    scope_key: 'global',
                    watermark_value: '2',
                    watermark_timestamp: '2026-05-07T10:00:00.000Z',
                    updated_at: '2026-05-07T10:00:00.000Z',
                  },
                ];
          }
          if (queryText.includes(' AS ok')) {
            return [{ ok: true }];
          }
          if (
            isLeasedActiveCoalesceQuery(queryText) ||
            isFullBuildCurrentGenerationQuery(queryText) ||
            isRecoverStaleBuildRequestQuery(queryText) ||
            isQueuedBuildSupersedeQuery(queryText)
          ) {
            return [];
          }
          if (
            queryText.includes('active_replacement') &&
            queryText.includes('INSERT INTO property_tile_pyramid_versions')
          ) {
            return [
              {
                id: 'successor-version',
                status: 'queued',
                next_retry_at: null,
                queue_eligible: true,
                pending_replacement: false,
              },
            ];
          }
          return [{ affected: 1 }];
        });
        txExecuteMock
          .mockResolvedValueOnce([{ affected: 1 }])
          .mockResolvedValueOnce([{ pending_replacement_watermarks_json: {} }])
          .mockResolvedValueOnce([{ current_version_id: null }])
          .mockRejectedValueOnce(new Error('current pointer compare-and-swap failed'));

        await expect(
          pyramid.executeDuePropertyTilePyramidBuild({
            leaseOwner: 'unit-test',
            reason: 'worker-build',
          })
        ).rejects.toThrow('current pointer compare-and-swap failed');

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(txExecuteMock).toHaveBeenCalledTimes(4);
        const txQueries = txExecuteMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(txQueries[1]).toContain('pending_replacement_watermarks_json');
        expect(txQueries[1]).toContain('FOR UPDATE');
        expect(txQueries[3]).toContain('promote_property_tile_pyramid_version');
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const failureIndex = executedQueries.findIndex((query) => query.includes('build_error'));
        const successorRequestIndex = executedQueries.findIndex(
          (query) =>
            query.includes('active_replacement') &&
            query.includes('INSERT INTO property_tile_pyramid_versions')
        );
        const failureQuery = executedQueries[failureIndex] ?? '';
        expect(failureIndex).toBeGreaterThanOrEqual(0);
        expect(successorRequestIndex).toBeGreaterThan(failureIndex);
        expect(failureQuery).toContain('failed_retryable');
        expect(failureQuery).toContain('build_error');
        expect(failureQuery).not.toContain('source_watermark_advanced');
      }
    );
  });

  it('re-reads and clears late pending replacement watermarks before promotion and uses them for successor enqueue', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
        PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1000000',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const closedSourceWatermarks =
          await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });
        const finalPendingWatermarks = {
          sourceWatermarkHash: 'late-watermarks',
          sourceWatermarksJson: {
            comparableSourceWatermarkHash: 'late-comparable-watermarks',
            sources: [{ source: 'unit-late-pending' }],
          },
        };

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                pendingReplacementWatermarksJson: {},
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'building',
                pendingReplacementWatermarksJson: {},
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
              }),
            ];
          }
          if (
            queryText.includes('EXPLAIN (FORMAT JSON)') ||
            queryText.includes('FROM property_tile_pyramid_source_watermarks') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          if (queryText.includes(' AS ok')) {
            return [{ ok: true }];
          }
          if (
            isLeasedActiveCoalesceQuery(queryText) ||
            isFullBuildCurrentGenerationQuery(queryText) ||
            isRecoverStaleBuildRequestQuery(queryText) ||
            isQueuedBuildSupersedeQuery(queryText)
          ) {
            return [];
          }
          if (
            queryText.includes('active_replacement') &&
            queryText.includes('INSERT INTO property_tile_pyramid_versions')
          ) {
            return [
              {
                id: 'successor-version',
                status: 'queued',
                next_retry_at: null,
                queue_eligible: true,
                pending_replacement: false,
              },
            ];
          }
          return [{ affected: 1 }];
        });
        txExecuteMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (
            queryText.includes('SELECT pending_replacement_watermarks_json') &&
            queryText.includes('FOR UPDATE')
          ) {
            return [{ pending_replacement_watermarks_json: finalPendingWatermarks }];
          }
          if (queryText.includes('current_version_id')) {
            return [];
          }
          return [{ affected: 1 }];
        });
        enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
          status: 'enqueued',
          jobId: 'job-1',
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'promoted',
          versionId: 'build-version',
        });
        expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
        const txQueries = txExecuteMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const lockedPendingIndex = txQueries.findIndex(
          (query) =>
            query.includes('SELECT pending_replacement_watermarks_json') &&
            query.includes('FOR UPDATE')
        );
        const clearPendingIndex = txQueries.findIndex((query) =>
          query.includes("pending_replacement_watermarks_json = '{}'::jsonb")
        );
        const promoteIndex = txQueries.findIndex((query) =>
          query.includes('promote_property_tile_pyramid_version')
        );
        expect(lockedPendingIndex).toBeGreaterThanOrEqual(0);
        expect(txQueries[lockedPendingIndex]).toContain("status = 'validated'");
        expect(clearPendingIndex).toBeGreaterThan(lockedPendingIndex);
        expect(promoteIndex).toBeGreaterThan(clearPendingIndex);

        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const successorRequestIndex = executedQueries.findIndex(
          (query) =>
            query.includes('active_replacement') &&
            query.includes('INSERT INTO property_tile_pyramid_versions')
        );
        expect(successorRequestIndex).toBeGreaterThanOrEqual(0);
        const successorRequestValues = collectSqlValues(
          executeMock.mock.calls[successorRequestIndex]?.[0]
        );
        expect(successorRequestValues).toContain('late-watermarks');
        expect(successorRequestValues).toContain(
          JSON.stringify(finalPendingWatermarks.sourceWatermarksJson)
        );
      }
    );
  });

  it('restricts a worker job to the intended version id when provided', async () => {
    executeMock.mockResolvedValueOnce([{ retryable_version_count: 0 }]).mockResolvedValueOnce([]);

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
    expect(reserveDbConnectionMock).toHaveBeenCalled();
  });

  it('closes candidate source snapshots inside one repeatable-read transaction', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T10:30:00.000Z'));
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
        PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const sourceWatermarks = await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });
        let executeCallIndex = 0;
        executeMock.mockImplementation(async (query) => {
          executeCallIndex += 1;
          const queryText = JSON.stringify(query);
          if (executeCallIndex === 1) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
                status: 'building',
              }),
            ];
          }
          if (isCandidateSourceSnapshotAttachQuery(queryText)) {
            return [{ candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1' }];
          }
          if (
            queryText.includes('FROM property_tile_candidate_source_snapshots') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('FROM property_tile_pyramid_source_watermarks') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('EXPLAIN (FORMAT JSON)')
          ) {
            return [];
          }
          return [{ affected: 1 }];
        });
        txExecuteMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('INSERT INTO property_tile_candidate_source_snapshots')) {
            return [{ id: '00000000-0000-0000-0000-0000000000c1' }];
          }
          if (queryText.includes('candidate_count')) {
            return [
              {
                candidate_count: '0',
                fact_count: '0',
                social_fact_count: '0',
                grouping_fact_count: '0',
              },
            ];
          }
          return [];
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'failed_retryable',
          versionId: 'build-version',
          failureCategory: 'resource_limit',
        });
        expect(transactionMock).toHaveBeenCalledTimes(1);
        const txQueries = txExecuteMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const joinedTxQueries = txQueries.join('\n');
        expect(txQueries[0]).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        expect(joinedTxQueries).toContain('FROM property_tile_pyramid_source_watermarks');
        expect(joinedTxQueries).toContain("status = 'superseded'");
        expect(joinedTxQueries).toContain('social_fact_row_count IS NULL');
        expect(joinedTxQueries).toContain('grouping_fact_row_count IS NULL');
        expect(joinedTxQueries).toContain('INSERT INTO property_tile_candidate_source_snapshots');
        expect(joinedTxQueries).toContain('INSERT INTO property_tile_listing_candidates');
        expect(joinedTxQueries).toContain('INSERT INTO property_tile_listing_facts');
        expect(joinedTxQueries).toContain('INSERT INTO property_tile_social_facts');
        expect(joinedTxQueries).toContain('INSERT INTO property_tile_grouping_facts');
        expect(joinedTxQueries).toContain('social_fact_row_count');
        expect(joinedTxQueries).toContain('grouping_fact_row_count');
        expect(joinedTxQueries).toContain('property_tile_candidate_source_current');
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const claimIndex = executedQueries.findIndex((query) => isPyramidBuildingClaimQuery(query));
        const snapshotInsertIndex = txQueries.findIndex((query) =>
          isCandidateSourceSnapshotInsertQuery(query)
        );
        expect(claimIndex).toBeGreaterThanOrEqual(0);
        expect(snapshotInsertIndex).toBeGreaterThanOrEqual(0);
        expect(executeMock.mock.invocationCallOrder[claimIndex]).toBeLessThan(
          transactionMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(isCandidateSourceSnapshotProgressQuery(executedQueries.join('\n'))).toBe(true);
      }
    );
  });

  it('treats candidate source snapshot attach updating no rows as lease loss before tile generation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T10:30:00.000Z'));
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const sourceWatermarks = await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
                status: 'building',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (isCandidateSourceSnapshotAttachQuery(queryText)) {
            return [];
          }
          if (
            queryText.includes('FROM property_tile_pyramid_source_watermarks') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          return [{ affected: 1 }];
        });

        await expect(
          pyramid.executeDuePropertyTilePyramidBuild({
            leaseOwner: 'unit-test',
            reason: 'worker-build',
          })
        ).rejects.toThrow('Property tile pyramid build lease lost for version build-version');
        expect(buildGroupsMock).not.toHaveBeenCalled();
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const claimIndex = executedQueries.findIndex((query) => isPyramidBuildingClaimQuery(query));
        const attachIndex = executedQueries.findIndex((query) =>
          isCandidateSourceSnapshotAttachQuery(query)
        );
        expect(claimIndex).toBeGreaterThanOrEqual(0);
        expect(attachIndex).toBeGreaterThan(claimIndex);
        expect(executedQueries[attachIndex]).toContain("status = 'building'");
        expect(executedQueries[attachIndex]).toContain('lease_owner');
        expect(executedQueries[attachIndex]).toContain('lease_token');
        expect(executedQueries[attachIndex]).not.toContain(
          "status IN ('queued', 'failed_retryable')"
        );
      }
    );
  });

  it('does not rebuild or attach a candidate source snapshot when early claim returns no row', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T10:30:00.000Z'));
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const sourceWatermarks = await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: sourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: sourceWatermarks.sourceWatermarksJson,
              }),
            ];
          }
          if (isCandidateSourceSnapshotAttachQuery(queryText)) {
            return [{ candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1' }];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [];
          }
          if (
            queryText.includes('FROM property_tile_pyramid_source_watermarks') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('WITH current_snapshot AS MATERIALIZED') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          return [{ affected: 1 }];
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'noop',
          versionId: 'build-version',
          reason: 'pyramid-build-lease-not-acquired',
        });
        expect(buildGroupsMock).not.toHaveBeenCalled();
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(executedQueries.some((query) => isPyramidBuildingClaimQuery(query))).toBe(true);
        expect(executedQueries.some((query) => isCandidateSourceSnapshotAttachQuery(query))).toBe(
          false
        );
        expect(transactionMock).not.toHaveBeenCalled();
      }
    );
  });

  it('promotes an already closed candidate as last-known-good when source watermarks advance during active build and requests a successor', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
        PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1000000',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const closedSourceWatermarks =
          await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'queued',
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'building',
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_pyramid_source_watermarks')) {
            return [
              {
                scope: 'listing_facts',
                scope_key: 'global',
                watermark_value: '2',
                watermark_timestamp: '2026-05-07T10:00:00.000Z',
                updated_at: '2026-05-07T10:00:00.000Z',
              },
            ];
          }
          if (
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('WITH current_snapshot AS MATERIALIZED') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts') ||
            queryText.includes('EXPLAIN (FORMAT JSON)')
          ) {
            return [];
          }
          if (queryText.includes(' AS ok')) {
            return [{ ok: true }];
          }
          if (
            isLeasedActiveCoalesceQuery(queryText) ||
            isFullBuildCurrentGenerationQuery(queryText) ||
            isRecoverStaleBuildRequestQuery(queryText) ||
            isQueuedBuildSupersedeQuery(queryText)
          ) {
            return [];
          }
          if (
            queryText.includes('active_replacement') &&
            queryText.includes('INSERT INTO property_tile_pyramid_versions')
          ) {
            return [
              {
                id: 'successor-version',
                status: 'queued',
                next_retry_at: null,
                queue_eligible: true,
                pending_replacement: false,
              },
            ];
          }
          return [{ affected: 1 }];
        });
        txExecuteMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('current_version_id')) {
            return [];
          }
          return [{ affected: 1 }];
        });
        enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
          status: 'enqueued',
          jobId: 'job-1',
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'promoted',
          versionId: 'build-version',
        });
        expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(
          executedQueries.some((query) =>
            query.includes('source-watermark-advanced-before-candidate-snapshot')
          )
        ).toBe(false);
        expect(executedQueries.some((query) => query.includes('active_replacement'))).toBe(true);
        const txQueries = txExecuteMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(
          txQueries.some((query) => query.includes('promote_property_tile_pyramid_version'))
        ).toBe(true);
      }
    );
  });

  it('supersedes pre-closure source-watermark advancement while the candidate is still non-active', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const closedSourceWatermarks =
          await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [];
          }
          if (queryText.includes('FROM property_tile_pyramid_source_watermarks')) {
            return [
              {
                scope: 'listing_facts',
                scope_key: 'global',
                watermark_value: '2',
                watermark_timestamp: '2026-05-07T10:00:00.000Z',
                updated_at: '2026-05-07T10:00:00.000Z',
              },
            ];
          }
          if (
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('WITH current_snapshot AS MATERIALIZED') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          if (
            isLeasedActiveCoalesceQuery(queryText) ||
            isFullBuildCurrentGenerationQuery(queryText) ||
            isRecoverStaleBuildRequestQuery(queryText) ||
            isQueuedBuildSupersedeQuery(queryText)
          ) {
            return [];
          }
          if (
            queryText.includes('active_replacement') &&
            queryText.includes('INSERT INTO property_tile_pyramid_versions')
          ) {
            return [
              {
                id: 'successor-version',
                status: 'queued',
                next_retry_at: null,
                queue_eligible: true,
                pending_replacement: false,
              },
            ];
          }
          return [{ affected: 1 }];
        });
        enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
          status: 'enqueued',
          jobId: 'job-1',
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'superseded',
          versionId: 'build-version',
          reason: 'source-watermark-advanced-before-candidate-snapshot',
        });
        expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const preClosureSupersedeQuery =
          executedQueries.find((query) =>
            query.includes('source-watermark-advanced-before-candidate-snapshot')
          ) ?? '';
        expect(preClosureSupersedeQuery).toContain("status IN ('queued', 'failed_retryable')");
        expect(preClosureSupersedeQuery).not.toContain("status = 'building'");
        expect(preClosureSupersedeQuery).not.toContain('lease_owner');
        expect(executedQueries.some((query) => query.includes('active_replacement'))).toBe(true);
        expect(isPyramidBuildingClaimQuery(executedQueries.join('\n'))).toBe(false);
      }
    );
  });

  it('supersedes with the active lease when source watermarks advance inside candidate snapshot closure', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        executeMock.mockResolvedValue([]);
        const closedSourceWatermarks =
          await pyramid.readPropertyTilePyramidSourceWatermarkSnapshot();
        executeMock.mockReset();
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });

        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (queryText.includes('recovered_count')) {
            return [{ recovered_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'queued',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: closedSourceWatermarks.sourceWatermarkHash,
                sourceWatermarksJson: closedSourceWatermarks.sourceWatermarksJson,
                status: 'building',
                candidateSnapshotId: null,
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [];
          }
          if (
            queryText.includes('FROM property_tile_pyramid_source_watermarks') ||
            queryText.includes('FROM property_tile_snapshot_watermarks') ||
            queryText.includes('FROM ingest_sources') ||
            queryText.includes('FROM listing_source_scope_watermarks') ||
            queryText.includes('FROM listing_scope_completions') ||
            queryText.includes('FROM property_tile_candidate_source_current') ||
            queryText.includes('WITH current_snapshot AS MATERIALIZED') ||
            queryText.includes('FROM property_tile_listing_candidates') ||
            queryText.includes('FROM property_tile_listing_facts')
          ) {
            return [];
          }
          if (
            isLeasedActiveCoalesceQuery(queryText) ||
            isFullBuildCurrentGenerationQuery(queryText) ||
            isRecoverStaleBuildRequestQuery(queryText) ||
            isQueuedBuildSupersedeQuery(queryText)
          ) {
            return [];
          }
          if (
            queryText.includes('active_replacement') &&
            queryText.includes('INSERT INTO property_tile_pyramid_versions')
          ) {
            return [
              {
                id: 'successor-version',
                status: 'queued',
                next_retry_at: null,
                queue_eligible: true,
                pending_replacement: false,
              },
            ];
          }
          return [{ affected: 1 }];
        });
        txExecuteMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('FROM property_tile_pyramid_source_watermarks')) {
            return [
              {
                scope: 'listing_facts',
                scope_key: 'global',
                watermark_value: '2',
                watermark_timestamp: '2026-05-07T10:00:00.000Z',
                updated_at: '2026-05-07T10:00:00.000Z',
              },
            ];
          }
          return [];
        });
        enqueuePropertyTilePyramidBuildMock.mockResolvedValueOnce({
          status: 'enqueued',
          jobId: 'job-1',
        });

        const result = await pyramid.executeDuePropertyTilePyramidBuild({
          leaseOwner: 'unit-test',
          reason: 'worker-build',
        });

        expect(result).toMatchObject({
          status: 'superseded',
          versionId: 'build-version',
          reason: 'source-watermark-advanced-before-candidate-snapshot',
        });
        expect(enqueuePropertyTilePyramidBuildMock).toHaveBeenCalledTimes(1);
        expect(buildGroupsMock).not.toHaveBeenCalled();
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        const claimIndex = executedQueries.findIndex((query) => isPyramidBuildingClaimQuery(query));
        const supersedeIndex = executedQueries.findIndex(
          (query) =>
            query.includes('source-watermark-advanced-before-candidate-snapshot') &&
            query.includes("status = 'building'")
        );
        expect(claimIndex).toBeGreaterThanOrEqual(0);
        expect(supersedeIndex).toBeGreaterThan(claimIndex);
        expect(executedQueries[supersedeIndex]).toContain('lease_owner');
        expect(executedQueries[supersedeIndex]).toContain('lease_token');
        expect(
          txExecuteMock.mock.calls.map((call) => JSON.stringify(call[0])).join('\n')
        ).not.toContain('INSERT INTO property_tile_candidate_source_snapshots');
      }
    );
  });

  it('uses the configured WAL limit when validating build resources', async () => {
    await withTemporaryEnv(
      {
        PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '0',
        PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: '1',
      },
      async () => {
        const pyramid = await import('./property-tile-pyramid.js');
        const identity = pyramid.buildPropertyTilePyramidBuildIdentitySnapshots({
          coverageId: 'public_default_low_zoom',
          filterSignature: 'default',
          maxZoom: 0,
          pyramidKind: 'public_default_low_zoom',
        });
        executeMock.mockImplementation(async (query) => {
          const queryText = JSON.stringify(query);
          if (queryText.includes('retryable_version_count')) {
            return [{ retryable_version_count: 0 }];
          }
          if (isPyramidCandidateSelectionQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: 'watermarks',
                status: 'queued',
              }),
            ];
          }
          if (isPyramidBuildingClaimQuery(queryText)) {
            return [
              makePyramidBuildRow({
                identity,
                sourceWatermarkHash: 'watermarks',
                status: 'building',
              }),
            ];
          }
          if (queryText.includes('FROM property_tile_candidate_source_snapshots')) {
            return [
              makeCandidateSnapshotRow({
                sourceWatermarkHash: 'watermarks',
              }),
            ];
          }
          return [{ affected: 1 }];
        });

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
        expect(buildGroupsMock).not.toHaveBeenCalled();
        const executedQueries = executeMock.mock.calls.map((call) => JSON.stringify(call[0]));
        expect(executedQueries.some((query) => query.includes('EXPLAIN (FORMAT JSON)'))).toBe(true);
        const preflightQueries = executedQueries.filter((query) =>
          query.includes('EXPLAIN (FORMAT JSON)')
        );
        expect(preflightQueries.join('\n')).toContain('property_tile_grouping_facts');
        expect(preflightQueries.join('\n')).not.toContain('FROM comments');
        expect(preflightQueries.join('\n')).not.toContain('FROM reactions');
        expect(preflightQueries.join('\n')).not.toContain('FROM price_guesses');
        expect(preflightQueries.join('\n')).not.toContain('FROM property_views');
        expect(preflightQueries.join('\n')).not.toContain('property_tile_listing_candidates');
        expect(preflightQueries.join('\n')).not.toContain('property_tile_listing_facts');
        expect(preflightQueries.join('\n')).not.toContain('property_tile_social_facts');
        expect(
          executedQueries.some((query) => query.includes('DELETE FROM property_tile_pyramid_nodes'))
        ).toBe(false);
      }
    );
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
      .mockResolvedValueOnce([
        {
          source: 'property_tile_listing_candidates',
          candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1',
          row_count: '12',
          max_updated_at: '2026-05-07T09:14:00.000Z',
        },
        {
          source: 'property_tile_listing_facts',
          candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1',
          row_count: '10',
          max_updated_at: '2026-05-07T09:15:00.000Z',
        },
        {
          source: 'property_tile_social_facts',
          candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1',
          row_count: '7',
          max_updated_at: '2026-05-07T09:16:00.000Z',
        },
        {
          source: 'property_tile_grouping_facts',
          candidate_snapshot_id: '00000000-0000-0000-0000-0000000000c1',
          row_count: '14',
          max_updated_at: '2026-05-07T09:17:00.000Z',
        },
      ]);

    const { readPropertyTilePyramidSourceWatermarkSnapshot } =
      await import('./property-tile-pyramid.js');
    const snapshot = await readPropertyTilePyramidSourceWatermarkSnapshot();
    const sources = (snapshot.sourceWatermarksJson as { sources: unknown[] }).sources;

    expect(snapshot.sourceWatermarkHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'property_tile_snapshot_watermarks' }),
        expect.objectContaining({ source: 'ingest_sources' }),
        expect.objectContaining({ source: 'listing_source_scope_watermarks' }),
        expect.objectContaining({ source: 'listing_scope_completions' }),
        expect.objectContaining({
          source: 'property_tile_listing_candidates',
          scope: 'current_candidate_source_snapshot',
          rowCount: '12',
          maxUpdatedAt: '2026-05-07T09:14:00.000Z',
        }),
        expect.objectContaining({
          source: 'property_tile_listing_facts',
          scope: 'current_candidate_source_snapshot',
          rowCount: '10',
          maxUpdatedAt: '2026-05-07T09:15:00.000Z',
        }),
        expect.objectContaining({
          source: 'property_tile_social_facts',
          scope: 'current_candidate_source_snapshot',
          rowCount: '7',
          maxUpdatedAt: '2026-05-07T09:16:00.000Z',
        }),
        expect.objectContaining({
          source: 'property_tile_grouping_facts',
          scope: 'current_candidate_source_snapshot',
          rowCount: '14',
          maxUpdatedAt: '2026-05-07T09:17:00.000Z',
        }),
        expect.objectContaining({
          source: 'rolling_social_window',
          bucket: 20580,
          bucketUnit: 'cadence',
          cadenceMs: 86400000,
          cutoffAt: '2026-05-07T00:00:00.000Z',
        }),
      ])
    );
    expect(snapshot.sourceWatermarksJson).toMatchObject({
      comparableSourceWatermarkHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('does not advance source hashes for source-watermark bookkeeping churn', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-07T10:30:00.000Z'));
    const sourceRows = (updatedAt: string) => [
      {
        scope: 'listing_facts',
        scope_key: 'global',
        watermark_value: '3',
        watermark_timestamp: '2026-05-07T10:00:00.000Z',
        updated_at: updatedAt,
      },
      {
        scope: 'rolling_social_window',
        scope_key: 'full-build-eligibility',
        watermark_value: '0',
        watermark_timestamp: null,
        updated_at: updatedAt,
      },
    ];
    executeMock
      .mockResolvedValueOnce(sourceRows('2026-05-07T10:01:00.000Z'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sourceRows('2026-05-07T10:29:00.000Z'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { readPropertyTilePyramidSourceWatermarkSnapshot } =
      await import('./property-tile-pyramid.js');
    const first = await readPropertyTilePyramidSourceWatermarkSnapshot();
    const second = await readPropertyTilePyramidSourceWatermarkSnapshot();

    expect(second.sourceWatermarkHash).toBe(first.sourceWatermarkHash);
    expect(second.sourceWatermarksJson.comparableSourceWatermarkHash).toBe(
      first.sourceWatermarksJson.comparableSourceWatermarkHash
    );
    const sources = second.sourceWatermarksJson.sources as Array<Record<string, unknown>>;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'property_tile_pyramid_source_watermarks',
          scope: 'listing_facts',
          watermarkValue: '3',
          watermarkTimestamp: '2026-05-07T10:00:00.000Z',
        }),
      ])
    );
    expect(
      sources.some(
        (source) =>
          source.source === 'property_tile_pyramid_source_watermarks' &&
          source.scope === 'rolling_social_window' &&
          source.scopeKey === 'full-build-eligibility'
      )
    ).toBe(false);
    expect(
      sources.some(
        (source) =>
          source.source === 'property_tile_pyramid_source_watermarks' &&
          Object.hasOwn(source, 'updatedAt')
      )
    ).toBe(false);
  });

  it('checks health freshness against the full closed pyramid source set', async () => {
    executeMock.mockResolvedValueOnce([
      {
        current_version_id: 'build-version',
        current_promoted_at: '2026-05-07T10:00:00.000Z',
        degraded_reason: null,
        active_candidate_version_id: null,
        active_candidate_status: null,
        retryable_failure_due_at: null,
        terminal_failure_count: 0,
        encoded_coverage_ratio: 1,
        closed_watermark_max_updated_at: '2026-05-07T10:00:00.000Z',
        current_watermark_max_updated_at: '2026-05-07T10:00:00.000Z',
        closed_to_current_watermark_lag_seconds: 0,
        last_successful_promotion_at: '2026-05-07T10:00:00.000Z',
      },
    ]);

    const { getPropertyTilePyramidHealthSummary } = await import('./property-tile-pyramid.js');
    const summary = await getPropertyTilePyramidHealthSummary();

    expect(summary.status).toBe('ok');
    const healthQuery = JSON.stringify(executeMock.mock.calls[0]?.[0]);
    expect(healthQuery).toContain('property_tile_snapshot_watermarks');
    expect(healthQuery).toContain('ingest_sources');
    expect(healthQuery).toContain('listing_source_scope_watermarks');
    expect(healthQuery).toContain('listing_scope_completions');
    expect(healthQuery).toContain('property_tile_candidate_source_current');
    expect(healthQuery).toContain('property_tile_listing_candidates');
    expect(healthQuery).toContain('property_tile_listing_facts');
    expect(healthQuery).toContain('property_tile_social_facts');
    expect(healthQuery).toContain('property_tile_grouping_facts');
    expect(healthQuery).toContain('rolling_social_window');
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

    const { buildPropertyTilePyramidEtag, lookupPromotedPropertyTilePyramidTile } =
      await import('./property-tile-pyramid.js');
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
    expect(result.state === 'hit' ? result.etag : null).toBe(
      buildPropertyTilePyramidEtag({
        versionId: version.versionId,
        z: 0,
        x: 0,
        y: 0,
        payload: Buffer.from('new-payload'),
      })
    );
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

  it('runs retention through chunked pyramid and candidate snapshot cleanup', async () => {
    executeMock
      .mockResolvedValueOnce([{ result: { partitioned: false } }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ relation_name: 'property_tile_pyramid_members' }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }])
      .mockResolvedValueOnce([{ affected: 0 }]);

    const { runPropertyTilePyramidRetention } = await import('./property-tile-pyramid.js');
    const result = await runPropertyTilePyramidRetention();

    expect(result).toMatchObject({
      status: 'completed',
      resetPayloads: 0,
      deletedMembers: 0,
      deletedNodes: 0,
      deletedTiles: 0,
      deletedVersions: 0,
      deletedCandidateListingCandidates: 0,
      deletedCandidateListingFacts: 0,
      deletedCandidateSocialFacts: 0,
      deletedCandidateGroupingFacts: 0,
      deletedCandidateSourceSnapshots: 0,
    });
    const retentionQueries = executeMock.mock.calls
      .map((call) => JSON.stringify(call[0]))
      .join('\n');
    const retentionQueryValues = executeMock.mock.calls.flatMap((call) =>
      collectSqlValues(call[0])
    );
    expect(retentionQueries).toContain('LIMIT');
    expect(retentionQueryValues).toContain(10000);
    expect(retentionQueries).toContain('FOR UPDATE SKIP LOCKED');
    expect(retentionQueries).not.toMatch(/AND NOT EXISTS \(\s+AND \(/);
    expect(retentionQueries).toContain('property_tile_pyramid_members');
    expect(retentionQueries).toContain('previous_version_id');
    expect(retentionQueries).toContain("interval '30 minutes'");
    expect(retentionQueries).toContain("interval '1 hour'");
    expect(retentionQueries).toContain("interval '7 days'");
    expect(retentionQueries).toContain('property_tile_pyramid_audit');
    expect(retentionQueries).toContain('property_tile_candidate_source_snapshots');
    expect(retentionQueries).toContain('property_tile_candidate_source_current');
    expect(retentionQueries).toContain('candidate_snapshot_id');
    expect(retentionQueries).toContain('property_tile_listing_candidates');
    expect(retentionQueries).toContain('property_tile_listing_facts');
    expect(retentionQueries).toContain('property_tile_social_facts');
    expect(retentionQueries).toContain('property_tile_grouping_facts');
  });

  it('marks retention as draining after bounded full chunks remain', async () => {
    executeMock.mockImplementation(async (query) => {
      const queryText = JSON.stringify(query);
      if (queryText.includes('property_tile_generated_partition_retention')) {
        return [{ result: { partitioned: false } }];
      }
      if (queryText.includes('to_regclass')) {
        return [{ relation_name: 'property_tile_pyramid_members' }];
      }
      return [{ affected: 10000 }];
    });

    const { runPropertyTilePyramidRetention } = await import('./property-tile-pyramid.js');
    const result = await withTemporaryEnv(
      { PROPERTY_TILE_PYRAMID_RETENTION_MAX_CHUNKS_PER_STEP: '2' },
      () => runPropertyTilePyramidRetention()
    );

    expect(result).toMatchObject({
      status: 'draining',
      hasMore: true,
      resetPayloads: 20000,
      deletedMembers: 20000,
      deletedNodes: 20000,
      deletedTiles: 20000,
      deletedVersions: 20000,
      deletedCandidateListingCandidates: 20000,
      deletedCandidateListingFacts: 20000,
      deletedCandidateSocialFacts: 20000,
      deletedCandidateGroupingFacts: 20000,
      deletedCandidateSourceSnapshots: 20000,
      chunks: {
        resetPayloads: 2,
        deletedMembers: 2,
        deletedNodes: 2,
        deletedTiles: 2,
        deletedVersions: 2,
        deletedCandidateListingCandidates: 2,
        deletedCandidateListingFacts: 2,
        deletedCandidateSocialFacts: 2,
        deletedCandidateGroupingFacts: 2,
        deletedCandidateSourceSnapshots: 2,
      },
    });
    expect(executeMock).toHaveBeenCalledTimes(23);
    const retentionQueries = executeMock.mock.calls
      .map((call) => JSON.stringify(call[0]))
      .join('\n');
    const retentionQueryValues = executeMock.mock.calls.flatMap((call) =>
      collectSqlValues(call[0])
    );
    expect(retentionQueries).toContain('LIMIT');
    expect(retentionQueries).toContain('FOR UPDATE SKIP LOCKED');
    expect(retentionQueryValues).toContain(10000);
  });

  it('skips optional member retention when the legacy members table is absent', async () => {
    executeMock.mockImplementation(async (query) => {
      const queryText = JSON.stringify(query);
      if (queryText.includes('property_tile_generated_partition_retention')) {
        return [{ result: { partitioned: false } }];
      }
      if (queryText.includes('to_regclass')) {
        return [{ relation_name: null }];
      }
      return [{ affected: 0 }];
    });

    const { runPropertyTilePyramidRetention } = await import('./property-tile-pyramid.js');
    const result = await runPropertyTilePyramidRetention();

    expect(result).toMatchObject({
      status: 'completed',
      deletedMembers: 0,
    });
    const retentionQueries = executeMock.mock.calls
      .map((call) => JSON.stringify(call[0]))
      .join('\n');
    expect(retentionQueries).toContain('to_regclass');
    expect(retentionQueries).not.toContain('FROM property_tile_pyramid_members m');
    expect(retentionQueries).not.toContain('DELETE FROM property_tile_pyramid_members m');
  });

  it('uses partition retention without row-by-row generated table deletes when partitioned', async () => {
    executeMock.mockResolvedValueOnce([
      {
        result: {
          partitioned: true,
          droppedVersionPartitions: 4,
          droppedSnapshotPartitions: 8,
          deletedVersions: 2,
          deletedCandidateSourceSnapshots: 2,
        },
      },
    ]);

    const { runPropertyTilePyramidRetention } = await import('./property-tile-pyramid.js');
    const result = await runPropertyTilePyramidRetention();

    expect(result).toMatchObject({
      status: 'completed',
      hasMore: false,
      partitioned: true,
      deletedVersions: 2,
      deletedCandidateSourceSnapshots: 2,
      droppedVersionPartitions: 4,
      droppedSnapshotPartitions: 8,
    });
    const retentionQueries = executeMock.mock.calls
      .map((call) => JSON.stringify(call[0]))
      .join('\n');
    expect(retentionQueries).toContain('property_tile_generated_partition_retention');
    expect(retentionQueries).not.toContain('DELETE FROM property_tile_pyramid_nodes n');
    expect(retentionQueries).not.toContain('DELETE FROM property_tile_listing_candidates c');
    expect(retentionQueries).not.toContain('property_tile_pyramid_source_watermarks');
  });
});

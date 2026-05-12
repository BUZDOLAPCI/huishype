import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRuntime, type WorkerRuntimeModuleLoaders } from './runtime.js';
import { loadWorkerConfig } from './config.js';

type RecoverySweepResult = {
  propertyTilePyramidBuildRequested: boolean;
  propertyTilePyramidBuildStatus: string | null;
  propertyTilePyramidRetentionStatus: string | null;
  candidateHandoffIds: string[];
  candidateHandoffDispatchedIds: string[];
  candidateHandoffFailedDispatchIds: string[];
};

type RuntimeInternals = {
  performRecoverySweep(trigger: string): Promise<RecoverySweepResult>;
  processCandidateHandoffJob(
    job: {
      id?: string;
      data: { handoffId: string };
      attemptsStarted: number;
    },
  ): Promise<Record<string, unknown>>;
  processPropertyTilePyramidBuildJob(
    job: {
      id?: string;
      name: string;
      data: { versionId?: string; reason: string };
      attemptsStarted: number;
    },
    expectedJobName: string,
  ): Promise<Record<string, unknown>>;
};

function createLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };
}

function createModuleLoaders(
  overrides: Partial<WorkerRuntimeModuleLoaders> = {},
): WorkerRuntimeModuleLoaders {
  const enqueueIngestBatch = mock.fn(async () => undefined);
  const enqueueCandidateHandoff = mock.fn(async () => undefined);
  const requestLatestListingsRefresh = mock.fn(async () => undefined);
  const enqueueOfficialValuationHydration = mock.fn(async () => undefined);
  const markOfficialValuationHydrationJobQueued = mock.fn(async () => undefined);

  return {
    loadApiDbModule: async () => ({ closeConnection: async () => undefined }),
    loadApiRedisModule: async () => ({
      createRedisConnection: async () => ({
        quit: async () => undefined,
        disconnect: () => undefined,
      }),
      closeRedisConnection: async () => undefined,
    }),
    loadCandidateHandoffJobsModule: async () => ({
      CANDIDATE_HANDOFF_QUEUE: 'listing-candidate-handoffs',
    }),
    loadCandidateHandoffProcessorModule: async () => ({
      processCandidateHandoffJob: async () => ({ status: 'noop' }),
    }),
    loadCandidateHandoffQueueModule: async () => ({
      closeCandidateHandoffQueues: async () => undefined,
      enqueueCandidateHandoff,
    }),
    loadCandidateHandoffStoreModule: async () => ({
      collectDueCandidateHandoffIds: async () => [],
    }),
    loadIngestJobsModule: async () => ({
      INGEST_BATCH_QUEUE: 'ingest-batches',
      MAINTENANCE_QUEUE: 'maintenance',
      PROPERTY_TILE_PYRAMID_QUEUE: 'property-tile-pyramid',
      PROPERTY_TILE_PYRAMID_BUILD_JOB: 'build-property-tile-pyramid',
    }),
    loadIngestProcessorModule: async () => ({
      processIngestBatch: async () => ({
        status: 'completed' as const,
        ingested: 0,
        updated: 0,
        skipped: 0,
      }),
      refreshLatestListingsMaintenance: async () => 0,
    }),
    loadIngestQueueModule: async () => ({
      closeIngestQueues: async () => undefined,
      enqueueIngestBatch,
      requestLatestListingsRefresh,
    }),
    loadIngestStoreModule: async () => ({
      collectRecoveryDispatchWork: async () => ({
        staleProcessingBatchIds: [],
        recoverableBatchIds: [],
        maintenancePending: false,
      }),
      markBatchQueued: async () => undefined,
    }),
    loadListingsViewModule: async () => ({
      refreshLatestListingsView: async () => undefined,
      refreshPriceGuessStartMarketSummaries: async () => undefined,
    }),
    loadOfficialValuationJobsModule: async () => ({
      OFFICIAL_VALUATION_HYDRATION_QUEUE: 'official-valuation-hydration',
    }),
    loadOfficialValuationProcessorModule: async () => ({
      processOfficialValuationHydrationJob: async () => ({}),
    }),
    loadOfficialValuationQueueModule: async () => ({
      closeOfficialValuationQueues: async () => undefined,
      enqueueOfficialValuationHydration,
    }),
    loadOfficialValuationStoreModule: async () => ({
      collectDueOfficialValuationHydrationJobs: async () => [],
      markOfficialValuationHydrationJobQueued,
    }),
    loadPropertyTilePyramidModule: async () => ({
      executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
      requestPropertyTilePyramidBuild: async () => ({ status: 'coalesced' }),
      runPropertyTilePyramidRetention: async () => ({ status: 'completed', deletedVersions: 0 }),
    }),
    ...overrides,
  };
}

function createRuntime(
  loaders: WorkerRuntimeModuleLoaders,
  env: NodeJS.ProcessEnv = { WORKER_PROPERTY_TILE_PYRAMID_RETENTION_UTC_MINUTE_OF_DAY: '0' },
): WorkerRuntime {
  return new WorkerRuntime(loadWorkerConfig(env), createLogger(), loaders);
}

test('recovery sweep requests a property tile pyramid build through durable coalescing', async () => {
  const requestBuildCalls: unknown[] = [];
  const requestBuild = async (input: { reason: string }) => {
    requestBuildCalls.push(input);
    return { status: 'enqueued', versionId: 'version-1', queueJobId: 'job-1' };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
        requestPropertyTilePyramidBuild: requestBuild,
        runPropertyTilePyramidRetention: async () => ({ status: 'completed', deletedVersions: 0 }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.equal(summary.propertyTilePyramidBuildRequested, true);
  assert.equal(summary.propertyTilePyramidBuildStatus, 'enqueued');
  assert.deepEqual(requestBuildCalls[0], {
    reason: 'worker-recovery',
  });
});

test('recovery sweep reports unavailable pyramid schema without dispatching snapshots', async () => {
  const requestBuildCalls: unknown[] = [];
  const requestBuild = async (input: { reason: string }) => {
    requestBuildCalls.push(input);
    return { status: 'unavailable', reason: 'pyramid-schema-unavailable' };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
        requestPropertyTilePyramidBuild: requestBuild,
        runPropertyTilePyramidRetention: async () => ({ status: 'completed', deletedVersions: 0 }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.equal(summary.propertyTilePyramidBuildRequested, false);
  assert.equal(summary.propertyTilePyramidBuildStatus, 'unavailable');
  assert.deepEqual(requestBuildCalls, [{ reason: 'worker-recovery' }]);
});

test('recovery sweep runs property tile pyramid retention', async () => {
  const retentionCalls: string[] = [];
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
        requestPropertyTilePyramidBuild: async () => ({ status: 'coalesced' }),
        runPropertyTilePyramidRetention: async () => {
          retentionCalls.push('run');
          return { status: 'completed', deletedVersions: 2 };
        },
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.deepEqual(retentionCalls, ['run']);
  assert.equal(summary.propertyTilePyramidRetentionStatus, 'completed');
});

test('recovery sweep retries draining property tile pyramid retention on the same UTC day', async () => {
  const retentionCalls: string[] = [];
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
        requestPropertyTilePyramidBuild: async () => ({ status: 'coalesced' }),
        runPropertyTilePyramidRetention: async () => {
          retentionCalls.push('run');
          return retentionCalls.length === 1
            ? { status: 'draining', hasMore: true, deletedVersions: 10_000 }
            : { status: 'completed', hasMore: false, deletedVersions: 0 };
        },
      }),
    }),
  ) as unknown as RuntimeInternals;

  const firstSummary = await runtime.performRecoverySweep('unit');
  const secondSummary = await runtime.performRecoverySweep('unit');

  assert.deepEqual(retentionCalls, ['run', 'run']);
  assert.equal(firstSummary.propertyTilePyramidRetentionStatus, 'draining');
  assert.equal(secondSummary.propertyTilePyramidRetentionStatus, 'completed');
});

test('recovery sweep skips property tile pyramid retention before the configured UTC minute', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-07T03:19:00.000Z') });
  const retentionCalls: string[] = [];
  try {
    const runtime = createRuntime(
      createModuleLoaders({
        loadPropertyTilePyramidModule: async () => ({
          executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
          requestPropertyTilePyramidBuild: async () => ({ status: 'coalesced' }),
          runPropertyTilePyramidRetention: async () => {
            retentionCalls.push('run');
            return { status: 'completed', deletedVersions: 0 };
          },
        }),
      }),
      { WORKER_PROPERTY_TILE_PYRAMID_RETENTION_UTC_MINUTE_OF_DAY: '200' },
    ) as unknown as RuntimeInternals;

    const summary = await runtime.performRecoverySweep('unit');

    assert.deepEqual(retentionCalls, []);
    assert.equal(summary.propertyTilePyramidRetentionStatus, null);
  } finally {
    mock.timers.reset();
  }
});

test('recovery sweep dispatches due candidate handoffs', async () => {
  const dispatchCalls: string[] = [];
  const runtime = createRuntime(
    createModuleLoaders({
      loadCandidateHandoffStoreModule: async () => ({
        collectDueCandidateHandoffIds: async () => ['handoff-1', 'handoff-2'],
      }),
      loadCandidateHandoffQueueModule: async () => ({
        closeCandidateHandoffQueues: async () => undefined,
        enqueueCandidateHandoff: async (handoffId: string) => {
          dispatchCalls.push(handoffId);
        },
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.deepEqual(summary.candidateHandoffIds, ['handoff-1', 'handoff-2']);
  assert.deepEqual(summary.candidateHandoffDispatchedIds, ['handoff-1', 'handoff-2']);
  assert.deepEqual(summary.candidateHandoffFailedDispatchIds, []);
  assert.deepEqual(dispatchCalls, ['handoff-1', 'handoff-2']);
});

test('candidate handoff worker job delegates to processor', async () => {
  const processorCalls: unknown[] = [];
  const runtime = createRuntime(
    createModuleLoaders({
      loadCandidateHandoffProcessorModule: async () => ({
        processCandidateHandoffJob: async (input) => {
          processorCalls.push(input);
          return { status: 'delivered' };
        },
      }),
    }),
  ) as unknown as RuntimeInternals;

  const result = await runtime.processCandidateHandoffJob({
    id: 'job-1',
    data: { handoffId: 'handoff-1' },
    attemptsStarted: 1,
  });

  assert.deepEqual(result, { status: 'delivered' });
  assert.equal((processorCalls[0] as { handoffId: string }).handoffId, 'handoff-1');
  assert.ok((processorCalls[0] as { logger?: unknown }).logger);
});

test('runtime does not expose the legacy property tile snapshot worker processor', () => {
  const runtime = createRuntime(createModuleLoaders()) as unknown as {
    processPropertyTileSnapshotRefreshJob?: unknown;
  };

  assert.equal(runtime.processPropertyTileSnapshotRefreshJob, undefined);
});

test('property tile pyramid worker job delegates to durable pyramid build lease', async () => {
  const executeBuildCalls: unknown[] = [];
  const executeBuild = async (input: {
    reason?: string;
    leaseOwner?: string;
    versionId?: string;
    logger?: unknown;
  }) => {
    executeBuildCalls.push(input);
    return { status: 'failed_retryable', versionId: 'version-1' };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: executeBuild,
        requestPropertyTilePyramidBuild: async () => ({ status: 'coalesced' }),
        runPropertyTilePyramidRetention: async () => ({ status: 'completed', deletedVersions: 0 }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const result = await runtime.processPropertyTilePyramidBuildJob(
    {
      id: 'job-1',
      name: 'build-property-tile-pyramid',
      data: { versionId: 'version-1', reason: 'unit-test' },
      attemptsStarted: 1,
    },
    'build-property-tile-pyramid',
  );

  assert.deepEqual(result, { status: 'failed_retryable', versionId: 'version-1' });
  const buildInput = executeBuildCalls[0] as {
    reason?: string;
    leaseOwner?: string;
    versionId?: string;
    logger?: unknown;
  };
  assert.equal(buildInput.reason, 'unit-test');
  assert.equal(buildInput.leaseOwner, `worker:${process.pid}:job-1`);
  assert.equal(buildInput.versionId, 'version-1');
  assert.ok(buildInput.logger);
});

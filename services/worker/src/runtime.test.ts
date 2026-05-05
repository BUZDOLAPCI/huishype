import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRuntime, type WorkerRuntimeModuleLoaders } from './runtime.js';
import { loadWorkerConfig } from './config.js';

type RecoverySweepResult = {
  propertyTileSnapshotRefreshRequested: boolean;
  propertyTileSnapshotRefreshReason: string | null;
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
  processPropertyTileSnapshotRefreshJob(
    job: {
      id?: string;
      name: string;
      data: { reason: string };
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
      PROPERTY_TILE_SNAPSHOT_QUEUE: 'property-tile-snapshots',
      PROPERTY_TILE_SNAPSHOT_REFRESH_JOB: 'refresh-property-tile-snapshots',
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
      enqueuePropertyTileSnapshotRefresh: async () => undefined,
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
    loadPropertyTileSnapshotsModule: async () => ({
      executePropertyTileSnapshotRefresh: async () => ({}),
      requestPropertyTileSnapshotRefresh: async () => ({ enqueued: false, throttled: false }),
      shouldRequestPropertyTileSnapshotRefresh: async () => ({
        shouldEnqueue: false,
        reason: 'current',
      }),
    }),
    ...overrides,
  };
}

function createRuntime(loaders: WorkerRuntimeModuleLoaders): WorkerRuntime {
  return new WorkerRuntime(loadWorkerConfig({}), createLogger(), loaders);
}

test('recovery sweep requests property tile snapshot refresh when snapshots are behind', async () => {
  const requestRefreshCalls: unknown[] = [];
  const requestRefresh = async (input: { reason: string; throttleMs?: number }) => {
    requestRefreshCalls.push(input);
    return { enqueued: true, throttled: false };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTileSnapshotsModule: async () => ({
        executePropertyTileSnapshotRefresh: async () => ({}),
        requestPropertyTileSnapshotRefresh: requestRefresh,
        shouldRequestPropertyTileSnapshotRefresh: async () => ({
          shouldEnqueue: true,
          reason: 'absent_snapshots',
        }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.equal(summary.propertyTileSnapshotRefreshRequested, true);
  assert.equal(summary.propertyTileSnapshotRefreshReason, 'absent_snapshots');
  assert.deepEqual(requestRefreshCalls[0], {
    reason: 'worker-recovery:absent_snapshots',
  });
});

test('recovery sweep respects snapshot refresh throttle decisions', async () => {
  const requestRefreshCalls: unknown[] = [];
  const requestRefresh = async (input: { reason: string; throttleMs?: number }) => {
    requestRefreshCalls.push(input);
    return { enqueued: true, throttled: false };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTileSnapshotsModule: async () => ({
        executePropertyTileSnapshotRefresh: async () => ({}),
        requestPropertyTileSnapshotRefresh: requestRefresh,
        shouldRequestPropertyTileSnapshotRefresh: async () => ({
          shouldEnqueue: false,
          reason: 'property_view_throttled',
        }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.equal(summary.propertyTileSnapshotRefreshRequested, false);
  assert.equal(summary.propertyTileSnapshotRefreshReason, 'property_view_throttled');
  assert.deepEqual(requestRefreshCalls, []);
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

test('property tile snapshot worker job delegates to snapshot refresh with a durable lease owner', async () => {
  const executeRefreshCalls: unknown[] = [];
  const executeRefresh = async (input?: {
    reason?: string;
    leaseOwner?: string;
    logger?: unknown;
  }) => {
    executeRefreshCalls.push(input);
    return { status: 'completed' };
  };
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTileSnapshotsModule: async () => ({
        executePropertyTileSnapshotRefresh: executeRefresh,
        requestPropertyTileSnapshotRefresh: async () => ({ enqueued: false, throttled: false }),
        shouldRequestPropertyTileSnapshotRefresh: async () => ({
          shouldEnqueue: false,
          reason: 'current',
        }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const result = await runtime.processPropertyTileSnapshotRefreshJob(
    {
      id: 'job-1',
      name: 'refresh-property-tile-snapshots',
      data: { reason: 'unit-test' },
      attemptsStarted: 2,
    },
    'refresh-property-tile-snapshots',
  );

  assert.deepEqual(result, { status: 'completed' });
  const refreshInput = executeRefreshCalls[0] as {
    reason?: string;
    leaseOwner?: string;
    logger?: unknown;
  };
  assert.equal(refreshInput.reason, 'unit-test');
  assert.equal(refreshInput.leaseOwner, `worker:${process.pid}:job-1`);
  assert.ok(refreshInput.logger);
});

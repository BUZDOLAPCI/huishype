import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRuntime, type WorkerRuntimeModuleLoaders } from './runtime.js';
import { loadWorkerConfig } from './config.js';

type RecoverySweepResult = {
  propertyTilePyramidBuildRequested: boolean;
  propertyTilePyramidBuildStatus: string | null;
  propertyTilePyramidBuildReason: string | null;
  propertyTilePyramidRetentionStatus: string | null;
  candidateHandoffIds: string[];
  candidateHandoffDispatchedIds: string[];
  candidateHandoffFailedDispatchIds: string[];
  officialValuationHydrationJobIds: string[];
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
    loadIngestOperationalRetentionModule: async () => ({
      runIngestOperationalRetention: async () => ({ retiredBatches: 0, deletedEvidence: 0 }),
    }),
    loadListingTileUpdatesModule: async () => ({
      runListingTileUpdates: async () => ({ publishedCount: 0 }),
    }),
    loadListingLifecycleModule: async () => ({
      runListingLifecycleMaintenance: async () => ({ expiredCount: 0, projectionsRefreshed: false }),
    }),
    loadPriceEvidenceRepairModule: async () => ({
      runPriceEvidenceRepair: async () => ({ repairedCount: 0 }),
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
  assert.equal(summary.propertyTilePyramidBuildReason, null);
  assert.deepEqual(requestBuildCalls[0], {
    reason: 'worker-recovery',
  });
});

test('recovery sweep reports unavailable pyramid schema reason without dispatching snapshots', async () => {
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
  assert.equal(summary.propertyTilePyramidBuildReason, 'pyramid-schema-unavailable');
  assert.deepEqual(requestBuildCalls, [{ reason: 'worker-recovery' }]);
});

test('recovery sweep preserves coalesced pyramid recovery reason', async () => {
  const runtime = createRuntime(
    createModuleLoaders({
      loadPropertyTilePyramidModule: async () => ({
        executeDuePropertyTilePyramidBuild: async () => ({ status: 'noop' }),
        requestPropertyTilePyramidBuild: async () => ({
          status: 'coalesced',
          versionId: 'version-active',
          reason: 'active-build-in-progress',
        }),
        runPropertyTilePyramidRetention: async () => ({ status: 'completed', deletedVersions: 0 }),
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.equal(summary.propertyTilePyramidBuildRequested, true);
  assert.equal(summary.propertyTilePyramidBuildStatus, 'coalesced');
  assert.equal(summary.propertyTilePyramidBuildReason, 'active-build-in-progress');
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

test('recovery sweep re-enqueues due retryable official valuation hydration jobs', async () => {
  const dispatchCalls: unknown[] = [];
  const queuedJobIds: string[] = [];
  const runtime = createRuntime(
    createModuleLoaders({
      loadOfficialValuationStoreModule: async () => ({
        collectDueOfficialValuationHydrationJobs: async () => [
          {
            id: 'hydration-job-1',
            propertyId: 'property-1',
            source: 'woz',
            valuationYear: 2025,
          },
          {
            id: 'hydration-job-2',
            propertyId: 'property-2',
            source: 'woz',
            valuationYear: 2025,
          },
        ],
        markOfficialValuationHydrationJobQueued: async (jobId: string) => {
          queuedJobIds.push(jobId);
        },
      }),
      loadOfficialValuationQueueModule: async () => ({
        closeOfficialValuationQueues: async () => undefined,
        enqueueOfficialValuationHydration: async (data) => {
          dispatchCalls.push(data);
        },
      }),
    }),
  ) as unknown as RuntimeInternals;

  const summary = await runtime.performRecoverySweep('unit');

  assert.deepEqual(summary.officialValuationHydrationJobIds, [
    'hydration-job-1',
    'hydration-job-2',
  ]);
  assert.deepEqual(queuedJobIds, ['hydration-job-1', 'hydration-job-2']);
  assert.deepEqual(dispatchCalls, [
    {
      jobId: 'hydration-job-1',
      propertyId: 'property-1',
      source: 'woz',
      valuationYear: 2025,
    },
    {
      jobId: 'hydration-job-2',
      propertyId: 'property-2',
      source: 'woz',
      valuationYear: 2025,
    },
  ]);
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


test('recovery sweep expires listing eligibility and repairs price evidence without incoming ingest', async () => {
  const calls: string[] = [];
  const runtime = createRuntime(createModuleLoaders({
    loadListingLifecycleModule: async () => ({
      runListingLifecycleMaintenance: async () => {
        calls.push('expiry');
        return { expiredCount: 1, projectionsRefreshed: true };
      },
    }),
    loadPriceEvidenceRepairModule: async () => ({
      runPriceEvidenceRepair: async () => {
        calls.push('repair');
        return { repairedCount: 1 };
      },
    }),
  }));
  await (runtime as unknown as RuntimeInternals).performRecoverySweep('test');
  assert.deepEqual(calls, ['expiry', 'repair']);
});

test('failed lifecycle maintenance is retried by the next sweep and does not prevent other recovery', async () => {
  let attempts = 0;
  let repairs = 0;
  const runtime = createRuntime(createModuleLoaders({
    loadListingLifecycleModule: async () => ({
      runListingLifecycleMaintenance: async () => {
        attempts += 1;
        throw new Error('refresh interrupted');
      },
    }),
    loadPriceEvidenceRepairModule: async () => ({
      runPriceEvidenceRepair: async () => { repairs += 1; return {}; },
    }),
  }));
  await (runtime as unknown as RuntimeInternals).performRecoverySweep('first');
  await (runtime as unknown as RuntimeInternals).performRecoverySweep('second');
  assert.equal(attempts, 2);
  assert.equal(repairs, 2);
});

test('raw ingest retention runs without incoming work and retries a rolled-back pass on the next sweep', async () => {
  let attempts = 0;
  let recoveryCalls = 0;
  const runtime = createRuntime(createModuleLoaders({
    loadIngestOperationalRetentionModule: async () => ({
      runIngestOperationalRetention: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('retention transaction interrupted');
        return { retiredBatches: 2, deletedEvidence: 10 };
      },
    }),
    loadIngestStoreModule: async () => ({
      collectRecoveryDispatchWork: async () => {
        recoveryCalls += 1;
        return { staleProcessingBatchIds: [], recoverableBatchIds: [], maintenancePending: false };
      },
      markBatchQueued: async () => undefined,
    }),
  }));
  await (runtime as unknown as RuntimeInternals).performRecoverySweep('first');
  await (runtime as unknown as RuntimeInternals).performRecoverySweep('second');
  assert.equal(attempts, 2);
  assert.equal(recoveryCalls, 2);
});

test('shutdown drains active workers, recovery and health before closing their dependencies', async () => {
  const events: string[] = [];
  let finishWorker!: () => void;
  let finishSweep!: () => void;
  let finishHealth!: () => void;
  const runtime = createRuntime(createModuleLoaders({
    loadApiDbModule: async () => ({ closeConnection: async () => { events.push('db'); } }),
    loadApiRedisModule: async () => ({
      createRedisConnection: async () => { throw new Error('unexpected connection'); },
      closeRedisConnection: async () => { events.push('shared-redis'); },
    }),
  }), { WORKER_SHUTDOWN_TIMEOUT_MS: '5' });
  const internals = runtime as unknown as {
    maintenanceWorker: { close(): Promise<void> };
    maintenanceWorkerConnection: { quit(): Promise<void>; disconnect(): void };
    sweepInFlight: Promise<void>;
    healthInFlight: Promise<void>;
    runRecoverySweep(trigger: string): Promise<unknown>;
  };
  internals.maintenanceWorker = {
    close: () => new Promise<void>((resolve) => {
      finishWorker = () => { events.push('acknowledged'); resolve(); };
    }),
  };
  internals.maintenanceWorkerConnection = {
    quit: async () => { events.push('worker-redis'); },
    disconnect: () => { throw new Error('unexpected forced disconnect'); },
  };
  internals.sweepInFlight = new Promise<void>((resolve) => { finishSweep = resolve; });
  internals.healthInFlight = new Promise<void>((resolve) => { finishHealth = resolve; });
  const shutdown = runtime.shutdown('test');
  assert.equal(runtime.shutdown('second-signal'), shutdown);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, [], 'drain warning deadline must not close active-job dependencies');
  assert.equal(await internals.runRecoverySweep('late-interval'), null);
  finishWorker();
  finishSweep();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['acknowledged'], 'in-flight health must also finish');
  finishHealth();
  await shutdown;
  assert.deepEqual(events, ['acknowledged', 'worker-redis', 'shared-redis', 'db']);
});

test('SIGTERM during an active job exits naturally after acknowledgement and resource cleanup', async () => {
  const { spawn } = await import('node:child_process');
  const script = `
    import { WorkerRuntime, runWorker } from ${JSON.stringify(new URL('./runtime.js', import.meta.url).href)};
    import { loadWorkerConfig } from ${JSON.stringify(new URL('./config.js', import.meta.url).href)};
    const noop = async () => {};
    const runtime = new WorkerRuntime(loadWorkerConfig({WORKER_SHUTDOWN_TIMEOUT_MS:'5'}),
      {info:noop, warn:noop, error:noop}, {
        loadApiDbModule:async()=>({closeConnection:async()=>console.log('DB_CLOSED')}),
        loadApiRedisModule:async()=>({closeRedisConnection:noop}),
        loadIngestQueueModule:async()=>({closeIngestQueues:noop}),
        loadCandidateHandoffQueueModule:async()=>({closeCandidateHandoffQueues:noop}),
        loadOfficialValuationQueueModule:async()=>({closeOfficialValuationQueues:noop}),
      });
    runtime.start = async () => {
      const heartbeat = setInterval(noop, 1000);
      const activeJob = new Promise(resolve => setTimeout(() => {
        console.log('ACKNOWLEDGED'); resolve();
      }, 80));
      runtime.maintenanceWorker = {close:async()=>{await activeJob; clearInterval(heartbeat);}};
      runtime.maintenanceWorkerConnection = {
        quit:async()=>console.log('REDIS_CLOSED'), disconnect:()=>{throw Error('forced disconnect');}
      };
      console.log('READY');
    };
    await runWorker(runtime);
    console.log('STOPPED');
  `;
  const child = spawn(process.execPath, [...process.execArgv, '--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let signalled = false;
  child.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
    if (!signalled && stdout.includes('READY')) {
      signalled = true;
      child.kill('SIGTERM');
    }
  });
  child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null }, `${stdout}\n${stderr}`);
    assert.equal(stderr, '');
    assert.deepEqual(stdout.trim().split('\n'), [
      'READY', 'ACKNOWLEDGED', 'REDIS_CLOSED', 'DB_CLOSED', 'STOPPED',
    ]);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

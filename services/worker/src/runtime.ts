import { Queue, Worker, type Job } from 'bullmq';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import {
  loadCandidateHandoffJobsModule,
  loadCandidateHandoffProcessorModule,
  loadCandidateHandoffQueueModule,
  loadCandidateHandoffStoreModule,
  loadApiDbModule,
  loadApiRedisModule,
  loadIngestJobsModule,
  loadIngestProcessorModule,
  loadIngestQueueModule,
  loadIngestStoreModule,
  loadIngestOperationalRetentionModule,
  loadListingsViewModule,
  loadListingLifecycleModule,
  loadListingTileUpdatesModule,
  loadPriceEvidenceRepairModule,
  loadOfficialValuationJobsModule,
  loadOfficialValuationProcessorModule,
  loadOfficialValuationQueueModule,
  loadOfficialValuationStoreModule,
  loadPropertyTilePyramidModule,
  type RedisConnectionLike,
} from './api-runtime.js';
import { createWorkerLogger, serializeError, type WorkerLogger } from './logger.js';

type TimerHandle = ReturnType<typeof setInterval>;
type OfficialValuationHydrationJobData = {
  jobId: string;
  propertyId: string;
  source: 'woz';
  valuationYear: number;
};

interface RecoverySweepSummary {
  trigger: string;
  staleProcessingBatchIds: string[];
  recoverableBatchIds: string[];
  dispatchedBatchIds: string[];
  failedDispatchBatchIds: string[];
  maintenanceRequested: boolean;
  candidateHandoffIds: string[];
  candidateHandoffDispatchedIds: string[];
  candidateHandoffFailedDispatchIds: string[];
  officialValuationHydrationJobIds: string[];
  propertyTilePyramidBuildRequested: boolean;
  propertyTilePyramidBuildStatus: string | null;
  propertyTilePyramidBuildReason: string | null;
  propertyTilePyramidRetentionStatus: string | null;
}

export type WorkerRuntimeModuleLoaders = {
  loadApiDbModule: typeof loadApiDbModule;
  loadApiRedisModule: typeof loadApiRedisModule;
  loadCandidateHandoffJobsModule: typeof loadCandidateHandoffJobsModule;
  loadCandidateHandoffProcessorModule: typeof loadCandidateHandoffProcessorModule;
  loadCandidateHandoffQueueModule: typeof loadCandidateHandoffQueueModule;
  loadCandidateHandoffStoreModule: typeof loadCandidateHandoffStoreModule;
  loadIngestJobsModule: typeof loadIngestJobsModule;
  loadIngestProcessorModule: typeof loadIngestProcessorModule;
  loadIngestQueueModule: typeof loadIngestQueueModule;
  loadIngestStoreModule: typeof loadIngestStoreModule;
  loadIngestOperationalRetentionModule: typeof loadIngestOperationalRetentionModule;
  loadListingsViewModule: typeof loadListingsViewModule;
  loadListingLifecycleModule: typeof loadListingLifecycleModule;
  loadListingTileUpdatesModule: typeof loadListingTileUpdatesModule;
  loadPriceEvidenceRepairModule: typeof loadPriceEvidenceRepairModule;
  loadOfficialValuationJobsModule: typeof loadOfficialValuationJobsModule;
  loadOfficialValuationProcessorModule: typeof loadOfficialValuationProcessorModule;
  loadOfficialValuationQueueModule: typeof loadOfficialValuationQueueModule;
  loadOfficialValuationStoreModule: typeof loadOfficialValuationStoreModule;
  loadPropertyTilePyramidModule: typeof loadPropertyTilePyramidModule;
};

const DEFAULT_MODULE_LOADERS: WorkerRuntimeModuleLoaders = {
  loadApiDbModule,
  loadApiRedisModule,
  loadCandidateHandoffJobsModule,
  loadCandidateHandoffProcessorModule,
  loadCandidateHandoffQueueModule,
  loadCandidateHandoffStoreModule,
  loadIngestJobsModule,
  loadIngestProcessorModule,
  loadIngestQueueModule,
  loadIngestStoreModule,
  loadIngestOperationalRetentionModule,
  loadListingsViewModule,
  loadListingLifecycleModule,
  loadListingTileUpdatesModule,
  loadPriceEvidenceRepairModule,
  loadOfficialValuationJobsModule,
  loadOfficialValuationProcessorModule,
  loadOfficialValuationQueueModule,
  loadOfficialValuationStoreModule,
  loadPropertyTilePyramidModule,
};

function toIngestLogger(logger: WorkerLogger) {
  return {
    info(payload: Record<string, unknown>, message: string) {
      logger.info(message, payload);
    },
    warn(payload: Record<string, unknown>, message: string) {
      logger.warn(message, payload);
    },
    error(payload: Record<string, unknown>, message: string) {
      logger.error(message, payload);
    },
  };
}

function createTimeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function withTimeout<T>(
  label: string,
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function collectShutdownFailures(
  closers: Array<() => Promise<unknown> | null>,
): Promise<unknown[]> {
  const results = await Promise.allSettled(closers.map((close) => Promise.resolve().then(close)));
  return results.flatMap((result) => {
    if (result.status !== 'rejected') return [];
    return result.reason instanceof AggregateError ? result.reason.errors : [result.reason];
  });
}

function throwShutdownFailures(message: string, errors: unknown[]): void {
  if (errors.length > 0) throw new AggregateError(errors, message);
}

export class WorkerRuntime {
  private readonly config: WorkerConfig;
  private readonly logger: WorkerLogger;
  private readonly startedAt = Date.now();
  private lastPropertyTilePyramidRetentionUtcDay: string | null = null;

  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private startupPromise: Promise<void> | null = null;
  private healthInFlight: Promise<void> | null = null;
  private sweepInFlight: Promise<RecoverySweepSummary> | null = null;

  private ingestWorker: Worker<{ batchId: string }> | null = null;
  private maintenanceWorker: Worker<{ requestedBy: string; batchId?: string }> | null = null;
  private candidateHandoffWorker: Worker<{ handoffId: string }> | null = null;
  private officialValuationWorker: Worker<OfficialValuationHydrationJobData> | null = null;
  private propertyTilePyramidWorker: Worker<{ versionId?: string; reason: string }> | null = null;
  private ingestQueue: Queue<{ batchId: string }> | null = null;
  private maintenanceQueue: Queue<{ requestedBy: string; batchId?: string }> | null = null;
  private candidateHandoffQueue: Queue<{ handoffId: string }> | null = null;
  private officialValuationQueue: Queue<OfficialValuationHydrationJobData> | null = null;
  private propertyTilePyramidQueue: Queue<{ versionId?: string; reason: string }> | null = null;

  private ingestWorkerConnection: RedisConnectionLike | null = null;
  private maintenanceWorkerConnection: RedisConnectionLike | null = null;
  private candidateHandoffWorkerConnection: RedisConnectionLike | null = null;
  private officialValuationWorkerConnection: RedisConnectionLike | null = null;
  private propertyTilePyramidWorkerConnection: RedisConnectionLike | null = null;
  private ingestQueueConnection: RedisConnectionLike | null = null;
  private maintenanceQueueConnection: RedisConnectionLike | null = null;
  private candidateHandoffQueueConnection: RedisConnectionLike | null = null;
  private officialValuationQueueConnection: RedisConnectionLike | null = null;
  private propertyTilePyramidQueueConnection: RedisConnectionLike | null = null;

  private recoveryInterval: TimerHandle | null = null;
  private healthInterval: TimerHandle | null = null;

  constructor(
    config: WorkerConfig = loadWorkerConfig(),
    logger: WorkerLogger = createWorkerLogger(),
    private readonly moduleLoaders: WorkerRuntimeModuleLoaders = DEFAULT_MODULE_LOADERS,
  ) {
    this.config = config;
    this.logger = logger;
  }

  start(): Promise<void> {
    this.startupPromise ??= this.startRuntime();
    return this.startupPromise;
  }

  private async startRuntime(): Promise<void> {
    const [jobs, candidateHandoffJobs, officialValuationJobs, apiRedis] = await Promise.all([
      this.moduleLoaders.loadIngestJobsModule(),
      this.moduleLoaders.loadCandidateHandoffJobsModule(),
      this.moduleLoaders.loadOfficialValuationJobsModule(),
      this.moduleLoaders.loadApiRedisModule(),
    ]);

    [
      this.ingestWorkerConnection,
      this.maintenanceWorkerConnection,
      this.candidateHandoffWorkerConnection,
      this.officialValuationWorkerConnection,
      this.propertyTilePyramidWorkerConnection,
      this.ingestQueueConnection,
      this.maintenanceQueueConnection,
      this.candidateHandoffQueueConnection,
      this.officialValuationQueueConnection,
      this.propertyTilePyramidQueueConnection,
    ] = await Promise.all([
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
      apiRedis.createRedisConnection(),
    ]);

    this.ingestWorker = new Worker(
      jobs.INGEST_BATCH_QUEUE,
      (job) => this.processIngestJob(job),
      {
        connection: this.ingestWorkerConnection as never,
        concurrency: this.config.ingestConcurrency,
      },
    );

    this.maintenanceWorker = new Worker(
      jobs.MAINTENANCE_QUEUE,
      (job) => this.processMaintenanceJob(job),
      {
        connection: this.maintenanceWorkerConnection as never,
        concurrency: this.config.maintenanceConcurrency,
      },
    );

    this.candidateHandoffWorker = new Worker(
      candidateHandoffJobs.CANDIDATE_HANDOFF_QUEUE,
      (job) => this.processCandidateHandoffJob(job),
      {
        connection: this.candidateHandoffWorkerConnection as never,
        concurrency: this.config.candidateHandoffConcurrency,
      },
    );

    this.officialValuationWorker = new Worker(
      officialValuationJobs.OFFICIAL_VALUATION_HYDRATION_QUEUE,
      (job) => this.processOfficialValuationHydrationJob(job),
      {
        connection: this.officialValuationWorkerConnection as never,
        concurrency: this.config.officialValuationHydrationConcurrency,
      },
    );

    this.propertyTilePyramidWorker = new Worker(
      jobs.PROPERTY_TILE_PYRAMID_QUEUE,
      (job) => this.processPropertyTilePyramidBuildJob(job, jobs.PROPERTY_TILE_PYRAMID_BUILD_JOB),
      {
        connection: this.propertyTilePyramidWorkerConnection as never,
        concurrency: this.config.propertyTilePyramidConcurrency,
      },
    );

    this.ingestQueue = new Queue(jobs.INGEST_BATCH_QUEUE, {
      connection: this.ingestQueueConnection as never,
    });
    this.maintenanceQueue = new Queue(jobs.MAINTENANCE_QUEUE, {
      connection: this.maintenanceQueueConnection as never,
    });
    this.candidateHandoffQueue = new Queue(candidateHandoffJobs.CANDIDATE_HANDOFF_QUEUE, {
      connection: this.candidateHandoffQueueConnection as never,
    });
    this.officialValuationQueue = new Queue(
      officialValuationJobs.OFFICIAL_VALUATION_HYDRATION_QUEUE,
      {
        connection: this.officialValuationQueueConnection as never,
      },
    );
    this.propertyTilePyramidQueue = new Queue(jobs.PROPERTY_TILE_PYRAMID_QUEUE, {
      connection: this.propertyTilePyramidQueueConnection as never,
    });

    this.attachWorkerLogging('ingest', this.ingestWorker);
    this.attachWorkerLogging('maintenance', this.maintenanceWorker);
    this.attachWorkerLogging('candidate-handoff', this.candidateHandoffWorker);
    this.attachWorkerLogging('official-valuation-hydration', this.officialValuationWorker);
    this.attachWorkerLogging('property-tile-pyramid', this.propertyTilePyramidWorker);

    await Promise.all([
      this.ingestWorker.waitUntilReady(),
      this.maintenanceWorker.waitUntilReady(),
      this.candidateHandoffWorker.waitUntilReady(),
      this.officialValuationWorker.waitUntilReady(),
      this.propertyTilePyramidWorker.waitUntilReady(),
      this.ingestQueue.waitUntilReady(),
      this.maintenanceQueue.waitUntilReady(),
      this.candidateHandoffQueue.waitUntilReady(),
      this.officialValuationQueue.waitUntilReady(),
      this.propertyTilePyramidQueue.waitUntilReady(),
    ]);

    this.logger.info('Worker runtime started', {
      ingestConcurrency: this.config.ingestConcurrency,
      maintenanceConcurrency: this.config.maintenanceConcurrency,
      candidateHandoffConcurrency: this.config.candidateHandoffConcurrency,
      officialValuationHydrationConcurrency: this.config.officialValuationHydrationConcurrency,
      propertyTilePyramidConcurrency: this.config.propertyTilePyramidConcurrency,
      skippedBatchRecoveryLimit: this.config.skippedBatchRecoveryLimit,
      recoverySweepIntervalMs: this.config.recoverySweepIntervalMs,
      staleProcessingAfterMs: this.config.staleProcessingAfterMs,
      healthLogIntervalMs: this.config.healthLogIntervalMs,
      propertyTilePyramidRetentionUtcMinuteOfDay:
        this.config.propertyTilePyramidRetentionUtcMinuteOfDay,
    });

    if (this.shuttingDown) return;
    await this.runRecoverySweep('startup');
    if (this.shuttingDown) return;
    await this.logHealthSnapshot('startup');
    if (this.shuttingDown) return;

    this.recoveryInterval = setInterval(() => {
      void this.runRecoverySweep('interval');
    }, this.config.recoverySweepIntervalMs);

    this.healthInterval = setInterval(() => {
      void this.logHealthSnapshot('interval');
    }, this.config.healthLogIntervalMs);
  }

  shutdown(reason: string): Promise<void> {
    this.shutdownPromise ??= this.performShutdown(reason);
    return this.shutdownPromise;
  }

  private async performShutdown(reason: string): Promise<void> {
    this.shuttingDown = true;
    this.logger.info('Worker shutdown started', { reason });

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    // Startup may still be acquiring connections when the signal arrives.
    await this.startupPromise?.catch(() => undefined);

    // Processors and recovery can still use PostgreSQL and enqueue follow-up jobs.
    // Keep their dependencies alive until all active work has drained.
    const failures = await collectShutdownFailures([
      () => this.sweepInFlight,
      () => this.healthInFlight,
      () => this.closeBullMqWorkers(),
    ]);
    failures.push(...await collectShutdownFailures([() => this.closeBullMqResources()]));
    failures.push(...await collectShutdownFailures([() => this.closeApiResources()]));
    for (const error of failures) {
      this.logger.error('Worker shutdown cleanup failed', { error: serializeError(error) });
    }
    throwShutdownFailures('Worker shutdown failed', failures);

    this.logger.info('Worker shutdown completed', {
      reason,
      uptimeMs: Date.now() - this.startedAt,
    });
  }

  private async processIngestJob(job: Job<{ batchId: string }>): Promise<Record<string, unknown>> {
    const processor = await this.moduleLoaders.loadIngestProcessorModule();

    this.logger.info('Processing ingest batch', {
      jobId: job.id,
      batchId: job.data.batchId,
      attempt: job.attemptsStarted,
    });

    const result = await processor.processIngestBatch({
      batchId: job.data.batchId,
      logger: toIngestLogger(this.logger),
    });

    return {
      status: result.status,
      ingested: result.ingested,
      updated: result.updated,
      skipped: result.skipped,
    };
  }

  private async processMaintenanceJob(
    job: Job<{ requestedBy: string; batchId?: string }>,
  ): Promise<Record<string, unknown>> {
    const [processor, listingsView] = await Promise.all([
      this.moduleLoaders.loadIngestProcessorModule(),
      this.moduleLoaders.loadListingsViewModule(),
    ]);

    this.logger.info('Refreshing listing maintenance views', {
      jobId: job.id,
      requestedBy: job.data.requestedBy,
      batchId: job.data.batchId ?? null,
    });

    const refreshedBatchCount = await processor.refreshLatestListingsMaintenance(
      [
        listingsView.refreshLatestListingsView,
        listingsView.refreshPriceGuessStartMarketSummaries,
      ],
      {
        logger: toIngestLogger(this.logger),
        skippedBatchRecoveryLimit: this.config.skippedBatchRecoveryLimit,
      },
    );

    return {
      refreshedBatchCount,
    };
  }

  private async processCandidateHandoffJob(
    job: Job<{ handoffId: string }>,
  ): Promise<Record<string, unknown>> {
    const processor = await this.moduleLoaders.loadCandidateHandoffProcessorModule();

    this.logger.info('Processing candidate handoff', {
      jobId: job.id,
      handoffId: job.data.handoffId,
      attempt: job.attemptsStarted,
    });

    return processor.processCandidateHandoffJob({
      handoffId: job.data.handoffId,
      logger: toIngestLogger(this.logger),
    });
  }

  private async processOfficialValuationHydrationJob(
    job: Job<OfficialValuationHydrationJobData>,
  ): Promise<Record<string, unknown>> {
    const processor = await this.moduleLoaders.loadOfficialValuationProcessorModule();

    this.logger.info('Processing official valuation hydration', {
      jobId: job.id,
      durableJobId: job.data.jobId,
      propertyId: job.data.propertyId,
      source: job.data.source,
      valuationYear: job.data.valuationYear,
    });

    return processor.processOfficialValuationHydrationJob({
      jobId: job.data.jobId,
      logger: toIngestLogger(this.logger),
    });
  }

  private async processPropertyTilePyramidBuildJob(
    job: Job<{ versionId?: string; reason: string }>,
    expectedJobName: string,
  ): Promise<Record<string, unknown>> {
    if (job.name !== expectedJobName) {
      throw new Error(`Unsupported property tile pyramid job: ${job.name}`);
    }

    const pyramid = await this.moduleLoaders.loadPropertyTilePyramidModule();
    this.logger.info('Building property tile pyramid', {
      jobId: job.id,
      versionId: job.data.versionId ?? null,
      reason: job.data.reason,
      attempt: job.attemptsStarted,
    });

    const result = await pyramid.executeDuePropertyTilePyramidBuild({
      reason: job.data.reason,
      leaseOwner: `worker:${process.pid}:${job.id ?? 'unknown'}`,
      versionId: job.data.versionId,
      logger: toIngestLogger(this.logger),
    });

    this.logger.info('Property tile pyramid build completed', {
      jobId: job.id,
      versionId: job.data.versionId ?? null,
      reason: job.data.reason,
      ...result,
    });

    return result;
  }

  private attachWorkerLogging(name: string, worker: Worker): void {
    worker.on('active', (job) => {
      this.logger.info('Job started', {
        queue: name,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('completed', (job, result) => {
      this.logger.info('Job completed', {
        queue: name,
        jobId: job.id,
        jobName: job.name,
        result: result as Record<string, unknown>,
      });
    });

    worker.on('failed', (job, error) => {
      this.logger.error('Job failed', {
        queue: name,
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        error: serializeError(error),
      });
    });

    worker.on('error', (error) => {
      this.logger.error('Worker emitted error', {
        queue: name,
        error: serializeError(error),
      });
    });
  }

  private async runRecoverySweep(trigger: string): Promise<RecoverySweepSummary | null> {
    if (this.shuttingDown) return null;
    if (this.sweepInFlight) {
      return this.sweepInFlight;
    }

    this.sweepInFlight = this.performRecoverySweep(trigger);

    try {
      return await this.sweepInFlight;
    } finally {
      this.sweepInFlight = null;
    }
  }

  private async performRecoverySweep(trigger: string): Promise<RecoverySweepSummary> {
    const [
      store,
      queue,
      candidateHandoffStore,
      candidateHandoffQueue,
      officialValuationStore,
      officialValuationQueue,
      propertyTilePyramid,
    ] =
      await Promise.all([
        this.moduleLoaders.loadIngestStoreModule(),
        this.moduleLoaders.loadIngestQueueModule(),
        this.moduleLoaders.loadCandidateHandoffStoreModule(),
        this.moduleLoaders.loadCandidateHandoffQueueModule(),
        this.moduleLoaders.loadOfficialValuationStoreModule(),
        this.moduleLoaders.loadOfficialValuationQueueModule(),
        this.moduleLoaders.loadPropertyTilePyramidModule(),
      ]);

    // These jobs have durable database demand and run even when no ingest arrives.
    // A failed pass is retried on the next sweep; it must not block ingestion.
    for (const [name, run] of [
      ['listing-availability', async () => (await this.moduleLoaders.loadListingLifecycleModule())
        .runListingLifecycleMaintenance()],
      ['price-evidence', async () => (await this.moduleLoaders.loadPriceEvidenceRepairModule())
        .runPriceEvidenceRepair()],
      ['listing-tiles', async () => (await this.moduleLoaders.loadListingTileUpdatesModule())
        .runListingTileUpdates()],
      ['ingest-operational-retention', async () => (await this.moduleLoaders.loadIngestOperationalRetentionModule())
        .runIngestOperationalRetention()],
    ] as const) {
      try {
        const result = await run();
        if ('failedTiles' in result && Number(result.failedTiles) > 0) {
          this.logger.error('Listing tile publication failed; durable demand remains pending', { trigger, name, ...result });
        } else {
          this.logger.info('Listing maintenance completed', { trigger, name, ...result });
        }
      } catch (error) {
        this.logger.error('Listing maintenance failed; durable demand remains pending', {
          trigger, name, error: serializeError(error),
        });
      }
    }

    const staleProcessingBefore = new Date(Date.now() - this.config.staleProcessingAfterMs);
    const dispatchWork = await store.collectRecoveryDispatchWork(
      staleProcessingBefore,
      this.config.recoveryBatchLimit,
    );

    const dispatchedBatchIds: string[] = [];
    const failedDispatchBatchIds: string[] = [];

    for (const batchId of dispatchWork.recoverableBatchIds) {
      try {
        await queue.enqueueIngestBatch(batchId);
        await store.markBatchQueued(batchId);
        dispatchedBatchIds.push(batchId);
      } catch (error) {
        failedDispatchBatchIds.push(batchId);
        this.logger.error('Recovery sweep failed to dispatch ingest batch', {
          trigger,
          batchId,
          error: serializeError(error),
        });
      }
    }

    let maintenanceRequested = false;
    if (dispatchWork.maintenancePending) {
      try {
        await queue.requestLatestListingsRefresh({
          requestedBy: 'worker-sweep',
        });
        maintenanceRequested = true;
      } catch (error) {
        this.logger.error('Recovery sweep failed to enqueue maintenance refresh', {
          trigger,
          error: serializeError(error),
        });
      }
    }

    const candidateHandoffIds: string[] = [];
    const candidateHandoffDispatchedIds: string[] = [];
    const candidateHandoffFailedDispatchIds: string[] = [];
    try {
      candidateHandoffIds.push(
        ...(await candidateHandoffStore.collectDueCandidateHandoffIds(this.config.recoveryBatchLimit)),
      );
      for (const handoffId of candidateHandoffIds) {
        try {
          await candidateHandoffQueue.enqueueCandidateHandoff(handoffId);
          candidateHandoffDispatchedIds.push(handoffId);
        } catch (error) {
          candidateHandoffFailedDispatchIds.push(handoffId);
          this.logger.error('Recovery sweep failed to dispatch candidate handoff', {
            trigger,
            handoffId,
            error: serializeError(error),
          });
        }
      }
    } catch (error) {
      this.logger.error('Recovery sweep failed to collect due candidate handoffs', {
        trigger,
        error: serializeError(error),
      });
    }

    const officialValuationHydrationJobIds: string[] = [];
    try {
      const dueHydrationJobs = await officialValuationStore.collectDueOfficialValuationHydrationJobs(
        this.config.recoveryBatchLimit,
      );
      for (const hydrationJob of dueHydrationJobs) {
        await officialValuationQueue.enqueueOfficialValuationHydration({
          jobId: hydrationJob.id,
          propertyId: hydrationJob.propertyId,
          source: hydrationJob.source,
          valuationYear: hydrationJob.valuationYear,
        });
        await officialValuationStore.markOfficialValuationHydrationJobQueued(hydrationJob.id);
        officialValuationHydrationJobIds.push(hydrationJob.id);
      }
    } catch (error) {
      this.logger.error('Recovery sweep failed to enqueue official valuation hydration jobs', {
        trigger,
        error: serializeError(error),
      });
    }

    let propertyTilePyramidBuildRequested = false;
    let propertyTilePyramidBuildStatus: string | null = null;
    let propertyTilePyramidBuildReason: string | null = null;
    let propertyTilePyramidRetentionStatus: string | null = null;
    try {
      const buildRequest = await propertyTilePyramid.requestPropertyTilePyramidBuild({
        reason: 'worker-recovery',
      });
      propertyTilePyramidBuildRequested = buildRequest.status !== 'unavailable';
      propertyTilePyramidBuildStatus = buildRequest.status;
      propertyTilePyramidBuildReason = buildRequest.reason ?? null;
      this.logger.info('Property tile pyramid recovery build request recorded', {
        trigger,
        ...buildRequest,
      });
    } catch (error) {
      this.logger.error('Recovery sweep failed to request property tile pyramid build', {
        trigger,
        error: serializeError(error),
      });
    }
    if (this.shouldRunPropertyTilePyramidRetention(new Date())) {
      try {
        const retention = await propertyTilePyramid.runPropertyTilePyramidRetention();
        propertyTilePyramidRetentionStatus = typeof retention.status === 'string'
          ? retention.status
          : 'completed';
        if (
          retention.hasMore !== true &&
          (
            propertyTilePyramidRetentionStatus === 'completed' ||
            retention.reason === 'pyramid-schema-unavailable'
          )
        ) {
          this.markPropertyTilePyramidRetentionAttempt(new Date());
        }
        this.logger.info('Property tile pyramid retention completed', {
          trigger,
          ...retention,
        });
      } catch (error) {
        this.logger.error('Recovery sweep failed to run property tile pyramid retention', {
          trigger,
          error: serializeError(error),
        });
      }
    }

    const summary: RecoverySweepSummary = {
      trigger,
      staleProcessingBatchIds: dispatchWork.staleProcessingBatchIds,
      recoverableBatchIds: dispatchWork.recoverableBatchIds,
      dispatchedBatchIds,
      failedDispatchBatchIds,
      maintenanceRequested,
      candidateHandoffIds,
      candidateHandoffDispatchedIds,
      candidateHandoffFailedDispatchIds,
      officialValuationHydrationJobIds,
      propertyTilePyramidBuildRequested,
      propertyTilePyramidBuildStatus,
      propertyTilePyramidBuildReason,
      propertyTilePyramidRetentionStatus,
    };

    this.logger.info('Recovery sweep completed', {
      trigger,
      staleRequeuedCount: summary.staleProcessingBatchIds.length,
      recoverableCount: summary.recoverableBatchIds.length,
      dispatchedCount: summary.dispatchedBatchIds.length,
      failedDispatchCount: summary.failedDispatchBatchIds.length,
      maintenanceRequested,
      candidateHandoffDueCount: candidateHandoffIds.length,
      candidateHandoffDispatchedCount: candidateHandoffDispatchedIds.length,
      candidateHandoffFailedDispatchCount: candidateHandoffFailedDispatchIds.length,
      officialValuationHydrationDispatchedCount: officialValuationHydrationJobIds.length,
      propertyTilePyramidBuildRequested,
      propertyTilePyramidBuildStatus,
      propertyTilePyramidBuildReason,
      propertyTilePyramidRetentionStatus,
    });

    return summary;
  }

  private shouldRunPropertyTilePyramidRetention(now: Date): boolean {
    const utcMinuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const utcDay = now.toISOString().slice(0, 10);
    return (
      utcMinuteOfDay >= this.config.propertyTilePyramidRetentionUtcMinuteOfDay &&
      this.lastPropertyTilePyramidRetentionUtcDay !== utcDay
    );
  }

  private markPropertyTilePyramidRetentionAttempt(now: Date): void {
    this.lastPropertyTilePyramidRetentionUtcDay = now.toISOString().slice(0, 10);
  }

  private async logHealthSnapshot(trigger: string): Promise<void> {
    if (this.shuttingDown) return;
    if (this.healthInFlight) return this.healthInFlight;
    this.healthInFlight = this.performHealthSnapshot(trigger);
    try {
      await this.healthInFlight;
    } finally {
      this.healthInFlight = null;
    }
  }

  private async performHealthSnapshot(trigger: string): Promise<void> {
    if (
      !this.ingestQueue ||
      !this.maintenanceQueue ||
      !this.candidateHandoffQueue ||
      !this.officialValuationQueue ||
      !this.propertyTilePyramidQueue
    ) {
      return;
    }

    try {
      const [
        ingestCounts,
        maintenanceCounts,
        candidateHandoffCounts,
        officialValuationCounts,
        propertyTilePyramidCounts,
      ] = await Promise.all([
        this.ingestQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        this.maintenanceQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        this.candidateHandoffQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        this.officialValuationQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        ),
        this.propertyTilePyramidQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        ),
      ]);

      const memoryUsage = process.memoryUsage();
      this.logger.info('Worker health snapshot', {
        trigger,
        uptimeMs: Date.now() - this.startedAt,
        memoryRssBytes: memoryUsage.rss,
        memoryHeapUsedBytes: memoryUsage.heapUsed,
        ingestQueue: ingestCounts,
        maintenanceQueue: maintenanceCounts,
        candidateHandoffQueue: candidateHandoffCounts,
        officialValuationHydrationQueue: officialValuationCounts,
        propertyTilePyramidQueue: propertyTilePyramidCounts,
      });
    } catch (error) {
      this.logger.warn('Worker health snapshot failed', {
        trigger,
        error: serializeError(error),
      });
    }
  }

  private async closeBullMqWorkers(): Promise<void> {
    const failures = await collectShutdownFailures(([
      ['ingestWorker', 'ingest'],
      ['maintenanceWorker', 'maintenance'],
      ['candidateHandoffWorker', 'candidate handoff'],
      ['officialValuationWorker', 'official valuation hydration'],
      ['propertyTilePyramidWorker', 'property tile pyramid'],
    ] as const).map(([workerKey, label]) => async () => {
      const worker = this[workerKey];
      if (!worker) return;

      const closing = worker.close();
      const warning = setTimeout(() => {
        this.logger.warn('Worker drain is still waiting for active jobs', {
          queue: label,
          elapsedMs: this.config.shutdownTimeoutMs,
        });
      }, this.config.shutdownTimeoutMs);
      try {
        // A timeout must not disconnect Redis underneath BullMQ's completion
        // acknowledgement: that leaves its close promise retrying indefinitely.
        await closing;
        this[workerKey] = null;
      } finally {
        clearTimeout(warning);
      }
    }));
    throwShutdownFailures('BullMQ worker drain failed', failures);
  }

  private async closeBullMqResources(): Promise<void> {
    const failures = await collectShutdownFailures(([
      ['ingestQueue', 'ingest'],
      ['maintenanceQueue', 'maintenance'],
      ['candidateHandoffQueue', 'candidate handoff'],
      ['officialValuationQueue', 'official valuation hydration'],
      ['propertyTilePyramidQueue', 'property tile pyramid'],
    ] as const).map(([key, label]) => async () => {
      const queue = this[key];
      this[key] = null;
      if (queue) {
        await withTimeout(`${label} queue close`, queue.close(), this.config.shutdownTimeoutMs);
      }
    }));
    failures.push(...await collectShutdownFailures(([
      'ingestWorkerConnection',
      'maintenanceWorkerConnection',
      'candidateHandoffWorkerConnection',
      'officialValuationWorkerConnection',
      'propertyTilePyramidWorkerConnection',
      'ingestQueueConnection',
      'maintenanceQueueConnection',
      'candidateHandoffQueueConnection',
      'officialValuationQueueConnection',
      'propertyTilePyramidQueueConnection',
    ] as const).map((key) => () => this.quitRedisConnection(key))));
    throwShutdownFailures('BullMQ resource cleanup failed', failures);
  }

  private async closeApiResources(): Promise<void> {
    const failures = await collectShutdownFailures([
      async () => (await this.moduleLoaders.loadIngestQueueModule()).closeIngestQueues(),
      async () => (await this.moduleLoaders.loadCandidateHandoffQueueModule()).closeCandidateHandoffQueues(),
      async () => (await this.moduleLoaders.loadOfficialValuationQueueModule()).closeOfficialValuationQueues(),
    ]);
    failures.push(...await collectShutdownFailures([
      async () => (await this.moduleLoaders.loadApiRedisModule()).closeRedisConnection(),
      async () => (await this.moduleLoaders.loadApiDbModule()).closeConnection(),
    ]));
    throwShutdownFailures('API resource cleanup failed', failures);
  }

  private async quitRedisConnection(
    key:
      | 'ingestWorkerConnection'
      | 'maintenanceWorkerConnection'
      | 'candidateHandoffWorkerConnection'
      | 'officialValuationWorkerConnection'
      | 'propertyTilePyramidWorkerConnection'
      | 'ingestQueueConnection'
      | 'maintenanceQueueConnection'
      | 'candidateHandoffQueueConnection'
      | 'officialValuationQueueConnection'
      | 'propertyTilePyramidQueueConnection',
  ): Promise<void> {
    const connection = this[key];
    this[key] = null;

    if (!connection) {
      return;
    }

    try {
      await connection.quit();
    } catch (error) {
      connection.disconnect();
      throw error;
    }
  }
}

export async function runWorker(
  runtime: Pick<WorkerRuntime, 'start' | 'shutdown'> = new WorkerRuntime(),
): Promise<void> {
  const logger = createWorkerLogger();
  const shutdownController = new AbortController();
  const shutdownSignal = shutdownController.signal;
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async (reason: string, exitCode = 0) => {
    const currentExitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exitCode = Math.max(currentExitCode, exitCode);

    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        try {
          await runtime.shutdown(reason);
        } catch (error) {
          process.exitCode = 1;
          logger.error('Worker shutdown failed', { reason, error: serializeError(error) });
        } finally {
          shutdownController.abort();
        }
      })();
    }

    return shutdownPromise;
  };

  const onSigint = () => {
    void shutdown('sigint');
  };

  const onSigterm = () => {
    void shutdown('sigterm');
  };

  const onUnhandledRejection = (error: unknown) => {
    logger.error('Unhandled promise rejection', {
      error: serializeError(error),
    });
    void shutdown('unhandledRejection', 1);
  };

  const onUncaughtException = (error: unknown) => {
    logger.error('Uncaught exception', {
      error: serializeError(error),
    });
    void shutdown('uncaughtException', 1);
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  try {
    await runtime.start();
    await new Promise<void>((resolve) => {
      if (shutdownSignal.aborted) {
        resolve();
        return;
      }

      shutdownSignal.addEventListener('abort', () => resolve(), { once: true });
    });
  } catch (error) {
    logger.error('Worker runtime failed to start', {
      error: serializeError(error),
    });
    await shutdown('startupFailure', 1);
    throw error;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('unhandledRejection', onUnhandledRejection);
    process.off('uncaughtException', onUncaughtException);
  }
}

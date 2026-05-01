import { Queue, Worker, type Job } from 'bullmq';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import {
  loadApiDbModule,
  loadApiRedisModule,
  loadIngestJobsModule,
  loadIngestProcessorModule,
  loadIngestQueueModule,
  loadIngestStoreModule,
  loadListingReconciliationModule,
  loadListingsViewModule,
  loadOfficialValuationJobsModule,
  loadOfficialValuationProcessorModule,
  loadOfficialValuationQueueModule,
  loadOfficialValuationStoreModule,
  loadPropertyTileSnapshotsModule,
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
  listingWatchClaimedCount: number;
  listingWatchTerminalCount: number;
  listingWatchRetryableCount: number;
  listingWatchMaintenanceBatchIds: string[];
  officialValuationHydrationJobIds: string[];
  propertyTileSnapshotRefreshRequested: boolean;
  propertyTileSnapshotRefreshReason: string | null;
}

export type WorkerRuntimeModuleLoaders = {
  loadApiDbModule: typeof loadApiDbModule;
  loadApiRedisModule: typeof loadApiRedisModule;
  loadIngestJobsModule: typeof loadIngestJobsModule;
  loadIngestProcessorModule: typeof loadIngestProcessorModule;
  loadIngestQueueModule: typeof loadIngestQueueModule;
  loadIngestStoreModule: typeof loadIngestStoreModule;
  loadListingReconciliationModule: typeof loadListingReconciliationModule;
  loadListingsViewModule: typeof loadListingsViewModule;
  loadOfficialValuationJobsModule: typeof loadOfficialValuationJobsModule;
  loadOfficialValuationProcessorModule: typeof loadOfficialValuationProcessorModule;
  loadOfficialValuationQueueModule: typeof loadOfficialValuationQueueModule;
  loadOfficialValuationStoreModule: typeof loadOfficialValuationStoreModule;
  loadPropertyTileSnapshotsModule: typeof loadPropertyTileSnapshotsModule;
};

const DEFAULT_MODULE_LOADERS: WorkerRuntimeModuleLoaders = {
  loadApiDbModule,
  loadApiRedisModule,
  loadIngestJobsModule,
  loadIngestProcessorModule,
  loadIngestQueueModule,
  loadIngestStoreModule,
  loadListingReconciliationModule,
  loadListingsViewModule,
  loadOfficialValuationJobsModule,
  loadOfficialValuationProcessorModule,
  loadOfficialValuationQueueModule,
  loadOfficialValuationStoreModule,
  loadPropertyTileSnapshotsModule,
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

function createListingWatchRetryDelay(config: WorkerConfig): (attemptCount: number) => number {
  return (attemptCount: number) => {
    const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
    return Math.min(
      config.listingWatchRetryBaseDelayMs * 2 ** exponent,
      config.listingWatchRetryMaxDelayMs,
    );
  };
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

export class WorkerRuntime {
  private readonly config: WorkerConfig;
  private readonly logger: WorkerLogger;
  private readonly startedAt = Date.now();

  private shuttingDown = false;
  private sweepInFlight: Promise<RecoverySweepSummary> | null = null;

  private ingestWorker: Worker<{ batchId: string }> | null = null;
  private maintenanceWorker: Worker<{ requestedBy: string; batchId?: string }> | null = null;
  private officialValuationWorker: Worker<OfficialValuationHydrationJobData> | null = null;
  private propertyTileSnapshotWorker: Worker<{ reason: string }> | null = null;
  private ingestQueue: Queue<{ batchId: string }> | null = null;
  private maintenanceQueue: Queue<{ requestedBy: string; batchId?: string }> | null = null;
  private officialValuationQueue: Queue<OfficialValuationHydrationJobData> | null = null;
  private propertyTileSnapshotQueue: Queue<{ reason: string }> | null = null;

  private ingestWorkerConnection: RedisConnectionLike | null = null;
  private maintenanceWorkerConnection: RedisConnectionLike | null = null;
  private officialValuationWorkerConnection: RedisConnectionLike | null = null;
  private propertyTileSnapshotWorkerConnection: RedisConnectionLike | null = null;
  private ingestQueueConnection: RedisConnectionLike | null = null;
  private maintenanceQueueConnection: RedisConnectionLike | null = null;
  private officialValuationQueueConnection: RedisConnectionLike | null = null;
  private propertyTileSnapshotQueueConnection: RedisConnectionLike | null = null;

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

  async start(): Promise<void> {
    const [jobs, officialValuationJobs, apiRedis] = await Promise.all([
      this.moduleLoaders.loadIngestJobsModule(),
      this.moduleLoaders.loadOfficialValuationJobsModule(),
      this.moduleLoaders.loadApiRedisModule(),
    ]);

    [
      this.ingestWorkerConnection,
      this.maintenanceWorkerConnection,
      this.officialValuationWorkerConnection,
      this.propertyTileSnapshotWorkerConnection,
      this.ingestQueueConnection,
      this.maintenanceQueueConnection,
      this.officialValuationQueueConnection,
      this.propertyTileSnapshotQueueConnection,
    ] = await Promise.all([
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

    this.officialValuationWorker = new Worker(
      officialValuationJobs.OFFICIAL_VALUATION_HYDRATION_QUEUE,
      (job) => this.processOfficialValuationHydrationJob(job),
      {
        connection: this.officialValuationWorkerConnection as never,
        concurrency: this.config.officialValuationHydrationConcurrency,
      },
    );

    this.propertyTileSnapshotWorker = new Worker(
      jobs.PROPERTY_TILE_SNAPSHOT_QUEUE,
      (job) => this.processPropertyTileSnapshotRefreshJob(job, jobs.PROPERTY_TILE_SNAPSHOT_REFRESH_JOB),
      {
        connection: this.propertyTileSnapshotWorkerConnection as never,
        concurrency: this.config.propertyTileSnapshotConcurrency,
      },
    );

    this.ingestQueue = new Queue(jobs.INGEST_BATCH_QUEUE, {
      connection: this.ingestQueueConnection as never,
    });
    this.maintenanceQueue = new Queue(jobs.MAINTENANCE_QUEUE, {
      connection: this.maintenanceQueueConnection as never,
    });
    this.officialValuationQueue = new Queue(
      officialValuationJobs.OFFICIAL_VALUATION_HYDRATION_QUEUE,
      {
        connection: this.officialValuationQueueConnection as never,
      },
    );
    this.propertyTileSnapshotQueue = new Queue(jobs.PROPERTY_TILE_SNAPSHOT_QUEUE, {
      connection: this.propertyTileSnapshotQueueConnection as never,
    });

    this.attachWorkerLogging('ingest', this.ingestWorker);
    this.attachWorkerLogging('maintenance', this.maintenanceWorker);
    this.attachWorkerLogging('official-valuation-hydration', this.officialValuationWorker);
    this.attachWorkerLogging('property-tile-snapshot', this.propertyTileSnapshotWorker);

    await Promise.all([
      this.ingestWorker.waitUntilReady(),
      this.maintenanceWorker.waitUntilReady(),
      this.officialValuationWorker.waitUntilReady(),
      this.propertyTileSnapshotWorker.waitUntilReady(),
      this.ingestQueue.waitUntilReady(),
      this.maintenanceQueue.waitUntilReady(),
      this.officialValuationQueue.waitUntilReady(),
      this.propertyTileSnapshotQueue.waitUntilReady(),
    ]);

    this.logger.info('Worker runtime started', {
      ingestConcurrency: this.config.ingestConcurrency,
      maintenanceConcurrency: this.config.maintenanceConcurrency,
      officialValuationHydrationConcurrency: this.config.officialValuationHydrationConcurrency,
      propertyTileSnapshotConcurrency: this.config.propertyTileSnapshotConcurrency,
      skippedBatchRecoveryLimit: this.config.skippedBatchRecoveryLimit,
      recoverySweepIntervalMs: this.config.recoverySweepIntervalMs,
      staleProcessingAfterMs: this.config.staleProcessingAfterMs,
      healthLogIntervalMs: this.config.healthLogIntervalMs,
      listingWatchSweepLimit: this.config.listingWatchSweepLimit,
      listingWatchRetryBaseDelayMs: this.config.listingWatchRetryBaseDelayMs,
      listingWatchRetryMaxDelayMs: this.config.listingWatchRetryMaxDelayMs,
    });

    await this.runRecoverySweep('startup');
    await this.logHealthSnapshot('startup');

    this.recoveryInterval = setInterval(() => {
      void this.runRecoverySweep('interval');
    }, this.config.recoverySweepIntervalMs);

    this.healthInterval = setInterval(() => {
      void this.logHealthSnapshot('interval');
    }, this.config.healthLogIntervalMs);
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

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

    await Promise.allSettled([
      this.sweepInFlight,
      this.closeBullMqResources(),
      this.closeApiResources(),
    ]);

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

  private async processPropertyTileSnapshotRefreshJob(
    job: Job<{ reason: string }>,
    expectedJobName: string,
  ): Promise<Record<string, unknown>> {
    if (job.name !== expectedJobName) {
      throw new Error(`Unsupported property tile snapshot job: ${job.name}`);
    }

    const snapshots = await this.moduleLoaders.loadPropertyTileSnapshotsModule();
    this.logger.info('Refreshing property tile snapshots', {
      jobId: job.id,
      reason: job.data.reason,
      attempt: job.attemptsStarted,
    });

    const result = await snapshots.executePropertyTileSnapshotRefresh({
      reason: job.data.reason,
      leaseOwner: `worker:${process.pid}:${job.id ?? 'unknown'}`,
    });

    this.logger.info('Property tile snapshot refresh completed', {
      jobId: job.id,
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

  private async runRecoverySweep(trigger: string): Promise<RecoverySweepSummary> {
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
      reconciliation,
      officialValuationStore,
      officialValuationQueue,
      propertyTileSnapshots,
    ] =
      await Promise.all([
        this.moduleLoaders.loadIngestStoreModule(),
        this.moduleLoaders.loadIngestQueueModule(),
        this.moduleLoaders.loadListingReconciliationModule(),
        this.moduleLoaders.loadOfficialValuationStoreModule(),
        this.moduleLoaders.loadOfficialValuationQueueModule(),
        this.moduleLoaders.loadPropertyTileSnapshotsModule(),
      ]);

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

    let listingWatchClaimedCount = 0;
    let listingWatchTerminalCount = 0;
    let listingWatchRetryableCount = 0;
    const listingWatchMaintenanceBatchIds: string[] = [];

    try {
      const listingWatchSummary = await reconciliation.processDueListingValidationWatches({
        limit: this.config.listingWatchSweepLimit,
        retryDelayMs: createListingWatchRetryDelay(this.config),
      });
      listingWatchClaimedCount = listingWatchSummary.claimedCount;
      listingWatchTerminalCount = listingWatchSummary.terminalCount;
      listingWatchRetryableCount = listingWatchSummary.retryableCount;

      for (const result of listingWatchSummary.results) {
        if (result.outcome !== 'terminal') {
          continue;
        }

        try {
          await queue.requestLatestListingsRefresh({
            requestedBy: 'validation-outcome',
            batchId: result.maintenanceBatchId,
          });
          listingWatchMaintenanceBatchIds.push(result.maintenanceBatchId);
        } catch (error) {
          this.logger.error('Recovery sweep failed to enqueue validation maintenance refresh', {
            trigger,
            watchId: result.watchId,
            state: result.state,
            maintenanceBatchId: result.maintenanceBatchId,
            error: serializeError(error),
          });
        }
        try {
          const snapshotRefreshRequest = await propertyTileSnapshots.requestPropertyTileSnapshotRefresh({
            reason: 'validation-outcome',
          });
          this.logger.info('Validation outcome property tile refresh request recorded', {
            trigger,
            watchId: result.watchId,
            state: result.state,
            maintenanceBatchId: result.maintenanceBatchId,
            ...snapshotRefreshRequest,
          });
        } catch (error) {
          this.logger.error('Recovery sweep failed to request validation property tile refresh', {
            trigger,
            watchId: result.watchId,
            state: result.state,
            maintenanceBatchId: result.maintenanceBatchId,
            error: serializeError(error),
          });
        }
      }
    } catch (error) {
      this.logger.error('Recovery sweep failed to process listing validation watches', {
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

    let propertyTileSnapshotRefreshRequested = false;
    let propertyTileSnapshotRefreshReason: string | null = null;
    try {
      const snapshotCheck = await propertyTileSnapshots.shouldRequestPropertyTileSnapshotRefresh();
      propertyTileSnapshotRefreshReason = snapshotCheck.reason;
      if (snapshotCheck.shouldEnqueue) {
        const snapshotRefreshRequest = await propertyTileSnapshots.requestPropertyTileSnapshotRefresh({
          reason: `worker-recovery:${snapshotCheck.reason}`,
        });
        propertyTileSnapshotRefreshRequested = snapshotRefreshRequest.enqueueStatus !== 'skipped';
        this.logger.info('Property tile snapshot recovery refresh request recorded', {
          trigger,
          reason: snapshotCheck.reason,
          ...snapshotRefreshRequest,
        });
      }
      this.logger.info('Property tile snapshot recovery check completed', {
        trigger,
        shouldEnqueue: snapshotCheck.shouldEnqueue,
        reason: snapshotCheck.reason,
      });
    } catch (error) {
      this.logger.error('Recovery sweep failed to check property tile snapshots', {
        trigger,
        error: serializeError(error),
      });
    }

    const summary: RecoverySweepSummary = {
      trigger,
      staleProcessingBatchIds: dispatchWork.staleProcessingBatchIds,
      recoverableBatchIds: dispatchWork.recoverableBatchIds,
      dispatchedBatchIds,
      failedDispatchBatchIds,
      maintenanceRequested,
      listingWatchClaimedCount,
      listingWatchTerminalCount,
      listingWatchRetryableCount,
      listingWatchMaintenanceBatchIds,
      officialValuationHydrationJobIds,
      propertyTileSnapshotRefreshRequested,
      propertyTileSnapshotRefreshReason,
    };

    this.logger.info('Recovery sweep completed', {
      trigger,
      staleRequeuedCount: summary.staleProcessingBatchIds.length,
      recoverableCount: summary.recoverableBatchIds.length,
      dispatchedCount: summary.dispatchedBatchIds.length,
      failedDispatchCount: summary.failedDispatchBatchIds.length,
      maintenanceRequested,
      listingWatchClaimedCount,
      listingWatchTerminalCount,
      listingWatchRetryableCount,
      listingWatchMaintenanceRequestedCount: listingWatchMaintenanceBatchIds.length,
      officialValuationHydrationDispatchedCount: officialValuationHydrationJobIds.length,
      propertyTileSnapshotRefreshRequested,
      propertyTileSnapshotRefreshReason,
    });

    return summary;
  }

  private async logHealthSnapshot(trigger: string): Promise<void> {
    if (
      !this.ingestQueue ||
      !this.maintenanceQueue ||
      !this.officialValuationQueue ||
      !this.propertyTileSnapshotQueue
    ) {
      return;
    }

    try {
      const [
        ingestCounts,
        maintenanceCounts,
        officialValuationCounts,
        propertyTileSnapshotCounts,
      ] = await Promise.all([
        this.ingestQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        this.maintenanceQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        this.officialValuationQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        ),
        this.propertyTileSnapshotQueue.getJobCounts(
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
        officialValuationHydrationQueue: officialValuationCounts,
        propertyTileSnapshotQueue: propertyTileSnapshotCounts,
      });
    } catch (error) {
      this.logger.warn('Worker health snapshot failed', {
        trigger,
        error: serializeError(error),
      });
    }
  }

  private async closeBullMqResources(): Promise<void> {
    const closers: Array<Promise<void>> = [];

    if (this.ingestWorker) {
      const worker = this.ingestWorker;
      this.ingestWorker = null;
      closers.push(
        withTimeout(
          'ingest worker close',
          worker.close().catch(async () => {
            await worker.close(true);
          }),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    if (this.maintenanceWorker) {
      const worker = this.maintenanceWorker;
      this.maintenanceWorker = null;
      closers.push(
        withTimeout(
          'maintenance worker close',
          worker.close().catch(async () => {
            await worker.close(true);
          }),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    if (this.officialValuationWorker) {
      const worker = this.officialValuationWorker;
      this.officialValuationWorker = null;
      closers.push(
        withTimeout(
          'official valuation hydration worker close',
          worker.close().catch(async () => {
            await worker.close(true);
          }),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    if (this.propertyTileSnapshotWorker) {
      const worker = this.propertyTileSnapshotWorker;
      this.propertyTileSnapshotWorker = null;
      closers.push(
        withTimeout(
          'property tile snapshot worker close',
          worker.close().catch(async () => {
            await worker.close(true);
          }),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    if (this.ingestQueue) {
      const queue = this.ingestQueue;
      this.ingestQueue = null;
      closers.push(withTimeout('ingest queue close', queue.close(), this.config.shutdownTimeoutMs));
    }

    if (this.maintenanceQueue) {
      const queue = this.maintenanceQueue;
      this.maintenanceQueue = null;
      closers.push(withTimeout('maintenance queue close', queue.close(), this.config.shutdownTimeoutMs));
    }

    if (this.officialValuationQueue) {
      const queue = this.officialValuationQueue;
      this.officialValuationQueue = null;
      closers.push(
        withTimeout(
          'official valuation hydration queue close',
          queue.close(),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    if (this.propertyTileSnapshotQueue) {
      const queue = this.propertyTileSnapshotQueue;
      this.propertyTileSnapshotQueue = null;
      closers.push(
        withTimeout(
          'property tile snapshot queue close',
          queue.close(),
          this.config.shutdownTimeoutMs,
        ),
      );
    }

    await Promise.allSettled(closers);

    await Promise.allSettled([
      this.quitRedisConnection('ingestWorkerConnection'),
      this.quitRedisConnection('maintenanceWorkerConnection'),
      this.quitRedisConnection('officialValuationWorkerConnection'),
      this.quitRedisConnection('propertyTileSnapshotWorkerConnection'),
      this.quitRedisConnection('ingestQueueConnection'),
      this.quitRedisConnection('maintenanceQueueConnection'),
      this.quitRedisConnection('officialValuationQueueConnection'),
      this.quitRedisConnection('propertyTileSnapshotQueueConnection'),
    ]);
  }

  private async closeApiResources(): Promise<void> {
    const [apiDb, apiRedis, ingestQueue, officialValuationQueue] = await Promise.all([
      this.moduleLoaders.loadApiDbModule(),
      this.moduleLoaders.loadApiRedisModule(),
      this.moduleLoaders.loadIngestQueueModule(),
      this.moduleLoaders.loadOfficialValuationQueueModule(),
    ]);

    await Promise.allSettled([
      ingestQueue.closeIngestQueues(),
      officialValuationQueue.closeOfficialValuationQueues(),
      apiRedis.closeRedisConnection(),
      apiDb.closeConnection(),
    ]);
  }

  private async quitRedisConnection(
    key:
      | 'ingestWorkerConnection'
      | 'maintenanceWorkerConnection'
      | 'officialValuationWorkerConnection'
      | 'propertyTileSnapshotWorkerConnection'
      | 'ingestQueueConnection'
      | 'maintenanceQueueConnection'
      | 'officialValuationQueueConnection'
      | 'propertyTileSnapshotQueueConnection',
  ): Promise<void> {
    const connection = this[key];
    this[key] = null;

    if (!connection) {
      return;
    }

    await connection.quit().catch(() => {
      connection.disconnect();
    });
  }
}

export async function runWorker(): Promise<void> {
  const logger = createWorkerLogger();
  const runtime = new WorkerRuntime(loadWorkerConfig(), logger);
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

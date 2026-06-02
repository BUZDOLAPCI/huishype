import { randomUUID } from 'node:crypto';
import { getRedisConnection } from '../../lib/redis.js';
import {
  INGEST_BATCH_JOB,
  INGEST_BATCH_QUEUE,
  MAINTENANCE_QUEUE,
  PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_ID,
  PROPERTY_TILE_PYRAMID_BUILD_JOB,
  PROPERTY_TILE_PYRAMID_QUEUE,
  REFRESH_LATEST_LISTINGS_JOB,
  type IngestBatchJobData,
  type MaintenanceRefreshJobData,
  type PropertyTilePyramidBuildJobData,
  type PropertyTileSnapshotRefreshJobData,
} from './jobs.js';

type QueueLike<T> = {
  getJob(jobId: string): Promise<unknown>;
  add(name: string, data: T, options: { jobId: string }): Promise<unknown>;
  close(): Promise<unknown>;
};

type ExistingJobLike = {
  getState?: () => Promise<string>;
  retry?: (
    state?: 'failed' | 'completed',
    options?: { resetAttemptsMade?: boolean; resetAttemptsStarted?: boolean },
  ) => Promise<void>;
};

export type PropertyTileSnapshotRefreshEnqueueResult =
  | {
      status: 'enqueued';
      jobId: string;
    }
  | {
      status: 'retried';
      jobId: string;
      previousState: 'failed' | 'completed';
    }
  | {
      status: 'coalesced';
      jobId: string;
      existingState: string | null;
    }
  | {
      status: 'skipped';
      jobId: string;
      skippedReason: 'disabled';
    };

export type PropertyTilePyramidBuildEnqueueResult =
  | {
      status: 'enqueued';
      jobId: string;
    }
  | {
      status: 'retried';
      jobId: string;
      previousState: 'failed' | 'completed';
    }
  | {
      status: 'coalesced';
      jobId: string;
      existingState: string | null;
    };

let ingestBatchQueue: QueueLike<IngestBatchJobData> | null = null;
let maintenanceQueue: QueueLike<MaintenanceRefreshJobData> | null = null;
let propertyTilePyramidQueue: QueueLike<PropertyTilePyramidBuildJobData> | null = null;
let latestListingsRefreshOverrideForTests:
  | ((data: MaintenanceRefreshJobData) => Promise<void>)
  | null = null;

const WORKER_SWEEP_MAINTENANCE_REFRESH_JOB_ID = `${REFRESH_LATEST_LISTINGS_JOB}-worker-sweep`;

async function loadQueueConstructor<T>(): Promise<
  new (name: string, options: Record<string, unknown>) => QueueLike<T>
> {
  const bullmqModule = await import('bullmq');
  return (bullmqModule.Queue ??
    (bullmqModule.default as { Queue?: unknown } | undefined)?.Queue) as new (
      name: string,
      options: Record<string, unknown>,
    ) => QueueLike<T>;
}

async function getIngestBatchQueue(): Promise<QueueLike<IngestBatchJobData>> {
  if (ingestBatchQueue) {
    return ingestBatchQueue;
  }

  const Queue = await loadQueueConstructor<IngestBatchJobData>();
  ingestBatchQueue = new Queue(INGEST_BATCH_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 1_000,
      removeOnFail: false,
    },
  });

  return ingestBatchQueue;
}

async function getMaintenanceQueue(): Promise<QueueLike<MaintenanceRefreshJobData>> {
  if (maintenanceQueue) {
    return maintenanceQueue;
  }

  const Queue = await loadQueueConstructor<MaintenanceRefreshJobData>();
  maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: {
      attempts: 10,
      backoff: {
        type: 'exponential',
        delay: 10_000,
      },
      removeOnComplete: 10,
      removeOnFail: false,
    },
  });

  return maintenanceQueue;
}

async function getPropertyTilePyramidQueue(): Promise<QueueLike<PropertyTilePyramidBuildJobData>> {
  if (propertyTilePyramidQueue) {
    return propertyTilePyramidQueue;
  }

  const Queue = await loadQueueConstructor<PropertyTilePyramidBuildJobData>();
  propertyTilePyramidQueue = new Queue(PROPERTY_TILE_PYRAMID_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 10,
      removeOnFail: false,
    },
  });

  return propertyTilePyramidQueue;
}

export async function enqueueIngestBatch(batchId: string): Promise<void> {
  const queue = await getIngestBatchQueue();
  const existingJob = await queue.getJob(batchId) as ExistingJobLike | null;

  if (existingJob) {
    const state = await existingJob.getState?.();
    if (state === 'failed' || state === 'completed') {
      if (!existingJob.retry) {
        throw new Error(`Existing ingest job ${batchId} is ${state} but cannot be retried`);
      }

      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    }
    return;
  }

  await queue.add(
    INGEST_BATCH_JOB,
    { batchId },
    { jobId: batchId },
  );
}

export async function requestLatestListingsRefresh(data: MaintenanceRefreshJobData): Promise<void> {
  if (latestListingsRefreshOverrideForTests) {
    await latestListingsRefreshOverrideForTests(data);
    return;
  }

  const queue = await getMaintenanceQueue();

  if (data.requestedBy === 'worker-sweep' && !data.batchId) {
    const existingJob = await queue.getJob(WORKER_SWEEP_MAINTENANCE_REFRESH_JOB_ID) as ExistingJobLike | null;

    if (existingJob) {
      const state = await existingJob.getState?.();
      if (state === 'failed' || state === 'completed') {
        if (!existingJob.retry) {
          throw new Error(
            `Existing maintenance refresh job ${WORKER_SWEEP_MAINTENANCE_REFRESH_JOB_ID} is ${state} but cannot be retried`,
          );
        }

        await existingJob.retry(state, {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
      }
      return;
    }

    await queue.add(
      REFRESH_LATEST_LISTINGS_JOB,
      data,
      { jobId: WORKER_SWEEP_MAINTENANCE_REFRESH_JOB_ID },
    );
    return;
  }

  const dedupeId = data.batchId ?? randomUUID();
  await queue.add(
    REFRESH_LATEST_LISTINGS_JOB,
    data,
    { jobId: `${REFRESH_LATEST_LISTINGS_JOB}-${dedupeId}` },
  );
}

export function setLatestListingsRefreshOverrideForTests(
  override: ((data: MaintenanceRefreshJobData) => Promise<void>) | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Latest listings refresh override is only available in tests');
  }

  latestListingsRefreshOverrideForTests = override;
}

export async function enqueuePropertyTileSnapshotRefresh(
  _data: PropertyTileSnapshotRefreshJobData,
): Promise<PropertyTileSnapshotRefreshEnqueueResult> {
  return {
    status: 'skipped',
    jobId: PROPERTY_TILE_SNAPSHOT_REFRESH_JOB_ID,
    skippedReason: 'disabled',
  };
}

export async function enqueuePropertyTilePyramidBuild(
  data: PropertyTilePyramidBuildJobData,
  jobId: string,
): Promise<PropertyTilePyramidBuildEnqueueResult> {
  const queue = await getPropertyTilePyramidQueue();
  const existingJob = await queue.getJob(jobId) as ExistingJobLike | null;

  if (existingJob) {
    const state = await existingJob.getState?.() ?? null;
    if (state === 'failed' || state === 'completed') {
      if (!existingJob.retry) {
        throw new Error(
          `Existing property tile pyramid build job ${jobId} is ${state} but cannot be retried`,
        );
      }

      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      return {
        status: 'retried',
        jobId,
        previousState: state,
      };
    }

    return {
      status: 'coalesced',
      jobId,
      existingState: state,
    };
  }

  await queue.add(
    PROPERTY_TILE_PYRAMID_BUILD_JOB,
    data,
    { jobId },
  );
  return {
    status: 'enqueued',
    jobId,
  };
}

export async function closeIngestQueues(): Promise<void> {
  await Promise.all([
    ingestBatchQueue?.close(),
    maintenanceQueue?.close(),
    propertyTilePyramidQueue?.close(),
  ]);

  ingestBatchQueue = null;
  maintenanceQueue = null;
  propertyTilePyramidQueue = null;
  latestListingsRefreshOverrideForTests = null;
}

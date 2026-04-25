import { randomUUID } from 'node:crypto';
import { getRedisConnection } from '../../lib/redis.js';
import {
  INGEST_BATCH_JOB,
  INGEST_BATCH_QUEUE,
  MAINTENANCE_QUEUE,
  REFRESH_LATEST_LISTINGS_JOB,
  type IngestBatchJobData,
  type MaintenanceRefreshJobData,
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

let ingestBatchQueue: QueueLike<IngestBatchJobData> | null = null;
let maintenanceQueue: QueueLike<MaintenanceRefreshJobData> | null = null;

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
  const queue = await getMaintenanceQueue();
  const dedupeId = data.batchId ?? randomUUID();
  await queue.add(
    REFRESH_LATEST_LISTINGS_JOB,
    data,
    { jobId: `${REFRESH_LATEST_LISTINGS_JOB}-${dedupeId}` },
  );
}

export async function closeIngestQueues(): Promise<void> {
  await Promise.all([
    ingestBatchQueue?.close(),
    maintenanceQueue?.close(),
  ]);

  ingestBatchQueue = null;
  maintenanceQueue = null;
}

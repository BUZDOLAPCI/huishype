import { getRedisConnection } from '../../lib/redis.js';
import {
  OFFICIAL_VALUATION_HYDRATION_JOB,
  OFFICIAL_VALUATION_HYDRATION_QUEUE,
  type OfficialValuationHydrationJobData,
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

let hydrationQueue: QueueLike<OfficialValuationHydrationJobData> | null = null;

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

async function getHydrationQueue(): Promise<QueueLike<OfficialValuationHydrationJobData>> {
  if (hydrationQueue) {
    return hydrationQueue;
  }

  const Queue = await loadQueueConstructor<OfficialValuationHydrationJobData>();
  hydrationQueue = new Queue(OFFICIAL_VALUATION_HYDRATION_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1_000,
      removeOnFail: false,
    },
  });

  return hydrationQueue;
}

export async function enqueueOfficialValuationHydration(
  data: OfficialValuationHydrationJobData,
): Promise<void> {
  const queue = await getHydrationQueue();
  const existingJob = await queue.getJob(data.jobId) as ExistingJobLike | null;

  if (existingJob) {
    const state = await existingJob.getState?.();
    if (state === 'failed' || state === 'completed') {
      if (!existingJob.retry) {
        throw new Error(
          `Existing official valuation hydration job ${data.jobId} is ${state} but cannot be retried`,
        );
      }

      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    }
    return;
  }

  await queue.add(OFFICIAL_VALUATION_HYDRATION_JOB, data, {
    jobId: data.jobId,
  });
}

export async function closeOfficialValuationQueues(): Promise<void> {
  await hydrationQueue?.close();
  hydrationQueue = null;
}

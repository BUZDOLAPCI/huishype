import { getRedisConnection } from '../../lib/redis.js';
import {
  CANDIDATE_HANDOFF_JOB,
  CANDIDATE_HANDOFF_QUEUE,
  type CandidateHandoffJobData,
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

let candidateHandoffQueue: QueueLike<CandidateHandoffJobData> | null = null;
let enqueueCandidateHandoffOverrideForTests: ((handoffId: string) => Promise<void>) | null = null;

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

async function getCandidateHandoffQueue(): Promise<QueueLike<CandidateHandoffJobData>> {
  if (candidateHandoffQueue) {
    return candidateHandoffQueue;
  }

  const Queue = await loadQueueConstructor<CandidateHandoffJobData>();
  candidateHandoffQueue = new Queue(CANDIDATE_HANDOFF_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1_000,
      removeOnFail: false,
    },
  });

  return candidateHandoffQueue;
}

export async function enqueueCandidateHandoff(handoffId: string): Promise<void> {
  if (enqueueCandidateHandoffOverrideForTests) {
    await enqueueCandidateHandoffOverrideForTests(handoffId);
    return;
  }

  const queue = await getCandidateHandoffQueue();
  const existingJob = await queue.getJob(handoffId) as ExistingJobLike | null;

  if (existingJob) {
    const state = await existingJob.getState?.();
    if (state === 'failed' || state === 'completed') {
      if (!existingJob.retry) {
        throw new Error(`Existing candidate handoff job ${handoffId} is ${state} but cannot be retried`);
      }

      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    }
    return;
  }

  await queue.add(
    CANDIDATE_HANDOFF_JOB,
    { handoffId },
    { jobId: handoffId },
  );
}

export function setCandidateHandoffEnqueueOverrideForTests(
  override: ((handoffId: string) => Promise<void>) | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Candidate handoff enqueue override is only available in tests');
  }

  enqueueCandidateHandoffOverrideForTests = override;
}

export async function closeCandidateHandoffQueues(): Promise<void> {
  await candidateHandoffQueue?.close();
  candidateHandoffQueue = null;
  enqueueCandidateHandoffOverrideForTests = null;
}

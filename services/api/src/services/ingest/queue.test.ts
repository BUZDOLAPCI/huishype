import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getRedisConnectionMock = jest.fn(async () => ({}));
const getJobMock = jest.fn(async () => null as unknown);
const addMock = jest.fn(async () => undefined);
const closeMock = jest.fn(async () => undefined);
const QueueMock = jest.fn(() => ({
  getJob: getJobMock,
  add: addMock,
  close: closeMock,
}));

jest.unstable_mockModule('../../lib/redis.js', () => ({
  getRedisConnection: getRedisConnectionMock,
}));

jest.unstable_mockModule('bullmq', () => ({
  Queue: QueueMock,
}));

describe('ingest queue', () => {
  beforeEach(() => {
    jest.resetModules();
    getRedisConnectionMock.mockClear();
    getJobMock.mockReset();
    getJobMock.mockResolvedValue(null);
    addMock.mockClear();
    closeMock.mockClear();
    QueueMock.mockClear();
  });

  it('uses the batch id as the BullMQ dedupe id', async () => {
    const { enqueueIngestBatch } = await import('./queue.js');

    await enqueueIngestBatch('ingest-batch-1');

    expect(getJobMock).toHaveBeenCalledWith('ingest-batch-1');
    expect(addMock).toHaveBeenCalledWith(
      'ingest-batch',
      { batchId: 'ingest-batch-1' },
      { jobId: 'ingest-batch-1' },
    );
  });

  it('does not add another Redis dispatch job when BullMQ already has a live durable job id', async () => {
    const getStateMock = jest.fn(async () => 'waiting');
    const retryMock = jest.fn(async () => undefined);
    getJobMock.mockResolvedValueOnce({
      id: 'ingest-batch-1',
      getState: getStateMock,
      retry: retryMock,
    });
    const { enqueueIngestBatch } = await import('./queue.js');

    await enqueueIngestBatch('ingest-batch-1');

    expect(getJobMock).toHaveBeenCalledWith('ingest-batch-1');
    expect(getStateMock).toHaveBeenCalled();
    expect(retryMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('retries an existing failed durable job instead of silently treating it as dispatched', async () => {
    const getStateMock = jest.fn(async () => 'failed');
    const retryMock = jest.fn(async () => undefined);
    getJobMock.mockResolvedValueOnce({
      id: 'ingest-batch-1',
      getState: getStateMock,
      retry: retryMock,
    });
    const { enqueueIngestBatch } = await import('./queue.js');

    await enqueueIngestBatch('ingest-batch-1');

    expect(getJobMock).toHaveBeenCalledWith('ingest-batch-1');
    expect(getStateMock).toHaveBeenCalled();
    expect(retryMock).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it('surfaces failed-job retry errors so recovery does not mark the batch queued', async () => {
    const retryError = new Error('retry failed');
    const getStateMock = jest.fn(async () => 'failed');
    const retryMock = jest.fn(async () => {
      throw retryError;
    });
    getJobMock.mockResolvedValueOnce({
      id: 'ingest-batch-1',
      getState: getStateMock,
      retry: retryMock,
    });
    const { enqueueIngestBatch } = await import('./queue.js');

    await expect(enqueueIngestBatch('ingest-batch-1')).rejects.toThrow(retryError);

    expect(retryMock).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(addMock).not.toHaveBeenCalled();
  });
});

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

  it('retries an existing completed durable job so previously out-of-order noops can run later', async () => {
    const getStateMock = jest.fn(async () => 'completed');
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
    expect(retryMock).toHaveBeenCalledWith('completed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it('surfaces completed-job retry errors so recovery does not mark the batch queued', async () => {
    const retryError = new Error('completed retry failed');
    const getStateMock = jest.fn(async () => 'completed');
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

    expect(retryMock).toHaveBeenCalledWith('completed', {
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

  it('uses a BullMQ-safe maintenance refresh job id', async () => {
    const { requestLatestListingsRefresh } = await import('./queue.js');

    await requestLatestListingsRefresh({
      requestedBy: 'ingest-batch',
      batchId: 'batch-1',
    });

    expect(addMock).toHaveBeenCalledWith(
      'refresh-latest-active-listings',
      {
        requestedBy: 'ingest-batch',
        batchId: 'batch-1',
      },
      { jobId: 'refresh-latest-active-listings-batch-1' },
    );
  });

  it('coalesces worker sweep maintenance refreshes without a batch id into a singleton job id', async () => {
    const { requestLatestListingsRefresh } = await import('./queue.js');

    await requestLatestListingsRefresh({
      requestedBy: 'worker-sweep',
    });

    expect(getJobMock).toHaveBeenCalledWith('refresh-latest-active-listings-worker-sweep');
    expect(addMock).toHaveBeenCalledWith(
      'refresh-latest-active-listings',
      {
        requestedBy: 'worker-sweep',
      },
      { jobId: 'refresh-latest-active-listings-worker-sweep' },
    );
  });

  it.each(['active', 'waiting', 'delayed'] as const)(
    'does not add another worker sweep maintenance refresh when the singleton job is %s',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'refresh-latest-active-listings-worker-sweep',
        getState: getStateMock,
        retry: retryMock,
      });
      const { requestLatestListingsRefresh } = await import('./queue.js');

      await requestLatestListingsRefresh({
        requestedBy: 'worker-sweep',
      });

      expect(getJobMock).toHaveBeenCalledWith('refresh-latest-active-listings-worker-sweep');
      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).not.toHaveBeenCalled();
      expect(addMock).not.toHaveBeenCalled();
    },
  );

  it.each(['completed', 'failed'] as const)(
    'retries an existing %s worker sweep singleton refresh so pending maintenance can run again',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'refresh-latest-active-listings-worker-sweep',
        getState: getStateMock,
        retry: retryMock,
      });
      const { requestLatestListingsRefresh } = await import('./queue.js');

      await requestLatestListingsRefresh({
        requestedBy: 'worker-sweep',
      });

      expect(getJobMock).toHaveBeenCalledWith('refresh-latest-active-listings-worker-sweep');
      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).toHaveBeenCalledWith(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      expect(addMock).not.toHaveBeenCalled();
    },
  );

  it('keeps worker sweep maintenance refreshes with a batch id batch-specific', async () => {
    const { requestLatestListingsRefresh } = await import('./queue.js');

    await requestLatestListingsRefresh({
      requestedBy: 'worker-sweep',
      batchId: 'batch-1',
    });

    expect(getJobMock).not.toHaveBeenCalled();
    expect(addMock).toHaveBeenCalledWith(
      'refresh-latest-active-listings',
      {
        requestedBy: 'worker-sweep',
        batchId: 'batch-1',
      },
      { jobId: 'refresh-latest-active-listings-batch-1' },
    );
  });

  it('keeps legacy property tile snapshot refresh dispatch disabled', async () => {
    const { enqueuePropertyTileSnapshotRefresh } = await import('./queue.js');

    const result = await enqueuePropertyTileSnapshotRefresh({ reason: 'unit-test' });

    expect(getJobMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'skipped',
      jobId: 'property-tile-snapshot-refresh-public-default-low-zoom',
      skippedReason: 'disabled',
    });
  });

  it('uses the version-scoped singleton job id for property tile pyramid builds', async () => {
    const { enqueuePropertyTilePyramidBuild } = await import('./queue.js');

    const result = await enqueuePropertyTilePyramidBuild(
      { versionId: '00000000-0000-0000-0000-000000000001', reason: 'unit-test' },
      'property-tile-pyramid-unit',
    );

    expect(getJobMock).toHaveBeenCalledWith('property-tile-pyramid-unit');
    expect(addMock).toHaveBeenCalledWith(
      'build-property-tile-pyramid',
      { versionId: '00000000-0000-0000-0000-000000000001', reason: 'unit-test' },
      { jobId: 'property-tile-pyramid-unit' },
    );
    expect(result).toEqual({
      status: 'enqueued',
      jobId: 'property-tile-pyramid-unit',
    });
  });

  it.each(['active', 'waiting', 'delayed'] as const)(
    'coalesces property tile pyramid build dispatch when singleton job is %s',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'property-tile-pyramid-unit',
        getState: getStateMock,
        retry: retryMock,
      });
      const { enqueuePropertyTilePyramidBuild } = await import('./queue.js');

      const result = await enqueuePropertyTilePyramidBuild(
        { reason: 'unit-test' },
        'property-tile-pyramid-unit',
      );

      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).not.toHaveBeenCalled();
      expect(addMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'coalesced',
        jobId: 'property-tile-pyramid-unit',
        existingState: state,
      });
    },
  );

  it.each(['completed', 'failed'] as const)(
    'retries an existing %s property tile pyramid singleton job',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'property-tile-pyramid-unit',
        getState: getStateMock,
        retry: retryMock,
      });
      const { enqueuePropertyTilePyramidBuild } = await import('./queue.js');

      const result = await enqueuePropertyTilePyramidBuild(
        { reason: 'unit-test' },
        'property-tile-pyramid-unit',
      );

      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).toHaveBeenCalledWith(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      expect(addMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'retried',
        jobId: 'property-tile-pyramid-unit',
        previousState: state,
      });
    },
  );
});

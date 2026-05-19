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

describe('official valuation hydration queue', () => {
  beforeEach(() => {
    jest.resetModules();
    getRedisConnectionMock.mockClear();
    getJobMock.mockReset();
    getJobMock.mockResolvedValue(null);
    addMock.mockClear();
    closeMock.mockClear();
    QueueMock.mockClear();
  });

  it('uses the durable hydration job id as the BullMQ dedupe id', async () => {
    const { enqueueOfficialValuationHydration } = await import('./queue.js');

    await enqueueOfficialValuationHydration({
      jobId: 'durable-job-1',
      propertyId: 'property-1',
      source: 'woz',
      valuationYear: 2025,
    });

    expect(getJobMock).toHaveBeenCalledWith('durable-job-1');
    expect(addMock).toHaveBeenCalledWith(
      'official-valuation-hydration',
      {
        jobId: 'durable-job-1',
        propertyId: 'property-1',
        source: 'woz',
        valuationYear: 2025,
      },
      { jobId: 'durable-job-1' },
    );
  });

  it.each(['active', 'waiting', 'delayed'] as const)(
    'does not add another Redis dispatch job when BullMQ already has a live %s durable job id',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'durable-job-1',
        getState: getStateMock,
        retry: retryMock,
      });
      const { enqueueOfficialValuationHydration } = await import('./queue.js');

      await enqueueOfficialValuationHydration({
        jobId: 'durable-job-1',
        propertyId: 'property-1',
        source: 'woz',
        valuationYear: 2025,
      });

      expect(getJobMock).toHaveBeenCalledWith('durable-job-1');
      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).not.toHaveBeenCalled();
      expect(addMock).not.toHaveBeenCalled();
    },
  );

  it.each(['failed', 'completed'] as const)(
    'retries an existing %s durable job instead of silently treating it as dispatched',
    async (state) => {
      const getStateMock = jest.fn(async () => state);
      const retryMock = jest.fn(async () => undefined);
      getJobMock.mockResolvedValueOnce({
        id: 'durable-job-1',
        getState: getStateMock,
        retry: retryMock,
      });
      const { enqueueOfficialValuationHydration } = await import('./queue.js');

      await enqueueOfficialValuationHydration({
        jobId: 'durable-job-1',
        propertyId: 'property-1',
        source: 'woz',
        valuationYear: 2025,
      });

      expect(getJobMock).toHaveBeenCalledWith('durable-job-1');
      expect(getStateMock).toHaveBeenCalled();
      expect(retryMock).toHaveBeenCalledWith(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      expect(addMock).not.toHaveBeenCalled();
    },
  );

  it('surfaces retained-job retry errors so recovery does not mark hydration dispatched', async () => {
    const retryError = new Error('retry failed');
    const getStateMock = jest.fn(async () => 'failed');
    const retryMock = jest.fn(async () => {
      throw retryError;
    });
    getJobMock.mockResolvedValueOnce({
      id: 'durable-job-1',
      getState: getStateMock,
      retry: retryMock,
    });
    const { enqueueOfficialValuationHydration } = await import('./queue.js');

    await expect(enqueueOfficialValuationHydration({
      jobId: 'durable-job-1',
      propertyId: 'property-1',
      source: 'woz',
      valuationYear: 2025,
    })).rejects.toThrow(retryError);

    expect(retryMock).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    expect(addMock).not.toHaveBeenCalled();
  });
});

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

  it('does not add another Redis dispatch job when BullMQ already has the durable job id', async () => {
    getJobMock.mockResolvedValueOnce({ id: 'durable-job-1' });
    const { enqueueOfficialValuationHydration } = await import('./queue.js');

    await enqueueOfficialValuationHydration({
      jobId: 'durable-job-1',
      propertyId: 'property-1',
      source: 'woz',
      valuationYear: 2025,
    });

    expect(getJobMock).toHaveBeenCalledWith('durable-job-1');
    expect(addMock).not.toHaveBeenCalled();
  });
});

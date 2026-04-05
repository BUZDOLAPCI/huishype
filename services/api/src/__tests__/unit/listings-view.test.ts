import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const executeMock = jest.fn() as jest.MockedFunction<() => Promise<void>>;
const closeConnectionMock = jest.fn(async () => undefined);

jest.unstable_mockModule('../../db/index.js', () => ({
  db: {
    execute: executeMock,
  },
  closeConnection: closeConnectionMock,
}));

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('refreshLatestListingsView', () => {
  beforeEach(() => {
    jest.resetModules();
    executeMock.mockReset();
  });

  it('coalesces concurrent callers and guarantees one follow-up refresh for calls during the first pass', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;

    const firstPass = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondPass = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    executeMock.mockImplementationOnce(() => firstPass);
    executeMock.mockImplementationOnce(() => secondPass);

    const { refreshLatestListingsView } = await import('../../services/listings-view.js');

    const refreshOne = refreshLatestListingsView();
    const refreshTwo = refreshLatestListingsView();

    expect(executeMock).toHaveBeenCalledTimes(1);

    const refreshThree = refreshLatestListingsView();
    expect(executeMock).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushMicrotasks();

    expect(executeMock).toHaveBeenCalledTimes(2);

    releaseSecond();
    await Promise.all([refreshOne, refreshTwo, refreshThree]);

    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('starts a new refresh after the previous one has finished', async () => {
    executeMock.mockResolvedValue(undefined);

    const { refreshLatestListingsView } = await import('../../services/listings-view.js');

    await refreshLatestListingsView();
    await refreshLatestListingsView();

    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { PropertyTileRuntime } from './property-tile-runtime.js';

describe('PropertyTileRuntime', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    return { promise, resolve, reject };
  }

  it('coalesces same-key waiters onto one builder and reports the attached waiter', async () => {
    const runtime = new PropertyTileRuntime();
    const releaseBuilder = deferred<string>();
    let builderCalls = 0;
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });

    const firstResult = runtime.run({
      key: 'public:13/4208/2686:default',
      zoom: 13,
      budgetMs: 5_000,
      builder: async () => {
        builderCalls += 1;
        markBuilderStarted();
        return releaseBuilder.promise;
      },
    });

    await builderStarted;

    const secondResult = runtime.run({
      key: 'public:13/4208/2686:default',
      zoom: 13,
      budgetMs: 5_000,
      builder: async () => {
        throw new Error('coalesced builder should not run');
      },
    });

    releaseBuilder.resolve('shared-result');

    await expect(firstResult).resolves.toMatchObject({
      state: 'completed',
      result: 'shared-result',
      coalesced: false,
      publishable: true,
    });
    await expect(secondResult).resolves.toMatchObject({
      state: 'completed',
      result: 'shared-result',
      coalesced: true,
      publishable: true,
    });
    expect(builderCalls).toBe(1);

    runtime.resetForTests();
  });

  it('lets a coalesced waiter enforce its own tighter runtime budget', async () => {
    const runtime = new PropertyTileRuntime();
    const releaseBuilder = deferred<string>();
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });

    const firstResult = runtime.run({
      key: 'public:13/4208/2686:default',
      zoom: 13,
      budgetMs: 5_000,
      builder: async () => {
        markBuilderStarted();
        return releaseBuilder.promise;
      },
    });

    await builderStarted;

    const coalescedResult = runtime.run({
      key: 'public:13/4208/2686:default',
      zoom: 13,
      budgetMs: 1,
      builder: async () => {
        throw new Error('coalesced builder should not run');
      },
    });

    await expect(coalescedResult).resolves.toMatchObject({
      state: 'timeout',
      coalesced: true,
      budgetMs: 1,
    });

    releaseBuilder.resolve('fresh-result');
    await expect(firstResult).resolves.toMatchObject({
      state: 'completed',
      result: 'fresh-result',
      publishable: true,
    });
    runtime.resetForTests();
  });

  it('times out queued waiters without starting their builders when runtime slots are saturated', async () => {
    process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
    const runtime = new PropertyTileRuntime();
    const releaseBlocker = deferred<string>();
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    let queuedBuilderRan = false;

    const blocker = runtime.run({
      key: 'public:blocker',
      zoom: 20,
      budgetMs: 5_000,
      builder: async () => {
        markBlockerStarted();
        return releaseBlocker.promise;
      },
    });
    await blockerStarted;

    const queued = runtime.run({
      key: 'public:queued-timeout',
      zoom: 10,
      budgetMs: 5_000,
      queueWaitMs: 5,
      builder: async () => {
        queuedBuilderRan = true;
        return 'should-not-run';
      },
    });

    await expect(queued).resolves.toMatchObject({
      state: 'timeout',
      coalesced: false,
      generationTimeMs: 0,
    });
    expect(queuedBuilderRan).toBe(false);

    releaseBlocker.resolve('done');
    await blocker;
    runtime.resetForTests();
  });

  it('drops lower-priority queued tasks when the queue limit is exceeded', async () => {
    process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
    process.env.PROPERTY_TILE_QUEUE_LIMIT = '1';
    const runtime = new PropertyTileRuntime();
    const releaseBlocker = deferred<string>();
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    let lowPriorityBuilderRan = false;

    const blocker = runtime.run({
      key: 'public:blocker',
      zoom: 20,
      budgetMs: 5_000,
      builder: async () => {
        markBlockerStarted();
        return releaseBlocker.promise;
      },
    });
    await blockerStarted;

    const lowPriority = runtime.run({
      key: 'public:low-priority',
      zoom: 3,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      builder: async () => {
        lowPriorityBuilderRan = true;
        return 'low';
      },
    });

    const highPriority = runtime.run({
      key: 'public:high-priority',
      zoom: 15,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      builder: async () => 'high',
    });

    await expect(lowPriority).resolves.toMatchObject({
      state: 'dropped',
      coalesced: false,
    });
    expect(lowPriorityBuilderRan).toBe(false);

    releaseBlocker.resolve('done');
    await expect(blocker).resolves.toMatchObject({ state: 'completed' });
    await expect(highPriority).resolves.toMatchObject({
      state: 'completed',
      result: 'high',
    });
    runtime.resetForTests();
  });

  it('removes an aborted queued same-key task so a later request can build normally', async () => {
    process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
    const runtime = new PropertyTileRuntime();
    const releaseBlocker = deferred<string>();
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    let abortedBuilderRan = false;
    let replacementBuilderRan = false;

    const blocker = runtime.run({
      key: 'public:blocker',
      zoom: 20,
      budgetMs: 5_000,
      builder: async () => {
        markBlockerStarted();
        return releaseBlocker.promise;
      },
    });
    await blockerStarted;

    const controller = new AbortController();
    const aborted = runtime.run({
      key: 'public:aborted-queued',
      zoom: 10,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      signal: controller.signal,
      builder: async () => {
        abortedBuilderRan = true;
        return 'aborted';
      },
    });

    controller.abort();
    await expect(aborted).resolves.toMatchObject({ state: 'aborted' });
    expect(abortedBuilderRan).toBe(false);

    const replacement = runtime.run({
      key: 'public:aborted-queued',
      zoom: 10,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      builder: async () => {
        replacementBuilderRan = true;
        return 'replacement';
      },
    });

    releaseBlocker.resolve('done');
    await blocker;
    await expect(replacement).resolves.toMatchObject({
      state: 'completed',
      result: 'replacement',
      coalesced: false,
    });
    expect(replacementBuilderRan).toBe(true);
    runtime.resetForTests();
  });

  it('reports each waiter budget when a queued same-key task is dropped', async () => {
    process.env.PROPERTY_TILE_MAX_CONCURRENCY = '1';
    process.env.PROPERTY_TILE_QUEUE_LIMIT = '1';
    const runtime = new PropertyTileRuntime();
    const releaseBlocker = deferred<string>();
    let markBlockerStarted!: () => void;
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });

    const blocker = runtime.run({
      key: 'public:blocker',
      zoom: 20,
      budgetMs: 5_000,
      builder: async () => {
        markBlockerStarted();
        return releaseBlocker.promise;
      },
    });
    await blockerStarted;

    const firstWaiter = runtime.run({
      key: 'public:queued-same-key',
      zoom: 3,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      builder: async () => 'low',
    });
    const secondWaiter = runtime.run({
      key: 'public:queued-same-key',
      zoom: 3,
      budgetMs: 123,
      queueWaitMs: 5_000,
      builder: async () => {
        throw new Error('coalesced queued builder should not run');
      },
    });

    const highPriority = runtime.run({
      key: 'public:high-priority',
      zoom: 15,
      budgetMs: 5_000,
      queueWaitMs: 5_000,
      builder: async () => 'high',
    });

    await expect(firstWaiter).resolves.toMatchObject({
      state: 'dropped',
      coalesced: false,
      budgetMs: 5_000,
    });
    await expect(secondWaiter).resolves.toMatchObject({
      state: 'dropped',
      coalesced: true,
      budgetMs: 123,
    });

    releaseBlocker.resolve('done');
    await blocker;
    await expect(highPriority).resolves.toMatchObject({ state: 'completed', result: 'high' });
    runtime.resetForTests();
  });

  it('aborts the builder signal when the runtime budget expires', async () => {
    const runtime = new PropertyTileRuntime();
    const signalAborted = new Promise<void>((resolve) => {
      void runtime.run({
        key: 'public:budget-timeout',
        zoom: 10,
        budgetMs: 5,
        builder: async ({ signal }) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
          await new Promise(() => undefined);
          return 'unreachable';
        },
      });
    });

    const result = runtime.run({
      key: 'public:budget-timeout',
      zoom: 10,
      budgetMs: 5,
      builder: async () => {
        throw new Error('same-key timeout waiter should coalesce');
      },
    });

    await expect(result).resolves.toMatchObject({
      state: 'timeout',
      coalesced: true,
    });
    await signalAborted;
    runtime.resetForTests();
  });

  it('aborts obsolete running work when an uncancellable stage ends with no waiters', async () => {
    const runtime = new PropertyTileRuntime();
    const controller = new AbortController();
    let releaseSql!: () => void;
    let markBuilderStarted!: () => void;
    let markBuilderDone!: () => void;
    let signalAbortedAfterSql = false;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });
    const builderDone = new Promise<void>((resolve) => {
      markBuilderDone = resolve;
    });

    const result = runtime.run({
      key: 'public:obsolete-running-work',
      zoom: 10,
      budgetMs: 5_000,
      signal: controller.signal,
      builder: async ({ signal, markUncancellableStage }) => {
        markBuilderStarted();
        markUncancellableStage?.(true);
        await new Promise<void>((resolve) => {
          releaseSql = resolve;
        });
        markUncancellableStage?.(false);
        signalAbortedAfterSql = Boolean(signal?.aborted);
        markBuilderDone();
        if (signal?.aborted) {
          throw signal.reason;
        }
        return 'obsolete-result';
      },
    });

    await builderStarted;
    controller.abort();
    await expect(result).resolves.toMatchObject({ state: 'aborted' });

    releaseSql();
    await builderDone;
    expect(signalAbortedAfterSql).toBe(true);
    runtime.resetForTests();
  });

  it('detaches in-flight tasks invalidated by key before they can publish', async () => {
    const runtime = new PropertyTileRuntime();
    let releaseBuilder!: () => void;
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });
    const firstResult = runtime.run({
      key: 'read:1/2/3:default:session:test-viewer:old-scope',
      zoom: 16,
      budgetMs: 5_000,
      builder: async () => {
        markBuilderStarted();
        await new Promise<void>((release) => {
          releaseBuilder = release;
        });
        return 'obsolete-result';
      },
    });

    const coalescedResult = runtime.run({
      key: 'read:1/2/3:default:session:test-viewer:old-scope',
      zoom: 16,
      budgetMs: 5_000,
      builder: async () => {
        throw new Error('coalesced builders should not run');
      },
    });

    await builderStarted;

    const invalidated = runtime.invalidateMatching((key) => key.includes(':session:test-viewer:'));

    expect(invalidated).toBe(1);
    await expect(firstResult).resolves.toMatchObject({
      state: 'aborted',
    });
    await expect(coalescedResult).resolves.toMatchObject({
      state: 'aborted',
    });

    releaseBuilder();
    runtime.resetForTests();
  });

  it('marks completed invalidated tasks as unpublishable if the builder cannot be cancelled', async () => {
    const runtime = new PropertyTileRuntime();
    let releaseBuilder!: () => void;
    let markBuilderStarted!: () => void;
    const builderStarted = new Promise<void>((resolve) => {
      markBuilderStarted = resolve;
    });
    const resultPromise = runtime.run({
      key: 'read:1/2/3:default:session:test-viewer:old-scope',
      zoom: 16,
      budgetMs: 5_000,
      builder: async ({ markUncancellableStage }) => {
        markBuilderStarted();
        markUncancellableStage?.(true);
        await new Promise<void>((release) => {
          releaseBuilder = release;
        });
        markUncancellableStage?.(false);
        return 'obsolete-result';
      },
    });

    await builderStarted;

    const invalidated = runtime.invalidateMatching((key) => key.includes(':session:test-viewer:'));

    expect(invalidated).toBe(1);
    releaseBuilder();
    await expect(resultPromise).resolves.toMatchObject({
      state: 'aborted',
    });
    runtime.resetForTests();
  });
});

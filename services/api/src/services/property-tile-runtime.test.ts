import { describe, expect, it } from '@jest/globals';
import { PropertyTileRuntime } from './property-tile-runtime.js';

describe('PropertyTileRuntime', () => {
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

    const invalidated = runtime.invalidateMatching((key) =>
      key.includes(':session:test-viewer:')
    );

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

    const invalidated = runtime.invalidateMatching((key) =>
      key.includes(':session:test-viewer:')
    );

    expect(invalidated).toBe(1);
    releaseBuilder();
    await expect(resultPromise).resolves.toMatchObject({
      state: 'aborted',
    });
    runtime.resetForTests();
  });
});

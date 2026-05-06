import { describe, expect, it } from '@jest/globals';
import {
  buildListingReplayThresholds,
  collectListingReplayThresholdViolations,
  computePlannedListingReplayBatchCount,
  shouldPreserveMirrorRowForIngest,
} from '../../scripts/seed-listings-safety.js';

describe('seed listings replay safety', () => {
  it('computes threshold violations before replay execution', () => {
    const thresholds = buildListingReplayThresholds(
      {
        mirrorListingCount: 100,
        skippedBeforeIngestCount: 12,
      },
      {
        maxSkipped: 10,
        maxSkipRatio: 0.1,
      },
    );

    expect(thresholds).toEqual({
      maxSkipped: 10,
      maxSkipRatio: 0.1,
      skipRatio: 0.12,
      violations: ['max_skipped', 'max_skip_ratio'],
    });
  });

  it('plans observation batches plus the completion batch without mutating', () => {
    expect(
      computePlannedListingReplayBatchCount({ preparedListingCount: 0 }, { batchSize: 1_000 }),
    ).toBe(1);
    expect(
      computePlannedListingReplayBatchCount({ preparedListingCount: 999 }, { batchSize: 1_000 }),
    ).toBe(1);
    expect(
      computePlannedListingReplayBatchCount({ preparedListingCount: 1_000 }, { batchSize: 1_000 }),
    ).toBe(2);
    expect(
      computePlannedListingReplayBatchCount({ preparedListingCount: 1_001 }, { batchSize: 1_000 }),
    ).toBe(2);
  });

  it('collects violations across all selected sources so execute can gate once', () => {
    const violations = collectListingReplayThresholdViolations([
      {
        sourceName: 'funda',
        mirrorListingCount: 10,
        preparedListingCount: 10,
        skippedBeforeIngestCount: 0,
        thresholds: { violations: [] },
      },
      {
        sourceName: 'pararius',
        mirrorListingCount: 10,
        preparedListingCount: 7,
        skippedBeforeIngestCount: 3,
        thresholds: { violations: ['max_skip_ratio'] },
      },
    ]);

    expect(violations).toEqual(['pararius:max_skip_ratio']);
  });

  it('keeps diagnostic replay rows with source evidence even when address fields are incomplete', () => {
    expect(
      shouldPreserveMirrorRowForIngest({
        listingUrl: 'https://example.test/listing/blocked',
        street: null,
        postalCode: null,
        houseNumber: null,
        diagnosticStatus: 'blocked',
      }),
    ).toBe(true);

    expect(
      shouldPreserveMirrorRowForIngest({
        listingUrl: 'https://example.test/listing/missing-address',
        street: null,
        postalCode: null,
        houseNumber: null,
        diagnosticStatus: null,
      }),
    ).toBe(false);

    expect(
      shouldPreserveMirrorRowForIngest({
        listingUrl: '',
        street: null,
        postalCode: null,
        houseNumber: null,
        diagnosticStatus: 'blocked',
      }),
    ).toBe(false);
  });
});

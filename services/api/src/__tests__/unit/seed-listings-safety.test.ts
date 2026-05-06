import { describe, expect, it } from '@jest/globals';
import {
  buildListingReplayExecutionAssessment,
  buildListingReplayThresholds,
  classifyListingReplayPreparation,
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
        affectedCanonicalCount: 42,
        staleObservationCount: 5,
      },
      {
        maxSkipped: 10,
        maxSkipRatio: 0.1,
        maxAffectedCanonical: 40,
        maxStaleRows: 4,
      },
    );

    expect(thresholds).toEqual({
      maxSkipped: 10,
      maxSkipRatio: 0.1,
      maxAffectedCanonical: 40,
      maxStaleRows: 4,
      skipRatio: 0.12,
      violations: ['max_skipped', 'max_skip_ratio', 'max_affected_canonical', 'max_stale_rows'],
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

  it('marks stale projection as repair-only and absence without completion as blocked', () => {
    expect(
      buildListingReplayExecutionAssessment(
        {
          mirrorListingCount: 100,
          staleObservationCount: 5,
          absenceWithoutCompletionCount: 0,
          duplicateCanonicalCandidateCount: 0,
          reactivationCandidateCount: 0,
        },
        [],
      ),
    ).toEqual({
      executeAllowed: false,
      repairExecuteAllowed: true,
      abortReasons: ['stale_for_projection_without_repair'],
    });

    expect(
      buildListingReplayExecutionAssessment(
        {
          mirrorListingCount: 100,
          staleObservationCount: 0,
          absenceWithoutCompletionCount: 1,
          duplicateCanonicalCandidateCount: 0,
          reactivationCandidateCount: 0,
        },
        [],
      ),
    ).toMatchObject({
      executeAllowed: false,
      repairExecuteAllowed: false,
      abortReasons: ['absence_without_completion'],
    });
  });

  it('keeps diagnostic replay rows with source evidence even when address fields are incomplete', () => {
    expect(
      classifyListingReplayPreparation({
        listingUrl: 'https://example.test/listing/incomplete-active',
        street: null,
        postalCode: null,
        houseNumber: null,
        diagnosticStatus: null,
      }),
    ).toBe('diagnostic');

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
    ).toBe(true);

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

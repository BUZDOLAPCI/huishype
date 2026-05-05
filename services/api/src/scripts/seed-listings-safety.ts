export interface ListingReplaySafetyOptions {
  maxSkipped: number;
  maxSkipRatio: number;
  batchSize: number;
}

export interface ListingReplaySafetySummary {
  sourceName: string;
  mirrorListingCount: number;
  preparedListingCount: number;
  skippedBeforeIngestCount: number;
}

export function buildListingReplayThresholds(
  summary: Pick<ListingReplaySafetySummary, 'mirrorListingCount' | 'skippedBeforeIngestCount'>,
  options: Pick<ListingReplaySafetyOptions, 'maxSkipped' | 'maxSkipRatio'>,
) {
  const skipRatio = summary.mirrorListingCount === 0
    ? 0
    : summary.skippedBeforeIngestCount / summary.mirrorListingCount;
  const violations: string[] = [];
  if (summary.skippedBeforeIngestCount > options.maxSkipped) {
    violations.push('max_skipped');
  }
  if (skipRatio > options.maxSkipRatio) {
    violations.push('max_skip_ratio');
  }

  return {
    maxSkipped: options.maxSkipped,
    maxSkipRatio: options.maxSkipRatio,
    skipRatio,
    violations,
  };
}

export function computePlannedListingReplayBatchCount(
  summary: Pick<ListingReplaySafetySummary, 'preparedListingCount'>,
  options: Pick<ListingReplaySafetyOptions, 'batchSize'>,
): number {
  if (summary.preparedListingCount === 0) return 1;
  const fullObservationBatches = Math.floor(summary.preparedListingCount / options.batchSize);
  return fullObservationBatches + 1;
}

export function collectListingReplayThresholdViolations(
  summaries: Array<ListingReplaySafetySummary & {
    thresholds: { violations: string[] };
  }>,
): string[] {
  return summaries.flatMap((summary) =>
    summary.thresholds.violations.map((violation) => `${summary.sourceName}:${violation}`)
  );
}

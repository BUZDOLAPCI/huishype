export interface ListingReplaySafetyOptions {
  maxSkipped: number;
  maxSkipRatio: number;
  batchSize: number;
  maxAffectedCanonical?: number;
  maxStaleRows?: number;
}

export interface ListingReplaySafetySummary {
  sourceName: string;
  mirrorListingCount: number;
  preparedListingCount: number;
  skippedBeforeIngestCount: number;
  affectedCanonicalCount?: number;
  staleObservationCount?: number;
  reactivationCandidateCount?: number;
  duplicateCanonicalCandidateCount?: number;
  terminalLifecycleChangeCount?: number;
  absenceWithoutCompletionCount?: number;
  readModelRefreshCount?: number;
}

export interface ListingReplayPreparationEvidence {
  listingUrl: string | null | undefined;
  street: string | null | undefined;
  postalCode: string | null | undefined;
  houseNumber: string | number | null | undefined;
  diagnosticStatus: string | null | undefined;
}

export type ListingReplayTransitionClass = 'projectable' | 'diagnostic' | 'skipped';

export interface ListingReplayExecutionAssessment {
  executeAllowed: boolean;
  repairExecuteAllowed: boolean;
  abortReasons: string[];
}

export function hasCompleteMirrorAddress(evidence: ListingReplayPreparationEvidence): boolean {
  return Boolean(
    evidence.street?.trim()
      && evidence.postalCode?.trim()
      && evidence.houseNumber !== null
      && evidence.houseNumber !== undefined
      && String(evidence.houseNumber).trim(),
  );
}

export function classifyListingReplayPreparation(
  evidence: ListingReplayPreparationEvidence,
): ListingReplayTransitionClass {
  if (!evidence.listingUrl?.trim()) {
    return 'skipped';
  }

  if (evidence.diagnosticStatus) {
    return 'diagnostic';
  }

  return hasCompleteMirrorAddress(evidence) ? 'projectable' : 'diagnostic';
}

export function shouldPreserveMirrorRowForIngest(evidence: ListingReplayPreparationEvidence): boolean {
  return classifyListingReplayPreparation(evidence) !== 'skipped';
}

export function buildListingReplayThresholds(
  summary: Pick<
    ListingReplaySafetySummary,
    'mirrorListingCount' | 'skippedBeforeIngestCount' | 'affectedCanonicalCount' | 'staleObservationCount'
  >,
  options: Pick<
    ListingReplaySafetyOptions,
    'maxSkipped' | 'maxSkipRatio' | 'maxAffectedCanonical' | 'maxStaleRows'
  >,
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
  if (
    options.maxAffectedCanonical !== undefined
    && (summary.affectedCanonicalCount ?? 0) > options.maxAffectedCanonical
  ) {
    violations.push('max_affected_canonical');
  }
  if (
    options.maxStaleRows !== undefined
    && (summary.staleObservationCount ?? 0) > options.maxStaleRows
  ) {
    violations.push('max_stale_rows');
  }

  return {
    maxSkipped: options.maxSkipped,
    maxSkipRatio: options.maxSkipRatio,
    maxAffectedCanonical: options.maxAffectedCanonical ?? null,
    maxStaleRows: options.maxStaleRows ?? null,
    skipRatio,
    violations,
  };
}

export function buildListingReplayExecutionAssessment(
  summary: Pick<
    ListingReplaySafetySummary,
    | 'mirrorListingCount'
    | 'reactivationCandidateCount'
    | 'duplicateCanonicalCandidateCount'
    | 'terminalLifecycleChangeCount'
    | 'absenceWithoutCompletionCount'
    | 'staleObservationCount'
  >,
  thresholdViolations: string[],
): ListingReplayExecutionAssessment {
  const abortReasons = [...thresholdViolations];
  const projectableBase = Math.max(summary.mirrorListingCount, 1);
  const reactivationRatio = (summary.reactivationCandidateCount ?? 0) / projectableBase;
  const duplicateRatio = (summary.duplicateCanonicalCandidateCount ?? 0) / projectableBase;

  if (reactivationRatio > 0.01) {
    abortReasons.push('reactivation_ratio_gt_1_percent');
  }
  if (duplicateRatio > 0.001) {
    abortReasons.push('duplicate_candidate_ratio_gt_0_1_percent');
  }
  if ((summary.absenceWithoutCompletionCount ?? 0) > 0) {
    abortReasons.push('absence_without_completion');
  }
  if ((summary.staleObservationCount ?? 0) > 0) {
    abortReasons.push('stale_for_projection_without_repair');
  }

  return {
    executeAllowed: abortReasons.length === 0,
    repairExecuteAllowed: abortReasons.every((reason) => reason === 'stale_for_projection_without_repair'),
    abortReasons,
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

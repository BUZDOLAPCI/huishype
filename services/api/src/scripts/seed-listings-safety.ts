import type { ListingSourceAlias } from '../services/listing-source-resolution.js';

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
  sourceName?: 'funda' | 'pararius';
  sourceListingId?: string | null | undefined;
  street: string | null | undefined;
  postalCode: string | null | undefined;
  houseNumber: string | number | null | undefined;
  diagnosticStatus: string | null | undefined;
}

export type ListingReplayTransitionClass = 'projectable' | 'diagnostic' | 'skipped';
export type ListingReplaySourceName = 'funda' | 'pararius';
export type ListingReplaySourceListingIdKind = 'tiny_id' | 'canonical_path' | 'url_path' | 'unknown';

export interface ListingReplaySourceIdentity {
  sourceUrl: string;
  sourceListingId: string;
  sourceListingIdKind: ListingReplaySourceListingIdKind;
  canonicalUrl: string;
  aliases: ListingSourceAlias[];
}

function uniqueAliases(aliases: ListingSourceAlias[]): ListingSourceAlias[] {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.kind}:${alias.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeFundaMirrorId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return /^\d{6,}$/.test(normalized) ? normalized : null;
}

export function buildCanonicalFundaDetailUrl(fundaId: string | null | undefined): string | null {
  const normalized = normalizeFundaMirrorId(fundaId);
  return normalized ? `https://www.funda.nl/detail/${normalized}/` : null;
}

export function resolveListingReplaySourceIdentity(
  source: ListingReplaySourceName,
  rawUrl: string | null | undefined,
  mirrorId: string | null | undefined,
): ListingReplaySourceIdentity | null {
  const trimmedUrl = rawUrl?.trim() ?? '';
  const trimmedMirrorId = mirrorId?.trim() ?? '';
  const synthesizedFundaUrl = source === 'funda' ? buildCanonicalFundaDetailUrl(trimmedMirrorId) : null;
  const sourceUrl = trimmedUrl || synthesizedFundaUrl;
  if (!sourceUrl) return null;

  const aliases: ListingSourceAlias[] = [];
  const canonicalUrl = sourceUrl.replace(/[?#].*$/, '').replace(/\/+$/, '/');
  let sourceListingId = trimmedMirrorId;
  let sourceListingIdKind: ListingReplaySourceListingIdKind = trimmedMirrorId
    ? source === 'funda' ? 'tiny_id' : 'url_path'
    : 'unknown';

  try {
    const parsed = new URL(canonicalUrl);
    if (source === 'funda') {
      const match = parsed.pathname.match(/(\d{6,})(?:\/)?$/);
      if (match?.[1]) {
        sourceListingId = match[1];
        sourceListingIdKind = 'tiny_id';
        aliases.push({ kind: 'tiny_id', value: match[1] });
      }
    } else {
      sourceListingId = parsed.pathname.replace(/\/+$/, '');
      sourceListingIdKind = 'canonical_path';
      aliases.push({ kind: 'url_path', value: sourceListingId });
    }
  } catch {
    // Keep the mirror id/raw URL fallback below.
  }

  if (trimmedMirrorId && !aliases.some((alias) => alias.value === trimmedMirrorId)) {
    aliases.push({ kind: source === 'funda' ? 'tiny_id' : 'url_path', value: trimmedMirrorId });
  }

  const fallbackId = sourceListingId || trimmedMirrorId || sourceUrl;
  aliases.push({ kind: 'canonical_url', value: sourceUrl });
  return {
    sourceUrl,
    sourceListingId: fallbackId,
    sourceListingIdKind,
    canonicalUrl,
    aliases: uniqueAliases(aliases),
  };
}

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
  const hasListingSourceIdentity = Boolean(resolveListingReplaySourceIdentity(
    evidence.sourceName ?? 'pararius',
    evidence.listingUrl,
    evidence.sourceListingId,
  ));

  if (
    !evidence.listingUrl?.trim()
    && !hasListingSourceIdentity
  ) {
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

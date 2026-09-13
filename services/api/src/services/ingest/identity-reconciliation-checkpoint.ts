import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/index.js';
import { sourceIdentityReconciliationCheckpoints } from '../../db/schema.js';
import { lockIngestSource, reconcileLegacySourceIdentities } from './identity.js';

// Bump only when a new reconciliation algorithm must run for already processed sources.
export const SOURCE_IDENTITY_RECONCILIATION_VERSION = 'source-identities-v1';

const reportCountKeys = [
  'rowsBefore', 'canonicalRowsBefore', 'legacyRowsBefore', 'identityGroups', 'duplicateGroups',
  'quarantinedGroups', 'canonicalDuplicatesSuppressed', 'legacyDuplicatesRecorded',
  'rowsAfter', 'canonicalRowsAfter', 'legacyRowsAfter',
] as const;
const profileCountKeys = ['graphParentBytes', 'graphEdgeBatchLimit', 'edgesRead', 'maximumComponentRows', 'graphPreparationMs',
  'fastPathGroups', 'fastPathLegacyRows', 'reconciliationMs'] as const;
export type ReconciliationCheckpointReport = Record<typeof reportCountKeys[number], number> & {
  profile: Record<typeof profileCountKeys[number], number>;
};
export type ReconciliationWork = (tx: DbTransaction, sourceName: string, options: { dryRun: boolean }) => Promise<Record<string, unknown>>;

function numericCounts<Keys extends string>(report: Record<string, unknown>, keys: readonly Keys[]): Record<Keys, number> {
  const result = {} as Record<Keys, number>;
  for (const key of keys) {
    const count = report[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid identity reconciliation report count: ${key}`);
    }
    result[key] = count;
  }
  return result;
}

function compactReport(report: Record<string, unknown>): ReconciliationCheckpointReport {
  if (!report.profile || typeof report.profile !== 'object' || Array.isArray(report.profile)) {
    throw new Error('Missing identity reconciliation profiling counts.');
  }
  return { ...numericCounts(report, reportCountKeys),
    profile: numericCounts(report.profile as Record<string, unknown>, profileCountKeys) };
}

/** The caller owns the transaction; no completion survives a failed reconciliation. */
export async function reconcileSourceIdentityCheckpoint(
  tx: DbTransaction,
  sourceName: string,
  options: { execute: boolean; once: boolean },
  reconcile: ReconciliationWork = reconcileLegacySourceIdentities,
) {
  if (options.once && !options.execute) throw new Error('--once requires --execute.');
  await lockIngestSource(tx, sourceName);
  const key = and(eq(sourceIdentityReconciliationCheckpoints.sourceName, sourceName),
    eq(sourceIdentityReconciliationCheckpoints.reconciliationVersion, SOURCE_IDENTITY_RECONCILIATION_VERSION));
  if (options.once) {
    const [checkpoint] = await tx.select().from(sourceIdentityReconciliationCheckpoints).where(key);
    if (checkpoint) {
      return { sourceName, reconciliationVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
        status: 'already_completed' as const, completedAt: checkpoint.completedAt.toISOString(),
        report: compactReport(checkpoint.reportJson) };
    }
  }
  const fullReport = await reconcile(tx, sourceName, { dryRun: !options.execute });
  const report = compactReport(fullReport);
  const completedAt = options.execute ? new Date() : null;
  if (completedAt) {
    await tx.insert(sourceIdentityReconciliationCheckpoints).values({ sourceName,
      reconciliationVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION, completedAt, reportJson: report,
    }).onConflictDoUpdate({
      target: [sourceIdentityReconciliationCheckpoints.sourceName, sourceIdentityReconciliationCheckpoints.reconciliationVersion],
      set: { completedAt, reportJson: report },
    });
  }
  return { sourceName, reconciliationVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION,
    status: options.execute ? 'completed' as const : 'dry_run' as const,
    completedAt: completedAt?.toISOString() ?? null, report,
    // The reconciliation reducer caps conflict examples; startup checkpoints
    // carry aggregate counts only, while explicit operator runs retain samples.
    ...(!options.once ? { conflicts: fullReport.conflicts ?? [],
      conflictsTruncated: fullReport.conflictsTruncated ?? false,
      conflictSampleLimit: fullReport.conflictSampleLimit ?? 100 } : {}),
  };
}

import { fileURLToPath } from 'node:url';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { closeConnection, db } from '../db/index.js';
import * as schema from '../db/index.js';
import { closeRedisConnection, getRedisConnection } from '../lib/redis.js';
import { INGEST_BATCH_QUEUE } from '../services/ingest/index.js';
import { reconcileListingObservation } from '../services/listing-reconciliation.js';

const TARGET_RUN_ID = 'f1dd6530-54ce-4a7e-ba4d-da6b55072f5e';
const SOURCE_NAME = 'funda';
const SCRIPT_NAME = 'reconcile-funda-f1dd-stale-observations';
const PROJECTABLE_SOURCE_STATUSES = ['available', 'sold', 'rented', 'withdrawn', 'not_found'] as const;

interface CliOptions {
  execute: boolean;
  confirmRun: string | null;
  forceSupersedeStartedProcessing: boolean;
  forceStartedProcessingSequences: number[];
  confirmWorkerStopped: boolean;
  help: boolean;
}

interface RunMetadataRow extends Record<string, unknown> {
  id: string;
  sourceName: string;
  upstreamRunKey: string;
  upstreamCursorStart: string | null;
  upstreamCursorEnd: string | null;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  processedBatchCount: number;
  errorSummary: Record<string, unknown> | null;
}

interface BatchCountRow extends Record<string, unknown> {
  status: string;
  started: boolean;
  count: number;
  minSequence: number | null;
  maxSequence: number | null;
  ingestedCount: number;
  updatedCount: number;
  skippedCount: number;
}

interface CandidateGroupRow extends Record<string, unknown> {
  origin: string;
  sourceStatus: string;
  propertyMatchKind: string;
  sourceRunId: string | null;
  count: number;
  minBatchSequence: number;
  maxBatchSequence: number;
  minObservedAt: Date;
  maxObservedAt: Date;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  batchId: string;
  batchSequence: number;
  observedAt: Date;
  sourceStatus: string;
  propertyMatchKind: string;
  sourceRunId: string | null;
}

interface ActiveBatchRow extends Record<string, unknown> {
  id: string;
  status: string;
  batchSequence: number;
  startedAt: Date | null;
}

interface JobStateRow extends ActiveBatchRow {
  jobState: string | null;
}

interface ActiveJobHandlingPlan {
  activeJobs: JobStateRow[];
  removableBeforeDbMutation: JobStateRow[];
  abortReasons: string[];
  warnings: string[];
}

interface StartedProcessingForcePlan {
  forced: ActiveBatchRow[];
  unexpected: ActiveBatchRow[];
  staleAllowedSequences: number[];
}

interface ReconcileCounts {
  inspected: number;
  updated: number;
  reconciled: number;
  nullCanonical: number;
  stillStale: number;
  duplicateMirrorFallbacks: number;
  failures: number;
}

interface QueueJobLike {
  getState(): Promise<string>;
}

interface QueueLike {
  getJob(jobId: string): Promise<QueueJobLike | null>;
  remove(jobId: string, options: { removeChildren: boolean }): Promise<number>;
  close(): Promise<unknown>;
}

function parseArgs(argv: string[]): CliOptions {
  let execute = false;
  let confirmRun: string | null = null;
  let forceSupersedeStartedProcessing = false;
  let forceStartedProcessingSequences: number[] = [];
  let confirmWorkerStopped = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--execute') {
      execute = true;
      continue;
    }

    if (arg === '--force-supersede-started-processing') {
      forceSupersedeStartedProcessing = true;
      continue;
    }

    if (arg === '--force-processing-sequences' || arg === '--force-started-processing-sequences') {
      forceStartedProcessingSequences = parseSequenceAllowlist(argv[index + 1] ?? null, arg);
      index += 1;
      continue;
    }

    if (arg === '--confirm-worker-stopped') {
      confirmWorkerStopped = true;
      continue;
    }

    if (arg === '--confirm-run') {
      confirmRun = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    execute,
    confirmRun,
    forceSupersedeStartedProcessing,
    forceStartedProcessingSequences,
    confirmWorkerStopped,
    help,
  };
}

function parseSequenceAllowlist(value: string | null, optionName: string): number[] {
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a comma-separated sequence list`);
  }

  const seen = new Set<number>();
  const sequences = value.split(',').map((part) => {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${optionName} only accepts positive integer sequences`);
    }

    const sequence = Number(trimmed);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error(`${optionName} only accepts positive integer sequences`);
    }

    if (seen.has(sequence)) {
      throw new Error(`${optionName} contains duplicate sequence ${sequence}`);
    }
    seen.add(sequence);
    return sequence;
  });

  if (sequences.length === 0) {
    throw new Error(`${optionName} requires a comma-separated sequence list`);
  }

  return sequences;
}

function getExecuteGateErrors(options: CliOptions): string[] {
  const errors: string[] = [];

  if (options.execute && options.confirmRun !== TARGET_RUN_ID) {
    errors.push(`--execute requires --confirm-run ${TARGET_RUN_ID}`);
  }

  if (options.execute && options.forceSupersedeStartedProcessing && !options.confirmWorkerStopped) {
    errors.push('--force-supersede-started-processing requires --confirm-worker-stopped');
  }

  if (options.execute && options.forceSupersedeStartedProcessing && options.forceStartedProcessingSequences.length === 0) {
    errors.push('--force-supersede-started-processing requires --force-started-processing-sequences with a non-empty exact allowlist');
  }

  return errors;
}

function planStartedProcessingForce(
  rows: ActiveBatchRow[],
  forceSupersedeStartedProcessing: boolean,
  allowedSequences: number[],
): StartedProcessingForcePlan {
  if (!forceSupersedeStartedProcessing) {
    return { forced: [], unexpected: rows, staleAllowedSequences: [] };
  }

  const allowedSequenceSet = new Set(allowedSequences);
  const presentSequenceSet = new Set(rows.map((row) => row.batchSequence));
  const staleAllowedSequences = allowedSequences.filter((sequence) => !presentSequenceSet.has(sequence));

  const plan = rows.reduce<StartedProcessingForcePlan>((accumulator, row) => {
    if (allowedSequenceSet.has(row.batchSequence)) {
      accumulator.forced.push(row);
    } else {
      accumulator.unexpected.push(row);
    }
    return accumulator;
  }, { forced: [], unexpected: [], staleAllowedSequences });

  return plan;
}

function planActiveJobHandling(
  jobStates: JobStateRow[],
  forceSupersedeStartedProcessing: boolean,
  forcedStartedBatchIds: string[],
  allowedSequences: number[],
): ActiveJobHandlingPlan {
  const activeJobs = jobStates.filter((row) => row.jobState === 'active');
  if (activeJobs.length === 0) {
    return {
      activeJobs: [],
      removableBeforeDbMutation: [],
      abortReasons: [],
      warnings: [],
    };
  }

  if (!forceSupersedeStartedProcessing) {
    return {
      activeJobs,
      removableBeforeDbMutation: [],
      abortReasons: [`Target run has ${activeJobs.length} active BullMQ ingest-batches jobs across f1dd batches`],
      warnings: [],
    };
  }

  const forcedStartedBatchIdSet = new Set(forcedStartedBatchIds);
  const activeStartedOutsideForce = activeJobs.filter((row) => (
    row.status === 'processing' &&
    row.startedAt !== null &&
    !forcedStartedBatchIdSet.has(row.id)
  ));

  if (activeStartedOutsideForce.length > 0) {
    return {
      activeJobs,
      removableBeforeDbMutation: [],
      abortReasons: [
        [
          `Target run has ${activeStartedOutsideForce.length} active started-processing BullMQ jobs outside force allowlist`,
          `allowed_sequences=${formatSequenceList(allowedSequences)}`,
        ].join(' '),
      ],
      warnings: [],
    };
  }

  return {
    activeJobs,
    removableBeforeDbMutation: activeJobs,
    abortReasons: [],
    warnings: [
      `Force path will attempt exact BullMQ Queue.remove for ${activeJobs.length} active f1dd jobs before DB mutation; BullMQ remove returns 0 for live locks and execute will abort.`,
    ],
  };
}

function formatSequenceList(sequences: number[]): string {
  return sequences.length > 0 ? sequences.join(',') : 'none';
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @huishype/api exec tsx src/scripts/reconcile-funda-f1dd-stale-observations.ts
  pnpm --filter @huishype/api exec tsx src/scripts/reconcile-funda-f1dd-stale-observations.ts -- --execute --confirm-run ${TARGET_RUN_ID}
  pnpm --filter @huishype/api exec tsx src/scripts/reconcile-funda-f1dd-stale-observations.ts -- --force-supersede-started-processing --force-started-processing-sequences 4,6,19
  pnpm --filter @huishype/api exec tsx src/scripts/reconcile-funda-f1dd-stale-observations.ts -- --execute --confirm-run ${TARGET_RUN_ID} --force-supersede-started-processing --confirm-worker-stopped --force-started-processing-sequences 4,6,19

Options:
  --execute                              Apply the reconciliation and supersede queued f1dd batches.
  --confirm-run ${TARGET_RUN_ID}         Required together with --execute.
  --force-supersede-started-processing  Also supersede explicitly allowlisted started processing sequences.
  --force-started-processing-sequences  Comma-separated exact allowlist for started processing sequences, e.g. 4,6,19.
  --force-processing-sequences          Alias for --force-started-processing-sequences.
  --confirm-worker-stopped              Required with the force flag in execute mode.
  --help                                 Show this help.

Default mode is a dry run. Passing the force flag and sequence allowlist in dry-run mode reports whether current started processing rows exactly match without mutating.`);
}

function printSection(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function formatDate(value: unknown): string {
  if (value == null) {
    return 'null';
  }

  const date = value instanceof Date || typeof value === 'string' || typeof value === 'number'
    ? new Date(value)
    : null;

  if (date && Number.isFinite(date.getTime())) {
    return date.toISOString();
  }

  return String(value);
}

function printJson(label: string, value: unknown): void {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

async function getRunMetadata(): Promise<RunMetadataRow | null> {
  const rows = await db.execute<RunMetadataRow>(sql`
    SELECT
      id,
      source_name AS "sourceName",
      upstream_run_key AS "upstreamRunKey",
      upstream_cursor_start AS "upstreamCursorStart",
      upstream_cursor_end AS "upstreamCursorEnd",
      started_at AS "startedAt",
      completed_at AS "completedAt",
      status,
      processed_batch_count AS "processedBatchCount",
      error_summary AS "errorSummary"
    FROM ingest_runs
    WHERE id = ${TARGET_RUN_ID}
  `);

  return Array.from(rows)[0] ?? null;
}

async function getCompletedBatchCounts(): Promise<BatchCountRow[]> {
  const rows = await db.execute<BatchCountRow>(sql`
    SELECT
      status,
      started_at IS NOT NULL AS started,
      COUNT(*)::int AS count,
      MIN(batch_sequence)::int AS "minSequence",
      MAX(batch_sequence)::int AS "maxSequence",
      COALESCE(SUM(ingested_count), 0)::int AS "ingestedCount",
      COALESCE(SUM(updated_count), 0)::int AS "updatedCount",
      COALESCE(SUM(skipped_count), 0)::int AS "skippedCount"
    FROM ingest_batches
    WHERE run_id = ${TARGET_RUN_ID}
      AND source_name = ${SOURCE_NAME}
      AND status = 'completed'
    GROUP BY status, started
    ORDER BY status, started
  `);

  return Array.from(rows);
}

async function getActiveRemainingBatchCounts(): Promise<BatchCountRow[]> {
  const rows = await db.execute<BatchCountRow>(sql`
    SELECT
      status,
      started_at IS NOT NULL AS started,
      COUNT(*)::int AS count,
      MIN(batch_sequence)::int AS "minSequence",
      MAX(batch_sequence)::int AS "maxSequence",
      COALESCE(SUM(ingested_count), 0)::int AS "ingestedCount",
      COALESCE(SUM(updated_count), 0)::int AS "updatedCount",
      COALESCE(SUM(skipped_count), 0)::int AS "skippedCount"
    FROM ingest_batches
    WHERE run_id = ${TARGET_RUN_ID}
      AND source_name = ${SOURCE_NAME}
      AND status IN ('accepted', 'queued', 'retryable', 'processing')
    GROUP BY status, started
    ORDER BY status, started
  `);

  return Array.from(rows);
}

async function getCandidateGroups(): Promise<CandidateGroupRow[]> {
  const rows = await db.execute<CandidateGroupRow>(sql`
    SELECT
      lo.origin,
      lo.source_status AS "sourceStatus",
      lo.property_match_kind AS "propertyMatchKind",
      lo.source_run_id AS "sourceRunId",
      COUNT(*)::int AS count,
      MIN(b.batch_sequence)::int AS "minBatchSequence",
      MAX(b.batch_sequence)::int AS "maxBatchSequence",
      MIN(lo.observed_at) AS "minObservedAt",
      MAX(lo.observed_at) AS "maxObservedAt"
    FROM listing_observations lo
    JOIN ingest_batches b ON b.id = lo.ingest_batch_id
    WHERE b.run_id = ${TARGET_RUN_ID}
      AND b.source_name = ${SOURCE_NAME}
      AND lo.source_name = ${SOURCE_NAME}
      AND b.status = 'completed'
      AND lo.stale_for_projection = true
      AND lo.origin = 'replay'
      AND lo.diagnostic_status IS NULL
      AND lo.source_status IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')
    GROUP BY lo.origin, lo.source_status, lo.property_match_kind, lo.source_run_id
    ORDER BY lo.origin, lo.source_status, lo.property_match_kind, lo.source_run_id NULLS FIRST
  `);

  return Array.from(rows);
}

async function getCandidates(): Promise<CandidateRow[]> {
  const rows = await db.execute<CandidateRow>(sql`
    SELECT
      lo.id,
      b.id AS "batchId",
      b.batch_sequence AS "batchSequence",
      lo.observed_at AS "observedAt",
      lo.source_status AS "sourceStatus",
      lo.property_match_kind AS "propertyMatchKind",
      lo.source_run_id AS "sourceRunId"
    FROM listing_observations lo
    JOIN ingest_batches b ON b.id = lo.ingest_batch_id
    WHERE b.run_id = ${TARGET_RUN_ID}
      AND b.source_name = ${SOURCE_NAME}
      AND lo.source_name = ${SOURCE_NAME}
      AND b.status = 'completed'
      AND lo.stale_for_projection = true
      AND lo.origin = 'replay'
      AND lo.diagnostic_status IS NULL
      AND lo.source_status IN ('available', 'sold', 'rented', 'withdrawn', 'not_found')
    ORDER BY b.batch_sequence, lo.observed_at, lo.id
  `);

  return Array.from(rows);
}

async function getStartedProcessingBatches(): Promise<ActiveBatchRow[]> {
  const rows = await db.execute<ActiveBatchRow>(sql`
    SELECT
      id,
      status,
      batch_sequence AS "batchSequence",
      started_at AS "startedAt"
    FROM ingest_batches
    WHERE run_id = ${TARGET_RUN_ID}
      AND source_name = ${SOURCE_NAME}
      AND status = 'processing'
      AND started_at IS NOT NULL
    ORDER BY started_at, batch_sequence, id
  `);

  return Array.from(rows);
}

async function getTargetRunBatches(): Promise<ActiveBatchRow[]> {
  const rows = await db.execute<ActiveBatchRow>(sql`
    SELECT
      id,
      status,
      batch_sequence AS "batchSequence",
      started_at AS "startedAt"
    FROM ingest_batches
    WHERE run_id = ${TARGET_RUN_ID}
      AND source_name = ${SOURCE_NAME}
    ORDER BY batch_sequence, id
  `);

  return Array.from(rows);
}

async function loadQueueConstructor(): Promise<new (name: string, options: Record<string, unknown>) => QueueLike> {
  const bullmqModule = await import('bullmq');
  return (bullmqModule.Queue ??
    (bullmqModule.default as { Queue?: unknown } | undefined)?.Queue) as new (
      name: string,
      options: Record<string, unknown>,
    ) => QueueLike;
}

async function createIngestBatchQueue(): Promise<QueueLike> {
  const QueueConstructor = await loadQueueConstructor();
  return new QueueConstructor(INGEST_BATCH_QUEUE, {
    connection: await getRedisConnection(),
  });
}

async function collectJobStates(batches: ActiveBatchRow[], warnings: string[]): Promise<JobStateRow[]> {
  if (batches.length === 0) {
    return [];
  }

  let queue: QueueLike | null = null;
  try {
    queue = await createIngestBatchQueue();
    const states: JobStateRow[] = [];

    for (const batch of batches) {
      const job = await queue.getJob(batch.id);
      const jobState = job ? await job.getState() : null;
      states.push({ ...batch, jobState });
    }

    return states;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to read BullMQ job states: ${message}`);
    return batches.map((batch) => ({ ...batch, jobState: null }));
  } finally {
    await queue?.close();
  }
}

function summarizeJobStates(rows: JobStateRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.jobState ?? 'missing';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function printBatchCounts(rows: BatchCountRow[]): void {
  if (rows.length === 0) {
    console.log('No rows.');
    return;
  }

  for (const row of rows) {
    console.log([
      `status=${row.status}`,
      `started=${row.started}`,
      `count=${row.count}`,
      `sequence=${row.minSequence ?? 'null'}..${row.maxSequence ?? 'null'}`,
      `ingested=${row.ingestedCount}`,
      `updated=${row.updatedCount}`,
      `skipped=${row.skippedCount}`,
    ].join(' '));
  }
}

function printCandidateGroups(rows: CandidateGroupRow[]): void {
  if (rows.length === 0) {
    console.log('No stale observation candidates.');
    return;
  }

  for (const row of rows) {
    console.log([
      `origin=${row.origin}`,
      `source_status=${row.sourceStatus}`,
      `property_match_kind=${row.propertyMatchKind}`,
      `source_run_id=${row.sourceRunId ?? 'null'}`,
      `count=${row.count}`,
      `batch_sequence=${row.minBatchSequence}..${row.maxBatchSequence}`,
      `observed_at=${formatDate(row.minObservedAt)}..${formatDate(row.maxObservedAt)}`,
    ].join(' '));
  }
}

function printJobStates(rows: JobStateRow[]): void {
  printJson('State counts', summarizeJobStates(rows));
  for (const row of rows.slice(0, 25)) {
    console.log([
      `batch=${row.id}`,
      `status=${row.status}`,
      `sequence=${row.batchSequence}`,
      `started_at=${formatDate(row.startedAt)}`,
      `job_state=${row.jobState ?? 'missing'}`,
    ].join(' '));
  }
  if (rows.length > 25) {
    console.log(`... ${rows.length - 25} more batches omitted`);
  }
}

function printStartedProcessingForcePlan(rows: ActiveBatchRow[], label: string): void {
  if (rows.length === 0) {
    console.log(`${label}: none`);
    return;
  }

  console.log(`${label}:`);
  for (const row of rows) {
    console.log([
      `batch=${row.id}`,
      `sequence=${row.batchSequence}`,
      `status=${row.status}`,
      `started_at=${formatDate(row.startedAt)}`,
    ].join(' '));
  }
}

async function supersedeRemainingBatches(
  forcedStartedBatchIds: string[],
  forcedStartedSequences: number[],
): Promise<string[]> {
  const forcedStartedBatchIdFilter = forcedStartedBatchIds.length > 0
    ? sql`OR (
        id IN (${sql.join(forcedStartedBatchIds.map((id) => sql`${id}`), sql`, `)})
        AND batch_sequence IN (${sql.join(forcedStartedSequences.map((sequence) => sql`${sequence}`), sql`, `)})
        AND status = 'processing'
        AND started_at IS NOT NULL
      )`
    : sql``;

  const rows = await db.execute<{ id: string }>(sql`
    UPDATE ingest_batches
    SET
      status = 'superseded'::ingest_batch_status,
      completed_at = COALESCE(completed_at, NOW()),
      error_json = jsonb_build_object(
        'message', 'Superseded by one-off f1dd stale observation reconciliation',
        'runId', ${TARGET_RUN_ID}::text,
        'script', ${SCRIPT_NAME}::text,
        'previousStatus', status,
        'sequence', batch_sequence,
        'previousStartedAt', started_at,
        'forceSupersedeStartedProcessing', status = 'processing' AND started_at IS NOT NULL
      )
    WHERE run_id = ${TARGET_RUN_ID}
      AND source_name = ${SOURCE_NAME}
      AND (
        status IN ('accepted', 'queued', 'retryable')
        OR (status = 'processing' AND started_at IS NULL)
        ${forcedStartedBatchIdFilter}
      )
    RETURNING id
  `);

  const supersededBatchIds = Array.from(rows, (row) => row.id);
  const supersededBatchIdSet = new Set(supersededBatchIds);
  const missingForcedBatchIds = forcedStartedBatchIds.filter((batchId) => !supersededBatchIdSet.has(batchId));
  if (missingForcedBatchIds.length > 0) {
    throw new Error(`Forced started processing batches no longer matched guarded update predicates: ${missingForcedBatchIds.join(', ')}`);
  }

  return supersededBatchIds;
}

async function removeJobsByExactId(
  batchIds: string[],
  context: string,
): Promise<{ removed: string[]; warnings: string[] }> {
  if (batchIds.length === 0) {
    return { removed: [], warnings: [] };
  }

  const removed: string[] = [];
  const warnings: string[] = [];
  const queue = await createIngestBatchQueue();

  try {
    for (const batchId of batchIds) {
      const job = await queue.getJob(batchId);
      if (!job) {
        warnings.push(`BullMQ job missing ${context}: ${batchId}`);
        continue;
      }

      const removeCount = await queue.remove(batchId, { removeChildren: true });
      if (removeCount === 0) {
        const postRemoveJob = await queue.getJob(batchId);
        if (!postRemoveJob) {
          warnings.push(`BullMQ Queue.remove returned 0 but job is now missing ${context}: ${batchId}`);
          continue;
        }

        const postRemoveState = await postRemoveJob.getState();
        throw new Error(`BullMQ Queue.remove returned 0 and job still exists ${context}: ${batchId} state=${postRemoveState}`);
      }

      removed.push(batchId);
    }
  } finally {
    await queue.close();
  }

  return { removed, warnings };
}

function candidateGuard(candidate: CandidateRow) {
  return and(
    eq(schema.listingObservations.id, candidate.id),
    eq(schema.listingObservations.sourceName, SOURCE_NAME),
    eq(schema.listingObservations.staleForProjection, true),
    eq(schema.listingObservations.origin, 'replay'),
    isNull(schema.listingObservations.diagnosticStatus),
    sql`${schema.listingObservations.sourceStatus} IN (${sql.join(
      PROJECTABLE_SOURCE_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )})`,
    sql`EXISTS (
      SELECT 1
      FROM ingest_batches b
      WHERE b.id = ${schema.listingObservations.ingestBatchId}
        AND b.run_id = ${TARGET_RUN_ID}
        AND b.source_name = ${SOURCE_NAME}
        AND b.status = 'completed'
    )`,
  );
}

function errorCause(error: unknown): unknown {
  return error instanceof Error && 'cause' in error ? error.cause : null;
}

function isDuplicateMirrorObservationError(error: unknown): boolean {
  const cause = errorCause(error);
  if (!cause || typeof cause !== 'object') return false;

  const constraintName = (cause as { constraint_name?: unknown }).constraint_name;
  return constraintName === 'listing_observations_mirror_idempotency_idx'
    || constraintName === 'listing_observations_source_url_evidence_idx';
}

function formatErrorForSample(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = errorCause(error);
  if (!cause || typeof cause !== 'object') return message;

  const parts: string[] = [];
  const code = (cause as { code?: unknown }).code;
  const constraintName = (cause as { constraint_name?: unknown }).constraint_name;
  const detail = (cause as { detail?: unknown }).detail;
  if (typeof code === 'string') parts.push(`code=${code}`);
  if (typeof constraintName === 'string') parts.push(`constraint=${constraintName}`);
  if (typeof detail === 'string') parts.push(`detail=${detail}`);

  return parts.length > 0 ? `${message} cause(${parts.join(' ')})` : message;
}

async function reconcileCandidateWithMode(
  candidate: CandidateRow,
  mode: 'promote-to-mirror' | 'clear-stale-only',
): Promise<'reconciled' | 'null' | 'still-stale' | 'duplicate-fallback'> {
  return db.transaction(async (tx) => {
    const set = mode === 'promote-to-mirror'
      ? {
          staleForProjection: false,
          origin: 'mirror' as const,
        }
      : {
          staleForProjection: false,
        };

    const [updated] = await tx
      .update(schema.listingObservations)
      .set(set)
      .where(candidateGuard(candidate))
      .returning({ id: schema.listingObservations.id });

    if (!updated) {
      throw new Error(`Candidate ${candidate.id} no longer matched guarded update predicates`);
    }

    const canonical = await reconcileListingObservation(updated.id, tx);
    const [postReconcile] = await tx
      .select({ staleForProjection: schema.listingObservations.staleForProjection })
      .from(schema.listingObservations)
      .where(eq(schema.listingObservations.id, updated.id))
      .limit(1);

    if (!postReconcile) {
      throw new Error(`Candidate ${candidate.id} disappeared after reconciliation`);
    }

    if (postReconcile.staleForProjection) {
      return 'still-stale';
    }

    if (mode === 'clear-stale-only') {
      return 'duplicate-fallback';
    }

    return canonical ? 'reconciled' : 'null';
  });
}

async function reconcileCandidate(candidate: CandidateRow): Promise<'reconciled' | 'null' | 'still-stale' | 'duplicate-fallback'> {
  try {
    return await reconcileCandidateWithMode(candidate, 'promote-to-mirror');
  } catch (error) {
    if (!isDuplicateMirrorObservationError(error)) {
      throw error;
    }

    return reconcileCandidateWithMode(candidate, 'clear-stale-only');
  }
}

async function reconcileCandidates(candidates: CandidateRow[]): Promise<ReconcileCounts & { failureSamples: string[] }> {
  const counts: ReconcileCounts & { failureSamples: string[] } = {
    inspected: candidates.length,
    updated: 0,
    reconciled: 0,
    nullCanonical: 0,
    stillStale: 0,
    duplicateMirrorFallbacks: 0,
    failures: 0,
    failureSamples: [],
  };

  for (const candidate of candidates) {
    try {
      const result = await reconcileCandidate(candidate);
      counts.updated += 1;
      if (result === 'reconciled') {
        counts.reconciled += 1;
      } else if (result === 'null') {
        counts.nullCanonical += 1;
      } else if (result === 'duplicate-fallback') {
        counts.duplicateMirrorFallbacks += 1;
        counts.reconciled += 1;
      } else {
        counts.stillStale += 1;
      }
    } catch (error) {
      counts.failures += 1;
      if (counts.failureSamples.length < 10) {
        counts.failureSamples.push(`${candidate.id}: ${formatErrorForSample(error)}`);
      }
    }
  }

  return counts;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const executeGateErrors = getExecuteGateErrors(options);
  if (executeGateErrors.length > 0) {
    throw new Error(executeGateErrors.join('; '));
  }

  const warnings: string[] = [];
  const abortReasons: string[] = [];

  console.log(`${SCRIPT_NAME}`);
  console.log(`Mode: ${options.execute ? 'execute' : 'dry-run'}`);
  console.log(`Target run: ${TARGET_RUN_ID}`);
  console.log(`Force started processing: ${options.forceSupersedeStartedProcessing ? 'yes' : 'no'}`);
  console.log(`Force started processing sequences: ${formatSequenceList(options.forceStartedProcessingSequences)}`);
  console.log(`Worker stopped confirmed: ${options.confirmWorkerStopped ? 'yes' : 'no'}`);

  const run = await getRunMetadata();
  if (!run) {
    throw new Error(`Target ingest_runs row not found: ${TARGET_RUN_ID}`);
  }
  if (run.sourceName !== SOURCE_NAME) {
    throw new Error(`Target ingest_runs row has source_name=${run.sourceName}, expected ${SOURCE_NAME}`);
  }

  printSection('Run Metadata');
  printJson('Run', {
    id: run.id,
    sourceName: run.sourceName,
    upstreamRunKey: run.upstreamRunKey,
    upstreamCursorStart: run.upstreamCursorStart,
    upstreamCursorEnd: run.upstreamCursorEnd,
    startedAt: formatDate(run.startedAt),
    completedAt: formatDate(run.completedAt),
    status: run.status,
    processedBatchCount: run.processedBatchCount,
    errorSummary: run.errorSummary,
  });

  const completedBatchCounts = await getCompletedBatchCounts();
  printSection('Completed Batch Counts');
  printBatchCounts(completedBatchCounts);

  const candidateGroups = await getCandidateGroups();
  const candidates = await getCandidates();
  printSection('Stale Observation Candidates');
  printCandidateGroups(candidateGroups);
  console.log(`Candidate total: ${candidates.length}`);

  const activeRemainingBatchCounts = await getActiveRemainingBatchCounts();
  printSection('Active Remaining Batch Counts');
  printBatchCounts(activeRemainingBatchCounts);

  const startedProcessingBatches = await getStartedProcessingBatches();
  const startedProcessingForcePlan = planStartedProcessingForce(
    startedProcessingBatches,
    options.forceSupersedeStartedProcessing,
    options.forceStartedProcessingSequences,
  );

  if (startedProcessingBatches.length > 0) {
    if (!options.forceSupersedeStartedProcessing) {
      abortReasons.push(`Target run has ${startedProcessingBatches.length} processing batches with started_at IS NOT NULL`);
    } else if (startedProcessingForcePlan.unexpected.length > 0) {
      abortReasons.push([
        `Target run has ${startedProcessingForcePlan.unexpected.length} started processing batches outside force allowlist`,
        `allowed_sequences=${formatSequenceList(options.forceStartedProcessingSequences)}`,
      ].join(' '));
    }

    for (const batch of startedProcessingBatches.slice(0, 10)) {
      warnings.push(`Started processing batch: ${batch.id} sequence=${batch.batchSequence} started_at=${formatDate(batch.startedAt)}`);
    }
  }
  if (options.forceSupersedeStartedProcessing && options.forceStartedProcessingSequences.length === 0) {
    abortReasons.push('Force started processing path requires a non-empty explicit sequence allowlist');
  }
  if (startedProcessingForcePlan.staleAllowedSequences.length > 0) {
    abortReasons.push([
      'Force started processing allowlist contains sequences not currently present as started processing',
      `stale_sequences=${formatSequenceList(startedProcessingForcePlan.staleAllowedSequences)}`,
    ].join(' '));
  }

  printSection('Force Started Processing Plan');
  console.log(`Supplied force sequence allowlist: ${formatSequenceList(options.forceStartedProcessingSequences)}`);
  console.log(`Stale allowlist sequences not currently started processing: ${formatSequenceList(startedProcessingForcePlan.staleAllowedSequences)}`);
  printStartedProcessingForcePlan(startedProcessingForcePlan.forced, 'Allowlisted started processing rows included by force');
  printStartedProcessingForcePlan(startedProcessingForcePlan.unexpected, 'Started processing rows outside force allowlist');
  if (options.forceSupersedeStartedProcessing && !options.execute) {
    warnings.push('Force flag is in dry-run mode only. Allowlisted started processing rows above would be included, but no mutation will be applied.');
  }

  const targetRunBatches = await getTargetRunBatches();
  const jobStates = await collectJobStates(targetRunBatches, warnings);
  const jobStateReadFailed = warnings.some((warning) => warning.startsWith('Failed to read BullMQ job states:'));
  printSection('BullMQ Job States For All F1dd Batches');
  printJobStates(jobStates);

  const activeJobHandlingPlan = planActiveJobHandling(
    jobStates,
    options.forceSupersedeStartedProcessing,
    startedProcessingForcePlan.forced.map((batch) => batch.id),
    options.forceStartedProcessingSequences,
  );
  abortReasons.push(...activeJobHandlingPlan.abortReasons);
  warnings.push(...activeJobHandlingPlan.warnings);

  if (options.execute && jobStateReadFailed) {
    abortReasons.push('BullMQ job states could not be read before execute');
  }

  if (!options.execute) {
    warnings.push(`Dry run only. Pass --execute --confirm-run ${TARGET_RUN_ID} to mutate.`);
  }

  printSection('Abort And Warning Summary');
  printJson('Abort reasons', abortReasons);
  printJson('Warnings', warnings);

  if (options.execute && abortReasons.length > 0) {
    throw new Error('Refusing to execute because abort conditions are present');
  }

  if (!options.execute) {
    return;
  }

  const removedActiveJobs = await removeJobsByExactId(
    activeJobHandlingPlan.removableBeforeDbMutation.map((job) => job.id),
    'before DB mutation',
  );
  const removedActiveJobIdSet = new Set(removedActiveJobs.removed);
  printSection('Execute: Remove Active BullMQ Jobs Before DB Mutation');
  console.log(`Removed active BullMQ jobs: ${removedActiveJobs.removed.length}`);
  for (const batchId of removedActiveJobs.removed.slice(0, 25)) {
    const job = activeJobHandlingPlan.removableBeforeDbMutation.find((row) => row.id === batchId);
    console.log(`  - ${batchId} status=${job?.status ?? 'unknown'} sequence=${job?.batchSequence ?? 'unknown'}`);
  }
  if (removedActiveJobs.removed.length > 25) {
    console.log(`  ... ${removedActiveJobs.removed.length - 25} more`);
  }
  if (removedActiveJobs.warnings.length > 0) {
    printJson('Active job removal warnings', removedActiveJobs.warnings);
  }

  printSection('Execute: Supersede Remaining Batches');
  const supersededBatchIds = await supersedeRemainingBatches(
    startedProcessingForcePlan.forced.map((batch) => batch.id),
    options.forceStartedProcessingSequences,
  );
  console.log(`Superseded batches: ${supersededBatchIds.length}`);
  for (const batchId of supersededBatchIds.slice(0, 25)) {
    console.log(`  - ${batchId}`);
  }
  if (supersededBatchIds.length > 25) {
    console.log(`  ... ${supersededBatchIds.length - 25} more`);
  }

  const removedJobs = await removeJobsByExactId(
    supersededBatchIds.filter((batchId) => !removedActiveJobIdSet.has(batchId)),
    'after DB supersede',
  );
  console.log(`Removed BullMQ jobs: ${removedJobs.removed.length}`);
  if (removedJobs.warnings.length > 0) {
    printJson('Job removal warnings', removedJobs.warnings);
  }

  printSection('Execute: Reconcile Candidates');
  const reconcileCounts = await reconcileCandidates(candidates);
  printJson('Reconcile counts', reconcileCounts);
  if (reconcileCounts.failures > 0) {
    throw new Error(`Reconciliation completed with ${reconcileCounts.failures} failures`);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      if (error instanceof Error && 'cause' in error && error.cause) {
        console.error('Cause:', error.cause);
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedisConnection();
      await closeConnection();
    });
}

export {
  formatDate,
  getExecuteGateErrors,
  parseArgs,
  planActiveJobHandling,
  planStartedProcessingForce,
};

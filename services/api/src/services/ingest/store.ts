import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, ingestBatches, ingestRuns, ingestSources, type DbTransaction } from '../../db/index.js';
import { ingestBatchRequestSchema, type IngestBatchRequest, type IngestWatermarkResponse } from './contracts.js';
import {
  encodeOpaqueIngestCursor,
  isOpaqueIngestCursorAtOrBefore,
} from './cursor.js';
import { IngestIdempotencyConflictError } from './errors.js';

type BatchRow = typeof ingestBatches.$inferSelect;
type BatchStatus = BatchRow['status'];
type RunRow = typeof ingestRuns.$inferSelect;
type RunStatus = RunRow['status'];

export interface AcceptedIngestBatchRecord {
  batchId: string;
  runId: string | null;
  sourceName: string;
  acceptedAt: string;
  idempotencyKey: string;
  status: BatchStatus;
  duplicate: boolean;
}

export interface SweepDispatchResult {
  staleProcessingBatchIds: string[];
  recoverableBatchIds: string[];
  maintenancePending: boolean;
}

export interface IngestRunLifecycleResult {
  runId: string;
  sourceName: string;
  status: RunStatus;
  processedBatchCount: number;
  completedAt: string | null;
  errorSummary: Record<string, unknown> | null;
}

export interface MaintenanceRefreshRequestRecord {
  batchId: string;
  sourceName: string;
  maintenanceRequestedAt: string;
}

export interface SkippedBatchRecoveryCandidate {
  id: string;
  sourceName: string;
  payload: IngestBatchRequest;
  ingestedCount: number;
  updatedCount: number;
  skippedCount: number;
  maintenanceRequestedAt: string | null;
  maintenanceCompletedAt: string | null;
}

export interface BlockedSourceBatchAtWatermark {
  id: string;
  sourceName: string;
  previousStatus: BatchStatus;
  status: BatchStatus;
  cursorStart: string | null;
  cursorEnd: string;
  runId: string | null;
  batchSequence: number;
  receivedAt: string;
}

interface SupersededBatchCandidate {
  [key: string]: unknown;
  id: string;
  cursor_end: string;
  last_committed_cursor: string | null;
  last_committed_changed_at: Date | string | null;
  last_committed_listing_key: string | null;
}

interface SupersededBatchRow {
  [key: string]: unknown;
  id: string;
  run_id: string | null;
  source_name: string;
}

function sourceCursorBoundBatchPredicate(): ReturnType<typeof sql> {
  return sql`
    NOT (b.payload_json ? 'requestedBy')
    AND COALESCE(b.payload_json->>'scopeKey', '') <> 'candidate'
  `;
}

interface SkippedBatchRecoveryCandidateRow {
  [key: string]: unknown;
  id: string;
  source_name: string;
  payload_json: Record<string, unknown>;
  ingested_count: number;
  updated_count: number;
  skipped_count: number;
  maintenance_requested_at: Date | string | null;
  maintenance_completed_at: Date | string | null;
}

interface BlockedSourceBatchAtWatermarkRow {
  [key: string]: unknown;
  id: string;
  source_name: string;
  previous_status: BatchStatus;
  status: BatchStatus;
  cursor_start: string | null;
  cursor_end: string;
  run_id: string | null;
  batch_sequence: number;
  received_at: Date | string;
}

export const SKIPPED_BATCH_RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;

function toIsoString(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(objectValue[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown ingest run failure',
  };
}

function mapSkippedBatchRecoveryCandidate(row: SkippedBatchRecoveryCandidateRow): SkippedBatchRecoveryCandidate {
  return {
    id: row.id,
    sourceName: row.source_name,
    payload: ingestBatchRequestSchema.parse(row.payload_json),
    ingestedCount: row.ingested_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    maintenanceRequestedAt: toIsoString(row.maintenance_requested_at),
    maintenanceCompletedAt: toIsoString(row.maintenance_completed_at),
  };
}

function mapBlockedSourceBatchAtWatermark(row: BlockedSourceBatchAtWatermarkRow): BlockedSourceBatchAtWatermark {
  return {
    id: row.id,
    sourceName: row.source_name,
    previousStatus: row.previous_status,
    status: row.status,
    cursorStart: row.cursor_start,
    cursorEnd: row.cursor_end,
    runId: row.run_id,
    batchSequence: row.batch_sequence,
    receivedAt: toIsoString(row.received_at) as string,
  };
}

function isCursorAtOrBeforeCommittedWatermark(candidate: SupersededBatchCandidate): boolean {
  if (!candidate.last_committed_cursor) {
    return false;
  }

  if (candidate.cursor_end === candidate.last_committed_cursor) {
    return true;
  }

  try {
    return isOpaqueIngestCursorAtOrBefore(candidate.cursor_end, candidate.last_committed_cursor);
  } catch {
    return false;
  }
}

function hasProjectionEvidencePredicate(alias = sql`b`): ReturnType<typeof sql> {
  return sql`(
    (
      jsonb_typeof(${alias}.payload_json->'listings') = 'array'
      AND jsonb_array_length(${alias}.payload_json->'listings') > 0
    )
    OR (
      jsonb_typeof(${alias}.payload_json->'completions') = 'array'
      AND jsonb_array_length(${alias}.payload_json->'completions') > 0
    )
  )`;
}

async function ensureRun(
  tx: DbTransaction,
  request: IngestBatchRequest,
): Promise<{ runId: string; startedAt: Date } | null> {
  if (!request.upstreamRunKey) {
    return null;
  }

  const runRows = await tx.execute<{ id: string; started_at: Date }>(sql`
    INSERT INTO ingest_runs (
      source_name,
      upstream_run_key,
      upstream_cursor_start,
      upstream_cursor_end
    )
    VALUES (
      ${request.sourceName},
      ${request.upstreamRunKey},
      ${request.cursorStart},
      ${request.cursorEnd}
    )
    ON CONFLICT (source_name, upstream_run_key)
    DO UPDATE SET
      upstream_cursor_start = COALESCE(ingest_runs.upstream_cursor_start, EXCLUDED.upstream_cursor_start),
      upstream_cursor_end = EXCLUDED.upstream_cursor_end
    RETURNING id, started_at
  `);

  const run = Array.from(runRows)[0];
  return run ? { runId: run.id, startedAt: new Date(run.started_at) } : null;
}

async function touchSourceRunState(
  tx: DbTransaction,
  request: IngestBatchRequest,
  run: { runId: string; startedAt: Date } | null,
): Promise<void> {
  if (!request.upstreamRunKey || !run) {
    await tx.execute(sql`
      INSERT INTO ingest_sources (source_name)
      VALUES (${request.sourceName})
      ON CONFLICT (source_name) DO NOTHING
    `);
    return;
  }

  await tx.execute(sql`
    INSERT INTO ingest_sources (
      source_name,
      last_run_started_at,
      last_run_completed_at,
      last_run_status
    )
    VALUES (
      ${request.sourceName},
      ${run.startedAt.toISOString()},
      NULL,
      'in_progress'::ingest_run_status
    )
    ON CONFLICT (source_name)
    DO UPDATE SET
      last_run_started_at = CASE
        WHEN ingest_sources.last_run_started_at IS NULL
          OR ingest_sources.last_run_started_at < EXCLUDED.last_run_started_at
        THEN EXCLUDED.last_run_started_at
        ELSE ingest_sources.last_run_started_at
      END,
      last_run_completed_at = NULL,
      last_run_status = 'in_progress'::ingest_run_status
  `);
}

export async function finalizeIngestRunLifecycle(
  tx: DbTransaction,
  run: { runId: string; sourceName: string },
  terminalBatchId: string,
  terminalError?: unknown,
): Promise<IngestRunLifecycleResult | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${run.sourceName}))`);

  const runRows = await tx
    .select()
    .from(ingestRuns)
    .where(eq(ingestRuns.id, run.runId))
    .limit(1);

  const runRow = runRows[0];
  if (!runRow) {
    return null;
  }
  const runStartedAt = runRow.startedAt;
  const sourceRows = await tx
    .select()
    .from(ingestSources)
    .where(eq(ingestSources.sourceName, run.sourceName))
    .limit(1);
  const sourceRow = sourceRows[0];

  const counts = await tx.execute<{
    total_batch_count: number;
    completed_batch_count: number;
    superseded_batch_count: number;
    failed_batch_count: number;
    active_batch_count: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS total_batch_count,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_batch_count,
      COUNT(*) FILTER (WHERE status = 'superseded')::int AS superseded_batch_count,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_batch_count,
      COUNT(*) FILTER (WHERE status IN ('accepted', 'queued', 'processing', 'retryable'))::int AS active_batch_count
    FROM ingest_batches
    WHERE run_id = ${run.runId}
  `);

  const batchCounts = Array.from(counts)[0] ?? {
    total_batch_count: 0,
    completed_batch_count: 0,
    superseded_batch_count: 0,
    failed_batch_count: 0,
    active_batch_count: 0,
  };

  const processedBatchCount =
    batchCounts.completed_batch_count +
    batchCounts.superseded_batch_count +
    batchCounts.failed_batch_count;
  const nextStatus: RunStatus =
    batchCounts.failed_batch_count > 0
      ? 'failed'
      : batchCounts.active_batch_count === 0
        ? 'completed'
        : 'in_progress';
  const now = new Date();

  if (runRow.processedBatchCount !== processedBatchCount) {
    await tx
      .update(ingestRuns)
      .set({ processedBatchCount })
      .where(eq(ingestRuns.id, run.runId));
  }

  const canFinalizeSource =
    nextStatus !== 'in_progress' &&
    runRow.sourceName === run.sourceName &&
    (sourceRow == null ||
      sourceRow.lastRunStartedAt == null ||
      sourceRow.lastRunStartedAt <= runStartedAt);

  if (nextStatus === 'failed') {
    if (runRow.status !== 'failed') {
      await tx
        .update(ingestRuns)
        .set({
          status: 'failed',
          completedAt: now,
          errorSummary: {
            terminalBatchId,
            sourceName: run.sourceName,
            runId: run.runId,
            status: 'failed',
            processedBatchCount,
            totalBatchCount: batchCounts.total_batch_count,
            completedBatchCount: batchCounts.completed_batch_count,
            supersededBatchCount: batchCounts.superseded_batch_count,
            failedBatchCount: batchCounts.failed_batch_count,
            activeBatchCount: batchCounts.active_batch_count,
            terminalError: serializeError(terminalError),
          },
        })
        .where(eq(ingestRuns.id, run.runId));
    }
  } else if (nextStatus === 'completed') {
    if (runRow.status !== 'completed' && runRow.status !== 'failed') {
      await tx
        .update(ingestRuns)
        .set({
          status: 'completed',
          completedAt: now,
          errorSummary: null,
        })
        .where(eq(ingestRuns.id, run.runId));
    }
  }

  if (canFinalizeSource) {
    await tx
      .update(ingestSources)
      .set({
        lastRunCompletedAt: now,
        lastRunStatus: nextStatus,
      })
      .where(
        and(
          eq(ingestSources.sourceName, run.sourceName),
          sql`${ingestSources.lastRunStartedAt} IS NULL OR ${ingestSources.lastRunStartedAt} <= ${runStartedAt.toISOString()}`,
        ),
      );
  }

  return {
    runId: run.runId,
    sourceName: run.sourceName,
    status: nextStatus,
    processedBatchCount,
    completedAt: nextStatus === 'in_progress' ? null : now.toISOString(),
    errorSummary:
      nextStatus === 'failed'
        ? {
            terminalBatchId,
            sourceName: run.sourceName,
            runId: run.runId,
            status: 'failed',
            processedBatchCount,
            totalBatchCount: batchCounts.total_batch_count,
            completedBatchCount: batchCounts.completed_batch_count,
            supersededBatchCount: batchCounts.superseded_batch_count,
            failedBatchCount: batchCounts.failed_batch_count,
            activeBatchCount: batchCounts.active_batch_count,
            terminalError: serializeError(terminalError),
          }
        : null,
  };
}

async function markSupersededBatchesAfterWatermark(limit: number): Promise<SupersededBatchRow[]> {
  const candidates = await db.execute<SupersededBatchCandidate>(sql`
    SELECT
      b.id,
      b.cursor_end,
      s.last_committed_cursor,
      s.last_committed_changed_at,
      s.last_committed_listing_key
    FROM ingest_batches b
    INNER JOIN ingest_sources s ON s.source_name = b.source_name
    WHERE (
        b.status IN ('accepted', 'queued', 'retryable')
        OR (b.status = 'processing' AND b.started_at IS NULL)
      )
      AND s.last_committed_cursor IS NOT NULL
      AND ${sourceCursorBoundBatchPredicate()}
      AND NOT ${hasProjectionEvidencePredicate()}
    ORDER BY b.received_at, b.batch_sequence, b.id
    LIMIT ${limit}
  `);

  const supersededIds = Array.from(candidates)
    .filter((candidate) => isCursorAtOrBeforeCommittedWatermark(candidate))
    .map((candidate) => candidate.id);

  if (supersededIds.length === 0) {
    return [];
  }

  return Array.from(await db.execute<SupersededBatchRow>(sql`
    UPDATE ingest_batches
    SET
      status = 'superseded'::ingest_batch_status,
      completed_at = COALESCE(completed_at, NOW()),
      error_json = jsonb_build_object('message', 'Superseded by committed ingest watermark')
    WHERE id IN (${sql.join(supersededIds.map((id) => sql`${id}`), sql`, `)})
      AND (
        status IN ('accepted', 'queued', 'retryable')
        OR (status = 'processing' AND started_at IS NULL)
      )
    RETURNING id, run_id, source_name
  `));
}

async function listStaleEvidenceBatchIdsAfterWatermark(limit: number): Promise<string[]> {
  const candidates = await db.execute<SupersededBatchCandidate>(sql`
    SELECT
      b.id,
      b.cursor_end,
      s.last_committed_cursor,
      s.last_committed_changed_at,
      s.last_committed_listing_key
    FROM ingest_batches b
    INNER JOIN ingest_sources s ON s.source_name = b.source_name
    WHERE (
        b.status IN ('accepted', 'queued', 'retryable')
        OR (b.status = 'processing' AND b.started_at IS NULL)
      )
      AND s.last_committed_cursor IS NOT NULL
      AND ${sourceCursorBoundBatchPredicate()}
      AND ${hasProjectionEvidencePredicate()}
    ORDER BY b.received_at, b.batch_sequence, b.id
    LIMIT ${Math.max(limit * 10, 100)}
  `);

  return Array.from(candidates)
    .filter((candidate) => isCursorAtOrBeforeCommittedWatermark(candidate))
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

async function finalizeSupersededRunLifecycles(rows: SupersededBatchRow[]): Promise<void> {
  const terminalRowsByRun = new Map<string, SupersededBatchRow>();

  for (const row of rows) {
    if (row.run_id && !terminalRowsByRun.has(row.run_id)) {
      terminalRowsByRun.set(row.run_id, row);
    }
  }

  for (const row of terminalRowsByRun.values()) {
    await db.transaction(async (tx) => {
      await finalizeIngestRunLifecycle(
        tx,
        {
          runId: row.run_id as string,
          sourceName: row.source_name,
        },
        row.id,
      );
    });
  }
}

export async function acceptIngestBatch(
  request: IngestBatchRequest,
): Promise<AcceptedIngestBatchRecord> {
  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(ingestBatches)
      .where(
        and(
          eq(ingestBatches.sourceName, request.sourceName),
          eq(ingestBatches.idempotencyKey, request.idempotencyKey),
        ),
      )
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      const payloadMatches =
        stableJson(existing.payloadJson) === stableJson(request) &&
        existing.cursorStart === request.cursorStart &&
        existing.cursorEnd === request.cursorEnd &&
        existing.batchSequence === request.batchSequence;

      if (!payloadMatches) {
        throw new IngestIdempotencyConflictError(
          `Idempotency key ${request.idempotencyKey} is already bound to a different ingest batch`,
        );
      }

      return {
        batchId: existing.id,
        runId: existing.runId,
        sourceName: existing.sourceName,
        acceptedAt: existing.receivedAt.toISOString(),
        idempotencyKey: existing.idempotencyKey,
        status: existing.status,
        duplicate: true,
      };
    }

    const run = await ensureRun(tx, request);
    await touchSourceRunState(tx, request, run);

    const insertedRows = await tx
      .insert(ingestBatches)
      .values({
        runId: run?.runId ?? null,
        sourceName: request.sourceName,
        batchSequence: request.batchSequence,
        idempotencyKey: request.idempotencyKey,
        cursorStart: request.cursorStart,
        cursorEnd: request.cursorEnd,
        payloadJson: request as unknown as Record<string, unknown>,
        status: 'accepted',
      })
      .returning();

    const inserted = insertedRows[0];

    return {
      batchId: inserted.id,
      runId: inserted.runId,
      sourceName: inserted.sourceName,
      acceptedAt: inserted.receivedAt.toISOString(),
      idempotencyKey: inserted.idempotencyKey,
      status: inserted.status,
      duplicate: false,
    };
  });
}

export async function createMaintenanceRefreshRequest(
  tx: DbTransaction,
  request: {
    sourceName: string;
    requestedBy: 'listing-submit' | 'official-valuation';
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<MaintenanceRefreshRequestRecord> {
  const requestedAt = new Date();
  const cursorEnd = encodeOpaqueIngestCursor({
    changedAt: requestedAt.toISOString(),
    listingKey: request.idempotencyKey,
  });

  const rows = await tx
    .insert(ingestBatches)
    .values({
      runId: null,
      sourceName: request.sourceName,
      batchSequence: 0,
      idempotencyKey: request.idempotencyKey,
      cursorStart: null,
      cursorEnd,
      payloadJson: {
        requestedBy: request.requestedBy,
        ...request.payload,
      },
      status: 'completed',
      attemptCount: 0,
      receivedAt: requestedAt,
      startedAt: requestedAt,
      completedAt: requestedAt,
      ingestedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorJson: null,
      lastErrorAt: null,
      maintenanceRequestedAt: requestedAt,
      maintenanceCompletedAt: null,
    })
    .onConflictDoNothing()
    .returning({
      batchId: ingestBatches.id,
      sourceName: ingestBatches.sourceName,
      maintenanceRequestedAt: ingestBatches.maintenanceRequestedAt,
    });

  let row = rows[0];
  if (!row) {
    const existingRows = await tx
      .select({
        batchId: ingestBatches.id,
        sourceName: ingestBatches.sourceName,
        maintenanceRequestedAt: ingestBatches.maintenanceRequestedAt,
      })
      .from(ingestBatches)
      .where(
        and(
          eq(ingestBatches.sourceName, request.sourceName),
          eq(ingestBatches.idempotencyKey, request.idempotencyKey),
        ),
      )
      .limit(1);
    row = existingRows[0];
  }

  if (!row) {
    throw new Error('Failed to create maintenance refresh request');
  }

  const maintenanceRequestedAt = row.maintenanceRequestedAt ?? requestedAt;

  return {
    batchId: row.batchId,
    sourceName: row.sourceName,
    maintenanceRequestedAt: maintenanceRequestedAt.toISOString(),
  };
}

export async function markBatchQueued(batchId: string): Promise<void> {
  await db
    .update(ingestBatches)
    .set({ status: 'queued' })
    .where(
      and(
        eq(ingestBatches.id, batchId),
        inArray(ingestBatches.status, ['accepted', 'retryable']),
      ),
    );
}

export async function getIngestWatermark(sourceName: string): Promise<IngestWatermarkResponse> {
  const rows = await db
    .select()
    .from(ingestSources)
    .where(eq(ingestSources.sourceName, sourceName))
    .limit(1);

  const source = rows[0];

  return {
    sourceName,
    cursor: source?.lastCommittedCursor ?? null,
    lastCommittedChangedAt: toIsoString(source?.lastCommittedChangedAt ?? null),
    lastCommittedListingKey: source?.lastCommittedListingKey ?? null,
    lastBatchId: source?.lastBatchId ?? null,
  };
}

export async function markPendingMaintenanceCompleted(): Promise<number> {
  return markMaintenanceRequestsCompletedBefore(new Date());
}

export async function markMaintenanceRequestsCompletedBefore(cutoff: Date): Promise<number> {
  const cutoffIso = cutoff.toISOString();
  const pendingRows = await db
    .select({ id: ingestBatches.id })
    .from(ingestBatches)
    .where(
      sql`${ingestBatches.maintenanceRequestedAt} IS NOT NULL
        AND ${ingestBatches.maintenanceCompletedAt} IS NULL
        AND ${ingestBatches.maintenanceRequestedAt} <= ${cutoffIso}`,
    );

  if (pendingRows.length === 0) {
    return 0;
  }

  await db
    .update(ingestBatches)
    .set({ maintenanceCompletedAt: new Date() })
    .where(inArray(ingestBatches.id, pendingRows.map((row) => row.id)));

  return pendingRows.length;
}

export async function listSkippedBatchRecoveryCandidates(
  referenceTime: Date,
  limit = 100,
): Promise<SkippedBatchRecoveryCandidate[]> {
  const dueBefore = new Date(referenceTime.getTime() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS).toISOString();
  const rows = await db.execute<SkippedBatchRecoveryCandidateRow>(sql`
    SELECT
      id,
      source_name,
      payload_json,
      ingested_count,
      updated_count,
      skipped_count,
      maintenance_requested_at,
      maintenance_completed_at
    FROM ingest_batches
    WHERE status = 'completed'
      AND jsonb_typeof(payload_json->'listings') = 'array'
      AND jsonb_array_length(payload_json->'listings') > 0
      AND (
        SELECT count(*)
        FROM jsonb_array_elements(payload_json->'listings') AS payload_listing(listing)
        WHERE NOT EXISTS (
          SELECT 1
          FROM listing_observations observation
          WHERE (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_listing_id = COALESCE(
                NULLIF(payload_listing.listing->>'sourceListingId', ''),
                payload_listing.listing->>'mirrorListingId'
              )
            )
            OR (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_url_canonical = regexp_replace(
                regexp_replace(
                  COALESCE(
                    NULLIF(payload_listing.listing->>'canonicalUrl', ''),
                    payload_listing.listing->>'sourceUrl'
                  ),
                  '[?#].*$',
                  ''
                ),
                '/+$',
                ''
              )
            )
        )
      ) > GREATEST(skipped_count, 0)
      AND (
        maintenance_completed_at IS NULL
        OR maintenance_completed_at <= ${dueBefore}
      )
    ORDER BY
      COALESCE(maintenance_completed_at, to_timestamp(0)),
      COALESCE(completed_at, received_at),
      received_at,
      batch_sequence,
      id
    LIMIT ${limit}
  `);

  return Array.from(rows, mapSkippedBatchRecoveryCandidate);
}

export async function listForceSkippedBatchRecoveryCandidates(
  sourceName: string,
  limit = 100,
): Promise<SkippedBatchRecoveryCandidate[]> {
  const rows = await db.execute<SkippedBatchRecoveryCandidateRow>(sql`
    SELECT
      id,
      source_name,
      payload_json,
      ingested_count,
      updated_count,
      skipped_count,
      maintenance_requested_at,
      maintenance_completed_at
    FROM ingest_batches
    WHERE status = 'completed'
      AND source_name = ${sourceName}
      AND jsonb_typeof(payload_json->'listings') = 'array'
      AND jsonb_array_length(payload_json->'listings') > 0
      AND (
        SELECT count(*)
        FROM jsonb_array_elements(payload_json->'listings') AS payload_listing(listing)
        WHERE NOT EXISTS (
          SELECT 1
          FROM listing_observations observation
          WHERE (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_listing_id = COALESCE(
                NULLIF(payload_listing.listing->>'sourceListingId', ''),
                payload_listing.listing->>'mirrorListingId'
              )
            )
            OR (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_url_canonical = regexp_replace(
                regexp_replace(
                  COALESCE(
                    NULLIF(payload_listing.listing->>'canonicalUrl', ''),
                    payload_listing.listing->>'sourceUrl'
                  ),
                  '[?#].*$',
                  ''
                ),
                '/+$',
                ''
              )
            )
        )
      ) > 0
    ORDER BY
      COALESCE(completed_at, received_at),
      received_at,
      batch_sequence,
      id
    LIMIT ${limit}
  `);

  return Array.from(rows, mapSkippedBatchRecoveryCandidate);
}

export async function listBlockedSourceBatchesAtWatermark(
  sourceName: string,
  limit = 100,
): Promise<BlockedSourceBatchAtWatermark[]> {
  const rows = await db.execute<BlockedSourceBatchAtWatermarkRow>(sql`
    SELECT
      b.id,
      b.source_name,
      b.status AS previous_status,
      b.status AS status,
      b.cursor_start,
      b.cursor_end,
      b.run_id,
      b.batch_sequence,
      b.received_at
    FROM ingest_batches b
    LEFT JOIN ingest_sources s ON s.source_name = b.source_name
    WHERE b.source_name = ${sourceName}
      AND b.cursor_start IS NOT DISTINCT FROM s.last_committed_cursor
      AND b.status IN ('accepted', 'queued', 'retryable', 'failed')
    ORDER BY b.received_at, b.batch_sequence, b.id
    LIMIT ${limit}
  `);

  return Array.from(rows, mapBlockedSourceBatchAtWatermark);
}

export async function requeueBlockedSourceBatchesAtWatermark(
  sourceName: string,
  limit = 100,
): Promise<BlockedSourceBatchAtWatermark[]> {
  const rows = await db.execute<BlockedSourceBatchAtWatermarkRow>(sql`
    WITH ranked AS (
      SELECT
        b.id,
        b.status AS previous_status,
        row_number() OVER (
          ORDER BY b.received_at DESC, b.batch_sequence DESC, b.id DESC
        ) AS recovery_rank
      FROM ingest_batches b
      LEFT JOIN ingest_sources s ON s.source_name = b.source_name
      WHERE b.source_name = ${sourceName}
        AND b.cursor_start IS NOT DISTINCT FROM s.last_committed_cursor
        AND b.status IN ('accepted', 'queued', 'retryable', 'failed')
      LIMIT ${limit}
    ),
    superseded AS (
      UPDATE ingest_batches b
      SET
        status = 'superseded'::ingest_batch_status,
        completed_at = COALESCE(b.completed_at, NOW()),
        error_json = jsonb_build_object(
          'message',
          'Superseded by newer overlapping batch during operator recovery at current watermark',
          'previousStatus',
          ranked.previous_status
        ),
        last_error_at = CASE
          WHEN b.status = 'failed' THEN NOW()
          ELSE b.last_error_at
        END
      FROM ranked
      WHERE b.id = ranked.id
        AND ranked.recovery_rank > 1
      RETURNING b.id
    ),
    candidate AS (
      SELECT id, previous_status
      FROM ranked
      WHERE recovery_rank = 1
    )
    UPDATE ingest_batches b
    SET
      status = CASE
        WHEN b.status = 'failed' THEN 'retryable'::ingest_batch_status
        ELSE 'queued'::ingest_batch_status
      END,
      started_at = NULL,
      completed_at = NULL,
      error_json = CASE
        WHEN b.status = 'failed' THEN jsonb_build_object(
          'message',
          'Requeued by operator recovery at current watermark',
          'previousStatus',
          candidate.previous_status,
          'previousError',
          b.error_json
        )
        ELSE b.error_json
      END,
      last_error_at = CASE
        WHEN b.status = 'failed' THEN NOW()
        ELSE b.last_error_at
      END
    FROM candidate
    WHERE b.id = candidate.id
    RETURNING
      b.id,
      b.source_name,
      candidate.previous_status,
      b.status AS status,
      b.cursor_start,
      b.cursor_end,
      b.run_id,
      b.batch_sequence,
      b.received_at
  `);

  return Array.from(rows, mapBlockedSourceBatchAtWatermark);
}

export async function collectRecoveryDispatchWork(
  staleProcessingBefore: Date,
  limit = 100,
): Promise<SweepDispatchResult> {
  const staleProcessingBeforeIso = staleProcessingBefore.toISOString();
  const staleRows = await db.execute<{ id: string }>(sql`
    UPDATE ingest_batches
    SET
      status = 'retryable'::ingest_batch_status,
      error_json = jsonb_build_object('message', 'Requeued by recovery sweep after stale processing window'),
      last_error_at = NOW()
    WHERE status = 'processing'
      AND started_at IS NOT NULL
      AND started_at < ${staleProcessingBeforeIso}
    RETURNING id
  `);

  const supersededRows = await markSupersededBatchesAfterWatermark(Math.max(limit * 10, 100));
  await finalizeSupersededRunLifecycles(supersededRows);
  const staleEvidenceBatchIds = await listStaleEvidenceBatchIdsAfterWatermark(limit);

  const recoverableRows = await db.execute<{ id: string }>(sql`
    WITH next_recoverable_per_source AS (
      SELECT DISTINCT ON (b.source_name)
        b.id,
        b.received_at,
        b.batch_sequence
      FROM ingest_batches b
      LEFT JOIN ingest_sources s ON s.source_name = b.source_name
      WHERE (
          b.status IN ('accepted', 'queued', 'retryable')
          OR (b.status = 'processing' AND b.started_at IS NULL)
        )
        AND b.cursor_start IS NOT DISTINCT FROM s.last_committed_cursor
      ORDER BY b.source_name, b.received_at DESC, b.batch_sequence DESC, b.id DESC
    )
    SELECT id
    FROM next_recoverable_per_source
    ORDER BY received_at, batch_sequence, id
    LIMIT ${limit}
  `);

  const maintenanceRows = await db
    .select({ id: ingestBatches.id })
    .from(ingestBatches)
    .where(
      and(
        isNull(ingestBatches.maintenanceCompletedAt),
        sql`${ingestBatches.maintenanceRequestedAt} IS NOT NULL`,
      ),
    )
    .limit(1);

  const skippedRecoveryRows = await listSkippedBatchRecoveryCandidates(new Date(), 1);
  const skippedRecoveryPending = skippedRecoveryRows.length > 0;

  return {
    staleProcessingBatchIds: Array.from(staleRows, (row) => row.id),
    recoverableBatchIds: Array.from(new Set([
      ...staleEvidenceBatchIds,
      ...Array.from(recoverableRows, (row) => row.id),
    ])).slice(0, limit),
    maintenancePending: maintenanceRows.length > 0 || skippedRecoveryPending,
  };
}

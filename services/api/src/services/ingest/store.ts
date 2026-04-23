import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, ingestBatches, ingestRuns, ingestSources, type DbTransaction } from '../../db/index.js';
import type { IngestBatchRequest, IngestWatermarkResponse } from './contracts.js';
import { encodeOpaqueIngestCursor } from './cursor.js';
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

const RECOVERABLE_BATCH_STATUSES: BatchStatus[] = ['accepted', 'queued', 'retryable'];

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
    failed_batch_count: number;
    active_batch_count: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS total_batch_count,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_batch_count,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_batch_count,
      COUNT(*) FILTER (WHERE status IN ('accepted', 'queued', 'processing', 'retryable'))::int AS active_batch_count
    FROM ingest_batches
    WHERE run_id = ${run.runId}
  `);

  const batchCounts = Array.from(counts)[0] ?? {
    total_batch_count: 0,
    completed_batch_count: 0,
    failed_batch_count: 0,
    active_batch_count: 0,
  };

  const processedBatchCount = batchCounts.completed_batch_count + batchCounts.failed_batch_count;
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
            failedBatchCount: batchCounts.failed_batch_count,
            activeBatchCount: batchCounts.active_batch_count,
            terminalError: serializeError(terminalError),
          }
        : null,
  };
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
    requestedBy: 'listing-submit' | 'validation-outcome';
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
    .returning({
      batchId: ingestBatches.id,
      sourceName: ingestBatches.sourceName,
      maintenanceRequestedAt: ingestBatches.maintenanceRequestedAt,
    });

  const row = rows[0];
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

  const recoverableRows = await db
    .select({ id: ingestBatches.id })
    .from(ingestBatches)
    .where(
      or(
        inArray(ingestBatches.status, RECOVERABLE_BATCH_STATUSES),
        and(
          eq(ingestBatches.status, 'processing'),
          isNull(ingestBatches.startedAt),
        ),
      ),
    )
    .orderBy(asc(ingestBatches.receivedAt))
    .limit(limit);

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

  return {
    staleProcessingBatchIds: Array.from(staleRows, (row) => row.id),
    recoverableBatchIds: recoverableRows.map((row) => row.id),
    maintenancePending: maintenanceRows.length > 0,
  };
}

import { sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../../db/index.js';
import { backfillIdentityBusinessHistoryForBatch } from './identity-business-history.js';
import { backfillV2BatchReceiptMetadata } from './batch-receipts.js';

export const INGEST_OPERATIONAL_RETENTION_DAYS = 7;
const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_SOURCE_LIMIT = 16;
let retentionCursor: { sourceName: string; generation: number } | null = null;
type RetentionDatabase = Pick<typeof db, 'execute' | 'transaction'>;

export type IngestOperationalRetirement = {
  sourceName: string;
  generation: number;
  status: 'retired' | 'noop' | 'locked' | 'blocked';
  retiredSequence: number;
  retiredBatches: number;
  deletedEvidence: number;
  reason: string | null;
};

function boundedInteger(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

function sequence(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid retention sequence');
  return result;
}

/**
 * Compact bounded completed batch bodies, then retire a safe event prefix.
 * The caller owns the transaction: evidence deletion, receipt compaction and
 * the frontier either all commit or all roll back. Business history is
 * finalized before compaction; durable history and v1 audits are never deleted.
 */
export async function retireIngestOperationalEvidence(
  tx: DbTransaction,
  sourceName: string,
  generation: number,
  options: { batchLimit?: number; historyBatchLimit?: number; evidenceLimit?: number; now?: Date } = {},
): Promise<IngestOperationalRetirement> {
  boundedInteger(generation, Number.MAX_SAFE_INTEGER, 'writer generation');
  const batchLimit = boundedInteger(options.batchLimit ?? DEFAULT_BATCH_LIMIT, 1_000, 'retention batch limit');
  const historyBatchLimit = boundedInteger(options.historyBatchLimit ?? 1, 10, 'retention history batch limit');
  const evidenceLimit = boundedInteger(options.evidenceLimit ?? 100_000, 1_000_000, 'retention evidence limit');
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - INGEST_OPERATIONAL_RETENTION_DAYS * 86_400_000).toISOString();
  const result: IngestOperationalRetirement = {
    sourceName, generation, status: 'noop', retiredSequence: 0,
    retiredBatches: 0, deletedEvidence: 0, reason: null,
  };

  // Same source lock and ordering as acceptance, writer cutover and processing.
  // Retention yields immediately to an active writer instead of delaying ingest.
  const [lock] = await tx.execute<{ acquired: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtext(${sourceName})) AS acquired
  `);
  if (!lock?.acquired) return { ...result, status: 'locked', reason: 'source_locked' };

  await tx.execute(sql`
    INSERT INTO ingest_retired_sequences (source_name, generation, retired_sequence)
    VALUES (${sourceName}, ${generation}, 0)
    ON CONFLICT (source_name, generation) DO UPDATE SET updated_at = EXCLUDED.updated_at
  `);
  const [frontier] = await tx.execute<{ retired_sequence: string }>(sql`
    SELECT retired_sequence::text FROM ingest_retired_sequences
    WHERE source_name = ${sourceName} AND generation = ${generation}
    FOR UPDATE
  `);
  result.retiredSequence = sequence(frontier!.retired_sequence);

  await backfillV2BatchReceiptMetadata(tx, { sourceName, generation, batchLimit });

  // Phase one makes bounded progress even when thousands of duplicate receipts
  // form one overlapping interval component. Exact hashes/results stay forever.
  const eligible = sql`
    b.source_name = ${sourceName} AND b.writer_generation = ${generation}
    AND b.payload_compacted_at IS NULL AND b.payload_hash IS NOT NULL
    AND b.first_sequence IS NOT NULL AND b.last_sequence IS NOT NULL
    AND b.status = 'completed' AND b.completed_at <= ${cutoff}::timestamptz
    AND (b.maintenance_requested_at IS NULL
      OR b.maintenance_completed_at >= b.maintenance_requested_at)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(b.payload_json->'records') AS record(value)
      JOIN listing_candidate_handoffs h ON h.source_name = b.source_name
        AND (h.id::text = record.value->>'sourceCandidateId'
          OR h.preview_result_id::text = record.value->>'previewResultId')
      WHERE h.state IN ('pending', 'queued', 'retryable_error')
    )
  `;
  // Historical extraction is substantially heavier than compacting an already
  // finalized receipt. Separate quotas bound source-lock time without a large
  // pending-history backlog hiding cheap, ready bodies from the sweep.
  const ready = await tx.execute<{ id: string; history_ready: boolean }>(sql`
    SELECT b.id, true AS history_ready FROM ingest_batches b
    WHERE ${eligible} AND b.business_history_completed_at IS NOT NULL
    ORDER BY b.first_sequence, b.last_sequence, b.id
    LIMIT ${batchLimit} FOR UPDATE OF b
  `);
  const pending = await tx.execute<{ id: string; history_ready: boolean }>(sql`
    SELECT b.id, false AS history_ready FROM ingest_batches b
    WHERE ${eligible} AND b.business_history_completed_at IS NULL
    ORDER BY b.first_sequence, b.last_sequence, b.id
    LIMIT ${historyBatchLimit} FOR UPDATE OF b
  `);
  const batches = [...ready, ...pending];
  for (const batch of batches) {
    if (!batch.history_ready) await backfillIdentityBusinessHistoryForBatch(tx, { batchId: batch.id });
    const compacted = await tx.execute<{ id: string }>(sql`
      UPDATE ingest_batches
      SET payload_json = jsonb_build_object('ingestVersion', 2, 'writerGeneration', ${generation}::bigint)
          || jsonb_strip_nulls(jsonb_build_object('batchKind', payload_json->'batchKind', 'scopeKey', payload_json->'scopeKey')),
        payload_compacted_at = ${now.toISOString()}::timestamptz
      WHERE id = ${batch.id}::uuid AND payload_compacted_at IS NULL
        AND business_history_completed_at IS NOT NULL
      RETURNING id
    `);
    if (compacted.length !== 1) throw new Error('Business history was not finalized before receipt compaction');
    result.retiredBatches += 1;
  }
  if (result.retiredBatches > 0) result.status = 'retired';

  // Phase two cannot cross ANY still raw-owned interval, irrespective of its
  // status or age. In particular a recent overlapping replay pins old evidence.
  const [ownership] = await tx.execute<{
    missing: boolean; first_raw_sequence: string | null;
  }>(sql`
    SELECT COALESCE(bool_or(first_sequence IS NULL OR last_sequence IS NULL), false) AS missing,
      min(first_sequence)::text AS first_raw_sequence
    FROM ingest_batches
    WHERE source_name = ${sourceName} AND writer_generation = ${generation}
      AND payload_compacted_at IS NULL
  `);
  const [historical] = await tx.execute<{ missing: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ingest_batches WHERE source_name = ${sourceName}
        AND writer_generation IS NULL AND payload_compacted_at IS NULL
        AND payload_json->>'ingestVersion' = '2'
        AND payload_json->>'writerGeneration' = ${String(generation)}
    ) AS missing
  `);
  const [compacted] = await tx.execute<{ compacted_end: string }>(sql`
    SELECT last_sequence::text AS compacted_end FROM ingest_batches
    WHERE source_name = ${sourceName} AND writer_generation = ${generation}
      AND payload_compacted_at IS NOT NULL
    ORDER BY last_sequence DESC LIMIT 1
  `);
  const blocked = (reason: string): IngestOperationalRetirement => ({
    ...result, status: result.retiredBatches > 0 ? 'retired' : 'blocked', reason,
  });
  if (ownership?.missing || historical?.missing) return blocked('receipt_metadata_pending');
  if (!compacted) return blocked('batch_not_ready');
  let end = Math.min(sequence(compacted.compacted_end), result.retiredSequence + evidenceLimit);
  if (ownership!.first_raw_sequence !== null) end = Math.min(end, sequence(ownership!.first_raw_sequence) - 1);
  if (end <= result.retiredSequence) {
    return ownership!.first_raw_sequence === null ? result : blocked('raw_batch_pins_prefix');
  }

  const [recent] = await tx.execute<{ first_recent: string | null }>(sql`
    SELECT min(sequence)::text AS first_recent FROM ingest_evidence
    WHERE source_name = ${sourceName} AND generation = ${generation}
      AND sequence > ${result.retiredSequence} AND sequence <= ${end}
      AND created_at > ${cutoff}::timestamptz
  `);
  if (recent?.first_recent !== null && recent?.first_recent !== undefined) {
    end = Math.min(end, sequence(recent.first_recent) - 1);
  }
  if (end <= result.retiredSequence) return blocked('recent_evidence');

  // Complete compacted receipt coverage plus every raw sequence is required.
  // Multirange aggregation handles overlapping receipts without one row/event
  // tombstones or loading an arbitrarily large overlap component into Node.
  const [coverage] = await tx.execute<{ covered_end: string }>(sql`
    WITH receipt_coverage AS (
      SELECT range_agg(int8range(first_sequence, last_sequence, '[]')) AS covered
      FROM ingest_batches
      WHERE source_name = ${sourceName} AND writer_generation = ${generation}
        AND payload_compacted_at IS NOT NULL AND business_history_completed_at IS NOT NULL
        AND status = 'completed' AND first_sequence <= ${end} AND last_sequence > ${result.retiredSequence}
    )
    SELECT LEAST(upper(covered_range) - 1, ${end})::text AS covered_end
    FROM receipt_coverage CROSS JOIN LATERAL unnest(covered) AS covered_range
    WHERE covered_range @> ${result.retiredSequence + 1}::bigint
  `);
  if (!coverage) return blocked('sequence_gap');
  end = sequence(coverage.covered_end);
  const [evidence] = await tx.execute<{ count: string }>(sql`
    SELECT count(*)::text FROM ingest_evidence
    WHERE source_name = ${sourceName} AND generation = ${generation}
      AND sequence > ${result.retiredSequence} AND sequence <= ${end}
  `);
  if (Number(evidence?.count) !== end - result.retiredSequence) {
    throw new Error('Cannot retire ingest evidence with a missing sequence');
  }

  const deleted = await tx.execute<{ count: string }>(sql`
    WITH removed AS (
      DELETE FROM ingest_evidence WHERE source_name = ${sourceName} AND generation = ${generation}
        AND sequence > ${result.retiredSequence} AND sequence <= ${end} RETURNING 1
    ) SELECT count(*)::text FROM removed
  `);
  if (Number(deleted[0]?.count) !== end - result.retiredSequence) {
    throw new Error('Ingest retirement changed while locked');
  }
  await tx.execute(sql`
    UPDATE ingest_retired_sequences SET retired_sequence = ${end}, updated_at = ${now.toISOString()}::timestamptz
    WHERE source_name = ${sourceName} AND generation = ${generation} AND retired_sequence = ${result.retiredSequence}
  `);
  return { ...result, status: 'retired', retiredSequence: end,
    deletedEvidence: Number(deleted[0]!.count), reason: null };
}

/** Bounded work on each sweep; incomplete or failed work remains durable. */
export async function runIngestOperationalRetention(options: {
  batchLimit?: number; historyBatchLimit?: number; evidenceLimit?: number; sourceLimit?: number; sourceNames?: string[]; now?: Date;
} = {}, database: RetentionDatabase = db): Promise<Record<string, unknown>> {
  const sourceLimit = boundedInteger(options.sourceLimit ?? DEFAULT_SOURCE_LIMIT, 100, 'retention source limit');
  if (options.sourceNames?.length === 0) throw new Error('Empty retention source scope');
  const cursor = retentionCursor;
  const sources = await database.execute<{ source_name: string; generation: string }>(sql`
    WITH historical_generations AS (
      SELECT source_name, CASE
        WHEN payload_json->>'writerGeneration' ~ '^[1-9][0-9]{0,15}$'
        THEN CASE WHEN (payload_json->>'writerGeneration')::numeric <= 9007199254740991
          THEN (payload_json->>'writerGeneration')::bigint END
      END AS writer_generation
      FROM ingest_batches
      WHERE writer_generation IS NULL AND payload_compacted_at IS NULL
        AND payload_json->>'ingestVersion' = '2'
    ), candidates AS (
      SELECT source_name, writer_generation FROM ingest_batches
      WHERE writer_generation IS NOT NULL AND payload_compacted_at IS NULL
      GROUP BY source_name, writer_generation
      UNION
      SELECT source_name, writer_generation FROM historical_generations WHERE writer_generation IS NOT NULL
      UNION
      SELECT r.source_name, r.generation FROM ingest_retired_sequences r
      WHERE EXISTS (
        SELECT 1 FROM ingest_batches b
        WHERE b.source_name = r.source_name AND b.writer_generation = r.generation
          AND b.payload_compacted_at IS NOT NULL AND b.last_sequence > r.retired_sequence
      )
    )
    SELECT c.source_name, c.writer_generation::text AS generation
    FROM candidates c LEFT JOIN ingest_retired_sequences r
      ON r.source_name = c.source_name AND r.generation = c.writer_generation
    ${options.sourceNames ? sql`WHERE c.source_name IN (${sql.join(options.sourceNames.map(name => sql`${name}`), sql`, `)})` : sql``}
    ORDER BY
      ${cursor ? sql`CASE WHEN (c.source_name, c.writer_generation) > (${cursor.sourceName}, ${cursor.generation}::bigint) THEN 0 ELSE 1 END,`
        : sql`r.updated_at ASC NULLS FIRST,`}
      c.source_name, c.writer_generation
    LIMIT ${sourceLimit}
  `);
  const results: IngestOperationalRetirement[] = [];
  for (const source of sources) {
    // Advance even after a busy or failed group. A pinned generation must not
    // monopolize the first page forever; persisted inspection times also spread
    // work after a process restart.
    try {
      results.push(await database.transaction(tx => retireIngestOperationalEvidence(
        tx, source.source_name, sequence(source.generation), options,
      )));
    } finally {
      retentionCursor = { sourceName: source.source_name, generation: sequence(source.generation) };
    }
  }
  return {
    processedSources: results.length,
    retiredBatches: results.reduce((count, item) => count + item.retiredBatches, 0),
    deletedEvidence: results.reduce((count, item) => count + item.deletedEvidence, 0),
    lockedSources: results.filter(item => item.status === 'locked').length,
    blockedSources: results.filter(item => item.status === 'blocked').length,
  };
}

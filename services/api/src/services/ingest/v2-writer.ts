import { eq, sql } from 'drizzle-orm';
import { ingestWriterGenerations, type DbTransaction } from '../../db/index.js';
import type { IngestBatchRequest } from './contracts.js';
import { IngestIdempotencyConflictError } from './errors.js';

export class IngestWriterFencedError extends IngestIdempotencyConflictError {
  constructor(message: string) { super(message); this.name = 'IngestWriterFencedError'; }
}
export class IngestSequenceGapError extends Error {
  constructor(message: string) { super(message); this.name = 'IngestSequenceGapError'; }
}

export function validateEvidenceTimes(request: IngestBatchRequest, now = new Date()): void {
  const latest = now.getTime() + 5 * 60 * 1000;
  for (const record of request.records ?? []) {
    if (new Date(record.observedAt).getTime() > latest
      || (record.inventoryManifest && new Date(record.inventoryManifest.completedAt).getTime() > latest)) {
      throw new IngestIdempotencyConflictError('Evidence timestamps exceed the allowed five-minute clock skew');
    }
  }
}

export async function assertIngestWriter(tx: DbTransaction, request: IngestBatchRequest): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${request.sourceName}))`);
  const [writer] = await tx.select().from(ingestWriterGenerations)
    .where(eq(ingestWriterGenerations.sourceName, request.sourceName)).for('update');
  const incoming = request.ingestVersion === 2 ? request.writerGeneration : 0;
  if ((writer?.generation ?? 0) !== incoming) {
    throw new IngestWriterFencedError(`Writer generation ${incoming} is retired or has not been activated for ${request.sourceName}`);
  }
  validateEvidenceTimes(request);
}

/** Operator-only cutover: monotonic generations fence old accepted and late work. */
export async function activateIngestWriterGeneration(tx: DbTransaction, sourceName: string, generation: number): Promise<void> {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid writer generation');
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sourceName}))`);
  const [current] = await tx.select().from(ingestWriterGenerations).where(eq(ingestWriterGenerations.sourceName, sourceName)).for('update');
  if (current && generation <= current.generation) throw new Error('Writer generation must increase');
  await tx.insert(ingestWriterGenerations).values({ sourceName, generation, lastSequence: 0 })
    .onConflictDoUpdate({ target: ingestWriterGenerations.sourceName, set: { generation, lastSequence: 0, updatedAt: new Date() } });
  await tx.execute(sql`UPDATE ingest_batches SET status = 'superseded', completed_at = now()
    WHERE source_name = ${sourceName} AND status IN ('accepted', 'queued', 'processing', 'retryable')
      AND COALESCE((payload_json->>'writerGeneration')::bigint, 0) < ${generation}`);
  await tx.execute(sql`UPDATE ingest_sources SET last_committed_cursor = NULL, last_committed_changed_at = NULL,
    last_committed_listing_key = NULL, last_batch_id = NULL WHERE source_name = ${sourceName}`);
}

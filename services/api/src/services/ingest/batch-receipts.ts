import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ingestBatches, ingestRetiredSequences } from '../../db/schema.js';
import type { DbTransaction } from '../../db/index.js';
import { ingestBatchRequestSchema, type IngestBatchRequest } from './contracts.js';
import { IngestIdempotencyConflictError } from './errors.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash the validated/defaulted contract, independent of JSON object key order. */
export function ingestBatchPayloadHash(request: IngestBatchRequest): string {
  return createHash('sha256').update(canonicalJson(ingestBatchRequestSchema.parse(request))).digest('hex');
}

export function v2BatchReceiptMetadata(request: IngestBatchRequest) {
  if (request.ingestVersion !== 2 || !request.writerGeneration || !request.records?.length) return {};
  return {
    writerGeneration: request.writerGeneration,
    firstSequence: request.records[0].sequence,
    lastSequence: request.records.at(-1)!.sequence,
    payloadHash: ingestBatchPayloadHash(request),
  };
}

export class IngestEvidenceRetiredError extends IngestIdempotencyConflictError {
  constructor() {
    super('Unknown batch overlaps retired source evidence; use the original batch receipt or a new source-owned replay.');
    this.name = 'IngestEvidenceRetiredError';
  }
}

/** Known exact batch receipts are checked before this guard by the caller. */
export async function assertV2BatchRangeNotRetired(tx: DbTransaction, request: IngestBatchRequest): Promise<void> {
  if (request.ingestVersion !== 2 || !request.writerGeneration || !request.records?.length) return;
  const [retired] = await tx.select({ sequence: ingestRetiredSequences.retiredSequence })
    .from(ingestRetiredSequences).where(and(eq(ingestRetiredSequences.sourceName, request.sourceName),
      eq(ingestRetiredSequences.generation, request.writerGeneration)));
  if (retired && request.records[0].sequence <= retired.sequence) throw new IngestEvidenceRetiredError();
}

/** Bounded upgrade of pre-0066 v2 receipts; never marks business extraction done. */
export async function backfillV2BatchReceiptMetadata(tx: DbTransaction, options: {
  sourceName: string; generation: number; batchLimit?: number;
}): Promise<{ prepared: number; invalid: number }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${options.sourceName}))`);
  const limit = Math.min(100, Math.max(1, Math.floor(options.batchLimit ?? 100)));
  const rows = await tx.select({ id: ingestBatches.id, payload: ingestBatches.payloadJson })
    .from(ingestBatches).where(and(eq(ingestBatches.sourceName, options.sourceName),
      isNull(ingestBatches.payloadCompactedAt),
      sql`${ingestBatches.payloadJson}->>'ingestVersion' = '2'`,
      sql`${ingestBatches.payloadJson}->>'writerGeneration' = ${String(options.generation)}`,
      sql`(${ingestBatches.payloadHash} IS NULL OR ${ingestBatches.writerGeneration} IS NULL
        OR ${ingestBatches.firstSequence} IS NULL OR ${ingestBatches.lastSequence} IS NULL)`))
    .orderBy(ingestBatches.receivedAt, ingestBatches.id).limit(limit).for('update', { skipLocked: true });
  const result = { prepared: 0, invalid: 0 };
  for (const row of rows) {
    const parsed = ingestBatchRequestSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.ingestVersion !== 2) { result.invalid += 1; continue; }
    await tx.update(ingestBatches).set(v2BatchReceiptMetadata(parsed.data)).where(eq(ingestBatches.id, row.id));
    result.prepared += 1;
  }
  return result;
}

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, ingestBatches, ingestWriterGenerations, ingestSources, ingestRetiredSequences } from '../../db/index.js';
import { ingestBatchRequestSchema, type IngestBatchRequest } from '../../services/ingest/contracts.js';
import { encodeOpaqueIngestCursor } from '../../services/ingest/cursor.js';
import { acceptIngestBatch, getIngestBatchStatus } from '../../services/ingest/store.js';
import { processV2Evidence } from '../../services/ingest/v2-processor.js';
import { retireIngestOperationalEvidence } from '../../services/ingest/operational-retention.js';
import { activateIngestWriterGeneration } from '../../services/ingest/v2-writer.js';
import { buildApp } from '../../app.js';

const observedAt = '2026-09-01T00:00:00.000Z';
const retirementAt = new Date('2026-09-20T00:00:00.000Z');

async function fixture(run: (context: { request: IngestBatchRequest; complete: () => Promise<string>; generation: number }) => Promise<void>) {
  const [originalWriter] = await db.select().from(ingestWriterGenerations).where(eq(ingestWriterGenerations.sourceName, 'funda'));
  const [originalSource] = await db.select().from(ingestSources).where(eq(ingestSources.sourceName, 'funda'));
  const primary = randomUUID();
  const generation = Math.floor(Date.now() / 1000);
  const keys: string[] = [];
  const request = ingestBatchRequestSchema.parse({ sourceName: 'funda', ingestVersion: 2, writerGeneration: generation,
    idempotencyKey: randomUUID(), batchSequence: 0,
    cursorEnd: encodeOpaqueIngestCursor({ changedAt: '2000-01-01T00:00:01.000Z', listingKey: '00000000000000000001' }),
    records: [{ kind: 'facts', eventId: randomUUID(), sequence: 1, observedAt, collector: 'direct', evidenceStrength: 'detail',
      identity: { sourceListingId: primary, sourceListingIdKind: 'global_id' }, facts: { lifecycleStatus: 'available', askingPrice: 500000 } }],
  });
  keys.push(request.idempotencyKey);
  await db.insert(ingestWriterGenerations).values({ sourceName: 'funda', generation, lastSequence: 0 })
    .onConflictDoUpdate({ target: ingestWriterGenerations.sourceName, set: { generation, lastSequence: 0 } });
  async function complete() {
    const accepted = await acceptIngestBatch(request);
    await db.transaction(async tx => {
      const result = await processV2Evidence(tx, accepted.batchId, request);
      await tx.update(ingestBatches).set({ status: 'completed', completedAt: new Date(observedAt),
        receivedAt: new Date(observedAt), businessHistoryCompletedAt: new Date(observedAt),
        ingestedCount: result.ingestedCount, updatedCount: result.updatedCount, skippedCount: result.skippedCount,
      }).where(eq(ingestBatches.id, accepted.batchId));
      await tx.execute(sql`UPDATE ingest_evidence SET created_at=${observedAt}::timestamptz WHERE source_name='funda' AND generation=${generation}`);
    });
    return accepted.batchId;
  }
  try { await run({ request, complete, generation }); }
  finally {
    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM ingest_evidence WHERE source_name='funda' AND generation=${generation}`);
      await tx.execute(sql`DELETE FROM source_identity_business_history WHERE identity_id IN
        (SELECT id FROM source_listing_identities WHERE source_name='funda' AND primary_id=${primary})`);
      await tx.execute(sql`DELETE FROM source_listing_identities WHERE source_name='funda' AND primary_id=${primary}`);
      await tx.execute(sql`DELETE FROM ingest_batches WHERE source_name='funda' AND (writer_generation IN (${generation},${generation + 1}) OR idempotency_key IN (${sql.join(keys.map(key => sql`${key}`), sql`, `)}))`);
      await tx.execute(sql`DELETE FROM ingest_retired_sequences WHERE source_name='funda' AND generation IN (${generation},${generation + 1})`);
      if (originalWriter) await tx.update(ingestWriterGenerations).set(originalWriter).where(eq(ingestWriterGenerations.sourceName, 'funda'));
      else await tx.delete(ingestWriterGenerations).where(eq(ingestWriterGenerations.sourceName, 'funda'));
      if (originalSource) await tx.insert(ingestSources).values(originalSource).onConflictDoUpdate({ target: ingestSources.sourceName, set: originalSource });
      else await tx.delete(ingestSources).where(eq(ingestSources.sourceName, 'funda'));
    });
  }
}

async function counts() {
  const [row] = await db.execute(sql`SELECT
    (SELECT count(*)::int FROM ingest_batches) AS batches,
    (SELECT count(*)::int FROM ingest_runs) AS runs,
    (SELECT count(*)::int FROM ingest_evidence) AS evidence,
    (SELECT count(*)::int FROM source_listing_identities) AS identities,
    (SELECT count(*)::int FROM ingest_sources) AS sources`);
  return row;
}

describe('exact batch delivery receipts after raw retirement', () => {
  let app: FastifyInstance;
  const originalKey = process.env.INGEST_API_KEY;
  beforeAll(async () => {
    process.env.INGEST_API_KEY = 'receipt-contract-test-key';
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.INGEST_API_KEY;
    else process.env.INGEST_API_KEY = originalKey;
    await app?.close();
  });
  it('recovers a lost original ACK after seven days and generation cutover with original completion and outcomes', async () => fixture(async ({ request, complete, generation }) => {
    const batchId = await complete();
    const original = await getIngestBatchStatus(batchId);
    await db.transaction(async tx => {
      expect(await retireIngestOperationalEvidence(tx, 'funda', generation, { now: retirementAt }))
        .toMatchObject({ retiredBatches: 1, deletedEvidence: 1, retiredSequence: 1 });
      await activateIngestWriterGeneration(tx, 'funda', generation + 1);
    });
    const before = await counts();
    expect(await acceptIngestBatch(ingestBatchRequestSchema.parse(JSON.parse(JSON.stringify(request)))))
      .toMatchObject({ batchId, duplicate: true, status: 'completed', acceptedAt: observedAt });
    expect(await getIngestBatchStatus(batchId)).toEqual(original);
    expect(await counts()).toEqual(before);
    const [row] = await db.select().from(ingestBatches).where(eq(ingestBatches.id, batchId));
    expect(row?.payloadJson).toEqual({ ingestVersion: 2, writerGeneration: generation });
    expect(row?.payloadHash).toHaveLength(64);
  }));

  it('keeps an exact hash mismatch as a conflict after compaction and generation rotation', async () => fixture(async ({ request, complete, generation }) => {
    await complete();
    await db.transaction(async tx => {
      await retireIngestOperationalEvidence(tx, 'funda', generation, { now: retirementAt });
      await activateIngestWriterGeneration(tx, 'funda', generation + 1);
    });
    const changed = ingestBatchRequestSchema.parse({ ...request, records: request.records!.map(record => ({ ...record, facts: { askingPrice: null } })) });
    await expect(acceptIngestBatch(changed)).rejects.toMatchObject({ name: 'IngestIdempotencyConflictError' });
  }));

  it('rejects wholly retired and mixed old/new unknown batches before creating receipt, run or identity state', async () => fixture(async ({ request, complete, generation }) => {
    await complete();
    await db.transaction(tx => retireIngestOperationalEvidence(tx, 'funda', generation, { now: retirementAt }));
    const before = await counts();
    for (const mixed of [false, true]) {
      const records = mixed ? [...request.records!, { ...request.records![0]!, eventId: randomUUID(), sequence: 2 }] : request.records!;
      const unknown = ingestBatchRequestSchema.parse({ ...request, idempotencyKey: randomUUID(), upstreamRunKey: randomUUID(), records });
      await expect(acceptIngestBatch(unknown)).rejects.toMatchObject({ name: 'IngestEvidenceRetiredError' });
      expect(await counts()).toEqual(before);
    }
    expect(await getIngestBatchStatus(randomUUID())).toBeNull();
  }));

  it('preserves exact retries inside the seven-day window and detects changed content', async () => fixture(async ({ request, complete }) => {
    const batchId = await complete();
    expect(await acceptIngestBatch(request)).toMatchObject({ batchId, duplicate: true, status: 'completed' });
    await expect(acceptIngestBatch({ ...request, batchSequence: 99 })).rejects.toMatchObject({ name: 'IngestIdempotencyConflictError' });
    const [row] = await db.select().from(ingestBatches).where(eq(ingestBatches.id, batchId));
    expect(row?.payloadCompactedAt).toBeNull();
  }));

  it('extracts older raw business samples before completing a new overlapping receipt', async () => fixture(async ({ request, complete, generation }) => {
    const original = await complete();
    await db.execute(sql`DELETE FROM source_identity_business_history WHERE identity_id IN
      (SELECT identity_id FROM ingest_evidence WHERE source_name='funda' AND generation=${generation})`);
    await db.update(ingestBatches).set({ businessHistoryCompletedAt: null }).where(eq(ingestBatches.id, original));
    const replay = ingestBatchRequestSchema.parse({ ...request, idempotencyKey: randomUUID() });
    const receipt = await acceptIngestBatch(replay);
    await db.transaction(async tx => {
      expect(await processV2Evidence(tx, receipt.batchId, replay)).toMatchObject({ ingestedCount: 0, updatedCount: 0, projectionChanged: false });
      const history = await tx.execute<{ field_path: string; value_json: unknown }>(sql`
        SELECT field_path,value_json FROM source_identity_business_history WHERE identity_id IN
          (SELECT identity_id FROM ingest_evidence WHERE source_name='funda' AND generation=${generation})
        ORDER BY field_path`);
      expect(Array.from(history)).toEqual([{ field_path: 'askingPrice', value_json: 500000 }, { field_path: 'lifecycleStatus', value_json: 'available' }]);
    });
  }));

  it('does not commit a retirement frontier or a compact body when the transaction rolls back', async () => fixture(async ({ request, complete, generation }) => {
    const batchId = await complete();
    const rollback = new Error('receipt retention fixture rollback');
    await expect(db.transaction(async tx => {
      await retireIngestOperationalEvidence(tx, 'funda', generation, { now: retirementAt });
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db.select().from(ingestRetiredSequences).where(eq(ingestRetiredSequences.generation, generation)))).toHaveLength(0);
    expect((await db.select().from(ingestBatches).where(eq(ingestBatches.id, batchId)))[0]?.payloadCompactedAt).toBeNull();
    expect(await acceptIngestBatch(request)).toMatchObject({ batchId, duplicate: true });
  }));

  it('serves the original authenticated HTTP receipt and explicitly rejects an unknown retired request', async () => fixture(async ({ request, complete, generation }) => {
    const batchId = await complete();
    const original = await getIngestBatchStatus(batchId);
    await db.transaction(tx => retireIngestOperationalEvidence(tx, 'funda', generation, { now: retirementAt }));
    const headers = { 'x-api-key': 'receipt-contract-test-key' };
    const accepted = await app.inject({ method: 'POST', url: '/api/ingest/listings', headers, payload: request });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ batchId, duplicate: true, status: 'completed' });
    const status = await app.inject({ method: 'GET', url: `/api/ingest/batches/${batchId}`, headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual(original);
    const retired = await app.inject({ method: 'POST', url: '/api/ingest/listings', headers,
      payload: { ...request, idempotencyKey: randomUUID() } });
    expect(retired.statusCode).toBe(409);
    expect(retired.json()).toMatchObject({ error: 'EVIDENCE_RETIRED' });
    expect((await app.inject({ method: 'GET', url: `/api/ingest/batches/${batchId}` })).statusCode).toBe(401);
  }));
});

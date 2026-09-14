/** Real PostgreSQL; unique source fixtures roll back without ambient seed dependencies. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../../db/index.js';
import { retireIngestOperationalEvidence, runIngestOperationalRetention } from '../../services/ingest/operational-retention.js';
import { encodeOpaqueIngestCursor } from '../../services/ingest/cursor.js';

const now = new Date('2026-09-20T12:00:00Z');
const old = '2026-09-01T12:00:00Z';
const recent = '2026-09-19T12:00:00Z';
const fixtureRollback = new Error('retention fixture rollback');
type Fixture = { tx: DbTransaction; source: string; identity: string };

async function fixture(run: (f: Fixture) => Promise<void>) {
  await db.transaction(async tx => {
    const source = `retention-${randomUUID()}`;
    const identity = randomUUID();
    await tx.execute(sql`INSERT INTO source_listing_identities(id,source_name,primary_id,primary_id_type)
      VALUES (${identity},${source},'fixture-stable-id','global_id')`);
    await run({ tx, source, identity });
    throw fixtureRollback;
  }).catch(error => { if (error !== fixtureRollback) throw error; });
}

function record(sequence: number, generation = 1) {
  return { kind: 'facts', eventId: `g${generation}-event-${sequence}`, sequence, observedAt: old,
    collector: 'direct', evidenceStrength: 'detail',
    identity: { sourceListingId: 'fixture-stable-id', sourceListingIdKind: 'global_id', aliases: [] },
    facts: { askingPrice: 400000 + sequence } };
}

async function evidence(f: Fixture, first: number, last: number, createdAt = old, generation = 1) {
  for (let index = first; index <= last; index += 1) {
    await f.tx.execute(sql`INSERT INTO ingest_evidence
      (source_name,event_id,generation,sequence,identity_id,kind,observed_at,collector,payload_json,payload_hash,created_at)
      VALUES (${f.source},${`g${generation}-event-${index}`},${generation},${index},${f.identity},'facts',${old}::timestamptz,
        'direct',${JSON.stringify(record(index, generation))}::jsonb,${'a'.repeat(64)},${createdAt}::timestamptz)`);
  }
}

async function batch(f: Fixture, first: number, last: number, options: {
  status?: string; completedAt?: string; historyReady?: boolean; generation?: number;
  maintenanceRequested?: string; maintenanceCompleted?: string; candidateId?: string;
  v1?: boolean; missingMetadata?: boolean;
} = {}) {
  const id = randomUUID();
  const records = Array.from({ length: last - first + 1 }, (_, offset) => ({
    ...record(first + offset, options.generation ?? 1), ...(options.candidateId ? { sourceCandidateId: options.candidateId } : {}),
  }));
  const payload = options.v1 ? { listings: [{ sourceListingId: 'v1-terminal-audit' }] }
    : { ingestVersion: 2, writerGeneration: options.generation ?? 1, records };
  await f.tx.execute(sql`INSERT INTO ingest_batches
    (id,source_name,batch_sequence,idempotency_key,cursor_start,cursor_end,payload_json,status,
      completed_at,received_at,writer_generation,first_sequence,last_sequence,payload_hash,
      business_history_completed_at,maintenance_requested_at,maintenance_completed_at,
      ingested_count,updated_count,skipped_count)
    VALUES (${id},${f.source},0,${id},'before','after',${JSON.stringify(payload)}::jsonb,
      ${options.status ?? 'completed'}::ingest_batch_status,${options.completedAt ?? old}::timestamptz,${old}::timestamptz,
      ${options.v1 || options.missingMetadata ? null : options.generation ?? 1},
      ${options.v1 || options.missingMetadata ? null : first},${options.v1 || options.missingMetadata ? null : last},
      ${'b'.repeat(64)},${options.historyReady === false ? null : old}::timestamptz,
      ${options.maintenanceRequested ?? null}::timestamptz,${options.maintenanceCompleted ?? null}::timestamptz,2,3,4)`);
  return id;
}

async function state(f: Fixture) {
  const [row] = await f.tx.execute<{ evidence: number; compacted: number; frontier: number }>(sql`
    SELECT (SELECT count(*)::int FROM ingest_evidence WHERE source_name=${f.source}) AS evidence,
      (SELECT count(*)::int FROM ingest_batches WHERE source_name=${f.source} AND payload_compacted_at IS NOT NULL) AS compacted,
      COALESCE((SELECT retired_sequence::int FROM ingest_retired_sequences WHERE source_name=${f.source} AND generation=1),0) AS frontier
  `);
  return row!;
}

describe('raw ingest operational retirement', () => {
  it('preserves the permanent receipt, exact outcomes and v1 audits while deleting old v2 raw evidence', async () => fixture(async f => {
    await evidence(f, 1, 3);
    const receipt = await batch(f, 1, 3);
    const legacy = await batch(f, 1, 1, { v1: true });
    const result = await retireIngestOperationalEvidence(f.tx, f.source, 1, { now });
    expect(result).toMatchObject({ retiredBatches: 1, deletedEvidence: 3, retiredSequence: 3 });
    const rows = await f.tx.execute<{ id: string; payload_json: unknown; payload_hash: string; ingested_count: number; updated_count: number; skipped_count: number; cursor_end: string }>(sql`
      SELECT id,payload_json,payload_hash,ingested_count,updated_count,skipped_count,cursor_end FROM ingest_batches WHERE source_name=${f.source}
    `);
    expect(rows.find(row => row.id === receipt)).toMatchObject({ payload_json: { ingestVersion: 2, writerGeneration: 1 },
      payload_hash: 'b'.repeat(64), ingested_count: 2, updated_count: 3, skipped_count: 4, cursor_end: 'after' });
    expect(rows.find(row => row.id === legacy)?.payload_json).toEqual({ listings: [{ sourceListingId: 'v1-terminal-audit' }] });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ status: 'noop', retiredSequence: 3 });
  }));

  it.each(['accepted', 'queued', 'processing', 'retryable', 'failed', 'superseded'])('pins %s overlap without deleting its raw work', async status => fixture(async f => {
    await evidence(f, 1, 4);
    await batch(f, 1, 4);
    const pinned = await batch(f, 2, 4, { status });
    const result = await retireIngestOperationalEvidence(f.tx, f.source, 1, { now });
    expect(result).toMatchObject({ retiredBatches: 1, deletedEvidence: 1, retiredSequence: 1 });
    const [row] = await f.tx.execute<{ payload_compacted_at: unknown; status: string }>(sql`SELECT payload_compacted_at,status FROM ingest_batches WHERE id=${pinned}`);
    expect(row).toMatchObject({ payload_compacted_at: null, status });
    expect(await state(f)).toEqual({ evidence: 3, compacted: 1, frontier: 1 });
  }));

  it('pins recent overlapping receipts and later retires them without an oversized overlap stall', async () => fixture(async f => {
    await evidence(f, 1, 2);
    await batch(f, 1, 2);
    const fresh = await batch(f, 1, 2, { completedAt: recent });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 0 });
    expect(await state(f)).toEqual({ evidence: 2, compacted: 1, frontier: 0 });
    await f.tx.execute(sql`UPDATE ingest_batches SET completed_at=${old}::timestamptz WHERE id=${fresh}`);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 2 });
  }));

  it('compacts a thousand overlapping receipts in bounded passes before releasing their event prefix', async () => fixture(async f => {
    await evidence(f, 1, 1);
    const template = await batch(f, 1, 1);
    await f.tx.execute(sql`INSERT INTO ingest_batches(source_name,batch_sequence,idempotency_key,cursor_end,payload_json,status,
      completed_at,received_at,writer_generation,first_sequence,last_sequence,payload_hash,business_history_completed_at)
      SELECT source_name,0,gen_random_uuid()::text,cursor_end,payload_json,status,completed_at,received_at,
        writer_generation,first_sequence,last_sequence,payload_hash,business_history_completed_at
      FROM ingest_batches CROSS JOIN generate_series(1,1000) WHERE id=${template}`);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, batchLimit: 500 })).toMatchObject({ retiredBatches: 500, deletedEvidence: 0 });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, batchLimit: 500 })).toMatchObject({ retiredBatches: 500, deletedEvidence: 0 });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, batchLimit: 500 })).toMatchObject({ retiredBatches: 1, deletedEvidence: 1 });
  }));

  it('requires fresh enough maintenance completion and preserves recently created raw evidence', async () => fixture(async f => {
    await evidence(f, 1, 1, recent);
    const id = await batch(f, 1, 1, { maintenanceRequested: recent, maintenanceCompleted: old });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 0, deletedEvidence: 0 });
    await f.tx.execute(sql`UPDATE ingest_batches SET maintenance_completed_at=${recent}::timestamptz WHERE id=${id}`);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 0, reason: 'recent_evidence' });
  }));

  it('pins a queued explicit candidate until its dependency is complete', async () => fixture(async f => {
    await evidence(f, 1, 1);
    const propertyId = randomUUID();
    const candidate = randomUUID();
    await f.tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,city,postal_code,geometry)
      VALUES (${propertyId},'NL','Retention fixture',1,'Fixture','1234AB',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    await f.tx.execute(sql`INSERT INTO listing_candidate_handoffs(id,source_name,property_id,source_url_raw,source_url_canonical,state)
      VALUES (${candidate},${f.source},${propertyId},'https://fixture.invalid/listing','https://fixture.invalid/listing','queued')`);
    await batch(f, 1, 1, { candidateId: candidate });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 0, deletedEvidence: 0 });
    await f.tx.execute(sql`UPDATE listing_candidate_handoffs SET state='delivered' WHERE id=${candidate}`);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 1 });
  }));

  it('stops at metadata gaps and never advances through a missing raw sequence', async () => fixture(async f => {
    await evidence(f, 1, 1);
    await evidence(f, 3, 3);
    await batch(f, 1, 3);
    await expect(f.tx.transaction(tx => retireIngestOperationalEvidence(tx, f.source, 1, { now }))).rejects.toThrow('missing sequence');
    expect(await state(f)).toEqual({ evidence: 2, compacted: 0, frontier: 0 });
    await batch(f, 1, 3, { missingMetadata: true });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 0, reason: 'receipt_metadata_pending' });
  }));

  it('drains a fully compacted receipt in bounded contiguous event chunks', async () => fixture(async f => {
    await evidence(f, 1, 5);
    await batch(f, 1, 5);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, evidenceLimit: 2 })).toMatchObject({ retiredBatches: 1, deletedEvidence: 2, retiredSequence: 2 });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, evidenceLimit: 2 })).toMatchObject({ retiredBatches: 0, deletedEvidence: 2, retiredSequence: 4 });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, evidenceLimit: 2 })).toMatchObject({ retiredBatches: 0, deletedEvidence: 1, retiredSequence: 5 });
  }));

  it('advances only to the first receipt coverage gap, even when later raw sequences exist', async () => fixture(async f => {
    await evidence(f, 1, 5);
    await batch(f, 1, 2);
    await batch(f, 4, 5);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 2, deletedEvidence: 2, retiredSequence: 2 });
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 0, deletedEvidence: 0, retiredSequence: 2, reason: 'sequence_gap' });
    expect(await state(f)).toEqual({ evidence: 3, compacted: 2, frontier: 2 });
  }));

  it('rolls receipt bodies, history extraction, evidence and frontier back together', async () => fixture(async f => {
    await evidence(f, 1, 1);
    await batch(f, 1, 1, { historyReady: false });
    await expect(f.tx.transaction(async tx => {
      await retireIngestOperationalEvidence(tx, f.source, 1, { now });
      throw new Error('interrupt after retirement');
    })).rejects.toThrow('interrupt after retirement');
    expect(await state(f)).toEqual({ evidence: 1, compacted: 0, frontier: 0 });
    const [row] = await f.tx.execute<{ business_history_completed_at: unknown }>(sql`SELECT business_history_completed_at FROM ingest_batches WHERE source_name=${f.source}`);
    expect(row?.business_history_completed_at).toBeNull();
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now })).toMatchObject({ retiredBatches: 1, deletedEvidence: 1 });
  }));

  it('bounds history extraction separately without starving ready receipt bodies behind its backlog', async () => fixture(async f => {
    await evidence(f, 1, 3);
    await batch(f, 1, 1, { historyReady: false });
    const pending = await batch(f, 2, 2, { historyReady: false });
    const ready = await batch(f, 3, 3);
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, batchLimit: 1 })).toMatchObject({ retiredBatches: 2, deletedEvidence: 1, retiredSequence: 1 });
    const rows = await f.tx.execute<{ id: string; payload_compacted_at: unknown }>(sql`SELECT id,payload_compacted_at FROM ingest_batches WHERE source_name=${f.source}`);
    expect(rows.find(row => row.id === pending)?.payload_compacted_at).toBeNull();
    expect(rows.find(row => row.id === ready)?.payload_compacted_at).not.toBeNull();
    expect(await retireIngestOperationalEvidence(f.tx, f.source, 1, { now, batchLimit: 1 })).toMatchObject({ retiredBatches: 1, deletedEvidence: 2, retiredSequence: 3 });
  }));

  it('yields to a source writer lock held by another PostgreSQL connection', async () => {
    const source = `retention-${randomUUID()}`;
    await db.transaction(async writer => {
      await writer.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${source}))`);
      const result = await db.transaction(tx => retireIngestOperationalEvidence(tx, source, 1, { now }));
      expect(result).toMatchObject({ status: 'locked', retiredBatches: 0, deletedEvidence: 0 });
      const [row] = await writer.execute<{ count: number }>(sql`SELECT count(*)::int FROM ingest_retired_sequences WHERE source_name=${source}`);
      expect(row?.count).toBe(0);
    });
  });

  it('rotates bounded sweep pages past a permanently pinned generation', async () => fixture(async f => {
    await evidence(f, 1, 1);
    await batch(f, 1, 1, { status: 'failed' });
    await evidence(f, 1, 1, old, 2);
    await batch(f, 1, 1, { generation: 2 });
    const options = { sourceNames: [f.source], sourceLimit: 1, now };
    const first = await runIngestOperationalRetention(options, f.tx);
    const second = await runIngestOperationalRetention(options, f.tx);
    expect(Number(first.deletedEvidence) + Number(second.deletedEvidence)).toBe(1);
    const [row] = await f.tx.execute<{ generations: number[] }>(sql`
      SELECT array_agg(generation::int ORDER BY generation) AS generations FROM ingest_evidence WHERE source_name=${f.source}
    `);
    expect(row?.generations).toEqual([1]);
  }));

  it('discovers historical v2-only data and finalizes metadata and durable business history before retirement', async () => fixture(async f => {
    const historical = { ...f, source: 'funda', identity: randomUUID() };
    const generation = 900001;
    await f.tx.execute(sql`INSERT INTO source_listing_identities(id,source_name,primary_id,primary_id_type)
      VALUES (${historical.identity},'funda',${randomUUID()},'global_id')`);
    await evidence(historical, 1, 1, old, generation);
    const id = await batch(historical, 1, 1, { generation, missingMetadata: true, historyReady: false });
    const payload = { ingestVersion: 2, writerGeneration: generation, records: [record(1, generation)],
      sourceName: 'funda', idempotencyKey: id, batchSequence: 0, cursorStart: null,
      cursorEnd: encodeOpaqueIngestCursor({ changedAt: old, listingKey: 'history-fixture' }) };
    await f.tx.execute(sql`UPDATE ingest_batches SET payload_json=${JSON.stringify(payload)}::jsonb,payload_hash=NULL WHERE id=${id}`);
    await runIngestOperationalRetention({ sourceNames: ['funda'], sourceLimit: 100, now }, f.tx);
    const [receipt] = await f.tx.execute<{ writer_generation: string; payload_compacted_at: unknown; business_history_completed_at: unknown }>(sql`
      SELECT writer_generation::text,payload_compacted_at,business_history_completed_at FROM ingest_batches WHERE id=${id}
    `);
    expect(receipt?.writer_generation).toBe(String(generation));
    expect(receipt?.payload_compacted_at).not.toBeNull();
    expect(receipt?.business_history_completed_at).not.toBeNull();
    const [counts] = await f.tx.execute<{ history: number; evidence: number }>(sql`
      SELECT (SELECT count(*)::int FROM source_identity_business_history WHERE identity_id=${historical.identity}) AS history,
        (SELECT count(*)::int FROM ingest_evidence WHERE identity_id=${historical.identity}) AS evidence
    `);
    expect(counts).toEqual({ history: 1, evidence: 0 });
  }));
});

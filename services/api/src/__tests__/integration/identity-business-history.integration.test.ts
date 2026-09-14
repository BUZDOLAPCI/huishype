import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import { db, canonicalListings, ingestBatches, ingestEvidence, ingestWriterGenerations,
  sourceListingIdentities, sourceIdentityBusinessHistory, type DbTransaction } from '../../db/index.js';
import { encodeOpaqueIngestCursor } from '../../services/ingest/cursor.js';
import { ingestBatchRequestSchema } from '../../services/ingest/contracts.js';
import { ingestEvidenceV2Schema, type IngestEvidenceV2 } from '../../services/ingest/v2-contracts.js';
import { processV2Evidence } from '../../services/ingest/v2-processor.js';
import { backfillIdentityBusinessHistoryForBatch } from '../../services/ingest/identity-business-history.js';

const rollback = new Error('business history fixture rollback');
const at = (day: number) => new Date(Date.UTC(2026, 0, 1) + (day-1)*86400000).toISOString();
async function fixture(run: (ctx: {
  tx: DbTransaction; sourceId: string; propertyId: string; street: string; generation: number;
  send: (records: Record<string, unknown>[]) => Promise<{ batchId: string; records: IngestEvidenceV2[] }>;
  identity: () => Promise<typeof sourceListingIdentities.$inferSelect>;
  samples: (field?: string) => Promise<(typeof sourceIdentityBusinessHistory.$inferSelect)[]>;
}) => Promise<void>) {
  await db.transaction(async tx => {
    const sourceId = randomUUID(); const propertyId = randomUUID(); const street = `History fixture ${sourceId}`;
    const generation = Math.floor(Date.now()/1000);
    await tx.insert(ingestWriterGenerations).values({ sourceName: 'funda', generation, lastSequence: 0 })
      .onConflictDoUpdate({ target: ingestWriterGenerations.sourceName, set: { generation, lastSequence: 0 } });
    await tx.execute(sql`INSERT INTO properties(id,country_code,street,house_number,postal_code,city,geometry)
      VALUES (${propertyId},'NL',${street},1,'1234AB','Fixture',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    let sequence = 0;
    async function send(patches: Record<string, unknown>[]) {
      const first = sequence+1;
      const records = patches.map(patch => ingestEvidenceV2Schema.parse({
        eventId: randomUUID(), sequence: ++sequence, observedAt: at(sequence), collector: 'realtyapi', evidenceStrength: 'detail',
        identity: { sourceListingId: sourceId, sourceListingIdKind: 'global_id', aliases: [] }, ...patch,
      }));
      const payload = ingestBatchRequestSchema.parse({ sourceName: 'funda', ingestVersion: 2, writerGeneration: generation,
        idempotencyKey: randomUUID(), batchSequence: first, cursorStart: null, cursorEnd: encodeOpaqueIngestCursor({changedAt:'2026-01-01T00:00:00.000Z',listingKey:String(sequence)}), records });
      const [batch] = await tx.insert(ingestBatches).values({ sourceName: 'funda', batchSequence: first,
        idempotencyKey: payload.idempotencyKey, cursorEnd: payload.cursorEnd, payloadJson: payload as unknown as Record<string, unknown>,
        writerGeneration: generation, firstSequence: first, lastSequence: sequence,
      }).returning();
      await processV2Evidence(tx, batch.id, payload);
      return { batchId: batch.id, records };
    }
    async function identity() {
      const [row] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.primaryId, sourceId));
      return row;
    }
    async function samples(field?: string) {
      const row = await identity();
      const rows = await tx.select().from(sourceIdentityBusinessHistory).where(eq(sourceIdentityBusinessHistory.identityId, row.id));
      return rows.filter(sample => !field || sample.fieldPath===field)
        .sort((a,b) => a.observedAt.getTime()-b.observedAt.getTime() || a.sampleKey.localeCompare(b.sampleKey));
    }
    await run({ tx, sourceId, propertyId, street, generation, send, identity, samples });
    throw rollback;
  }).catch(error => { if (error!==rollback) throw error; });
}

function sparsePrice(price: number | null, day: number) {
  return { kind: 'facts', observedAt: at(day), facts: { askingPrice: price } };
}

describe('Identity business history before property projection', () => {
  it('preserves unresolved sparse fields and actual null clears without fabricated snapshots', async () => fixture(async ({ send, samples, identity }) => {
    await send([{ kind: 'facts', observedAt: at(1), facts: { askingPrice: 500, currency: 'EUR', address: { houseNumberAddition: 'A' } } }]);
    await send([{ kind: 'facts', observedAt: at(2), facts: { priceUnit: 'm2', currency: null, address: { houseNumberAddition: null } } }]);
    await send([sparsePrice(null,3)]);
    expect((await identity()).canonicalListingId).toBeNull();
    expect((await samples('askingPrice')).map(row => [row.observedAt.toISOString(),row.valueJson])).toEqual([[at(1),500],[at(3),null]]);
    expect((await samples('currency')).map(row => row.valueJson)).toEqual(['EUR',null]);
    expect((await samples('address.houseNumberAddition')).map(row => row.valueJson)).toEqual(['A',null]);
    expect(await samples('address.street')).toHaveLength(0);
    expect(await samples('priceUnit')).toHaveLength(1);
  }));

  it('restores raw-window confirmation neighbors around late values and preserves run reversals', async () => fixture(async ({ send, samples }) => {
    await send([sparsePrice(500,1),sparsePrice(500,2.5),sparsePrice(500,3)]);
    expect((await samples('askingPrice')).map(row => row.observedAt.toISOString())).toEqual([at(1),at(3)]);
    await send([sparsePrice(600,2)]);
    expect((await samples('askingPrice')).map(row => [row.observedAt.toISOString(),row.valueJson]))
      .toEqual([[at(1),500],[at(2),600],[at(2.5),500],[at(3),500]]);
    expect((await samples()).some(row => row.confirmationsCompacted)).toBe(true);
  }));

  it('uses only surviving actual samples when late evidence follows raw retirement', async () => fixture(async ({ tx, send, samples, identity }) => {
    await send([sparsePrice(500,1),sparsePrice(500,2.5),sparsePrice(500,3)]);
    await tx.delete(ingestEvidence).where(eq(ingestEvidence.identityId,(await identity()).id));
    await send([sparsePrice(600,2)]);
    expect((await samples('askingPrice')).map(row => [row.observedAt.toISOString(),row.valueJson]))
      .toEqual([[at(1),500],[at(2),600],[at(3),500]]);
    expect((await samples()).some(row => row.observedAt.toISOString()===at(2.5))).toBe(false);
  }));

  it('retains different-value equal-time facts and conditional confirmations without absence lifecycle invention', async () => fixture(async ({ send, samples }) => {
    await send([sparsePrice(500,1),sparsePrice(500,2),sparsePrice(600,2),sparsePrice(500,3)]);
    expect((await samples('askingPrice')).filter(row => row.observedAt.toISOString()===at(2)).map(row=>row.valueJson).sort()).toEqual([500,600]);
    await send([{ kind: 'sighting', observedAt: at(4), availability: 'conditional' },
      { kind: 'sighting', observedAt: at(5), availability: 'conditional' },
      { kind: 'sighting', observedAt: at(6), availability: 'conditional' },
      { kind: 'absence', observedAt: at(7), inventoryManifest: { id:'scan',scopeKey:'scope',completedAt:at(7),coverageStatus:'complete',verified:true } }]);
    expect((await samples('lifecycleStatus')).map(row=>[row.observedAt.toISOString(),row.valueJson])).toEqual([[at(4),'conditional'],[at(6),'conditional']]);
    expect(await samples('inventoryPresence')).toHaveLength(0);
  }));

  it('deduplicates identical replay samples with new transport IDs after old raw rows disappear', async () => fixture(async ({ tx, send, identity, samples }) => {
    await send([sparsePrice(500,1)]);
    const before=await samples();
    await tx.delete(ingestEvidence).where(eq(ingestEvidence.identityId,(await identity()).id));
    await send([sparsePrice(500,1)]);
    expect(await samples()).toEqual(before);
  }));

  it('records late facts before the current projection rejects their old clocks, preserving canonical histories', async () => fixture(async ({ tx, send, street, propertyId, samples }) => {
    await send([{ kind:'facts',observedAt:at(3),facts:{ askingPrice:500,currency:'EUR',lifecycleStatus:'available',
      address:{countryCode:'NL',street,postalCode:'1234AB',houseNumber:1} } }]);
    const [canonicalBefore]=await tx.select().from(canonicalListings).where(eq(canonicalListings.propertyId,propertyId));
    const historyBefore=await tx.execute(sql`SELECT to_jsonb(p) AS row FROM listing_price_observations p WHERE canonical_listing_id=${canonicalBefore.id}::uuid ORDER BY id`);
    await send([sparsePrice(600,2)]);
    const [canonicalAfter]=await tx.select().from(canonicalListings).where(eq(canonicalListings.id,canonicalBefore.id));
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(await tx.execute(sql`SELECT to_jsonb(p) AS row FROM listing_price_observations p WHERE canonical_listing_id=${canonicalBefore.id}::uuid ORDER BY id`)).toEqual(historyBefore);
    expect((await samples('askingPrice')).map(row=>row.valueJson)).toEqual([600,500]);
  }));

  it('preserves alias-quarantined and ambiguous-address facts before their early projection exits', async () => fixture(async ({ tx, sourceId, send, identity, samples, street }) => {
    await send([sparsePrice(500,1)]);
    await send([{ kind:'facts',observedAt:at(2),identity:{sourceListingId:sourceId,sourceListingIdKind:'global_id',
      aliases:[{kind:'global_id',value:`conflicting-${sourceId}`}]},facts:{askingPrice:600,address:{houseNumberAddition:null}} }]);
    expect((await identity()).quarantinedAt).not.toBeNull();
    expect((await samples('askingPrice')).map(row=>row.valueJson)).toEqual([500,600]);
    expect((await samples('askingPrice'))[1].provenanceJson.association).toBe('quarantined');
    const secondId=randomUUID();
    await tx.execute(sql`INSERT INTO properties(country_code,street,house_number,postal_code,city,geometry)
      VALUES ('NL',${street},1,'1234AB','Fixture',ST_SetSRID(ST_MakePoint(5.47,51.44),4326))`);
    await send([{kind:'facts',observedAt:at(3),identity:{sourceListingId:secondId,sourceListingIdKind:'global_id',aliases:[]},
      facts:{askingPrice:700,address:{countryCode:'NL',street,postalCode:'1234AB',houseNumber:1}}}]);
    const [ambiguous]=await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.primaryId,secondId));
    expect(ambiguous.quarantinedAt).not.toBeNull();
    expect(ambiguous.canonicalListingId).toBeNull();
    expect((await tx.select().from(sourceIdentityBusinessHistory).where(eq(sourceIdentityBusinessHistory.identityId,ambiguous.id)))
      .some(row=>row.fieldPath==='askingPrice' && row.valueJson===700)).toBe(true);
  }));

  it('backfills every raw event by its persisted identity before recording batch completion, idempotently', async () => fixture(async ({ tx, send, identity, samples }) => {
    const batch=await send([sparsePrice(500,1),sparsePrice(600,2),sparsePrice(500,3)]);
    const identityId=(await identity()).id;
    await tx.delete(sourceIdentityBusinessHistory).where(eq(sourceIdentityBusinessHistory.identityId,identityId));
    const result=await backfillIdentityBusinessHistoryForBatch(tx,{batchId:batch.batchId});
    expect(result).toMatchObject({events:3,alreadyCompleted:false});
    const before=await samples();
    expect(before.map(row=>row.valueJson)).toEqual([500,600,500]);
    const [receipt]=await tx.select().from(ingestBatches).where(eq(ingestBatches.id,batch.batchId));
    expect(receipt.businessHistoryCompletedAt).not.toBeNull();
    expect(await backfillIdentityBusinessHistoryForBatch(tx,{batchId:batch.batchId})).toEqual({events:0,samples:0,alreadyCompleted:true});
    expect(await samples()).toEqual(before);
  }));

  it('pins missing raw intervals and rolls back both history and completion on failure', async () => fixture(async ({tx,send,identity,samples})=>{
    const batch=await send([sparsePrice(500,1),sparsePrice(600,2)]);
    const identityId=(await identity()).id;
    await tx.delete(sourceIdentityBusinessHistory).where(eq(sourceIdentityBusinessHistory.identityId,identityId));
    await expect(tx.transaction(async nested=>{
      await backfillIdentityBusinessHistoryForBatch(nested,{batchId:batch.batchId});
      throw new Error('after-history-failure');
    })).rejects.toThrow('after-history-failure');
    expect(await samples()).toHaveLength(0);
    expect((await tx.select().from(ingestBatches).where(eq(ingestBatches.id,batch.batchId)))[0].businessHistoryCompletedAt).toBeNull();
    await tx.delete(ingestEvidence).where(eq(ingestEvidence.eventId,batch.records[0].eventId));
    await expect(backfillIdentityBusinessHistoryForBatch(tx,{batchId:batch.batchId})).rejects.toThrow('interval has gaps');
    expect((await tx.select().from(ingestBatches).where(eq(ingestBatches.id,batch.batchId)))[0].businessHistoryCompletedAt).toBeNull();
  }));

  it('keeps a 200-record fact batch proportional to value changes rather than field cadence', async () => fixture(async ({tx,send,identity,samples})=>{
    const facts={askingPrice:500,currency:'EUR',priceType:'sale',pricePeriod:'total',priceUnit:'listing',priceCondition:'asking',
      livingAreaM2:100,numRooms:4.5,energyLabel:'A',propertyType:'house',ogTitle:'History fixture',thumbnailUrl:'https://example.com/image.jpg',
      listedAt:at(1),lifecycleStatus:'available',address:{countryCode:'NL',city:'Fixture',latitude:51.44,longitude:5.47,houseNumberAddition:null}};
    const fieldCount=19;
    const [storageBefore]=await tx.execute<{heap:number;indexes:number}>(sql`
      SELECT pg_relation_size('source_identity_business_history')::float8 AS heap,
        pg_indexes_size('source_identity_business_history')::float8 AS indexes
    `);
    const started=performance.now();
    await send(Array.from({length:200},(_,index)=>({kind:'facts',observedAt:new Date(Date.parse(at(1))+index*60000).toISOString(),facts})));
    const durationMs=Math.round(performance.now()-started);
    expect(await samples()).toHaveLength(fieldCount*2);
    const identityId=(await identity()).id;
    const [sizes]=await tx.execute<{history_rows:number;history_bytes:string;raw_rows:number;raw_bytes:string}>(sql`
      SELECT (SELECT count(*)::integer FROM source_identity_business_history WHERE identity_id=${identityId}::uuid) AS history_rows,
      (SELECT sum(pg_column_size(h))::text FROM source_identity_business_history h WHERE identity_id=${identityId}::uuid) AS history_bytes,
      (SELECT count(*)::integer FROM ingest_evidence WHERE identity_id=${identityId}::uuid) AS raw_rows,
      (SELECT sum(pg_column_size(e))::text FROM ingest_evidence e WHERE identity_id=${identityId}::uuid) AS raw_bytes
    `);
    const [storageAfter]=await tx.execute<{heap:number;indexes:number}>(sql`
      SELECT pg_relation_size('source_identity_business_history')::float8 AS heap,
        pg_indexes_size('source_identity_business_history')::float8 AS indexes
    `);
    console.info('Identity business history 200-record batch evidence',JSON.stringify({durationMs,fieldsPerRecord:fieldCount,
      hypotheticalCadenceRows:200*fieldCount,...sizes,
      allocatedHeapGrowthBytes:storageAfter.heap-storageBefore.heap,allocatedIndexGrowthBytes:storageAfter.indexes-storageBefore.indexes,
      storageNote:'allocated growth includes immediate-reduction dead tuples pending ordinary vacuum; live sample bytes are separate',semantics:'actual retained endpoint samples; no continuous intervals'}));
  }),30000);
  it('measures initial durable sample and index cost for a representative 200-identity batch', async () => fixture(async ({tx,send,sourceId})=>{
    const facts={askingPrice:500,currency:'EUR',priceType:'sale',pricePeriod:'total',priceUnit:'listing',priceCondition:'asking',
      livingAreaM2:100,numRooms:4.5,energyLabel:'A',propertyType:'house',ogTitle:'History fixture',thumbnailUrl:'https://example.com/image.jpg',
      listedAt:at(1),lifecycleStatus:'available',address:{countryCode:'NL',city:'Fixture',latitude:51.44,longitude:5.47,houseNumberAddition:null}};
    const [before]=await tx.execute<{heap:number;indexes:number}>(sql`
      SELECT pg_relation_size('source_identity_business_history')::float8 AS heap,
        pg_indexes_size('source_identity_business_history')::float8 AS indexes
    `);
    const started=performance.now();
    await send(Array.from({length:200},(_,index)=>({kind:'facts',observedAt:at(1),facts,
      identity:{sourceListingId:`${sourceId}-${index}`,sourceListingIdKind:'global_id',aliases:[]}})));
    const durationMs=Math.round(performance.now()-started);
    const [measure]=await tx.execute<{rows:number;bytes:string;heap:number;indexes:number}>(sql`
      SELECT count(*)::integer AS rows,sum(pg_column_size(h))::text AS bytes,
        pg_relation_size('source_identity_business_history')::float8 AS heap,
        pg_indexes_size('source_identity_business_history')::float8 AS indexes
      FROM source_identity_business_history h JOIN source_listing_identities i ON i.id=h.identity_id
      WHERE i.primary_id LIKE ${sourceId+'-%'}
    `);
    expect(measure.rows).toBe(3800);
    console.info('Identity business history initial 200-identity batch evidence',JSON.stringify({durationMs,identities:200,fieldsPerRecord:19,
      historyRows:measure.rows,liveTupleBytes:Number(measure.bytes),allocatedHeapGrowthBytes:measure.heap-before.heap,
      allocatedIndexGrowthBytes:measure.indexes-before.indexes,
      projection300kIdentitiesLiveTupleBytes:Math.round(Number(measure.bytes)*1500),
      projectionAssumption:'300,000 identities each with19 first actual field samples; tuple bytes only, indexes/additional value changes separate'}));
  }),30000);

});

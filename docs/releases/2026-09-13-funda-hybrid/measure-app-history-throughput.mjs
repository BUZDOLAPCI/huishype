import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (process.env.HISTORY_E2E_MEASUREMENT !== '1') throw new Error('Opt in with HISTORY_E2E_MEASUREMENT=1');
const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.pathname.endsWith('_test') || !['127.0.0.1','localhost'].includes(url.hostname)) {
  throw new Error('Only a local *_test database is permitted');
}
const cwd = process.env.HISTORY_REPO_ROOT ?? process.cwd();
const require = createRequire(resolve(cwd,'services/api/package.json'));
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const load = relative => import(pathToFileURL(resolve(cwd,relative)).href);
const schema = await load('services/api/src/db/schema.ts');
const { processV2Evidence } = await load('services/api/src/services/ingest/v2-processor.ts');
const { ingestBatchRequestSchema } = await load('services/api/src/services/ingest/contracts.ts');
const { encodeOpaqueIngestCursor } = await load('services/api/src/services/ingest/cursor.ts');
const { closeConnection } = await load('services/api/src/db/index.ts');
let statements = 0;
const client = postgres(url.toString(),{max:1,onnotice:()=>{},debug:()=>{statements+=1;}});
const database = drizzle(client,{schema});
const prefix = `capacity-${randomUUID()}`;
const rollback = new Error('measurement fixture rollback');
const evidence = {
  measurement:'whole_processV2Evidence_1000_identity_fixture',identities:1000,exactLinked:500,unresolved:500,
  batchRecords:200,fieldsPerCompleteFacts:19,eventsPerIdentity:5,
  phases:[],
  timingScope:'actual processor and per-batch savepoint transaction; outer transaction rolls all fixtures back, so durable COMMIT/fsync is excluded',
  notes:[
    'No source calls, paid requests, API runtime, worker runtime, or mocked database behavior.',
    'Each identity has distinct global/tiny/URL aliases; half have exact properties and half remain unresolved.',
    'Replay has two actual-clock field groups per listing:17 metadata/address/lifecycle fields then2 price/currency fields.',
    'First routine full facts renew old availability; repeated same-state full facts and available sightings keep facts unchanged.',
    'Statement counts are postgres driver debug invocations; no SQL text, parameters, aliases, or property IDs are logged.',
    'Synthetic local PostgreSQL timing;300k and366k/day values are extrapolations, not production throughput guarantees.',
    'Raw bodies, permanent real value changes, WAL/fsync, background load and maintenance headroom remain separate.',
  ],
};
const outputPath='/tmp/hh-business-history-e2e.json';
const now=Date.now();
const time = hoursAgo => new Date(now-hoursAgo*3600000).toISOString();
const street=`Capacity road ${prefix}`;
function facts(index) {
  return {askingPrice:500000,currency:'EUR',priceType:'sale',pricePeriod:'total',priceUnit:'listing',priceCondition:'asking',
    livingAreaM2:100,numRooms:4.5,energyLabel:'A',lifecycleStatus:'available',
    sourceUrl:`https://www.funda.nl/detail/koop/synthetic/${prefix}-${index}/`,
    address:{countryCode:'NL',street,postalCode:'1234AB',houseNumber:index+1,houseNumberAddition:null,city:'Synthetic fixture town',latitude:51.44,longitude:5.47}};
}
function identity(index) {
  return {sourceListingId:`${prefix}-${index}`,sourceListingIdKind:'global_id',aliases:[
    {kind:'tiny_id',value:`tiny-${prefix}-${index}`},
    {kind:'canonical_url',value:facts(index).sourceUrl},
  ]};
}
try {
  await database.transaction(async tx => {
    const generation=Math.floor(now/1000);
    await tx.insert(schema.ingestWriterGenerations).values({sourceName:'funda',generation,lastSequence:0})
      .onConflictDoUpdate({target:schema.ingestWriterGenerations.sourceName,set:{generation,lastSequence:0}});
    await tx.execute(sql`INSERT INTO properties(country_code,street,house_number,postal_code,city,geometry)
      SELECT 'NL',${street},n,'1234AB','Synthetic fixture town',ST_SetSRID(ST_MakePoint(5.47,51.44),4326)
      FROM generate_series(1,500)n`);
    let sequence=0;
    const phaseInputs=[
      {name:'historical_replay_metadata',kind:'facts',observedAt:time(30*24),fields:index=>{
        const {askingPrice,currency,...metadata}=facts(index);void askingPrice;void currency;return metadata;
      }},
      {name:'historical_replay_price_group',kind:'facts',observedAt:time(29*24),fields:()=>({askingPrice:500000,currency:'EUR'})},
      {name:'routine_complete_facts',kind:'facts',observedAt:time(1),fields:facts},
      {name:'routine_unchanged_complete_facts',kind:'facts',observedAt:time(0.5),fields:facts},
      {name:'routine_available_sightings',kind:'sighting',observedAt:time(0)},
    ];
    for (const phase of phaseInputs) {
      const batches=[]; const phaseStarted=performance.now();const phaseQueries=statements;
      let ingested=0,updated=0,skipped=0,projectionChangedBatches=0,changedPropertyReferences=0;
      for (let start=0;start<1000;start+=200) {
        const first=sequence+1;
        const records=Array.from({length:200},(_,offset)=>{
          const index=start+offset;
          return {eventId:randomUUID(),sequence:++sequence,observedAt:phase.observedAt,collector:'realtyapi',
            evidenceStrength:phase.kind==='facts'?'detail':'inventory',identity:identity(index),kind:phase.kind,
            ...(phase.kind==='facts'?{facts:phase.fields(index)}:{availability:'available'})};
        });
        const payload=ingestBatchRequestSchema.parse({sourceName:'funda',ingestVersion:2,writerGeneration:generation,
          idempotencyKey:randomUUID(),batchSequence:first,cursorStart:null,
          cursorEnd:encodeOpaqueIngestCursor({changedAt:'2026-01-01T00:00:00.000Z',listingKey:String(sequence).padStart(20,'0')}),records});
        const began=performance.now();const beforeQueries=statements;
        const result=await tx.transaction(async batchTx=>{
          const [batch]=await batchTx.insert(schema.ingestBatches).values({sourceName:'funda',batchSequence:first,
            idempotencyKey:payload.idempotencyKey,cursorEnd:payload.cursorEnd,payloadJson:payload,
            writerGeneration:generation,firstSequence:first,lastSequence:sequence}).returning({id:schema.ingestBatches.id});
          return processV2Evidence(batchTx,batch.id,payload);
        });
        batches.push({batch:batches.length+1,records:200,durationMs:Math.round(performance.now()-began),statements:statements-beforeQueries,
          ingested:result.ingestedCount,updated:result.updatedCount,skipped:result.skippedCount,
          projectionChanged:result.projectionChanged,changedPropertyReferences:result.changedPropertyIds.length});
        ingested+=result.ingestedCount;updated+=result.updatedCount;skipped+=result.skippedCount;
        projectionChangedBatches+=Number(result.projectionChanged);changedPropertyReferences+=result.changedPropertyIds.length;
      }
      const durationMs=Math.round(performance.now()-phaseStarted);const queryCount=statements-phaseQueries;
      const sorted=batches.map(row=>row.durationMs).sort((a,b)=>a-b);
      const [state]=await tx.execute(sql`SELECT
        (SELECT count(*)::integer FROM source_identity_business_history h JOIN source_listing_identities i ON i.id=h.identity_id WHERE i.primary_id LIKE ${prefix+'-%'}) AS business_samples,
        (SELECT COALESCE(sum(pg_column_size(h)),0)::float8 FROM source_identity_business_history h JOIN source_listing_identities i ON i.id=h.identity_id WHERE i.primary_id LIKE ${prefix+'-%'}) AS business_tuple_bytes,
        (SELECT count(*)::integer FROM source_listing_identities WHERE primary_id LIKE ${prefix+'-%'}) AS identities,
        (SELECT count(*)::integer FROM source_listing_identities WHERE primary_id LIKE ${prefix+'-%'} AND canonical_listing_id IS NOT NULL) AS bound_identities,
        (SELECT count(*)::integer FROM ingest_evidence e JOIN source_listing_identities i ON i.id=e.identity_id WHERE i.primary_id LIKE ${prefix+'-%'}) AS raw_events,
        (SELECT count(*)::integer FROM listing_observations WHERE ingest_batch_id IN (SELECT id FROM ingest_batches WHERE writer_generation=${generation} AND source_name='funda')) AS compatibility_observations`);
      const row={phase:phase.name,records:1000,durationMs,statements:queryCount,p50BatchMs:sorted[2],maxBatchMs:sorted.at(-1),
        recordsPerSecond:1000000/durationMs,projection300kIdentityDurationMs:durationMs*300,
        equivalent366kRecordsPerDayProcessingHours:durationMs*366/3600000,
        maxBatchFractionOf15MinuteReceiptHead:sorted.at(-1)/900000,
        ingested,updated,skipped,projectionChangedBatches,changedPropertyReferences,...state,batches};
      evidence.phases.push(row);await writeFile(outputPath,`${JSON.stringify(evidence,null,2)}\n`,{mode:0o600});
      console.log(JSON.stringify(row));
    }
    evidence.totalRecords=sequence;
    evidence.totalMeasuredPhaseMs=evidence.phases.reduce((sum,phase)=>sum+phase.durationMs,0);
    evidence.totalProcessorStatements=evidence.phases.reduce((sum,phase)=>sum+phase.statements,0);
    evidence.projected300kIdentitiesFiveEventsMs=evidence.totalMeasuredPhaseMs*300;
    throw rollback;
  });
} catch(error) {
  if(error!==rollback) throw error;
  evidence.fixturesRolledBack=true;
} finally {
  await client.end();await closeConnection();
  await writeFile(outputPath,`${JSON.stringify(evidence,null,2)}\n`,{mode:0o600});
}

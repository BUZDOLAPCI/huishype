import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

if (process.env.HISTORY_CAPACITY_MEASUREMENT !== '1') throw new Error('Opt in with HISTORY_CAPACITY_MEASUREMENT=1');
const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('Only an explicitly named local *_test database is permitted');
}
const require = createRequire(resolve(process.cwd(), 'services/api/package.json'));
const postgres = require('postgres');
const q = postgres(url.toString(), { max: 1, onnotice: () => {} });
const schema = `history_capacity_${randomUUID().replaceAll('-', '')}`;
const table = `${schema}.business_history`;
const outputPath = process.env.HISTORY_CAPACITY_OUTPUT ?? '/tmp/hh-business-history-capacity.json';
const evidence = {
  measurement: 'synthetic_committed_identity_business_history_capacity',
  identities: 5000, fieldsPerIdentity: 19, endpointSamplesPerField: 2,
  sourceSchema: 'public.source_identity_business_history INCLUDING ALL',
  notes: [
    'The copy has all defaults/checks/primary/unique/secondary indexes; LIKE does not copy foreign keys.',
    'Values include numeric price/area/rooms, strings, timestamp string, address components and explicit JSON null.',
    'Each endpoint uses actual synthetic observedAt and minimal event/generation/sequence/source-primary provenance; no intervals.',
    'VACUUM ANALYZE is ordinary vacuum, not VACUUM FULL or REINDEX.',
    '300k projection assumes 19 fields with two unchanged-run endpoint samples per identity; actual value changes add permanent history.',
    'Raw seven-day evidence/receipts, existing canonical histories, identity/alias storage and other indexes are separate.',
    'WAL, transient new-tail writes/dead tuples, and vacuum headroom are not included in live endpoint capacity.',
    'This is synthetic fixture capacity, not a production dataset measurement or a hard storage cap.',
  ],
  stages: [],
};
let created = false;
async function measure(stage, durationMs) {
  const [sizes] = await q.unsafe(`SELECT count(*)::integer AS rows,
    count(DISTINCT identity_id)::integer AS identities,
    sum(pg_column_size(h))::float8 AS live_tuple_bytes,
    pg_relation_size('${table}')::float8 AS heap_bytes,
    pg_table_size('${table}')::float8 AS table_with_toast_fsm_vm_bytes,
    pg_indexes_size('${table}')::float8 AS index_bytes,
    pg_total_relation_size('${table}')::float8 AS total_relation_bytes
    FROM ${table} h`);
  const indexes = await q.unsafe(`SELECT pg_get_indexdef(indexrelid) AS definition,
    pg_relation_size(indexrelid)::float8 AS bytes FROM pg_index WHERE indrelid='${table}'::regclass ORDER BY indexrelid`);
  const row = { stage, durationMs, ...sizes,
    bytesPerIdentity: sizes.total_relation_bytes / 5000,
    projected300kIdentityBytes: sizes.total_relation_bytes * 60,
    projected300kIdentityGiB: sizes.total_relation_bytes * 60 / 1024**3,
    indexes: indexes.map(index => ({ ...index, definition: index.definition.replaceAll(schema, 'synthetic_schema') })),
  };
  evidence.stages.push(row);
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(row));
}
try {
  await q.unsafe(`CREATE SCHEMA ${schema}`);
  created = true;
  await q.unsafe(`CREATE TABLE ${table} (LIKE public.source_identity_business_history INCLUDING ALL)`);
  const began = performance.now();
  await q.unsafe(`WITH identities AS MATERIALIZED (
      SELECT n,gen_random_uuid() AS identity_id FROM generate_series(1,5000) n
    ), endpoints AS MATERIALIZED (
      SELECT i.*,endpoint,gen_random_uuid() AS event_id,
        timestamptz '2026-01-01T00:00:00Z' + (endpoint-1)*interval '6 days' AS observed_at
      FROM identities i CROSS JOIN generate_series(1,2) endpoint
    ), fields(field_path,value_json) AS (VALUES
      ('askingPrice','500000'::jsonb),('currency','"EUR"'::jsonb),('priceType','"sale"'::jsonb),
      ('pricePeriod','"total"'::jsonb),('priceUnit','"listing"'::jsonb),('priceCondition','"asking"'::jsonb),
      ('livingAreaM2','100'::jsonb),('numRooms','4.5'::jsonb),('energyLabel','"A"'::jsonb),
      ('propertyType','"house"'::jsonb),('ogTitle','"Synthetic listing with a garden and three bedrooms"'::jsonb),
      ('thumbnailUrl','"https://example.com/synthetic/listing/thumbnail-1234567890.jpg"'::jsonb),
      ('listedAt','"2026-01-01T00:00:00.000Z"'::jsonb),('lifecycleStatus','"available"'::jsonb),
      ('address.countryCode','"NL"'::jsonb),('address.city','"Synthetic fixture town"'::jsonb),
      ('address.latitude','51.44'::jsonb),('address.longitude','5.47'::jsonb),('address.houseNumberAddition','null'::jsonb)
    )
    INSERT INTO ${table} (source_name,identity_id,field_path,value_json,observed_at,sample_key,
      collector,evidence_strength,evidence_kind,provenance_json,recorded_at,confirmations_compacted)
    SELECT 'funda',identity_id,field_path,value_json,observed_at,
      md5(identity_id::text||field_path||endpoint::text)||md5(field_path||identity_id::text||endpoint::text),
      'realtyapi','detail','facts',jsonb_build_object('eventId',event_id::text,'generation',1,
        'sequence',n*2+endpoint,'sourceListingId',identity_id::text,'sourceListingIdKind','global_id','association','resolved'),
      observed_at,true FROM endpoints CROSS JOIN fields`);
  await q.unsafe(`VACUUM (ANALYZE) ${table}`);
  await measure('committed_initial_two_endpoints_after_vacuum', Math.round(performance.now()-began));
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const started = performance.now();
    const previousDay = 6 + cycle - 1;
    const nextDay = previousDay + 1;
    await q.begin(async tx => {
      await tx.unsafe(`INSERT INTO ${table} (source_name,identity_id,field_path,value_json,observed_at,sample_key,
          collector,evidence_strength,evidence_kind,provenance_json,recorded_at,confirmations_compacted)
        SELECT source_name,identity_id,field_path,value_json,
          timestamptz '2026-01-01T00:00:00Z' + interval '${nextDay} days',
          md5(sample_key||'cycle${cycle}')||md5('cycle${cycle}'||sample_key),collector,evidence_strength,evidence_kind,
          provenance_json||jsonb_build_object('eventId',gen_random_uuid()::text,'sequence',(provenance_json->>'sequence')::integer+5000),
          timestamptz '2026-01-01T00:00:00Z' + interval '${nextDay} days',true
        FROM ${table} WHERE observed_at=timestamptz '2026-01-01T00:00:00Z' + interval '${previousDay} days'`);
      await tx.unsafe(`DELETE FROM ${table}
        WHERE observed_at=timestamptz '2026-01-01T00:00:00Z' + interval '${previousDay} days'`);
    });
    await q.unsafe(`VACUUM (ANALYZE) ${table}`);
    await measure(`tail_replacement_cycle_${cycle}_after_vacuum`, Math.round(performance.now()-started));
  }
} finally {
  if (created) await q.unsafe(`DROP SCHEMA ${schema} CASCADE`);
  await q.end();
  evidence.cleanedUp = true;
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

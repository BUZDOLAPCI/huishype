import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/index.js';
import { lockIngestSource } from './identity.js';
import { ingestEvidenceV2Schema, type IngestEvidenceV2 } from './v2-contracts.js';

const addressFields = ['countryCode', 'street', 'postalCode', 'houseNumber', 'houseNumberAddition', 'city', 'latitude', 'longitude'];
export type HistoryAssociation = 'resolved' | 'quarantined' | 'historical_unknown';
export interface BusinessFieldSample { fieldPath: string; value: unknown }

/** Sparse patches are samples of individual fields, never a synthesized snapshot. */
export function businessHistoryFields(record: IngestEvidenceV2): BusinessFieldSample[] {
  if (record.kind === 'absence') return [];
  if (record.kind === 'sighting') return [{ fieldPath: 'lifecycleStatus', value: record.availability }];
  return Object.entries(record.facts).flatMap(([fieldPath, value]) => {
    if (value === undefined) return [];
    if (fieldPath !== 'address') return [{ fieldPath, value }];
    const address = value === null ? Object.fromEntries(addressFields.map(field => [field, null])) : value;
    return Object.entries(address as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([field, item]) => ({ fieldPath: `address.${field}`, value: item }));
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Replay transport IDs cannot establish an original observation's tie-break. */
export function businessHistorySampleKey(input: {
  identityId: string; fieldPath: string; value: unknown; observedAt: string | Date;
  collector: string; evidenceStrength: string;
}): string {
  return createHash('sha256').update(canonicalJson({
    identityId: input.identityId, fieldPath: input.fieldPath, value: input.value,
    collector: input.collector, evidenceStrength: input.evidenceStrength,
    observedAt: new Date(input.observedAt).toISOString(),
  })).digest('hex');
}

interface Sample {
  fieldPath: string; value: unknown; observedAt: Date; collector: string;
  evidenceStrength: string; evidenceKind: string; provenance: Record<string, unknown>; sampleKey: string;
}
interface RawNeighbor extends Record<string, unknown> {
  field_path: string; value_json: unknown; observed_at: Date; collector: string;
  evidence_strength: string; evidence_kind: string; event_id: string;
  generation: string | number; sequence: string | number;
  source_listing_id: string; source_listing_id_kind: string; inventory_manifest: unknown;
}

export async function recordIdentityBusinessHistory(tx: DbTransaction, input: {
  sourceName: string; identityId: string; generation: number; record: IngestEvidenceV2;
  association: HistoryAssociation;
}): Promise<{ samples: number; confirmationsCompacted: number }> {
  const fields = businessHistoryFields(input.record);
  if (!fields.length) return { samples: 0, confirmationsCompacted: 0 };
  await lockIngestSource(tx, input.sourceName);
  const observedAt = new Date(input.record.observedAt);
  const neighbors = await tx.execute<RawNeighbor>(sql`
    WITH fields AS (
      SELECT value AS field_path FROM jsonb_array_elements_text(${JSON.stringify(fields.map(field => field.fieldPath))}::jsonb)
    ), raw_values AS MATERIALIZED (
      SELECT field.field_path,e.observed_at,e.collector,e.kind AS evidence_kind,
        e.event_id,e.generation,e.sequence,
        e.payload_json->>'evidenceStrength' AS evidence_strength,
        e.payload_json#>>'{identity,sourceListingId}' AS source_listing_id,
        e.payload_json#>>'{identity,sourceListingIdKind}' AS source_listing_id_kind,
        COALESCE(e.payload_json->'inventoryManifest',e.payload_json->'inventoryManifestId') AS inventory_manifest,
        CASE WHEN e.kind='sighting' AND field.field_path='lifecycleStatus'
          THEN e.payload_json->'availability'
          WHEN e.kind='facts' AND field.field_path LIKE 'address.%'
            AND e.payload_json#>'{facts,address}'='null'::jsonb THEN 'null'::jsonb
          WHEN e.kind='facts' THEN e.payload_json->'facts'#>string_to_array(field.field_path,'.')
          ELSE NULL END AS value_json
      FROM ingest_evidence e CROSS JOIN fields field
      WHERE e.identity_id=${input.identityId}::uuid AND e.source_name=${input.sourceName}
        AND e.payload_json IS NOT NULL AND e.kind IN ('facts','sighting')
    ), bounds AS (
      SELECT field_path,max(observed_at) FILTER (WHERE observed_at<${observedAt.toISOString()}::timestamptz) AS previous_at,
        min(observed_at) FILTER (WHERE observed_at>${observedAt.toISOString()}::timestamptz) AS next_at
      FROM raw_values WHERE value_json IS NOT NULL GROUP BY field_path
    )
    SELECT DISTINCT raw.* FROM raw_values raw INNER JOIN bounds USING(field_path)
    WHERE raw.value_json IS NOT NULL AND
      (raw.observed_at=${observedAt.toISOString()}::timestamptz OR raw.observed_at=bounds.previous_at OR raw.observed_at=bounds.next_at)
  `);
  const samples = new Map<string, Sample>();
  function add(sample: Omit<Sample, 'sampleKey'>): void {
    const sampleKey = businessHistorySampleKey({ identityId: input.identityId,
      fieldPath: sample.fieldPath, value: sample.value, observedAt: sample.observedAt,
      collector: sample.collector, evidenceStrength: sample.evidenceStrength });
    samples.set(`${sample.fieldPath}:${sampleKey}`, { ...sample, sampleKey });
  }
  for (const neighbor of neighbors) add({
    fieldPath: neighbor.field_path, value: neighbor.value_json, observedAt: new Date(neighbor.observed_at),
    collector: neighbor.collector, evidenceStrength: neighbor.evidence_strength, evidenceKind: neighbor.evidence_kind,
    provenance: { eventId: neighbor.event_id, generation: Number(neighbor.generation), sequence: Number(neighbor.sequence),
      sourceListingId: neighbor.source_listing_id, sourceListingIdKind: neighbor.source_listing_id_kind,
      ...(neighbor.inventory_manifest === null ? {} : { inventoryManifest: neighbor.inventory_manifest }),
      association: 'historical_unknown' },
  });
  for (const field of fields) add({ ...field, observedAt, collector: input.record.collector,
    evidenceStrength: input.record.evidenceStrength, evidenceKind: input.record.kind,
    provenance: { eventId: input.record.eventId, generation: input.generation, sequence: input.record.sequence,
      sourceListingId: input.record.identity.sourceListingId, sourceListingIdKind: input.record.identity.sourceListingIdKind,
      ...(input.record.inventoryManifest ? { inventoryManifest: input.record.inventoryManifest }
        : input.record.inventoryManifestId ? { inventoryManifest: input.record.inventoryManifestId } : {}),
      association: input.association },
  });
  // Both real neighbors enter before reduction, so late evidence splits the
  // provisional run at actual surviving observations, including raw-window ones.
  const values = [...samples.values()];
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO source_identity_business_history
      (source_name,identity_id,field_path,value_json,observed_at,sample_key,collector,evidence_strength,evidence_kind,provenance_json)
    VALUES ${sql.join(values.map(sample => sql`(${input.sourceName},${input.identityId}::uuid,${sample.fieldPath},
      ${JSON.stringify(sample.value)}::jsonb,${sample.observedAt.toISOString()}::timestamptz,${sample.sampleKey},${sample.collector},
      ${sample.evidenceStrength},${sample.evidenceKind},${JSON.stringify(sample.provenance)}::jsonb)`),sql`, `)}
    ON CONFLICT (identity_id,field_path,sample_key) DO NOTHING RETURNING id
  `);
  const [reduced] = await tx.execute<{ deleted: number }>(sql`
    WITH centers AS MATERIALIZED (
      SELECT history.* FROM source_identity_business_history history
      INNER JOIN (VALUES ${sql.join(values.map(sample => sql`(${sample.fieldPath},${sample.sampleKey})`),sql`, `)}) wanted(field_path,sample_key)
        USING(field_path,sample_key)
      WHERE identity_id=${input.identityId}::uuid
    ), neighborhood AS MATERIALIZED (
      SELECT id FROM centers
      UNION SELECT neighbor.id FROM centers center CROSS JOIN LATERAL (
        SELECT id FROM source_identity_business_history h
        WHERE h.identity_id=center.identity_id AND h.field_path=center.field_path
          AND (h.observed_at,h.sample_key)<(center.observed_at,center.sample_key)
        ORDER BY h.observed_at DESC,h.sample_key DESC LIMIT 2
      ) neighbor
      UNION SELECT neighbor.id FROM centers center CROSS JOIN LATERAL (
        SELECT id FROM source_identity_business_history h
        WHERE h.identity_id=center.identity_id AND h.field_path=center.field_path
          AND (h.observed_at,h.sample_key)>(center.observed_at,center.sample_key)
        ORDER BY h.observed_at,h.sample_key LIMIT 2
      ) neighbor
    ), redundant AS MATERIALIZED (
      SELECT h.id,previous.id AS previous_id,following.id AS following_id
      FROM source_identity_business_history h INNER JOIN neighborhood USING(id)
      CROSS JOIN LATERAL (
        SELECT id,value_json FROM source_identity_business_history p
        WHERE p.identity_id=h.identity_id AND p.field_path=h.field_path
          AND (p.observed_at,p.sample_key)<(h.observed_at,h.sample_key)
        ORDER BY p.observed_at DESC,p.sample_key DESC LIMIT 1
      ) previous
      CROSS JOIN LATERAL (
        SELECT id,value_json FROM source_identity_business_history n
        WHERE n.identity_id=h.identity_id AND n.field_path=h.field_path
          AND (n.observed_at,n.sample_key)>(h.observed_at,h.sample_key)
        ORDER BY n.observed_at,n.sample_key LIMIT 1
      ) following
      WHERE h.value_json=previous.value_json AND h.value_json=following.value_json
        AND NOT EXISTS (SELECT 1 FROM source_identity_business_history conflict
          WHERE conflict.identity_id=h.identity_id AND conflict.field_path=h.field_path
            AND conflict.observed_at=h.observed_at AND conflict.value_json<>h.value_json)
    ), marked AS (
      UPDATE source_identity_business_history SET confirmations_compacted=true
      WHERE id IN (SELECT previous_id FROM redundant UNION SELECT following_id FROM redundant)
        AND id NOT IN (SELECT id FROM redundant) AND confirmations_compacted=false RETURNING id
    ), removed AS (
      DELETE FROM source_identity_business_history WHERE id IN (SELECT id FROM redundant) RETURNING id
    ) SELECT count(*)::integer AS deleted FROM removed
  `);
  return { samples: inserted.length, confirmationsCompacted: reduced?.deleted ?? 0 };
}

/** The caller commits this proof atomically with any subsequent raw retirement. */
export async function backfillIdentityBusinessHistoryForBatch(tx: DbTransaction, input: { batchId: string }): Promise<{
  events: number; samples: number; alreadyCompleted: boolean;
}> {
  const [owner] = await tx.execute<{ source_name: string }>(sql`
    SELECT source_name FROM ingest_batches WHERE id=${input.batchId}::uuid
  `);
  if (!owner) throw new Error('Business history requires an existing batch');
  await lockIngestSource(tx, owner.source_name);
  const [batch] = await tx.execute<{
    source_name: string; writer_generation: number | string | null;
    first_sequence: number | string | null; last_sequence: number | string | null;
    business_history_completed_at: Date | null;
  }>(sql`SELECT source_name,writer_generation,first_sequence,last_sequence,business_history_completed_at
    FROM ingest_batches WHERE id=${input.batchId}::uuid FOR UPDATE`);
  if (!batch || batch.source_name !== owner.source_name) throw new Error('Business history batch ownership changed');
  if (batch.business_history_completed_at) return { events: 0, samples: 0, alreadyCompleted: true };
  if (batch.writer_generation === null || batch.first_sequence === null || batch.last_sequence === null) {
    throw new Error('Business history requires complete v2 receipt metadata');
  }
  const generation = Number(batch.writer_generation);
  const first = Number(batch.first_sequence); const last = Number(batch.last_sequence);
  if (![generation, first, last].every(Number.isSafeInteger) || first < 1 || last < first || last-first >= 1000) {
    throw new Error('Business history receipt interval is invalid or exceeds the accepted batch limit');
  }
  const events = await tx.execute<{ identity_id: string; sequence: number | string; payload_json: unknown }>(sql`
    SELECT identity_id,sequence,payload_json FROM ingest_evidence
    WHERE source_name=${batch.source_name} AND generation=${generation} AND sequence BETWEEN ${first} AND ${last}
    ORDER BY sequence
  `);
  if (events.length !== last-first+1) throw new Error('Business history is incomplete: raw evidence interval has gaps');
  let samples = 0;
  for (const event of events) {
    const record = ingestEvidenceV2Schema.parse(event.payload_json);
    if (record.sequence !== Number(event.sequence)) throw new Error('Business history evidence ordering does not match its receipt');
    samples += (await recordIdentityBusinessHistory(tx, { sourceName: batch.source_name, identityId: event.identity_id,
      generation, record, association: 'historical_unknown' })).samples;
  }
  await tx.execute(sql`UPDATE ingest_batches SET business_history_completed_at=now() WHERE id=${input.batchId}::uuid`);
  return { events: events.length, samples, alreadyCompleted: false };
}

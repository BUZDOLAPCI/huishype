import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/index.js';

/**
 * The caller holds the source advisory transaction lock and has prepared the
 * reconciliation graph and its ECMAScript-compatible trim function. Only fresh,
 * unambiguous components enter this bulk path; all other components retain the
 * resolver's normal validation, quarantine and history reconciliation behavior.
 */
export async function applyFreshIdentityComponents(
  tx: DbTransaction,
  sourceName: string,
): Promise<{ groups: number; legacyRows: number }> {
  await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.ingest_identity_fast_components`);
  await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.ingest_identity_fast_aliases`);
  // Include weak aliases and every row's primary, even when the graph discarded
  // weak edges in favor of strong evidence. A reused URL must exclude BOTH owners.
  await tx.execute(sql`CREATE TEMP TABLE ingest_identity_fast_aliases ON COMMIT DROP AS
    SELECT component,kind,value,bool_and(valid) AS valid
    FROM (
      SELECT node.component,
        pg_temp.ingest_identity_trim(alias->>'kind') AS kind,
        pg_temp.ingest_identity_trim(alias->>'value') AS value,
        COALESCE(jsonb_typeof(alias->'kind') = 'string'
          AND jsonb_typeof(alias->'value') = 'string'
          AND pg_temp.ingest_identity_trim(alias->>'kind') <> ''
          AND pg_temp.ingest_identity_trim(alias->>'value') <> ''
          AND char_length(pg_temp.ingest_identity_trim(alias->>'kind')) <= 50
          AND octet_length(pg_temp.ingest_identity_trim(alias->>'kind'))
            = char_length(pg_temp.ingest_identity_trim(alias->>'kind')),false) AS valid
      FROM pg_temp.ingest_identity_reconciliation_nodes node
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(node.aliases) = 'array' THEN node.aliases ELSE '[]'::jsonb END
        || jsonb_build_array(jsonb_build_object('kind',node.primary_id_type,'value',node.primary_id))
      ) alias
    ) normalized GROUP BY component,kind,value`);
  // Non-ASCII kinds use the slow JavaScript validator: its UTF-16 length differs
  // from PostgreSQL character length. Standard source alias kinds are ASCII.
  await tx.execute(sql`CREATE INDEX ON ingest_identity_fast_aliases(kind,value,component)`);
  await tx.execute(sql`CREATE INDEX ON ingest_identity_fast_aliases(component)`);
  await tx.execute(sql`ANALYZE ingest_identity_fast_aliases`);

  await tx.execute(sql`CREATE TEMP TABLE ingest_identity_fast_components ON COMMIT DROP AS
    WITH node_groups AS MATERIALIZED (
      SELECT component,count(*) FILTER (WHERE listing_table = 'listings')::integer AS legacy_rows,
        (max(id::text) FILTER (WHERE listing_table = 'canonical_listings'))::uuid AS canonical_id
      FROM pg_temp.ingest_identity_reconciliation_nodes
      GROUP BY component
      HAVING count(*) FILTER (WHERE listing_table = 'canonical_listings') <= 1
        AND count(DISTINCT property_id) = 1 AND bool_and(property_id IS NOT NULL)
        AND bool_and(COALESCE(listing_table IN ('canonical_listings','listings'),false))
        AND bool_and(COALESCE(jsonb_typeof(aliases) = 'array',false))
    ), alias_groups AS MATERIALIZED (
      SELECT component,
        max(value) FILTER (WHERE kind = 'global_id') AS global_id,
        max(value) FILTER (WHERE kind = 'stable_id') AS stable_id,
        jsonb_agg(jsonb_build_object('kind',kind,'value',value) ORDER BY kind,value) AS aliases
      FROM pg_temp.ingest_identity_fast_aliases
      GROUP BY component
      HAVING bool_and(valid)
        AND count(*) FILTER (WHERE kind = 'global_id') <= 1
        AND count(*) FILTER (WHERE kind = 'stable_id') <= 1
    ), primary_rows AS MATERIALIZED (
      SELECT DISTINCT ON (component) component,primary_id,primary_id_type
      FROM pg_temp.ingest_identity_reconciliation_nodes
      ORDER BY component,(listing_table = 'canonical_listings') DESC,created_at,id
    ), blocked_alias_components AS MATERIALIZED (
      SELECT alias.component
      FROM pg_temp.ingest_identity_fast_aliases alias
      INNER JOIN (
        SELECT kind,value FROM pg_temp.ingest_identity_fast_aliases
        GROUP BY kind,value HAVING count(*) > 1
      ) shared USING (kind,value)
      UNION
      SELECT alias.component
      FROM pg_temp.ingest_identity_fast_aliases alias
      INNER JOIN source_listing_aliases owner
        ON owner.source_name = ${sourceName} AND owner.kind = alias.kind AND owner.value = alias.value
    ), audited_components AS MATERIALIZED (
      SELECT DISTINCT node.component
      FROM pg_temp.ingest_identity_reconciliation_nodes node
      INNER JOIN source_identity_reconciliations previous
        ON previous.listing_table = node.listing_table AND previous.listing_id = node.id
    ), candidates AS (
      SELECT nodes.component,nodes.legacy_rows,nodes.canonical_id,aliases.aliases,
        CASE WHEN primary_row.primary_id_type IN ('global_id','stable_id')
            AND primary_row.primary_id = pg_temp.ingest_identity_trim(primary_row.primary_id)
          THEN primary_row.primary_id_type
          WHEN aliases.global_id IS NOT NULL THEN 'global_id'
          WHEN aliases.stable_id IS NOT NULL THEN 'stable_id'
          ELSE pg_temp.ingest_identity_trim(primary_row.primary_id_type) END AS primary_id_type,
        CASE WHEN primary_row.primary_id_type IN ('global_id','stable_id')
            AND primary_row.primary_id = pg_temp.ingest_identity_trim(primary_row.primary_id)
          THEN primary_row.primary_id
          ELSE COALESCE(aliases.global_id,aliases.stable_id,pg_temp.ingest_identity_trim(primary_row.primary_id)) END AS primary_id
      FROM node_groups nodes
      INNER JOIN alias_groups aliases USING (component)
      INNER JOIN primary_rows primary_row USING (component)
      WHERE NOT EXISTS (SELECT 1 FROM blocked_alias_components blocked WHERE blocked.component = nodes.component)
        AND NOT EXISTS (SELECT 1 FROM audited_components audited WHERE audited.component = nodes.component)
    )
    SELECT candidate.*,gen_random_uuid() AS identity_id
    FROM candidates candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM source_listing_identities identity
      WHERE identity.source_name = ${sourceName}
        AND identity.primary_id_type = candidate.primary_id_type AND identity.primary_id = candidate.primary_id
    ) AND NOT EXISTS (
      SELECT 1 FROM source_listing_identities identity
      WHERE identity.canonical_listing_id = candidate.canonical_id
    )`);
  await tx.execute(sql`ALTER TABLE pg_temp.ingest_identity_fast_components ADD PRIMARY KEY (component)`);
  await tx.execute(sql`ANALYZE ingest_identity_fast_components`);

  const [counts] = await tx.execute<{ groups: number; legacy_rows: number }>(sql`
    SELECT count(*)::integer AS groups,COALESCE(sum(legacy_rows),0)::integer AS legacy_rows
    FROM pg_temp.ingest_identity_fast_components`);
  if (!counts || counts.groups === 0) return { groups: 0, legacyRows: 0 };

  // No ON CONFLICT clauses: any unexpected ownership/audit collision aborts the
  // entire source transaction rather than silently accepting an incomplete group.
  await tx.execute(sql`INSERT INTO source_listing_identities
      (id,source_name,primary_id_type,primary_id,canonical_listing_id)
    SELECT identity_id,${sourceName},primary_id_type,primary_id,canonical_id
    FROM pg_temp.ingest_identity_fast_components`);
  await tx.execute(sql`INSERT INTO source_listing_aliases(source_name,kind,value,identity_id)
    SELECT ${sourceName},alias.kind,alias.value,component.identity_id
    FROM pg_temp.ingest_identity_fast_aliases alias
    INNER JOIN pg_temp.ingest_identity_fast_components component USING (component)`);
  const [audited] = await tx.execute<{ rows: number }>(sql`
    WITH inserted AS (
      INSERT INTO source_identity_reconciliations
        (listing_table,listing_id,source_name,survivor_listing_id,identity_id,reason,details_json)
      SELECT 'listings',node.id,${sourceName},component.canonical_id,component.identity_id,
        CASE WHEN component.canonical_id IS NOT NULL THEN 'legacy_projection_replaced' ELSE 'legacy_identity_preserved' END,
        jsonb_build_object('snapshotFormat','postgres_row_v1','before',to_jsonb(legacy),
          'aliases',component.aliases,'preservedFactualStatus',node.status,
          'observationLinksBefore','[]'::jsonb,'priceObservationsBefore','[]'::jsonb,'candidateHandoffsBefore','[]'::jsonb)
      FROM pg_temp.ingest_identity_reconciliation_nodes node
      INNER JOIN pg_temp.ingest_identity_fast_components component USING (component)
      INNER JOIN listings legacy ON legacy.id = node.id
      WHERE node.listing_table = 'listings'
      RETURNING 1
    ) SELECT count(*)::integer AS rows FROM inserted`);
  if (audited?.rows !== counts.legacy_rows) {
    throw new Error('Fresh identity reconciliation did not audit every legacy row.');
  }
  return { groups: counts.groups, legacyRows: counts.legacy_rows };
}

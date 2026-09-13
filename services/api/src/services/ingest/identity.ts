import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/index.js';
import {
  canonicalListings, listings, listingObservationLinks, listingCandidateHandoffs,
  sourceListingAliases, sourceListingIdentities,
  sourceIdentityQuarantines,
} from '../../db/schema.js';
import { applyFreshIdentityComponents } from './identity-reconciliation-fast-path.js';

export interface SourceAlias { kind: string; value: string }
export type SourceListingIdentity = typeof sourceListingIdentities.$inferSelect;
export interface IdentityResolution {
  identity: SourceListingIdentity;
  quarantined: boolean;
  quarantineId?: string;
  affectedPropertyIds?: string[];
}

/** A source lock also serializes reconciliation against ordered outbox application. */
export async function lockIngestSource(tx: DbTransaction, sourceName: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sourceName}))`);
}

export function normalizeIdentityAliases(aliases: SourceAlias[]): SourceAlias[] {
  const normalized = new Map<string, SourceAlias>();
  for (const alias of aliases) {
    const kind = alias.kind.trim();
    const value = alias.value.trim();
    if (!kind || !value || kind.length > 50) throw new Error('Invalid source identity alias');
    // Types are significant: a tiny ID and global ID with equal digits are distinct.
    normalized.set(JSON.stringify([kind, value]), { kind, value });
  }
  return [...normalized.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

function isStableAlias(alias: SourceAlias): boolean {
  return alias.kind === 'global_id' || alias.kind === 'stable_id';
}

function isStrongAlias(alias: SourceAlias): boolean {
  return !['canonical_path', 'relative_path', 'url_path', 'url', 'canonical_url', 'unknown', 'legacy_row_id'].includes(alias.kind);
}

export function conflictsWithStablePrimary(primary: SourceAlias, existingAliases: SourceAlias[]): boolean {
  if (!isStableAlias(primary)) return false;
  const sameNamespace = existingAliases.filter(alias => alias.kind === primary.kind);
  return sameNamespace.length > 0 && !sameNamespace.some(alias => alias.value === primary.value);
}

async function lockAliases(tx: DbTransaction, sourceName: string, aliases: SourceAlias[]): Promise<void> {
  for (const alias of normalizeIdentityAliases(aliases)) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['ingest-alias', sourceName, alias.kind, alias.value])}, 0))`);
  }
}

async function quarantineIdentities(
  tx: DbTransaction,
  identities: SourceListingIdentity[],
  reason: string,
  aliases: SourceAlias[],
  listingIds: string[],
  details: Record<string, unknown>,
  auditMode?: 'server',
): Promise<IdentityResolution> {
  const first = identities[0];
  if (!first) throw new Error('Cannot quarantine an absent identity');
  const ids = [...new Set(identities.map((identity) => identity.id))];
  const affectedListings = [...new Set([...listingIds, ...identities.flatMap((identity) => identity.canonicalListingId ? [identity.canonicalListingId] : [])])];
  if (auditMode === 'server') {
    const [audit] = Array.from(await tx.execute<{ id: string }>(sql`INSERT INTO source_identity_quarantines
      (source_name,reason,identity_ids,listing_ids,aliases_json,details_json)
      SELECT ${first.sourceName},${reason},${JSON.stringify(ids)}::jsonb,${JSON.stringify(affectedListings)}::jsonb,${JSON.stringify(aliases)}::jsonb,
        ${JSON.stringify(details)}::jsonb || jsonb_build_object('canonicalSnapshotFormat','postgres_row_v1',
          'canonicalBefore',(SELECT COALESCE(jsonb_agg(to_jsonb(canonical_row)),'[]'::jsonb) FROM canonical_listings canonical_row
            WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(affectedListings)}::jsonb))))
      RETURNING id`));
    const affected = Array.from(await tx.execute<{ property_id: string }>(sql`SELECT DISTINCT property_id FROM canonical_listings
      WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(affectedListings)}::jsonb))`));
    await tx.execute(sql`UPDATE source_listing_identities SET quarantined_at = now(),quarantine_reason = ${reason},updated_at = now()
      WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`);
    await tx.execute(sql`UPDATE canonical_listings SET verification_state = 'invalid',active_eligible = false
      WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(affectedListings)}::jsonb))`);
    const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, first.id));
    return { identity: identity!, quarantined: true, quarantineId: audit!.id, affectedPropertyIds: affected.map(row => row.property_id) };
  }
  const before = affectedListings.length
    ? await tx.select().from(canonicalListings).where(inArray(canonicalListings.id, affectedListings))
    : [];
  const [audit] = await tx.insert(sourceIdentityQuarantines).values({
    sourceName: first.sourceName, reason, identityIds: ids, listingIds: affectedListings,
    aliasesJson: aliases, detailsJson: { ...details, canonicalBefore: before },
  }).returning();
  await tx.update(sourceListingIdentities).set({ quarantinedAt: new Date(), quarantineReason: reason, updatedAt: new Date() })
    .where(inArray(sourceListingIdentities.id, ids));
  if (affectedListings.length) {
    // Invalid verification suppresses projection without inventing a terminal outcome.
    await tx.update(canonicalListings).set({ verificationState: 'invalid', activeEligible: false })
      .where(inArray(canonicalListings.id, affectedListings));
  }
  const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, first.id));
  return { identity: identity!, quarantined: true, quarantineId: audit!.id,
    affectedPropertyIds: [...new Set(before.map((listing) => listing.propertyId))] };
}

export async function quarantineSourceIdentity(tx: DbTransaction, input: {
  identityId: string; reason: string; details: Record<string, unknown>; listingIds?: string[]; auditMode?: 'server';
}): Promise<IdentityResolution> {
  const [initial] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, input.identityId));
  if (!initial) throw new Error(`Unknown source identity ${input.identityId}`);
  await lockIngestSource(tx, initial.sourceName);
  const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, input.identityId));
  if (!identity) throw new Error(`Unknown source identity ${input.identityId}`);
  return quarantineIdentities(tx, [identity], input.reason, [], input.listingIds ?? [], input.details, input.auditMode);
}

export async function resolveSourceListingIdentity(tx: DbTransaction, input: {
  sourceName: string; primaryId: string; primaryIdType: string; aliases?: SourceAlias[]; auditMode?: 'server';
}): Promise<IdentityResolution> {
  const aliases = normalizeIdentityAliases([{ kind: input.primaryIdType, value: input.primaryId }, ...(input.aliases ?? [])]);
  await lockIngestSource(tx, input.sourceName);
  // Whole-source reconciliation already holds the same writer lock. Retaining
  // a million redundant per-alias xact locks would exhaust PostgreSQL's lock table.
  if (input.auditMode !== 'server') await lockAliases(tx, input.sourceName, aliases);
  const matches = await tx.select({ identity: sourceListingIdentities, kind: sourceListingAliases.kind, value: sourceListingAliases.value }).from(sourceListingAliases)
    .innerJoin(sourceListingIdentities, eq(sourceListingIdentities.id, sourceListingAliases.identityId))
    .where(and(eq(sourceListingAliases.sourceName, input.sourceName), or(...aliases.map((alias) => and(
      eq(sourceListingAliases.kind, alias.kind), eq(sourceListingAliases.value, alias.value),
    )))));
  const strongIncoming = aliases.some(isStrongAlias);
  const stableAliases = aliases.filter(isStableAlias);
  const duplicateStableValues = ['global_id', 'stable_id'].some(kind => new Set(aliases.filter(alias => alias.kind === kind).map(alias => alias.value)).size > 1);
  const candidateIds = [...new Set(matches.map(({ identity }) => identity.id))];
  const existingAliases = candidateIds.length ? await tx.select().from(sourceListingAliases)
    .where(inArray(sourceListingAliases.identityId, candidateIds)) : [];
  // Alias ownership remains historical after a public ID/URL is reused. Without
  // stable evidence, that ownership cannot identify which listing was observed.
  if (stableAliases.length === 0 && matches.length > 0) {
    const [ambiguity] = await tx.select().from(sourceIdentityQuarantines).where(and(
      eq(sourceIdentityQuarantines.sourceName, input.sourceName),
      eq(sourceIdentityQuarantines.reason, 'ambiguous_reused_alias'),
      or(...aliases.map(alias => sql`${sourceIdentityQuarantines.aliasesJson} @> ${JSON.stringify([alias])}::jsonb`)),
    )).limit(1);
    if (ambiguity) {
      const owner = matches.find(match => match.kind === input.primaryIdType && match.value === input.primaryId) ?? matches[0]!;
      // Quarantine this evidence only; both correctly identified listings stay usable.
      return { identity: owner.identity, quarantined: true, quarantineId: ambiguity.id, affectedPropertyIds: [] };
    }
  }
  const stableMatches = matches.filter(match => isStableAlias(match));
  // Supplied global/stable IDs are authoritative. Conflicting established owners
  // must be handled before a reused public alias can filter those owners out.
  const explicitStableConflict = duplicateStableValues
    || new Set(stableMatches.map(match => match.identity.id)).size > 1
    || stableMatches.some(match => stableAliases.some(alias => conflictsWithStablePrimary(alias,
      existingAliases.filter(existing => existing.identityId === match.identity.id))));
  const acceptedMatches = explicitStableConflict ? (stableMatches.length > 0 ? stableMatches : matches) : matches.filter((match) => {
    const ownerAliases = existingAliases.filter(alias => alias.identityId === match.identity.id);
    if (stableAliases.some(alias => conflictsWithStablePrimary(alias, ownerAliases))) return false;
    return !strongIncoming || isStrongAlias({ kind: match.kind, value: '' }) || !ownerAliases.some(isStrongAlias);
  });
  const identities = [...new Map(acceptedMatches.map(({ identity }) => [identity.id, identity])).values()];
  if (identities.length > 1) {
    const primaryMatch = acceptedMatches.find((match) => match.kind === input.primaryIdType
      && existingAliases.some((alias) => alias.identityId === match.identity.id
        && alias.kind === input.primaryIdType && alias.value === input.primaryId));
    let primaryIdentity = primaryMatch?.identity ?? (explicitStableConflict ? identities[0] : undefined);
    if (!primaryIdentity) {
      [primaryIdentity] = await tx.insert(sourceListingIdentities).values({
        sourceName: input.sourceName, primaryId: input.primaryId.trim(), primaryIdType: input.primaryIdType.trim(),
      }).returning();
      await tx.insert(sourceListingAliases).values({ sourceName: input.sourceName,
        kind: input.primaryIdType.trim(), value: input.primaryId.trim(), identityId: primaryIdentity!.id }).onConflictDoNothing();
    }
    return quarantineIdentities(tx, [primaryIdentity!, ...identities.filter((identity) => identity.id !== primaryIdentity!.id)],
      'aliases_resolve_to_multiple_identities', aliases, [], { incoming: input }, input.auditMode);
  }
  let identity = identities[0];
  if (!identity) {
    // A reused tiny primary may still be the legacy identity's primary key. Use
    // the supplied stable identity when creating its independently verified relisting.
    const creationPrimary = stableAliases.find(alias => alias.kind === input.primaryIdType && alias.value === input.primaryId)
      ?? stableAliases[0] ?? { kind: input.primaryIdType.trim(), value: input.primaryId.trim() };
    [identity] = await tx.insert(sourceListingIdentities).values({
      sourceName: input.sourceName, primaryId: creationPrimary.value, primaryIdType: creationPrimary.kind,
    }).returning();
  }
  if (!identity) throw new Error('Identity insert returned no row');
  if (explicitStableConflict) {
    // Persist only the identity's own primary, so later observations can find its
    // quarantine without assigning any of the contradictory aliases to it.
    await tx.insert(sourceListingAliases).values({ sourceName: input.sourceName,
      kind: identity.primaryIdType, value: identity.primaryId, identityId: identity.id }).onConflictDoNothing();
    return quarantineIdentities(tx, [identity], 'conflicting_source_identities', aliases, [], { incoming: input }, input.auditMode);
  }
  // A quarantined identity retains all evidence but cannot silently acquire new links.
  if (!identity.quarantinedAt) {
    const reused = existingAliases.filter(existing => existing.identityId !== identity!.id && !isStableAlias(existing)
      && aliases.some(alias => alias.kind === existing.kind && alias.value === existing.value));
    if (reused.length > 0) {
      const reusedAliases = normalizeIdentityAliases(reused);
      const identityIds = [...new Set([identity.id, ...reused.map(alias => alias.identityId)])].sort();
      const [previousAmbiguity] = await tx.select().from(sourceIdentityQuarantines).where(and(
        eq(sourceIdentityQuarantines.sourceName, input.sourceName),
        eq(sourceIdentityQuarantines.reason, 'ambiguous_reused_alias'),
        sql`${sourceIdentityQuarantines.identityIds} @> ${JSON.stringify(identityIds)}::jsonb`,
        sql`${sourceIdentityQuarantines.aliasesJson} @> ${JSON.stringify(reusedAliases)}::jsonb`,
      )).limit(1);
      if (!previousAmbiguity) {
        await tx.insert(sourceIdentityQuarantines).values({ sourceName: input.sourceName,
          reason: 'ambiguous_reused_alias', identityIds,
          listingIds: [...new Set([identity, ...matches.map(match => match.identity)]
            .flatMap(owner => owner.canonicalListingId ? [owner.canonicalListingId] : []))],
          aliasesJson: reusedAliases,
          detailsJson: { incoming: input, disposition: 'require_stable_identity_evidence', aliasOwners: reused },
        });
      }
    }

    await tx.insert(sourceListingAliases).values(aliases.map((alias) => ({ ...alias, sourceName: input.sourceName, identityId: identity!.id })))
      .onConflictDoNothing();
  }
  return { identity, quarantined: identity.quarantinedAt !== null };
}

export async function bindSourceIdentityToListing(tx: DbTransaction, identityId: string, listingId: string, auditMode?: 'server'): Promise<IdentityResolution> {
  const [initial] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, identityId));
  if (!initial) throw new Error(`Unknown source identity ${identityId}`);
  await lockIngestSource(tx, initial.sourceName);
  const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, identityId));
  if (!identity) throw new Error(`Unknown source identity ${identityId}`);
  if (identity.quarantinedAt) return { identity, quarantined: true };
  const [listing] = await tx.select().from(canonicalListings).where(eq(canonicalListings.id, listingId));
  if (!listing || listing.sourceName !== identity.sourceName) throw new Error('Canonical listing source does not match identity');
  const bound = identity.canonicalListingId
    ? await tx.select().from(canonicalListings).where(eq(canonicalListings.id, identity.canonicalListingId)) : [];
  const competing = await tx.select().from(sourceListingIdentities).where(and(
    eq(sourceListingIdentities.canonicalListingId, listingId), sql`${sourceListingIdentities.id} <> ${identityId}`,
  ));
  if (competing.length || (bound[0] && bound[0].id !== listingId)) {
    return quarantineIdentities(tx, [identity, ...competing], bound[0]?.propertyId !== listing.propertyId
      ? 'conflicting_property_links' : 'multiple_canonical_links', [], [listingId], {}, auditMode);
  }
  const [updated] = await tx.update(sourceListingIdentities).set({ canonicalListingId: listingId, updatedAt: new Date() })
    .where(eq(sourceListingIdentities.id, identityId)).returning();
  return { identity: updated!, quarantined: false };
}

export interface LegacyIdentityRow {
  listingTable: 'canonical_listings' | 'listings';
  id: string;
  propertyId: string;
  primaryId: string;
  primaryIdType: string;
  aliases: SourceAlias[];
  status: string;
  createdAt: Date;
  snapshot?: Record<string, unknown>;
}
export interface IdentityReconciliationGroup {
  rows: LegacyIdentityRow[];
  aliases: SourceAlias[];
  conflict: 'conflicting_property_links' | 'conflicting_status_evidence' | 'conflicting_source_identities' | null;
  survivor: LegacyIdentityRow | null;
}

/** Only typed alias evidence joins rows; address or coordinates never enter this graph. */
export function planIdentityReconciliation(rows: LegacyIdentityRow[]): IdentityReconciliationGroup[] {
  const parents = rows.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]!]!; index = parents[index]!; }
    return index;
  };
  const owners = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowAliases = normalizeIdentityAliases([{ kind: row.primaryIdType, value: row.primaryId }, ...row.aliases]);
    for (const alias of rowAliases) {
      if (rowAliases.some(isStrongAlias) && !isStrongAlias(alias)) continue;
      const key = JSON.stringify([alias.kind, alias.value]);
      const owner = owners.get(key);
      if (owner !== undefined) parents[root(index)] = root(owner);
      else owners.set(key, index);
    }
  });
  const groups = new Map<number, LegacyIdentityRow[]>();
  rows.forEach((row, index) => {
    const key = root(index);
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  });
  return [...groups.values()].map((group) => {
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const canonical = group.filter((row) => row.listingTable === 'canonical_listings');
    const aliases = normalizeIdentityAliases(group.flatMap((row) => [{ kind: row.primaryIdType, value: row.primaryId }, ...row.aliases]));
    const stableConflict = ['global_id', 'stable_id'].some(kind => new Set(aliases.filter(alias => alias.kind === kind).map(alias => alias.value)).size > 1);
    const conflict = new Set(group.map((row) => row.propertyId)).size > 1 ? 'conflicting_property_links'
      : stableConflict ? 'conflicting_source_identities'
      : new Set(canonical.map((row) => row.status)).size > 1 ? 'conflicting_status_evidence' : null;
    return {
      rows: group,
      aliases,
      conflict,
      survivor: conflict ? null : canonical[0] ?? null,
    };
  });
}

/**
 * Reduce history to distinct identity metadata inside PostgreSQL. Its bounded
 * work_mem sort can spill to disk; payloads and full history never enter Node.
 * Both lookup indexes matter: canonical links and legacy payload mirror IDs are
 * separate, explicitly recorded evidence paths.
 */
async function prepareLegacyIdentityMetadata(tx: DbTransaction, sourceName: string): Promise<void> {
  // ECMAScript String.trim whitespace, kept identical to normalizeIdentityAliases.
  await tx.execute(sql`CREATE OR REPLACE FUNCTION pg_temp.ingest_identity_trim(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT btrim(value,
      chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
      chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
      chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) $$`);
  await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.ingest_identity_observation_metadata`);
  await tx.execute(sql`CREATE TEMP TABLE ingest_identity_observation_metadata ON COMMIT DROP AS
    SELECT DISTINCT links.canonical_listing_id,
      observation.payload->>'mirrorListingId' AS mirror_listing_id,
      observation.source_listing_id, observation.source_listing_id_kind::text AS source_listing_id_kind,
      observation.source_listing_aliases
    FROM listing_observations observation
    LEFT JOIN listing_observation_links links ON links.listing_observation_id = observation.id
    WHERE observation.source_name = ${sourceName}
      AND (links.canonical_listing_id IS NOT NULL OR observation.payload->>'mirrorListingId' IS NOT NULL)`);
  await tx.execute(sql`CREATE INDEX ON ingest_identity_observation_metadata(canonical_listing_id)`);
  await tx.execute(sql`CREATE INDEX ON ingest_identity_observation_metadata(mirror_listing_id)`);
  await tx.execute(sql`ANALYZE ingest_identity_observation_metadata`);
  await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.ingest_identity_reconciliation_nodes`);
  await tx.execute(sql`CREATE TEMP TABLE ingest_identity_reconciliation_nodes ON COMMIT DROP AS
    WITH source_rows AS (
      SELECT 'canonical_listings'::text AS listing_table, id, property_id,
        primary_source_listing_id AS source_primary, COALESCE(primary_source_listing_id,id::text) AS primary_id,
        status::text, created_at
      FROM canonical_listings WHERE source_name = ${sourceName}
      UNION ALL
      SELECT 'listings', id, property_id, mirror_listing_id, COALESCE(mirror_listing_id,id::text), status::text, created_at
      FROM listings WHERE source_name = ${sourceName}
    )
    SELECT (row_number() OVER (ORDER BY row.listing_table,row.id)-1)::integer AS node_id, 0::integer AS component,
      row.listing_table, row.id, row.property_id, row.primary_id,
      COALESCE(observed.primary_type, known.primary_type,
        CASE WHEN row.source_primary IS NULL THEN 'legacy_row_id' ELSE 'unknown' END) AS primary_id_type,
      evidence.aliases, row.status, row.created_at
    FROM source_rows row
    LEFT JOIN LATERAL (
      SELECT min(observation.source_listing_id_kind) FILTER (
          WHERE observation.source_listing_id = row.source_primary
            AND observation.source_listing_id_kind <> 'unknown') AS primary_type,
        COALESCE(jsonb_agg(DISTINCT alias.value) FILTER (
          WHERE jsonb_typeof(alias.value->'kind') = 'string' AND jsonb_typeof(alias.value->'value') = 'string'
            AND pg_temp.ingest_identity_trim(alias.value->>'kind') <> '' AND pg_temp.ingest_identity_trim(alias.value->>'value') <> ''), '[]'::jsonb) AS aliases
      FROM (
        SELECT * FROM ingest_identity_observation_metadata
        WHERE row.listing_table = 'canonical_listings' AND canonical_listing_id = row.id
        UNION ALL
        SELECT * FROM ingest_identity_observation_metadata
        WHERE row.listing_table = 'listings' AND mirror_listing_id = row.source_primary
      ) observation
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(observation.source_listing_aliases) = 'array'
          THEN observation.source_listing_aliases ELSE '[]'::jsonb END
        || jsonb_build_array(jsonb_build_object('kind', observation.source_listing_id_kind, 'value', observation.source_listing_id))
      ) alias(value)
    ) observed ON true
    LEFT JOIN LATERAL (
      SELECT min(alias_kind::text) AS primary_type FROM listing_source_aliases
      WHERE source_name = ${sourceName} AND primary_source_listing_id = row.primary_id AND alias_value = row.primary_id
    ) known ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'value',value) ORDER BY kind,value),'[]'::jsonb) AS aliases
      FROM (
        SELECT DISTINCT pg_temp.ingest_identity_trim(candidate->>'kind') AS kind, pg_temp.ingest_identity_trim(candidate->>'value') AS value
        FROM (
          SELECT value AS candidate FROM jsonb_array_elements(observed.aliases)
          UNION ALL
          SELECT jsonb_build_object('kind',alias_kind,'value',alias_value) FROM listing_source_aliases
            WHERE source_name = ${sourceName} AND primary_source_listing_id = row.primary_id
          UNION ALL
          SELECT jsonb_build_object('kind',alias.kind,'value',alias.value)
            FROM source_listing_identities identity JOIN source_listing_aliases alias ON alias.identity_id = identity.id
            WHERE row.listing_table = 'canonical_listings' AND identity.canonical_listing_id = row.id
              AND identity.source_name = ${sourceName} AND alias.source_name = ${sourceName}
          UNION ALL
          SELECT value FROM source_identity_reconciliations previous
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(previous.details_json->'aliases') = 'array'
              THEN previous.details_json->'aliases' ELSE '[]'::jsonb END)
            WHERE previous.listing_table = row.listing_table AND previous.listing_id = row.id AND previous.source_name = ${sourceName}
        ) candidates
        WHERE jsonb_typeof(candidate->'kind') = 'string' AND jsonb_typeof(candidate->'value') = 'string'
          AND pg_temp.ingest_identity_trim(candidate->>'kind') <> '' AND pg_temp.ingest_identity_trim(candidate->>'value') <> ''
      ) distinct_aliases
    ) evidence ON true
    ORDER BY row.listing_table,row.id
  `);
  await tx.execute(sql`CREATE UNIQUE INDEX ON ingest_identity_reconciliation_nodes(node_id)`);
  await tx.execute(sql`ANALYZE ingest_identity_reconciliation_nodes`);
}

type IdentityMetadataRow = {
  listing_table: LegacyIdentityRow['listingTable']; id: string; property_id: string;
  primary_id: string; primary_id_type: string; aliases: SourceAlias[]; status: string; created_at: Date;
};
function identityMetadataRow(row: IdentityMetadataRow): LegacyIdentityRow {
  return { listingTable: row.listing_table, id: row.id, propertyId: row.property_id,
    primaryId: row.primary_id, primaryIdType: row.primary_id_type, aliases: row.aliases,
    status: row.status, createdAt: new Date(row.created_at) };
}

/** Convenience metadata reader; the mandatory reconciliation below streams graph components. */
export async function loadLegacyIdentityRows(tx: DbTransaction, sourceName: string): Promise<LegacyIdentityRow[]> {
  await prepareLegacyIdentityMetadata(tx, sourceName);
  return Array.from(await tx.execute<IdentityMetadataRow>(sql`SELECT * FROM pg_temp.ingest_identity_reconciliation_nodes ORDER BY node_id`), identityMetadataRow);
}

const IDENTITY_GRAPH_PAGE_SIZE = 5_000;
async function prepareIdentityComponents(tx: DbTransaction, sourceName: string) {
  const startedAt = performance.now();
  await prepareLegacyIdentityMetadata(tx, sourceName);
  const [counts] = Array.from(await tx.execute<{ rows: number; canonical_rows: number; legacy_rows: number }>(sql`
    SELECT count(*)::integer AS rows,
      count(*) FILTER (WHERE listing_table = 'canonical_listings')::integer AS canonical_rows,
      count(*) FILTER (WHERE listing_table = 'listings')::integer AS legacy_rows
    FROM pg_temp.ingest_identity_reconciliation_nodes`));
  const parents = new Int32Array(counts!.rows);
  for (let index = 0; index < parents.length; index += 1) parents[index] = index;
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]!]!; index = parents[index]!; }
    return index;
  };
  await tx.execute(sql`DROP TABLE IF EXISTS pg_temp.ingest_identity_reconciliation_edges`);
  await tx.execute(sql`CREATE TEMP TABLE ingest_identity_reconciliation_edges ON COMMIT DROP AS
    SELECT DISTINCT node.node_id, pg_temp.ingest_identity_trim(alias->>'kind') AS kind, pg_temp.ingest_identity_trim(alias->>'value') AS value
    FROM pg_temp.ingest_identity_reconciliation_nodes node
    CROSS JOIN LATERAL (SELECT node.aliases || jsonb_build_array(jsonb_build_object('kind',node.primary_id_type,'value',node.primary_id)) AS values) aliases
    CROSS JOIN LATERAL jsonb_array_elements(aliases.values) alias
    WHERE pg_temp.ingest_identity_trim(alias->>'kind') NOT IN ('canonical_path','relative_path','url_path','url','canonical_url','unknown','legacy_row_id')
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(aliases.values) candidate
        WHERE pg_temp.ingest_identity_trim(candidate->>'kind') NOT IN ('canonical_path','relative_path','url_path','url','canonical_url','unknown','legacy_row_id'))`);
  await tx.execute(sql`CREATE INDEX ON ingest_identity_reconciliation_edges(kind,value,node_id)`);
  await tx.execute(sql`ANALYZE ingest_identity_reconciliation_edges`);
  await tx.execute(sql`DECLARE ingest_identity_graph_cursor NO SCROLL CURSOR FOR
    SELECT owner_id,node_id FROM (
      SELECT min(node_id) OVER (PARTITION BY kind,value) AS owner_id,node_id
      FROM pg_temp.ingest_identity_reconciliation_edges
    ) edges WHERE owner_id <> node_id`);
  let edgesRead = 0;
  try {
    for (;;) {
      const page = Array.from(await tx.execute<{ owner_id: number; node_id: number }>(sql`FETCH FORWARD 5000 FROM ingest_identity_graph_cursor`));
      if (!page.length) break;
      for (const edge of page) {
        const owner = root(edge.owner_id); const member = root(edge.node_id);
        if (owner !== member) parents[Math.max(owner, member)] = Math.min(owner, member);
      }
      edgesRead += page.length;
    }
  } finally { await tx.execute(sql`CLOSE ingest_identity_graph_cursor`); }
  for (let start = 0; start < parents.length; start += IDENTITY_GRAPH_PAGE_SIZE) {
    const labels = [];
    for (let index = start; index < Math.min(start + IDENTITY_GRAPH_PAGE_SIZE, parents.length); index += 1) labels.push(sql`(${index}::integer,${root(index)}::integer)`);
    await tx.execute(sql`UPDATE pg_temp.ingest_identity_reconciliation_nodes node SET component = label.component
      FROM (VALUES ${sql.join(labels,sql`, `)}) label(node_id,component) WHERE node.node_id = label.node_id`);
  }
  await tx.execute(sql`CREATE INDEX ON ingest_identity_reconciliation_nodes(component,node_id)`);
  await tx.execute(sql`ANALYZE ingest_identity_reconciliation_nodes`);
  const [components] = Array.from(await tx.execute<{ groups: number; duplicate_groups: number; maximum_rows: number }>(sql`
    SELECT count(*)::integer AS groups,count(*) FILTER (WHERE members > 1)::integer AS duplicate_groups,
      COALESCE(max(members),0)::integer AS maximum_rows
    FROM (SELECT component,count(*) AS members FROM pg_temp.ingest_identity_reconciliation_nodes GROUP BY component) grouped`));
  return { rows: counts!.rows, canonicalRows: counts!.canonical_rows, legacyRows: counts!.legacy_rows,
    groups: components!.groups, duplicateGroups: components!.duplicate_groups,
    profile: { graphParentBytes: parents.byteLength, graphEdgeBatchLimit: IDENTITY_GRAPH_PAGE_SIZE,
      edgesRead, maximumComponentRows: components!.maximum_rows, graphPreparationMs: Math.round(performance.now()-startedAt) } };
}

async function* identityComponents(tx: DbTransaction, skipFresh = false): AsyncGenerator<IdentityReconciliationGroup> {
  // Read fixed metadata pages rather than one round trip per component. A group
  // can span pages, so only its metadata plus the current page remains in Node.
  await tx.execute(sql`DECLARE ingest_identity_components_cursor NO SCROLL CURSOR FOR
    SELECT node.* FROM pg_temp.ingest_identity_reconciliation_nodes node
    ${skipFresh ? sql`WHERE NOT EXISTS (SELECT 1 FROM pg_temp.ingest_identity_fast_components fresh WHERE fresh.component = node.component)` : sql``}
    ORDER BY node.component,node.created_at,node.id`);
  let currentComponent = -1;
  let rows: LegacyIdentityRow[] = [];
  const groupForRows = () => {
    const [group, ...extra] = planIdentityReconciliation(rows);
    if (!group || extra.length) throw new Error('Identity component projection disagrees with typed alias graph');
    return group;
  };
  try {
    for (;;) {
      const page = Array.from(await tx.execute<IdentityMetadataRow & { component: number }>(sql`FETCH FORWARD 5000 FROM ingest_identity_components_cursor`));
      if (!page.length) break;
      for (const row of page) {
        if (rows.length && row.component !== currentComponent) {
          yield groupForRows();
          rows = [];
        }
        currentComponent = row.component;
        rows.push(identityMetadataRow(row));
      }
    }
    if (rows.length) yield groupForRows();
  } finally { await tx.execute(sql`CLOSE ingest_identity_components_cursor`); }
}

/** Keep full pre-mutation rows in PostgreSQL for only the currently processed group. */
async function snapshotReconciliationGroup(tx: DbTransaction, group: IdentityReconciliationGroup): Promise<void> {
  await tx.execute(sql`TRUNCATE pg_temp.ingest_identity_reconciliation_snapshots`);
  const canonicalIds = group.rows.filter(row => row.listingTable === 'canonical_listings').map(row => row.id);
  const legacyIds = group.rows.filter(row => row.listingTable === 'listings').map(row => row.id);
  if (canonicalIds.length) await tx.execute(sql`INSERT INTO pg_temp.ingest_identity_reconciliation_snapshots
    SELECT 'canonical_listings',id,to_jsonb(listing) FROM canonical_listings listing
    WHERE id IN (${sql.join(canonicalIds.map(id => sql`${id}::uuid`),sql`, `)})`);
  if (legacyIds.length) await tx.execute(sql`INSERT INTO pg_temp.ingest_identity_reconciliation_snapshots
    SELECT 'listings',id,to_jsonb(listing) FROM listings listing
    WHERE id IN (${sql.join(legacyIds.map(id => sql`${id}::uuid`),sql`, `)})`);
}

async function recordReconciliationAudit(tx: DbTransaction, input: {
  row: LegacyIdentityRow; sourceName: string; survivorId: string | null; identityId: string; reason: string; aliases: SourceAlias[];
}): Promise<void> {
  const { row } = input;
  // JSON aggregates remain server-side, including arbitrarily long history chains.
  await tx.execute(sql`INSERT INTO source_identity_reconciliations
    (listing_table,listing_id,source_name,survivor_listing_id,identity_id,reason,details_json)
    SELECT ${row.listingTable},${row.id}::uuid,${input.sourceName},${input.survivorId}::uuid,${input.identityId}::uuid,${input.reason},
      jsonb_build_object('snapshotFormat','postgres_row_v1','before',snapshot.before_json,
        'aliases',${JSON.stringify(input.aliases)}::jsonb,'preservedFactualStatus',${row.status}::text,
        'observationLinksBefore',CASE WHEN ${row.listingTable} = 'canonical_listings' THEN
          (SELECT COALESCE(jsonb_agg(to_jsonb(link)),'[]'::jsonb) FROM listing_observation_links link WHERE canonical_listing_id = ${row.id}::uuid) ELSE '[]'::jsonb END,
        'priceObservationsBefore',CASE WHEN ${row.listingTable} = 'canonical_listings' THEN
          (SELECT COALESCE(jsonb_agg(to_jsonb(price_row)),'[]'::jsonb) FROM listing_price_observations price_row WHERE canonical_listing_id = ${row.id}::uuid) ELSE '[]'::jsonb END,
        'candidateHandoffsBefore',CASE WHEN ${row.listingTable} = 'canonical_listings' THEN
          (SELECT COALESCE(jsonb_agg(to_jsonb(handoff)),'[]'::jsonb) FROM listing_candidate_handoffs handoff WHERE canonical_listing_id = ${row.id}::uuid) ELSE '[]'::jsonb END)
    FROM pg_temp.ingest_identity_reconciliation_snapshots snapshot
    WHERE snapshot.listing_table = ${row.listingTable} AND snapshot.listing_id = ${row.id}::uuid
      AND NOT EXISTS (SELECT 1 FROM source_identity_reconciliations previous
        WHERE previous.listing_table = ${row.listingTable} AND previous.listing_id = ${row.id}::uuid)
    ON CONFLICT DO NOTHING`);
}

export async function reconcileLegacySourceIdentities(tx: DbTransaction, sourceName: string, options: { dryRun?: boolean } = {}) {
  const startedAt = performance.now();
  await lockIngestSource(tx, sourceName);
  const graph = await prepareIdentityComponents(tx, sourceName);
  if (!options.dryRun) await tx.execute(sql`CREATE TEMP TABLE IF NOT EXISTS ingest_identity_reconciliation_snapshots
    (listing_table text NOT NULL, listing_id uuid NOT NULL, before_json jsonb NOT NULL,
     PRIMARY KEY(listing_table,listing_id)) ON COMMIT DROP`);
  const report = {
    sourceName, dryRun: Boolean(options.dryRun), rowsBefore: graph.rows,
    canonicalRowsBefore: graph.canonicalRows, legacyRowsBefore: graph.legacyRows,
    identityGroups: graph.groups, duplicateGroups: graph.duplicateGroups, quarantinedGroups: 0,
    canonicalDuplicatesSuppressed: 0, legacyDuplicatesRecorded: 0,
    rowsAfter: graph.rows, canonicalRowsAfter: graph.canonicalRows, legacyRowsAfter: graph.legacyRows,
    conflictSampleLimit: 100, conflictsTruncated: false,
    conflicts: [] as Array<{ reason: string; listingIds: string[]; aliases: SourceAlias[]; listingCount: number; aliasCount: number }>,
    profile: { ...graph.profile, fastPathGroups: 0, fastPathLegacyRows: 0, reconciliationMs: 0 },
  };
  const recordConflict = (reason: string, group: IdentityReconciliationGroup) => {
    report.quarantinedGroups += 1;
    if (report.conflicts.length < report.conflictSampleLimit) report.conflicts.push({ reason,
      listingIds: group.rows.slice(0,32).map(row => row.id), aliases: group.aliases.slice(0,32),
      listingCount: group.rows.length, aliasCount: group.aliases.length });
    else report.conflictsTruncated = true;
  };
  if (!options.dryRun) {
    const fresh = await applyFreshIdentityComponents(tx, sourceName);
    report.profile.fastPathGroups = fresh.groups;
    report.profile.fastPathLegacyRows = fresh.legacyRows;
    report.legacyDuplicatesRecorded += fresh.legacyRows;
  }
  for await (const group of identityComponents(tx, !options.dryRun)) {
    if (group.conflict) recordConflict(group.conflict, group);
    const primary = group.survivor ?? group.rows[0]!;
    const canonicalIds = group.rows.filter((row) => row.listingTable === 'canonical_listings').map((row) => row.id);
    let survivor = group.survivor;
    let reason: string | null = group.conflict;
    let identity: SourceListingIdentity | null = null;
    if (!options.dryRun) {
      await snapshotReconciliationGroup(tx, group);
      let resolution = await resolveSourceListingIdentity(tx, { sourceName, primaryId: primary.primaryId, primaryIdType: primary.primaryIdType, aliases: group.aliases, auditMode: 'server' });
      if (!reason && !resolution.quarantined && survivor) {
        resolution = await bindSourceIdentityToListing(tx, resolution.identity.id, survivor.id, 'server');
      }
      if (resolution.quarantined) reason = reason ?? resolution.identity.quarantineReason ?? 'existing_identity_quarantine';
      if (reason) {
        resolution = await quarantineSourceIdentity(tx, { identityId: resolution.identity.id, reason,
          listingIds: canonicalIds, auditMode: 'server', details: { reconciliation: true, affectedRows: group.rows.map(row => ({ listingTable: row.listingTable, listingId: row.id })) } });
        survivor = null;
        if (!group.conflict) {
          recordConflict(reason, group);
        }
      }
      identity = resolution.identity;
    }
    const duplicateRows = group.rows.filter((row) => reason || row.id !== survivor?.id);
    report.canonicalDuplicatesSuppressed += duplicateRows.filter((row) => row.listingTable === 'canonical_listings').length;
    report.legacyDuplicatesRecorded += duplicateRows.filter((row) => row.listingTable === 'listings').length;
    if (options.dryRun) continue;
    for (const row of duplicateRows) {
      await recordReconciliationAudit(tx, { row, sourceName, survivorId: survivor?.id ?? null, identityId: identity!.id,
        reason: reason ?? (row.listingTable === 'listings'
          ? survivor ? 'legacy_projection_replaced' : 'legacy_identity_preserved' : 'proved_alias_duplicate'), aliases: group.aliases });
      if (row.listingTable === 'canonical_listings') {
        await tx.update(canonicalListings).set({ verificationState: 'invalid', activeEligible: false }).where(eq(canonicalListings.id, row.id));
        if (survivor) {
          await tx.update(listingObservationLinks).set({ canonicalListingId: survivor.id })
            .where(eq(listingObservationLinks.canonicalListingId, row.id));
          // Preserve exact duplicate evidence in its original historical row; move every other reference.
          await tx.execute(sql`UPDATE listing_price_observations historical
            SET canonical_listing_id = ${survivor.id}
            WHERE historical.canonical_listing_id = ${row.id}
              AND (historical.source_listing_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM listing_price_observations current_price
                WHERE current_price.canonical_listing_id = ${survivor.id}
                  AND current_price.source_name = historical.source_name
                  AND current_price.source_listing_id = historical.source_listing_id
                  AND current_price.price_date = historical.price_date
                  AND current_price.price = historical.price
                  AND current_price.event_type = historical.event_type
              ))`);
          await tx.update(listingCandidateHandoffs).set({ canonicalListingId: survivor.id })
            .where(eq(listingCandidateHandoffs.canonicalListingId, row.id));
        }
      }
    }
  }
  if (!options.dryRun) {
    const [canonicalAfter] = await tx.select({ count: sql<number>`count(*)::integer` }).from(canonicalListings).where(eq(canonicalListings.sourceName, sourceName));
    const [legacyAfter] = await tx.select({ count: sql<number>`count(*)::integer` }).from(listings).where(eq(listings.sourceName, sourceName));
    report.canonicalRowsAfter = canonicalAfter!.count;
    report.legacyRowsAfter = legacyAfter!.count;
    report.rowsAfter = report.canonicalRowsAfter + report.legacyRowsAfter;
  }
  report.profile.reconciliationMs = Math.round(performance.now() - startedAt);
  return report;
}

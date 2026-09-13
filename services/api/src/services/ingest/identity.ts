import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/index.js';
import {
  canonicalListings, listings, listingObservations, listingObservationLinks, listingPriceObservations, listingCandidateHandoffs,
  listingSourceAliases, sourceListingAliases, sourceListingIdentities,
  sourceIdentityQuarantines, sourceIdentityReconciliations,
} from '../../db/schema.js';

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

function isStrongAlias(alias: SourceAlias): boolean {
  return !['canonical_path', 'relative_path', 'url_path', 'url', 'canonical_url', 'unknown', 'legacy_row_id'].includes(alias.kind);
}

export function conflictsWithStablePrimary(primary: SourceAlias, existingAliases: SourceAlias[]): boolean {
  if (primary.kind !== 'global_id' && primary.kind !== 'stable_id') return false;
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
): Promise<IdentityResolution> {
  const first = identities[0];
  if (!first) throw new Error('Cannot quarantine an absent identity');
  const ids = [...new Set(identities.map((identity) => identity.id))];
  const affectedListings = [...new Set([...listingIds, ...identities.flatMap((identity) => identity.canonicalListingId ? [identity.canonicalListingId] : [])])];
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
  identityId: string; reason: string; details: Record<string, unknown>; listingIds?: string[];
}): Promise<IdentityResolution> {
  const [initial] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, input.identityId));
  if (!initial) throw new Error(`Unknown source identity ${input.identityId}`);
  await lockIngestSource(tx, initial.sourceName);
  const [identity] = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.id, input.identityId));
  if (!identity) throw new Error(`Unknown source identity ${input.identityId}`);
  return quarantineIdentities(tx, [identity], input.reason, [], input.listingIds ?? [], input.details);
}

export async function resolveSourceListingIdentity(tx: DbTransaction, input: {
  sourceName: string; primaryId: string; primaryIdType: string; aliases?: SourceAlias[];
}): Promise<IdentityResolution> {
  const aliases = normalizeIdentityAliases([{ kind: input.primaryIdType, value: input.primaryId }, ...(input.aliases ?? [])]);
  await lockIngestSource(tx, input.sourceName);
  await lockAliases(tx, input.sourceName, aliases);
  const matches = await tx.select({ identity: sourceListingIdentities, kind: sourceListingAliases.kind }).from(sourceListingAliases)
    .innerJoin(sourceListingIdentities, eq(sourceListingIdentities.id, sourceListingAliases.identityId))
    .where(and(eq(sourceListingAliases.sourceName, input.sourceName), or(...aliases.map((alias) => and(
      eq(sourceListingAliases.kind, alias.kind), eq(sourceListingAliases.value, alias.value),
    )))));
  const strongIncoming = aliases.some(isStrongAlias);
  const explicitStableConflict = ['global_id', 'stable_id'].some(kind => new Set(aliases.filter(alias => alias.kind === kind).map(alias => alias.value)).size > 1);
  const candidateIds = [...new Set(matches.map(({ identity }) => identity.id))];
  const existingAliases = candidateIds.length ? await tx.select().from(sourceListingAliases)
    .where(inArray(sourceListingAliases.identityId, candidateIds)) : [];
  const acceptedMatches = explicitStableConflict ? matches : matches.filter((match) => {
    const ownerAliases = existingAliases.filter(alias => alias.identityId === match.identity.id);
    if (conflictsWithStablePrimary({ kind: input.primaryIdType, value: input.primaryId }, ownerAliases)) return false;
    return !strongIncoming || isStrongAlias({ kind: match.kind, value: '' }) || !ownerAliases.some(isStrongAlias);
  });
  const identities = [...new Map(acceptedMatches.map(({ identity }) => [identity.id, identity])).values()];
  if (identities.length > 1) {
    const primaryMatch = matches.find((match) => match.kind === input.primaryIdType
      && existingAliases.some((alias) => alias.identityId === match.identity.id
        && alias.kind === input.primaryIdType && alias.value === input.primaryId));
    let primaryIdentity = primaryMatch?.identity;
    if (!primaryIdentity) {
      [primaryIdentity] = await tx.insert(sourceListingIdentities).values({
        sourceName: input.sourceName, primaryId: input.primaryId.trim(), primaryIdType: input.primaryIdType.trim(),
      }).returning();
      await tx.insert(sourceListingAliases).values({ sourceName: input.sourceName,
        kind: input.primaryIdType.trim(), value: input.primaryId.trim(), identityId: primaryIdentity!.id }).onConflictDoNothing();
    }
    return quarantineIdentities(tx, [primaryIdentity!, ...identities.filter((identity) => identity.id !== primaryIdentity!.id)],
      'aliases_resolve_to_multiple_identities', aliases, [], { incoming: input });
  }
  let identity = identities[0];
  if (!identity) {
    [identity] = await tx.insert(sourceListingIdentities).values({
      sourceName: input.sourceName, primaryId: input.primaryId.trim(), primaryIdType: input.primaryIdType.trim(),
    }).returning();
  }
  if (!identity) throw new Error('Identity insert returned no row');
  if (explicitStableConflict) return quarantineIdentities(tx, [identity], 'conflicting_source_identities', aliases, [], { incoming: input });
  // A quarantined identity retains all evidence but cannot silently acquire new links.
  if (!identity.quarantinedAt) {
    await tx.insert(sourceListingAliases).values(aliases.map((alias) => ({ ...alias, sourceName: input.sourceName, identityId: identity!.id })))
      .onConflictDoNothing();
  }
  return { identity, quarantined: identity.quarantinedAt !== null };
}

export async function bindSourceIdentityToListing(tx: DbTransaction, identityId: string, listingId: string): Promise<IdentityResolution> {
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
      ? 'conflicting_property_links' : 'multiple_canonical_links', [], [listingId], {});
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
  snapshot: Record<string, unknown>;
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
  rows.forEach((row, index) => { const key = root(index); groups.set(key, [...(groups.get(key) ?? []), row]); });
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

function validAliases(value: unknown): SourceAlias[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SourceAlias => Boolean(item && typeof item === 'object'
    && typeof item.kind === 'string' && item.kind.trim() && typeof item.value === 'string' && item.value.trim()));
}

export async function loadLegacyIdentityRows(tx: DbTransaction, sourceName: string): Promise<LegacyIdentityRow[]> {
  const canonical = await tx.select().from(canonicalListings).where(eq(canonicalListings.sourceName, sourceName));
  const legacy = await tx.select().from(listings).where(eq(listings.sourceName, sourceName));
  const observations = await tx.select({ observation: listingObservations, canonicalId: listingObservationLinks.canonicalListingId })
    .from(listingObservations).leftJoin(listingObservationLinks, eq(listingObservationLinks.listingObservationId, listingObservations.id))
    .where(eq(listingObservations.sourceName, sourceName));
  const oldAliases = await tx.select().from(listingSourceAliases).where(eq(listingSourceAliases.sourceName, sourceName));
  const currentIdentities = await tx.select().from(sourceListingIdentities).where(eq(sourceListingIdentities.sourceName, sourceName));
  const currentAliases = await tx.select().from(sourceListingAliases).where(eq(sourceListingAliases.sourceName, sourceName));
  const priorReconciliations = await tx.select().from(sourceIdentityReconciliations).where(eq(sourceIdentityReconciliations.sourceName, sourceName));
  const currentAliasMap = new Map<string, SourceAlias[]>();
  for (const alias of currentAliases) currentAliasMap.set(alias.identityId, [...(currentAliasMap.get(alias.identityId) ?? []), alias]);
  const aliasesByCanonical = new Map(currentIdentities.filter((identity) => identity.canonicalListingId)
    .map((identity) => [identity.canonicalListingId!, currentAliasMap.get(identity.id) ?? []]));
  const priorAliasesByRow = new Map(priorReconciliations.map((entry) => [
    `${entry.listingTable}:${entry.listingId}`, validAliases(entry.detailsJson.aliases),
  ]));
  const evidence = new Map<string, typeof observations>();
  for (const row of observations) {
    const keys = [row.canonicalId ? `canonical:${row.canonicalId}` : null,
      typeof row.observation.payload.mirrorListingId === 'string' ? `mirror:${row.observation.payload.mirrorListingId}` : null];
    for (const key of keys) if (key) evidence.set(key, [...(evidence.get(key) ?? []), row]);
  }
  const aliasByPrimary = new Map<string, SourceAlias[]>();
  for (const alias of oldAliases) aliasByPrimary.set(alias.primarySourceListingId, [
    ...(aliasByPrimary.get(alias.primarySourceListingId) ?? []), { kind: alias.aliasKind, value: alias.aliasValue },
  ]);
  const result: LegacyIdentityRow[] = [];
  for (const row of [...canonical.map((listing) => ({ listing, table: 'canonical_listings' as const })),
    ...legacy.map((listing) => ({ listing, table: 'listings' as const }))]) {
    const primaryId = 'primarySourceListingId' in row.listing ? row.listing.primarySourceListingId : row.listing.mirrorListingId;
    const related = evidence.get(row.table === 'canonical_listings' ? `canonical:${row.listing.id}` : `mirror:${primaryId}`) ?? [];
    // Rows without a source identifier remain independently addressable without guessing a URL ID.
    const fallback = primaryId ?? row.listing.id;
    const typed = related.find(({ observation }) => observation.sourceListingId === primaryId && observation.sourceListingIdKind && observation.sourceListingIdKind !== 'unknown');
    const primaryIdType = typed?.observation.sourceListingIdKind ?? (primaryId ? 'unknown' : 'legacy_row_id');
    const aliases = related.flatMap(({ observation }) => [
      ...validAliases(observation.sourceListingAliases),
      ...(observation.sourceListingId && observation.sourceListingIdKind ? [{ kind: observation.sourceListingIdKind, value: observation.sourceListingId }] : []),
    ]);
    // An unknown ID may be assigned a type only by explicit legacy alias evidence.
    const knownAliases = aliasByPrimary.get(fallback) ?? [];
    const knownType = knownAliases.find((alias) => alias.value === fallback)?.kind;
    result.push({ listingTable: row.table, id: row.listing.id, propertyId: row.listing.propertyId,
      primaryId: fallback, primaryIdType: primaryIdType === 'unknown' && knownType ? knownType : primaryIdType,
      aliases: [...aliases, ...knownAliases, ...(row.table === 'canonical_listings' ? aliasesByCanonical.get(row.listing.id) ?? [] : []),
        ...(priorAliasesByRow.get(`${row.table}:${row.listing.id}`) ?? [])], status: row.listing.status, createdAt: row.listing.createdAt,
      snapshot: { ...row.listing },
    });
  }
  return result;
}

export async function reconcileLegacySourceIdentities(tx: DbTransaction, sourceName: string, options: { dryRun?: boolean } = {}) {
  await lockIngestSource(tx, sourceName);
  const rows = await loadLegacyIdentityRows(tx, sourceName);
  const groups = planIdentityReconciliation(rows);
  const report = {
    sourceName, dryRun: Boolean(options.dryRun), rowsBefore: rows.length,
    canonicalRowsBefore: rows.filter((row) => row.listingTable === 'canonical_listings').length,
    legacyRowsBefore: rows.filter((row) => row.listingTable === 'listings').length,
    identityGroups: groups.length, duplicateGroups: groups.filter((group) => group.rows.length > 1).length,
    quarantinedGroups: groups.filter((group) => group.conflict).length,
    canonicalDuplicatesSuppressed: 0, legacyDuplicatesRecorded: 0,
    rowsAfter: rows.length, canonicalRowsAfter: rows.filter((row) => row.listingTable === 'canonical_listings').length,
    legacyRowsAfter: rows.filter((row) => row.listingTable === 'listings').length,
    conflicts: groups.filter((group) => group.conflict).map((group) => ({ reason: group.conflict as string, listingIds: group.rows.map((row) => row.id), aliases: group.aliases })),
  };
  for (const group of groups) {
    const primary = group.survivor ?? group.rows[0]!;
    const canonicalIds = group.rows.filter((row) => row.listingTable === 'canonical_listings').map((row) => row.id);
    let survivor = group.survivor;
    let reason: string | null = group.conflict;
    let identity: SourceListingIdentity | null = null;
    if (!options.dryRun) {
      let resolution = await resolveSourceListingIdentity(tx, { sourceName, primaryId: primary.primaryId, primaryIdType: primary.primaryIdType, aliases: group.aliases });
      if (!reason && !resolution.quarantined && survivor) {
        resolution = await bindSourceIdentityToListing(tx, resolution.identity.id, survivor.id);
      }
      if (resolution.quarantined) reason = reason ?? resolution.identity.quarantineReason ?? 'existing_identity_quarantine';
      if (reason) {
        resolution = await quarantineSourceIdentity(tx, { identityId: resolution.identity.id, reason,
          listingIds: canonicalIds, details: { reconciliation: true, before: group.rows.map((row) => row.snapshot) } });
        survivor = null;
        if (!group.conflict) {
          report.quarantinedGroups += 1;
          report.conflicts.push({ reason, listingIds: group.rows.map((row) => row.id), aliases: group.aliases });
        }
      }
      identity = resolution.identity;
    }
    const duplicateRows = group.rows.filter((row) => reason || row.id !== survivor?.id);
    report.canonicalDuplicatesSuppressed += duplicateRows.filter((row) => row.listingTable === 'canonical_listings').length;
    report.legacyDuplicatesRecorded += duplicateRows.filter((row) => row.listingTable === 'listings').length;
    if (options.dryRun) continue;
    for (const row of duplicateRows) {
      const previousLinks = row.listingTable === 'canonical_listings'
        ? await tx.select().from(listingObservationLinks).where(eq(listingObservationLinks.canonicalListingId, row.id)) : [];
      const previousPrices = row.listingTable === 'canonical_listings'
        ? await tx.select().from(listingPriceObservations).where(eq(listingPriceObservations.canonicalListingId, row.id)) : [];
      const previousHandoffs = row.listingTable === 'canonical_listings'
        ? await tx.select().from(listingCandidateHandoffs).where(eq(listingCandidateHandoffs.canonicalListingId, row.id)) : [];
      await tx.insert(sourceIdentityReconciliations).values({
        listingTable: row.listingTable, listingId: row.id, sourceName,
        survivorListingId: survivor?.id ?? null, identityId: identity!.id,
        reason: reason ?? (row.listingTable === 'listings'
          ? survivor ? 'legacy_projection_replaced' : 'legacy_identity_preserved' : 'proved_alias_duplicate'),
        detailsJson: { before: row.snapshot, aliases: group.aliases, preservedFactualStatus: row.status,
          observationLinksBefore: previousLinks, priceObservationsBefore: previousPrices, candidateHandoffsBefore: previousHandoffs },
      }).onConflictDoNothing();
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
  return report;
}

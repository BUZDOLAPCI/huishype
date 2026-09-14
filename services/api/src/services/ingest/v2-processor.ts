import { createHash } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { CountryCode } from '@huishype/shared';
import {
  canonicalListings, ingestEvidence, ingestWriterGenerations, listingCandidateHandoffs,
  listingObservationLinks, listingObservations, properties, sourceIdentityQuarantines, sourceListingIdentities,
  type CanonicalListing, type DbTransaction,
} from '../../db/index.js';
import { canonicalizeAddressWithDiagnostics, normalizeSourceUrl } from '../../utils/address.js';
import { projectListingAvailability, type ListingAvailabilityEvidence } from '../listing-lifecycle.js';
import { bindSourceIdentityToListing, quarantineSourceIdentity, resolveSourceListingIdentity } from './identity.js';
import type { IngestBatchRequest } from './contracts.js';
import type { IngestEvidenceV2, IngestFactsV2 } from './v2-contracts.js';
import { mergeListingFacts } from './field-merge.js';
import { recordIdentityBusinessHistory } from './identity-business-history.js';
import { IngestIdempotencyConflictError } from './errors.js';
import { assertIngestWriter, IngestSequenceGapError } from './v2-writer.js';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function evidencePayloadHash(record: IngestEvidenceV2): string {
  return createHash('sha256').update(stableJson(record)).digest('hex');
}
function asDate(value: unknown): Date | null { return typeof value === 'string' ? new Date(value) : null; }
function maxDate(a: Date | null, b: Date | null): Date | null { return !a ? b : !b ? a : a > b ? a : b; }
function evidenceKind(record: IngestEvidenceV2): ListingAvailabilityEvidence['kind'] {
  if (record.kind === 'sighting') return 'positive';
  if (record.kind !== 'facts') return 'none';
  const status = record.facts.lifecycleStatus;
  if (status === 'available' || status === 'conditional') return 'positive';
  return status ?? 'none';
}

async function matchProperty(tx: DbTransaction, facts: Record<string, unknown>): Promise<string[]> {
  const address = facts.address as IngestFactsV2['address'];
  if (!address?.countryCode || !address.street || !address.postalCode || address.houseNumber == null) return [];
  const result = canonicalizeAddressWithDiagnostics({
    countryCode: address.countryCode as CountryCode, street: address.street,
    postalCode: address.postalCode, houseNumber: address.houseNumber,
    houseNumberAddition: address.houseNumberAddition, city: address.city ?? undefined,
  });
  if (!result.canonical) return [];
  const canonical = result.canonical;
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM properties
    WHERE country_code = ${address.countryCode}
      AND postal_code = ${canonical.postalCode}
      AND house_number = ${canonical.houseNumber}
      AND COALESCE(house_number_addition, '') = ${canonical.houseNumberAddition ?? ''}
      AND LOWER(REGEXP_REPLACE(BTRIM(street), '\\s+', ' ', 'g')) = ${canonical.street.trim().replace(/\s+/g, ' ').toLowerCase()}
    LIMIT 2
  `);
  return Array.from(rows, row => row.id);
}

async function contradictsLinkedAddress(tx: DbTransaction, propertyId: string, facts: Record<string, unknown>): Promise<boolean> {
  const address = facts.address as IngestFactsV2['address'];
  if (!address) return false;
  const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
  if (!property) return true;
  const normalized = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (address.countryCode && address.countryCode !== property.countryCode) return true;
  if (address.street && normalized(address.street) !== normalized(property.street)) return true;
  if (address.postalCode && normalized(address.postalCode) !== normalized(property.postalCode)) return true;
  if (address.houseNumber != null) {
    const parsed = canonicalizeAddressWithDiagnostics({
      countryCode: property.countryCode as CountryCode, houseNumber: address.houseNumber,
      postalCode: property.postalCode ?? '', houseNumberAddition: address.houseNumberAddition,
    }).canonical;
    if (!parsed || parsed.houseNumber !== property.houseNumber) return true;
    if ((Object.hasOwn(address, 'houseNumberAddition') || parsed.houseNumberAddition)
      && normalized(parsed.houseNumberAddition) !== normalized(property.houseNumberAddition)) return true;
  }
  return false;
}

function canonicalFacts(canonical: CanonicalListing | null): Record<string, unknown> {
  if (!canonical) return {};
  return {
    sourceUrl: canonical.displayUrl, canonicalUrl: canonical.canonicalUrl,
    lifecycleStatus: canonical.status === 'active' ? 'available' : canonical.status,
    askingPrice: canonical.askingPrice, priceType: canonical.priceType, currency: canonical.priceCurrency,
    pricePeriod: canonical.pricePeriod, priceUnit: canonical.priceUnit, priceCondition: canonical.priceCondition,
    livingAreaM2: canonical.livingAreaM2, thumbnailUrl: canonical.thumbnailUrl, ogTitle: canonical.title,
    listedAt: canonical.listedAt?.toISOString() ?? null,
    soldAt: canonical.soldAt?.toISOString() ?? null, rentedAt: canonical.rentedAt?.toISOString() ?? null,
    withdrawnAt: canonical.withdrawnAt?.toISOString() ?? null,
  };
}
function projectedFacts(facts: Record<string, unknown>): Partial<typeof canonicalListings.$inferInsert> {
  const patch: Partial<typeof canonicalListings.$inferInsert> = {};
  const mapping = {
    askingPrice: 'askingPrice', priceType: 'priceType', currency: 'priceCurrency', livingAreaM2: 'livingAreaM2',
    pricePeriod: 'pricePeriod', priceUnit: 'priceUnit', priceCondition: 'priceCondition',
    thumbnailUrl: 'thumbnailUrl', ogTitle: 'title',
  } as const;
  for (const [field, column] of Object.entries(mapping)) {
    if (Object.hasOwn(facts, field)) Object.assign(patch, { [column]: facts[field] });
  }
  for (const key of ['listedAt', 'soldAt', 'rentedAt', 'withdrawnAt'] as const) {
    if (Object.hasOwn(facts, key)) patch[key] = asDate(facts[key]);
  }
  if (typeof facts.sourceUrl === 'string') patch.displayUrl = facts.sourceUrl;
  if (typeof facts.canonicalUrl === 'string' || typeof facts.sourceUrl === 'string') {
    patch.canonicalUrl = normalizeSourceUrl((facts.canonicalUrl ?? facts.sourceUrl) as string);
  }
  return patch;
}
function hasCanonicalChanges(existing: CanonicalListing, patch: Partial<typeof canonicalListings.$inferInsert>): boolean {
  return Object.entries(patch).some(([key, value]) => {
    const before = existing[key as keyof CanonicalListing];
    return before instanceof Date && value instanceof Date ? before.getTime() !== value.getTime() : before !== value;
  });
}

async function recordCanonicalChange(tx: DbTransaction, batchId: string, record: IngestEvidenceV2,
  canonical: CanonicalListing, previousPrice: number | null | undefined, facts: Record<string, unknown>): Promise<string> {
  // V2's event ledger is authoritative. The compact compatibility observation powers existing detail/history reads.
  const observationId = (await tx.insert(listingObservations).values({
    sourceName: canonical.sourceName, sourceListingId: record.eventId,
    sourceListingIdKind: 'unknown', sourceListingAliases: record.identity.aliases,
    sourceUrlRaw: canonical.displayUrl, sourceUrlCanonical: canonical.canonicalUrl,
    origin: 'mirror', propertyId: canonical.propertyId, propertyMatchKind: 'source_exact',
    sourceStatus: evidenceKind(record) === 'positive' ? 'available'
      : (record.kind === 'facts' && ['sold', 'rented', 'withdrawn'].includes(record.facts.lifecycleStatus ?? ''))
        ? record.facts.lifecycleStatus as 'sold' | 'rented' | 'withdrawn' : null,
    askingPrice: canonical.askingPrice, priceCurrency: canonical.priceCurrency,
    observedAt: new Date(record.observedAt), ingestBatchId: batchId,
    payload: { ...facts, sourceListingId: record.identity.sourceListingId, eventId: record.eventId, ingestVersion: 2, collector: record.collector, imageUrl: facts.thumbnailUrl, title: facts.ogTitle },
  }).returning({ id: listingObservations.id }))[0].id;
  await tx.insert(listingObservationLinks).values({
    listingObservationId: observationId, canonicalListingId: canonical.id, linkReason: 'source_identity',
  });
  if (canonical.askingPrice !== null && canonical.askingPrice !== previousPrice) {
    const date = new Date(record.observedAt).toISOString().slice(0, 10);
    await tx.execute(sql`INSERT INTO listing_price_observations
      (listing_observation_id, canonical_listing_id, property_id, source_name, source_listing_id,
       origin, price, currency, event_type, price_date, observed_at, price_kind)
      VALUES (${observationId}, ${canonical.id}, ${canonical.propertyId}, ${canonical.sourceName}, ${record.identity.sourceListingId},
        'mirror', ${canonical.askingPrice}, ${canonical.priceCurrency ?? 'EUR'}, 'asking_price', ${date}::date,
        ${record.observedAt}::timestamptz, 'asking') ON CONFLICT DO NOTHING`);
    await tx.execute(sql`INSERT INTO price_history (property_id, price, price_date, event_type, source, price_kind)
      VALUES (${canonical.propertyId}, ${canonical.askingPrice}, ${date}::date, 'asking_price', ${canonical.sourceName}, 'asking')
      ON CONFLICT DO NOTHING`);
  }
  return observationId;
}

function evidenceUrls(record: IngestEvidenceV2, facts: Record<string, unknown>, canonical?: CanonicalListing): string[] {
  return [...new Set([
    facts.sourceUrl, facts.canonicalUrl, canonical?.canonicalUrl, canonical?.displayUrl,
    ...record.identity.aliases.filter(alias => alias.kind === 'canonical_url').map(alias => alias.value),
  ].filter((value): value is string => typeof value === 'string').map(normalizeSourceUrl))];
}

async function findCandidateCanonicals(tx: DbTransaction, sourceName: string, propertyId: string,
  record: IngestEvidenceV2, facts: Record<string, unknown>): Promise<{ listings: CanonicalListing[]; rejectedPropertyIds: string[] }> {
  const identifiers = [];
  if (record.sourceCandidateId) identifiers.push(eq(listingCandidateHandoffs.id, record.sourceCandidateId));
  if (record.previewResultId) identifiers.push(eq(listingCandidateHandoffs.previewResultId, record.previewResultId));
  const explicit = identifiers.length ? await tx.select({ handoff: listingCandidateHandoffs, listing: canonicalListings }).from(listingCandidateHandoffs)
    .leftJoin(canonicalListings, eq(canonicalListings.id, listingCandidateHandoffs.canonicalListingId))
    .where(or(...identifiers)) : [];
  const urls = evidenceUrls(record, facts);
  const accepted: CanonicalListing[] = [];
  const rejectedPropertyIds: string[] = [];
  for (const { handoff, listing } of explicit) {
    const valid = handoff.sourceName === sourceName && handoff.propertyId === propertyId
      && urls.includes(normalizeSourceUrl(handoff.sourceUrlCanonical))
      && (!listing || (listing.sourceName === sourceName && listing.propertyId === propertyId));
    if (valid) {
      if (listing?.originSummary === 'user' && listing.verificationState === 'provisional') accepted.push(listing);
      continue;
    }
    // A user hint is not source identity evidence. Reject its association while retaining proven listing coverage.
    await tx.insert(sourceIdentityQuarantines).values({ sourceName, reason: 'candidate_association_conflict', identityIds: [],
      listingIds: listing ? [listing.id] : [], aliasesJson: record.identity.aliases,
      detailsJson: { candidateBefore: handoff, canonicalBefore: listing, observedPropertyId: propertyId, observedUrls: urls, eventId: record.eventId },
    });
    await tx.update(listingCandidateHandoffs).set({ state: 'dead_letter', nextAttemptAt: null,
      lastError: 'Source evidence does not match the requested property or URL', updatedAt: new Date() })
      .where(eq(listingCandidateHandoffs.id, handoff.id));
    if (listing?.originSummary === 'user' && listing.verificationState === 'provisional') {
      await tx.update(canonicalListings).set({ verificationState: 'invalid', activeEligible: false }).where(eq(canonicalListings.id, listing.id));
      rejectedPropertyIds.push(listing.propertyId);
    }
  }
  if (identifiers.length) return { listings: [...new Map(accepted.map(listing => [listing.id, listing])).values()], rejectedPropertyIds };
  const candidates = await tx.select().from(canonicalListings).where(and(
    eq(canonicalListings.sourceName, sourceName), eq(canonicalListings.propertyId, propertyId),
    eq(canonicalListings.verificationState, 'provisional'), eq(canonicalListings.originSummary, 'user'),
    ...(urls.length ? [inArray(canonicalListings.canonicalUrl, urls)] : [sql`false`]),
  ));
  return { listings: candidates, rejectedPropertyIds };
}

async function completeCandidateHandoffs(tx: DbTransaction, record: IngestEvidenceV2,
  canonical: CanonicalListing, facts: Record<string, unknown>, hasAvailabilityEvidence: boolean, observationId?: string): Promise<void> {
  if (!hasAvailabilityEvidence) return;
  const identifiers = [];
  if (record.sourceCandidateId) identifiers.push(eq(listingCandidateHandoffs.id, record.sourceCandidateId));
  if (record.previewResultId) identifiers.push(eq(listingCandidateHandoffs.previewResultId, record.previewResultId));
  const urls = evidenceUrls(record, facts, canonical);
  if (urls.length) identifiers.push(inArray(listingCandidateHandoffs.sourceUrlCanonical, urls));
  if (!identifiers.length) return;
  await tx.update(listingCandidateHandoffs).set({
    canonicalListingId: canonical.id, ...(observationId ? { observationId } : {}),
    state: 'delivered', nextAttemptAt: null, lastError: null, updatedAt: new Date(),
  }).where(and(eq(listingCandidateHandoffs.sourceName, canonical.sourceName),
    eq(listingCandidateHandoffs.propertyId, canonical.propertyId), or(...identifiers),
    sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error', 'delivered')`));
}

export interface V2ProjectionResult {
  ingestedCount: number; updatedCount: number; skippedCount: number;
  changedPropertyIds: string[]; projectionChanged: boolean;
}
export async function processV2Evidence(tx: DbTransaction, batchId: string, payload: IngestBatchRequest): Promise<V2ProjectionResult> {
  await assertIngestWriter(tx, payload);
  const [writer] = await tx.select().from(ingestWriterGenerations).where(eq(ingestWriterGenerations.sourceName, payload.sourceName)).for('update');
  if (!writer || !payload.records || !payload.writerGeneration) throw new Error('Missing v2 writer state');
  let lastSequence = writer.lastSequence;
  const result: V2ProjectionResult = { ingestedCount: 0, updatedCount: 0, skippedCount: 0, changedPropertyIds: [], projectionChanged: false };
  for (const record of payload.records) {
    const hash = evidencePayloadHash(record);
    const [previous] = await tx.select().from(ingestEvidence).where(and(eq(ingestEvidence.sourceName, payload.sourceName), eq(ingestEvidence.eventId, record.eventId)));
    if (previous) {
      if (previous.payloadHash !== hash || previous.generation !== payload.writerGeneration || previous.sequence !== record.sequence) {
        throw new IngestIdempotencyConflictError(`Evidence event ${record.eventId} is already bound to different content or ordering`);
      }
      // An overlapping receipt can reference evidence accepted before identity
      // history existed. Its completion proof must include extraction of those
      // real samples, even when the original receipt has not been backfilled.
      await recordIdentityBusinessHistory(tx, { sourceName: payload.sourceName, identityId: previous.identityId,
        generation: payload.writerGeneration, record, association: 'historical_unknown' });
      continue;
    }
    if (record.sequence !== lastSequence + 1) throw new IngestSequenceGapError(`Expected evidence sequence ${lastSequence + 1}; received ${record.sequence}`);
    const resolved = await resolveSourceListingIdentity(tx, {
      sourceName: payload.sourceName, primaryId: record.identity.sourceListingId,
      primaryIdType: record.identity.sourceListingIdKind, aliases: record.identity.aliases,
    });
    let identity = resolved.identity;
    await tx.insert(ingestEvidence).values({
      sourceName: payload.sourceName, eventId: record.eventId, generation: payload.writerGeneration,
      sequence: record.sequence, identityId: identity.id, kind: record.kind,
      observedAt: new Date(record.observedAt), collector: record.collector,
      manifestRef: record.inventoryManifest ?? (record.inventoryManifestId ? { id: record.inventoryManifestId } : null), payloadJson: record as unknown as Record<string, unknown>, payloadHash: hash,
    });
    await recordIdentityBusinessHistory(tx, { sourceName: payload.sourceName, identityId: identity.id,
      generation: payload.writerGeneration, record, association: resolved.quarantined ? 'quarantined' : 'resolved' });
    lastSequence = record.sequence;
    if (resolved.quarantined) {
      result.changedPropertyIds.push(...resolved.affectedPropertyIds ?? []);
      result.projectionChanged ||= Boolean(resolved.affectedPropertyIds?.length);
      result.skippedCount += 1; continue;
    }
    let canonical = identity.canonicalListingId
      ? (await tx.select().from(canonicalListings).where(eq(canonicalListings.id, identity.canonicalListingId)).for('update'))[0] ?? null : null;
    const seed = { ...canonicalFacts(canonical), ...identity.factsJson };
    const patch = record.kind === 'facts' ? record.facts : record.kind === 'sighting' ? { lifecycleStatus: record.availability } : {};
    const previousFieldEvidence = { ...identity.fieldEvidence };
    if (canonical) {
      const observedAt = canonical.lastMirrorSeenAt ?? canonical.lastSeenAt;
      if (observedAt) for (const [field, value] of Object.entries(canonicalFacts(canonical))) {
        if (value !== null && previousFieldEvidence[field] === undefined) previousFieldEvidence[field] = {
          observedAt: observedAt.toISOString(), evidenceStrength: 'inventory', collector: 'direct', eventId: '',
        };
      }
    }
    const merged = mergeListingFacts(seed, previousFieldEvidence, patch, record);
    const kind = evidenceKind(record);
    const lastPositive = kind === 'positive' ? maxDate(identity.lastPositiveObservedAt, new Date(record.observedAt)) : identity.lastPositiveObservedAt;
    const lastEnded = kind !== 'positive' && kind !== 'none' ? maxDate(identity.lastStatusObservedAt, new Date(record.observedAt)) : identity.lastStatusObservedAt;
    [identity] = await tx.update(sourceListingIdentities).set({
      factsJson: merged.facts, fieldEvidence: merged.fieldEvidence, lastPositiveObservedAt: lastPositive,
      lastStatusObservedAt: lastEnded, updatedAt: new Date(),
    }).where(eq(sourceListingIdentities.id, identity.id)).returning();
    if (record.kind === 'absence') { result.updatedCount += 1; continue; }
    const propertyMatches = await matchProperty(tx, merged.facts);
    if (propertyMatches.length === 1 && (!canonical || record.sourceCandidateId || record.previewResultId)) {
      const candidateResolution = await findCandidateCanonicals(tx, payload.sourceName, propertyMatches[0], record, merged.facts);
      result.changedPropertyIds.push(...candidateResolution.rejectedPropertyIds);
      result.projectionChanged ||= candidateResolution.rejectedPropertyIds.length > 0;
      const candidates = candidateResolution.listings;
      if (!canonical && candidates.length > 1) {
        const quarantined = await quarantineSourceIdentity(tx, { identityId: identity.id, reason: 'ambiguous_candidate_identity',
          details: { eventId: record.eventId }, listingIds: candidates.map(candidate => candidate.id) });
        result.changedPropertyIds.push(...quarantined.affectedPropertyIds ?? []);
        result.projectionChanged ||= Boolean(quarantined.affectedPropertyIds?.length);
        result.skippedCount += 1; continue;
      }
      if (!canonical) canonical = candidates[0] ?? null;
    }
    if (propertyMatches.length > 1 || (canonical && (
      (propertyMatches.length === 1 && propertyMatches[0] !== canonical.propertyId)
      || await contradictsLinkedAddress(tx, canonical.propertyId, merged.facts)
    ))) {
      await quarantineSourceIdentity(tx, { identityId: identity.id, reason: propertyMatches.length > 1 ? 'ambiguous_address' : 'property_link_conflict',
        details: { propertyIds: propertyMatches, facts: merged.facts }, listingIds: canonical ? [canonical.id] : [] });
      if (canonical) { result.changedPropertyIds.push(canonical.propertyId); result.projectionChanged = true; }
      result.skippedCount += 1; continue;
    }
    if (!canonical && propertyMatches.length !== 1) { result.skippedCount += 1; continue; }
    if (canonical && !identity.canonicalListingId) {
      const bound = await bindSourceIdentityToListing(tx, identity.id, canonical.id);
      if (bound.quarantined) {
        result.changedPropertyIds.push(...bound.affectedPropertyIds ?? []);
        result.projectionChanged ||= Boolean(bound.affectedPropertyIds?.length);
        result.skippedCount += 1; continue;
      }
    }
    const factsPatch = projectedFacts(merged.facts);
    let availability = projectListingAvailability(canonical ?? {
      status: 'active', lastPositiveAvailabilityAt: lastPositive, availabilityEndedAt: lastEnded,
    }, { kind, observedAt: new Date(record.observedAt) });
    if (!identity.canonicalListingId) {
      // First binding to a provisional listing must replay retained source clocks
      // just like new insertion when the address arrives after availability.
      const terminal = merged.facts.lifecycleStatus;
      if (lastEnded && ['sold', 'rented', 'withdrawn', 'unavailable'].includes(String(terminal))) {
        availability = projectListingAvailability(availability, { kind: terminal as ListingAvailabilityEvidence['kind'], observedAt: lastEnded });
      }
      if (lastPositive) availability = projectListingAvailability(availability, { kind: 'positive', observedAt: lastPositive });
    }
    const displayPatch = { ...factsPatch, status: availability.status, activeEligible: availability.activeEligible, verificationState: 'validated' as const };
    const substantiveChanged = !canonical || hasCanonicalChanges(canonical, displayPatch) || merged.changedFields.some(field => ['numRooms', 'energyLabel', 'propertyType'].includes(field));
    const previousPrice = canonical?.askingPrice;
    const now = new Date();
    const writePatch = { ...factsPatch, ...availability, verificationState: 'validated' as const, statusSource: 'mirror' as const,
      originSummary: canonical?.originSummary === 'user' ? 'user_and_mirror' as const : canonical?.originSummary ?? 'mirror' as const,
      lastSeenAt: maxDate(canonical?.lastSeenAt ?? null, new Date(record.observedAt)),
      lastMirrorSeenAt: maxDate(canonical?.lastMirrorSeenAt ?? null, new Date(record.observedAt)),
      ...(substantiveChanged ? { updatedAt: now, lastReconciledAt: now } : {}),
    };
    const inserted = !canonical;
    if (!canonical) {
      [canonical] = await tx.insert(canonicalListings).values({
        ...writePatch, propertyId: propertyMatches[0], sourceName: payload.sourceName,
        primarySourceListingId: identity.id, originSummary: 'mirror', firstSeenAt: new Date(record.observedAt),
      }).returning();
      const bound = await bindSourceIdentityToListing(tx, identity.id, canonical.id);
      if (bound.quarantined) { result.skippedCount += 1; continue; }
    } else {
      [canonical] = await tx.update(canonicalListings).set(writePatch).where(eq(canonicalListings.id, canonical.id)).returning();
    }
    let observationId: string | undefined;
    if (substantiveChanged) {
      observationId = await recordCanonicalChange(tx, batchId, record, canonical, previousPrice, merged.facts);
      result.changedPropertyIds.push(canonical.propertyId);
      result.projectionChanged = true;
    }
    if (propertyMatches.length === 1 && propertyMatches[0] === canonical.propertyId) {
      await completeCandidateHandoffs(tx, record, canonical, merged.facts, Boolean(lastPositive || lastEnded), observationId);
    }
    if (inserted) result.ingestedCount += 1; else result.updatedCount += 1;
  }
  await tx.update(ingestWriterGenerations).set({ lastSequence, updatedAt: new Date() }).where(eq(ingestWriterGenerations.sourceName, payload.sourceName));
  return result;
}

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CountryCode } from '@huishype/shared';
import {
  canonicalListings, ingestEvidence, ingestWriterGenerations, listingCandidateHandoffs,
  listingObservationLinks, listingObservations, properties, sourceListingIdentities,
  type CanonicalListing, type DbTransaction,
} from '../../db/index.js';
import { canonicalizeAddressWithDiagnostics, normalizeSourceUrl } from '../../utils/address.js';
import { projectListingAvailability, type ListingAvailabilityEvidence } from '../listing-lifecycle.js';
import { bindSourceIdentityToListing, quarantineSourceIdentity, resolveSourceListingIdentity } from './identity.js';
import type { IngestBatchRequest } from './contracts.js';
import type { IngestEvidenceV2, IngestFactsV2 } from './v2-contracts.js';
import { mergeListingFacts } from './field-merge.js';
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
    if (parsed.houseNumberAddition && normalized(parsed.houseNumberAddition) !== normalized(property.houseNumberAddition)) return true;
  }
  return false;
}

function canonicalFacts(canonical: CanonicalListing | null): Record<string, unknown> {
  if (!canonical) return {};
  return {
    sourceUrl: canonical.displayUrl, canonicalUrl: canonical.canonicalUrl,
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
  canonical: CanonicalListing, previousPrice: number | null | undefined, facts: Record<string, unknown>): Promise<void> {
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
  await tx.update(listingCandidateHandoffs).set({
    canonicalListingId: canonical.id, observationId, state: 'delivered', nextAttemptAt: null, lastError: null, updatedAt: new Date(),
  }).where(and(eq(listingCandidateHandoffs.sourceName, canonical.sourceName), eq(listingCandidateHandoffs.propertyId, canonical.propertyId),
    eq(listingCandidateHandoffs.sourceUrlCanonical, canonical.canonicalUrl ?? ''),
    sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error')`));
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
    lastSequence = record.sequence;
    if (resolved.quarantined) {
      result.changedPropertyIds.push(...resolved.affectedPropertyIds ?? []);
      result.projectionChanged ||= Boolean(resolved.affectedPropertyIds?.length);
      result.skippedCount += 1; continue;
    }
    let canonical = identity.canonicalListingId
      ? (await tx.select().from(canonicalListings).where(eq(canonicalListings.id, identity.canonicalListingId)).for('update'))[0] ?? null : null;
    const seed = { ...canonicalFacts(canonical), ...identity.factsJson };
    const patch = record.kind === 'facts' ? record.facts : {};
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
    if (propertyMatches.length > 1 || (canonical && (await contradictsLinkedAddress(tx, canonical.propertyId, merged.facts)))) {
      await quarantineSourceIdentity(tx, { identityId: identity.id, reason: propertyMatches.length > 1 ? 'ambiguous_address' : 'property_link_conflict',
        details: { propertyIds: propertyMatches, facts: merged.facts }, listingIds: canonical ? [canonical.id] : [] });
      if (canonical) { result.changedPropertyIds.push(canonical.propertyId); result.projectionChanged = true; }
      result.skippedCount += 1; continue;
    }
    if (!canonical && propertyMatches.length !== 1) { result.skippedCount += 1; continue; }
    const factsPatch = projectedFacts(merged.facts);
    let availability = projectListingAvailability(canonical ?? {
      status: 'active', lastPositiveAvailabilityAt: lastPositive, availabilityEndedAt: lastEnded,
    }, { kind, observedAt: new Date(record.observedAt) });
    if (!canonical) {
      // Address resolution may arrive after the evidence that ended availability.
      const terminal = merged.facts.lifecycleStatus;
      if (lastEnded && ['sold', 'rented', 'withdrawn', 'unavailable'].includes(String(terminal))) {
        availability = projectListingAvailability(availability, { kind: terminal as ListingAvailabilityEvidence['kind'], observedAt: lastEnded });
      }
      if (lastPositive) availability = projectListingAvailability(availability, { kind: 'positive', observedAt: lastPositive });
    }
    const displayPatch = { ...factsPatch, status: availability.status, activeEligible: availability.activeEligible };
    const substantiveChanged = !canonical || hasCanonicalChanges(canonical, displayPatch) || merged.changedFields.some(field => ['numRooms', 'energyLabel', 'propertyType'].includes(field));
    const previousPrice = canonical?.askingPrice;
    const now = new Date();
    const writePatch = { ...factsPatch, ...availability, verificationState: 'validated' as const, statusSource: 'mirror' as const,
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
    if (substantiveChanged) {
      await recordCanonicalChange(tx, batchId, record, canonical, previousPrice, merged.facts);
      result.changedPropertyIds.push(canonical.propertyId);
      result.projectionChanged = true;
    }
    if (inserted) result.ingestedCount += 1; else result.updatedCount += 1;
  }
  await tx.update(ingestWriterGenerations).set({ lastSequence, updatedAt: new Date() }).where(eq(ingestWriterGenerations.sourceName, payload.sourceName));
  return result;
}

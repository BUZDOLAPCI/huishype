import crypto from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { IngestIdempotencyConflictError } from './ingest/errors.js';
import {
  canonicalListings,
  db,
  listingCandidateHandoffs,
  listingObservationLinks,
  listingObservations,
  listingPreviewResults,
  listingPriceObservations,
  listingSourceAliases,
  priceHistory,
  type CanonicalListing,
  type DbTransaction,
  type ListingObservation,
  type ListingPreviewResult,
  type NewListingObservation,
  type NewListingPreviewResult,
} from '../db/index.js';
import type {
  ListingPreviewPlan,
  ListingSourceAddress,
  ListingSourceAlias,
} from './listing-source-resolution.js';

type ReconciliationDb = typeof db | DbTransaction;
type CanonicalStatus = CanonicalListing['status'];
type VerificationState = CanonicalListing['verificationState'];
type OriginSummary = CanonicalListing['originSummary'];
type StatusSource = CanonicalListing['statusSource'];
type SourceListingIdKind = NonNullable<NewListingObservation['sourceListingIdKind']>;

export type ListingSourceStatus = NonNullable<ListingObservation['sourceStatus']>;
export type ListingDiagnosticStatus = NonNullable<ListingObservation['diagnosticStatus']>;

export type CanonicalListingReadModel = Omit<Pick<
  CanonicalListing,
  | 'id'
  | 'propertyId'
  | 'sourceName'
  | 'primarySourceListingId'
  | 'canonicalUrl'
  | 'displayUrl'
  | 'askingPrice'
  | 'priceCurrency'
  | 'thumbnailUrl'
  | 'title'
  | 'description'
  | 'status'
  | 'verificationState'
>, 'displayUrl'> & {
  displayUrl: string;
  candidateHandoffState: string | null;
  reasonCode: string | null;
  createdAt: string;
};

export type UserListingSubmissionInput = {
  userId: string;
  preview: ListingPreviewResult;
};

export type UserListingSubmissionResult = {
  canonicalListing: CanonicalListing;
  observationId: string;
  candidateId: string;
  candidateHandoffState: string;
  reasonCode: string;
};

export type PersistMirrorObservationForIngestInput = {
  batchId: string;
  sourceName: string;
  sourceUrl: string;
  sourceListingId: string | null;
  sourceListingIdKind: string | null;
  aliases?: Array<{ kind: string; value: string }>;
  propertyId: string | null;
  propertyMatchKind: ListingObservation['propertyMatchKind'];
  sourceStatus?: ListingSourceStatus | null;
  diagnosticStatus?: ListingDiagnosticStatus | null;
  askingPrice?: number | null;
  priceCurrency?: string | null;
  address?: {
    countryCode?: string | null;
    street?: string | null;
    postalCode?: string | null;
    houseNumber?: number | string | null;
    houseNumberAddition?: string | null;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  firstSeenAt?: string | Date | null;
  lastSeenAt?: string | Date | null;
  sourceUpdatedAt?: string | Date | null;
  observedAt?: string | Date | null;
  sourceRunId?: string | null;
  sourceHighWatermark?: string | Date | null;
  sourceProvenance?: 'crawler_discovered' | 'user_submitted' | 'replay' | 'import' | null;
  scopeCompletionId?: string | null;
  staleForProjection?: boolean;
  previewResultId?: string | null;
  candidateHandoffId?: string | null;
  payload?: Record<string, unknown>;
};

export type ListingWriteResult = {
  canonicalListing: CanonicalListing | null;
  observationId: string;
  propertyId: string | null;
  inserted: boolean;
  changed: boolean;
};

export type StoredPreviewResult = {
  preview: ListingPreviewResult;
  previewToken: string;
};

function targetDb(executor?: ReconciliationDb): ReconciliationDb {
  return executor ?? db;
}

function toOptionalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeSourceListingIdKind(kind: string | null | undefined): SourceListingIdKind | null {
  if (
    kind === 'tiny_id'
    || kind === 'global_id'
    || kind === 'detail_id'
    || kind === 'canonical_path'
    || kind === 'relative_path'
    || kind === 'url_path'
    || kind === 'unknown'
  ) {
    return kind;
  }
  return null;
}

function isListingSourceAlias(alias: { kind: string; value: string }): alias is ListingSourceAlias {
  return ['tiny_id', 'global_id', 'detail_id', 'canonical_url', 'relative_path', 'url_path'].includes(alias.kind);
}

function normalizeSourceAliases(aliases: readonly { kind: string; value: string }[] | undefined): ListingSourceAlias[] {
  return (aliases ?? []).filter(isListingSourceAlias);
}

function observationStatusToCanonicalStatus(status: ListingSourceStatus): CanonicalStatus {
  if (status === 'available') return 'active';
  if (status === 'not_found') return 'withdrawn';
  return status;
}

function observationStatusSource(origin: ListingObservation['origin']): StatusSource {
  return origin === 'user' ? 'user' : 'mirror';
}

function observationVerificationState(observation: ListingObservation): VerificationState {
  if (
    observation.diagnosticStatus === 'invalid'
    || observation.diagnosticStatus === 'unsupported'
    || observation.propertyMatchKind === 'source_mismatch'
  ) {
    return 'invalid';
  }
  if (observation.diagnosticStatus === 'blocked') return 'validation_blocked';
  if (observation.diagnosticStatus === 'parser_error' || observation.diagnosticStatus === 'retryable_error') {
    return 'validation_failed';
  }
  if (observation.origin === 'user') return 'provisional';
  return observation.sourceStatus ? 'validated' : 'validation_pending';
}

function mergeOriginSummary(current: OriginSummary | null, origin: ListingObservation['origin']): OriginSummary {
  const incoming: OriginSummary = origin === 'user' ? 'user' : 'mirror';
  if (!current || current === incoming) return incoming;
  return 'user_and_mirror';
}

function priceDateFromObservation(observation: ListingObservation): string {
  const source = observation.observedAt ?? observation.createdAt;
  return source.toISOString().slice(0, 10);
}

function priceEventTypeForObservation(observation: ListingObservation): 'initial' | 'mirror_refresh' | 'user_submission' | 'status_change' {
  if (observation.origin === 'user') return 'user_submission';
  if (observation.sourceStatus === 'sold' || observation.sourceStatus === 'rented') return 'status_change';
  return observation.origin === 'mirror' ? 'mirror_refresh' : 'initial';
}

function legacyPriceHistoryEventType(
  observation: ListingObservation,
  eventType: 'initial' | 'mirror_refresh' | 'user_submission' | 'status_change',
): string {
  if (eventType === 'status_change') return observation.sourceStatus === 'rented' ? 'rented' : 'sold';
  return 'asking_price';
}

function legacyPriceHistoryEventTypeForPriceObservation(
  eventType: string,
  sourceStatus: ListingSourceStatus | null,
): string {
  if (eventType === 'status_change') return sourceStatus === 'rented' ? 'rented' : 'sold';
  return 'asking_price';
}

function isMirrorBackedCanonical(canonical: CanonicalListing): boolean {
  return canonical.originSummary === 'mirror'
    || canonical.originSummary === 'user_and_mirror'
    || canonical.statusSource === 'mirror'
    || canonical.verificationState === 'validated'
    || canonical.lastMirrorSeenAt !== null;
}

function observationDisplayString(
  observation: ListingObservation,
  key: 'title' | 'description' | 'imageUrl',
): string | null {
  const direct = observation.payload[key];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const preview = observation.payload.preview;
  if (preview && typeof preview === 'object') {
    const previewValue = (preview as Record<string, unknown>)[key];
    if (typeof previewValue === 'string' && previewValue.length > 0) return previewValue;
  }
  return null;
}

function houseNumberFromAddress(address: ListingSourceAddress | Record<string, unknown> | null | undefined): number | null {
  if (typeof address?.houseNumber === 'number') return address.houseNumber;
  const parsed = Number.parseInt(String(address?.houseNumber ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function stableJson(value: unknown): string {
  if (typeof value === 'undefined') return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function stablePreviewIdempotencyKey(plan: ListingPreviewPlan): string {
  return crypto
    .createHash('sha256')
    .update(stableJson({
      sourceName: plan.sourceName,
      rawUrl: plan.rawUrl,
      canonicalUrl: plan.canonicalUrl,
      propertyId: plan.submittedPropertyId,
      matchedPropertyId: plan.matchedPropertyId,
      sourceListingId: plan.sourceListingId,
      sourceListingIdKind: plan.sourceListingIdKind,
      aliases: plan.aliases,
      validationState: plan.validationState,
      matchState: plan.matchState,
      propertyMatchKind: plan.propertyMatchKind,
      lifecycleStatus: plan.sourceStatus,
      askingPrice: plan.askingPrice,
      priceType: plan.priceType,
      currency: plan.currency,
      title: plan.title,
      description: plan.description,
      imageUrl: plan.imageUrl,
      address: plan.address,
      reasonCode: plan.reasonCode,
    }))
    .digest('hex');
}

function previewOwnerConflictPredicate(userId: string | null | undefined): ReturnType<typeof sql> {
  if (!userId) {
    return sql`${listingPreviewResults.userId} IS NULL`;
  }
  return sql`${listingPreviewResults.userId} = ${userId}`;
}

export async function upsertListingSourceAliases(
  sourceName: string,
  primarySourceListingId: string,
  aliases: readonly ListingSourceAlias[],
  executor?: ReconciliationDb,
): Promise<void> {
  if (aliases.length === 0) return;
  const database = targetDb(executor);
  const now = new Date();

  await database
    .insert(listingSourceAliases)
    .values(
      aliases.map((alias) => ({
        sourceName,
        aliasKind: alias.kind,
        aliasValue: alias.value,
        primarySourceListingId,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [listingSourceAliases.sourceName, listingSourceAliases.aliasKind, listingSourceAliases.aliasValue],
      set: {
        primarySourceListingId,
        lastSeenAt: now,
      },
    });
}

function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function observationCompatibilityPayload(
  observation: NewListingObservation | ListingObservation,
): Record<string, unknown> {
  const payload = { ...(observation.payload ?? {}) };
  delete payload.sourceCandidateId;

  return {
    sourceName: observation.sourceName,
    sourceListingId: observation.sourceListingId ?? null,
    sourceListingIdKind: observation.sourceListingIdKind ?? null,
    sourceListingAliases: observation.sourceListingAliases ?? [],
    sourceUrlRaw: observation.sourceUrlRaw ?? null,
    sourceUrlCanonical: observation.sourceUrlCanonical ?? null,
    submittedBy: observation.submittedBy ?? null,
    origin: observation.origin,
    propertyId: observation.propertyId ?? null,
    propertyMatchKind: observation.propertyMatchKind,
    sourceStatus: observation.sourceStatus ?? null,
    diagnosticStatus: observation.diagnosticStatus ?? null,
    askingPrice: observation.askingPrice ?? null,
    priceCurrency: observation.priceCurrency ?? null,
    addressRaw: observation.addressRaw ?? null,
    addressNormalized: observation.addressNormalized ?? null,
    postalCode: observation.postalCode ?? null,
    houseNumber: observation.houseNumber ?? null,
    houseNumberAddition: observation.houseNumberAddition ?? null,
    listedAt: dateKey(observation.listedAt),
    firstSeenAt: dateKey(observation.firstSeenAt),
    lastSeenAt: dateKey(observation.lastSeenAt),
    sourceUpdatedAt: dateKey(observation.sourceUpdatedAt),
    observedAt: dateKey(observation.observedAt),
    payload,
  };
}

function observationsAreCompatible(
  existing: ListingObservation,
  incoming: NewListingObservation,
): boolean {
  return stableJson(observationCompatibilityPayload(existing))
    === stableJson(observationCompatibilityPayload(incoming));
}

async function findCompatibleExistingObservationForIdempotentReplay(
  observation: NewListingObservation,
  executor?: ReconciliationDb,
): Promise<ListingObservation | null> {
  if (!observation.sourceListingId || !observation.observedAt) return null;

  const observedAt = observation.observedAt instanceof Date
    ? observation.observedAt
    : new Date(observation.observedAt);
  const [existing] = await targetDb(executor)
    .select()
    .from(listingObservations)
    .where(
      and(
        eq(listingObservations.sourceName, observation.sourceName),
        eq(listingObservations.sourceListingId, observation.sourceListingId),
        eq(listingObservations.origin, observation.origin),
        eq(listingObservations.observedAt, observedAt),
      ),
    )
    .limit(1);

  if (!existing) return null;
  if (!observationsAreCompatible(existing, observation)) {
    throw new IngestIdempotencyConflictError(
      `Listing observation idempotency key for ${observation.sourceName}:${observation.sourceListingId}:${observedAt.toISOString()} is already bound to different source facts`,
    );
  }

  return existing;
}

function nonNullMetadataValue<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

async function refreshCompatibleObservationMetadata(
  existing: ListingObservation,
  incoming: NewListingObservation,
  executor?: ReconciliationDb,
): Promise<{ observation: ListingObservation; madeFreshForProjection: boolean }> {
  const set: Partial<NewListingObservation> = {};
  const incomingStale = incoming.staleForProjection ?? false;
  const madeFreshForProjection = existing.staleForProjection && !incomingStale;

  if (existing.staleForProjection !== incomingStale) {
    set.staleForProjection = incomingStale;
  }
  if (
    incoming.sourceHighWatermark
    && dateKey(existing.sourceHighWatermark) !== dateKey(incoming.sourceHighWatermark)
  ) {
    set.sourceHighWatermark = incoming.sourceHighWatermark;
  }

  const safeLinkage = {
    ingestBatchId: nonNullMetadataValue(incoming.ingestBatchId),
    scopeCompletionId: nonNullMetadataValue(incoming.scopeCompletionId),
    candidateHandoffId: nonNullMetadataValue(incoming.candidateHandoffId),
    previewResultId: nonNullMetadataValue(incoming.previewResultId),
    sourceRunId: nonNullMetadataValue(incoming.sourceRunId),
  };

  for (const [key, value] of Object.entries(safeLinkage) as Array<
    [keyof typeof safeLinkage, string]
  >) {
    if (value && existing[key] !== value) {
      set[key] = value;
    }
  }

  if (Object.keys(set).length === 0) {
    return { observation: existing, madeFreshForProjection: false };
  }

  const [updated] = await targetDb(executor)
    .update(listingObservations)
    .set(set)
    .where(eq(listingObservations.id, existing.id))
    .returning();

  if (!updated) {
    throw new Error(`Listing observation ${existing.id} could not be refreshed for idempotent replay`);
  }

  return { observation: updated, madeFreshForProjection };
}

async function insertListingObservationInternal(
  observation: NewListingObservation,
  executor?: ReconciliationDb,
): Promise<{ observation: ListingObservation; reusedExisting: boolean; madeFreshForProjection: boolean }> {
  const [inserted] = await targetDb(executor)
    .insert(listingObservations)
    .values(observation)
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return { observation: inserted, reusedExisting: false, madeFreshForProjection: false };
  }

  const existing = await findCompatibleExistingObservationForIdempotentReplay(observation, executor);
  if (existing) {
    const refreshed = await refreshCompatibleObservationMetadata(existing, observation, executor);
    return {
      observation: refreshed.observation,
      reusedExisting: true,
      madeFreshForProjection: refreshed.madeFreshForProjection,
    };
  }
  throw new Error('Listing observation insert conflicted without a reusable idempotent observation');
}

export async function insertListingObservation(
  observation: NewListingObservation,
  executor?: ReconciliationDb,
): Promise<ListingObservation> {
  return (await insertListingObservationInternal(observation, executor)).observation;
}

async function resolvePrimarySourceListingId(
  observation: ListingObservation,
  executor: ReconciliationDb,
): Promise<string | null> {
  if (!observation.sourceListingId) return null;

  const [alias] = await executor
    .select({ primarySourceListingId: listingSourceAliases.primarySourceListingId })
    .from(listingSourceAliases)
    .where(
      and(
        eq(listingSourceAliases.sourceName, observation.sourceName),
        eq(listingSourceAliases.aliasValue, observation.sourceListingId),
      ),
    )
    .limit(1);

  return alias?.primarySourceListingId ?? observation.sourceListingId;
}

async function findCanonicalListing(
  observation: ListingObservation,
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing | null> {
  if (observation.candidateHandoffId) {
    const [row] = await executor
      .select({ canonical: canonicalListings })
      .from(listingCandidateHandoffs)
      .innerJoin(canonicalListings, eq(canonicalListings.id, listingCandidateHandoffs.canonicalListingId))
      .where(eq(listingCandidateHandoffs.id, observation.candidateHandoffId))
      .limit(1);

    if (row?.canonical) return row.canonical;
  }

  const predicates = [];
  if (primarySourceListingId) {
    predicates.push(and(
      eq(canonicalListings.sourceName, observation.sourceName),
      eq(canonicalListings.primarySourceListingId, primarySourceListingId),
    ));
  }
  if (observation.sourceUrlCanonical) {
    predicates.push(and(
      eq(canonicalListings.sourceName, observation.sourceName),
      eq(canonicalListings.canonicalUrl, observation.sourceUrlCanonical),
    ));
  }
  if (observation.propertyId && observation.sourceUrlCanonical) {
    predicates.push(and(
      eq(canonicalListings.sourceName, observation.sourceName),
      eq(canonicalListings.propertyId, observation.propertyId),
      eq(canonicalListings.canonicalUrl, observation.sourceUrlCanonical),
    ));
  }

  if (predicates.length === 0) return null;

  const [canonical] = await executor
    .select()
    .from(canonicalListings)
    .where(predicates.length === 1 ? predicates[0] : or(...predicates))
    .orderBy(desc(canonicalListings.updatedAt))
    .limit(1);

  return canonical ?? null;
}

function canProjectObservation(observation: ListingObservation): observation is ListingObservation & { sourceStatus: ListingSourceStatus } {
  if (observation.staleForProjection) return false;
  if (observation.diagnosticStatus) return false;
  if (!observation.sourceStatus) return false;
  if (observation.sourceStatus === 'not_found') {
    return Boolean(observation.sourceListingId || observation.sourceUrlCanonical || observation.scopeCompletionId);
  }
  return true;
}

function shouldRetireProvisionalForDiagnostic(observation: ListingObservation): boolean {
  return observation.diagnosticStatus === 'invalid'
    || observation.diagnosticStatus === 'unsupported';
}

function diagnosticHandoffState(status: ListingDiagnosticStatus): 'retryable_error' | 'dead_letter' {
  return status === 'invalid' || status === 'unsupported' ? 'dead_letter' : 'retryable_error';
}

async function createCanonicalListing(
  observation: ListingObservation & { sourceStatus: ListingSourceStatus },
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing> {
  if (!observation.propertyId) throw new Error('Cannot create canonical listing without a property id');

  const [created] = await executor
    .insert(canonicalListings)
    .values({
      propertyId: observation.propertyId,
      sourceName: observation.sourceName,
      primarySourceListingId,
      canonicalUrl: observation.sourceUrlCanonical,
      displayUrl: observation.sourceUrlCanonical ?? observation.sourceUrlRaw,
      status: observationStatusToCanonicalStatus(observation.sourceStatus),
      statusSource: observationStatusSource(observation.origin),
      verificationState: observationVerificationState(observation),
      originSummary: mergeOriginSummary(null, observation.origin),
      submittedBy: observation.submittedBy,
      thumbnailUrl: observationDisplayString(observation, 'imageUrl'),
      title: observationDisplayString(observation, 'title'),
      description: observationDisplayString(observation, 'description'),
      askingPrice: observation.askingPrice,
      priceCurrency: observation.priceCurrency,
      priceType: typeof observation.payload.priceType === 'string' ? observation.payload.priceType : null,
      livingAreaM2: typeof observation.payload.livingAreaM2 === 'number' ? observation.payload.livingAreaM2 : null,
      firstSeenAt: observation.firstSeenAt ?? observation.observedAt,
      lastSeenAt: observation.lastSeenAt ?? observation.observedAt,
      lastMirrorSeenAt: observation.origin === 'user' ? null : observation.lastSeenAt ?? observation.observedAt,
      lastUserSeenAt: observation.origin === 'user' ? observation.observedAt : null,
      lastReconciledAt: new Date(),
    })
    .returning();

  if (!created) throw new Error('Canonical listing insert did not return a row');
  return created;
}

function incomingObservationIsNewer(canonical: CanonicalListing, observation: ListingObservation): boolean {
  const current = observation.origin === 'user'
    ? canonical.lastUserSeenAt ?? canonical.lastSeenAt ?? canonical.updatedAt ?? canonical.createdAt
    : canonical.lastMirrorSeenAt ?? new Date(0);
  const incoming = observation.sourceUpdatedAt ?? observation.lastSeenAt ?? observation.observedAt;
  return incoming >= current || observation.origin === 'user';
}

async function updateCanonicalListingFromObservation(
  canonical: CanonicalListing,
  observation: ListingObservation & { sourceStatus: ListingSourceStatus },
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing> {
  const mirrorBacked = observation.origin !== 'user';
  const sourceIsNewer = incomingObservationIsNewer(canonical, observation);
  const preserveMirrorFacts = observation.origin === 'user' && isMirrorBackedCanonical(canonical);
  const shouldApplySourceFacts = preserveMirrorFacts ? false : (!mirrorBacked || sourceIsNewer);
  const shouldCorrectProvisionalProperty = mirrorBacked
    && canonical.originSummary === 'user'
    && canonical.verificationState === 'provisional'
    && observation.propertyId !== null
    && observation.propertyId !== canonical.propertyId;

  if (shouldCorrectProvisionalProperty) {
    await cleanupCanonicalPriceArtifacts(canonical, executor);
  }
  const nextPropertyId = shouldCorrectProvisionalProperty && observation.propertyId
    ? observation.propertyId
    : canonical.propertyId;

  const [updated] = await executor
    .update(canonicalListings)
    .set({
      propertyId: nextPropertyId,
      primarySourceListingId: canonical.primarySourceListingId ?? primarySourceListingId,
      canonicalUrl: shouldApplySourceFacts ? observation.sourceUrlCanonical ?? canonical.canonicalUrl : canonical.canonicalUrl,
      displayUrl: shouldApplySourceFacts
        ? observation.sourceUrlCanonical ?? canonical.displayUrl ?? observation.sourceUrlRaw
        : canonical.displayUrl,
      status: shouldApplySourceFacts
        ? observationStatusToCanonicalStatus(observation.sourceStatus)
        : canonical.status,
      statusSource: preserveMirrorFacts ? canonical.statusSource : (mirrorBacked ? 'mirror' : canonical.statusSource),
      verificationState: preserveMirrorFacts ? canonical.verificationState : observationVerificationState(observation),
      originSummary: mergeOriginSummary(canonical.originSummary, observation.origin),
      submittedBy: canonical.submittedBy ?? observation.submittedBy,
      thumbnailUrl: shouldApplySourceFacts
        ? observationDisplayString(observation, 'imageUrl') ?? canonical.thumbnailUrl
        : canonical.thumbnailUrl,
      title: shouldApplySourceFacts ? observationDisplayString(observation, 'title') ?? canonical.title : canonical.title,
      description: shouldApplySourceFacts
        ? observationDisplayString(observation, 'description') ?? canonical.description
        : canonical.description,
      askingPrice: shouldApplySourceFacts ? observation.askingPrice ?? canonical.askingPrice : canonical.askingPrice,
      priceCurrency: shouldApplySourceFacts ? observation.priceCurrency ?? canonical.priceCurrency : canonical.priceCurrency,
      priceType: shouldApplySourceFacts && typeof observation.payload.priceType === 'string'
        ? observation.payload.priceType
        : canonical.priceType,
      livingAreaM2: shouldApplySourceFacts && typeof observation.payload.livingAreaM2 === 'number'
        ? observation.payload.livingAreaM2
        : canonical.livingAreaM2,
      firstSeenAt: canonical.firstSeenAt ?? observation.firstSeenAt ?? observation.observedAt,
      lastSeenAt: shouldApplySourceFacts ? observation.lastSeenAt ?? observation.observedAt : canonical.lastSeenAt,
      lastMirrorSeenAt: mirrorBacked && shouldApplySourceFacts
        ? observation.lastSeenAt ?? observation.observedAt
        : canonical.lastMirrorSeenAt,
      lastUserSeenAt: observation.origin === 'user' ? observation.observedAt : canonical.lastUserSeenAt,
      lastReconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(canonicalListings.id, canonical.id))
    .returning();

  if (!updated) throw new Error(`Canonical listing ${canonical.id} could not be updated`);
  return updated;
}

async function cleanupCanonicalPriceArtifacts(
  canonical: Pick<CanonicalListing, 'id' | 'propertyId'>,
  executor: ReconciliationDb,
): Promise<void> {
  const projectedPrices = await executor
    .select({
      propertyId: listingPriceObservations.propertyId,
      price: listingPriceObservations.price,
      priceDate: listingPriceObservations.priceDate,
      eventType: listingPriceObservations.eventType,
      sourceName: listingPriceObservations.sourceName,
      sourceStatus: listingObservations.sourceStatus,
    })
    .from(listingPriceObservations)
    .innerJoin(listingObservations, eq(listingObservations.id, listingPriceObservations.listingObservationId))
    .where(eq(listingPriceObservations.canonicalListingId, canonical.id));

  for (const projected of projectedPrices) {
    await executor
      .delete(priceHistory)
      .where(and(
        eq(priceHistory.propertyId, projected.propertyId),
        eq(priceHistory.price, projected.price),
        eq(priceHistory.priceDate, projected.priceDate),
        eq(priceHistory.eventType, legacyPriceHistoryEventTypeForPriceObservation(
          projected.eventType,
          projected.sourceStatus,
        )),
        eq(priceHistory.source, projected.sourceName),
      ));
  }

  await executor
    .delete(listingPriceObservations)
    .where(eq(listingPriceObservations.canonicalListingId, canonical.id));
}

async function retireProvisionalCanonicalFromDiagnostic(
  canonical: CanonicalListing,
  observation: ListingObservation,
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing> {
  await cleanupCanonicalPriceArtifacts(canonical, executor);

  const [updated] = await executor
    .update(canonicalListings)
    .set({
      primarySourceListingId: canonical.primarySourceListingId ?? primarySourceListingId,
      canonicalUrl: observation.sourceUrlCanonical ?? canonical.canonicalUrl,
      displayUrl: observation.sourceUrlCanonical ?? canonical.displayUrl ?? observation.sourceUrlRaw,
      status: 'withdrawn',
      statusSource: 'mirror',
      verificationState: observationVerificationState(observation),
      originSummary: mergeOriginSummary(canonical.originSummary, observation.origin),
      lastMirrorSeenAt: observation.observedAt,
      lastReconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(canonicalListings.id, canonical.id))
    .returning();

  if (!updated) throw new Error(`Canonical listing ${canonical.id} could not be retired`);
  return updated;
}

async function linkObservationToCanonical(
  observationId: string,
  canonicalListingId: string,
  linkReason: 'source_identity' | 'source_alias' | 'canonical_url' | 'user_provisional' | 'manual_repair',
  executor: ReconciliationDb,
): Promise<void> {
  await executor
    .insert(listingObservationLinks)
    .values({ canonicalListingId, listingObservationId: observationId, linkReason })
    .onConflictDoNothing();
}

export async function projectPriceObservation(
  observation: ListingObservation,
  canonical: CanonicalListing,
  executor?: ReconciliationDb,
): Promise<void> {
  if (!observation.askingPrice || !observation.propertyId || !observation.sourceStatus || observation.staleForProjection) return;
  const database = targetDb(executor);
  const eventType = priceEventTypeForObservation(observation);
  const priceDate = priceDateFromObservation(observation);
  const currency = observation.priceCurrency ?? canonical.priceCurrency ?? 'EUR';

  await database
    .insert(listingPriceObservations)
    .values({
      listingObservationId: observation.id,
      canonicalListingId: canonical.id,
      propertyId: observation.propertyId,
      sourceName: observation.sourceName,
      sourceListingId: observation.sourceListingId,
      origin: observation.origin,
      price: observation.askingPrice,
      currency,
      eventType,
      priceDate,
      observedAt: observation.observedAt,
    })
    .onConflictDoNothing();

  await database
    .insert(priceHistory)
    .values({
      propertyId: observation.propertyId,
      listingId: null,
      price: observation.askingPrice,
      priceDate,
      eventType: legacyPriceHistoryEventType(observation, eventType),
      source: observation.sourceName,
    })
    .onConflictDoNothing();
}

async function completeCandidateHandoffForObservation(
  observation: ListingObservation,
  canonical: CanonicalListing,
  executor: ReconciliationDb,
): Promise<string | null> {
  const predicates = [];
  if (observation.candidateHandoffId) {
    predicates.push(eq(listingCandidateHandoffs.id, observation.candidateHandoffId));
  }
  if (observation.previewResultId) {
    predicates.push(eq(listingCandidateHandoffs.previewResultId, observation.previewResultId));
  }
  if (observation.propertyId && observation.sourceUrlCanonical) {
    predicates.push(and(
      eq(listingCandidateHandoffs.sourceName, observation.sourceName),
      eq(listingCandidateHandoffs.propertyId, observation.propertyId),
      eq(listingCandidateHandoffs.sourceUrlCanonical, observation.sourceUrlCanonical),
      sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error')`,
    ));
  }

  if (predicates.length === 0) return null;

  const [handoff] = await executor
    .update(listingCandidateHandoffs)
    .set({
      canonicalListingId: canonical.id,
      observationId: observation.id,
      propertyId: canonical.propertyId,
      sourceUrlCanonical: observation.sourceUrlCanonical ?? canonical.canonicalUrl ?? undefined,
      sourceListingId: observation.sourceListingId ?? canonical.primarySourceListingId ?? undefined,
      state: 'delivered',
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(predicates.length === 1 ? predicates[0] : or(...predicates))
    .returning({ id: listingCandidateHandoffs.id });

  if (!handoff) return null;

  await executor
    .update(listingObservations)
    .set({ candidateHandoffId: handoff.id })
    .where(eq(listingObservations.id, observation.id));

  return handoff.id;
}

async function markCandidateHandoffForDiagnosticObservation(
  observation: ListingObservation,
  canonical: CanonicalListing,
  executor: ReconciliationDb,
): Promise<string | null> {
  if (!observation.diagnosticStatus) return null;

  const predicates = [];
  if (observation.candidateHandoffId) {
    predicates.push(eq(listingCandidateHandoffs.id, observation.candidateHandoffId));
  }
  if (observation.previewResultId) {
    predicates.push(eq(listingCandidateHandoffs.previewResultId, observation.previewResultId));
  }
  if (observation.propertyId && observation.sourceUrlCanonical) {
    predicates.push(and(
      eq(listingCandidateHandoffs.sourceName, observation.sourceName),
      eq(listingCandidateHandoffs.propertyId, observation.propertyId),
      eq(listingCandidateHandoffs.sourceUrlCanonical, observation.sourceUrlCanonical),
      sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error')`,
    ));
  }

  if (predicates.length === 0) return null;

  const state = diagnosticHandoffState(observation.diagnosticStatus);
  const [handoff] = await executor
    .update(listingCandidateHandoffs)
    .set({
      canonicalListingId: canonical.id,
      observationId: observation.id,
      propertyId: canonical.propertyId,
      sourceUrlCanonical: observation.sourceUrlCanonical ?? canonical.canonicalUrl ?? undefined,
      sourceListingId: observation.sourceListingId ?? canonical.primarySourceListingId ?? undefined,
      state,
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      lastError: `Source service diagnostic: ${observation.diagnosticStatus}`,
      updatedAt: new Date(),
    })
    .where(predicates.length === 1 ? predicates[0] : or(...predicates))
    .returning({ id: listingCandidateHandoffs.id });

  if (!handoff) return null;

  await executor
    .update(listingObservations)
    .set({ candidateHandoffId: handoff.id })
    .where(eq(listingObservations.id, observation.id));

  return handoff.id;
}

export async function reconcileListingObservation(
  observationId: string,
  executor?: ReconciliationDb,
): Promise<CanonicalListing | null> {
  const database = targetDb(executor);
  const [observation] = await database
    .select()
    .from(listingObservations)
    .where(eq(listingObservations.id, observationId))
    .limit(1);

  if (!observation) throw new Error(`Listing observation ${observationId} not found`);

  if (observation.sourceListingId) {
    await upsertListingSourceAliases(
      observation.sourceName,
      observation.sourceListingId,
      normalizeSourceAliases(observation.sourceListingAliases),
      database,
    );
  }

  const primarySourceListingId = await resolvePrimarySourceListingId(observation, database);
  const existingCanonical = await findCanonicalListing(observation, primarySourceListingId, database);

  if (!canProjectObservation(observation)) {
    if (existingCanonical) {
      if (
        observation.diagnosticStatus
        && shouldRetireProvisionalForDiagnostic(observation)
        && existingCanonical.verificationState === 'provisional'
      ) {
        const retiredCanonical = await retireProvisionalCanonicalFromDiagnostic(
          existingCanonical,
          observation,
          primarySourceListingId,
          database,
        );
        await linkObservationToCanonical(observation.id, retiredCanonical.id, 'manual_repair', database);
        return retiredCanonical;
      }
      await linkObservationToCanonical(observation.id, existingCanonical.id, 'manual_repair', database);
    }
    return existingCanonical;
  }

  const linkReason = primarySourceListingId
    ? primarySourceListingId === observation.sourceListingId ? 'source_identity' : 'source_alias'
    : observation.sourceUrlCanonical
      ? 'canonical_url'
      : 'user_provisional';

  const canonical = existingCanonical
    ? await updateCanonicalListingFromObservation(existingCanonical, observation, primarySourceListingId, database)
    : await createCanonicalListing(observation, primarySourceListingId, database);

  await linkObservationToCanonical(observation.id, canonical.id, linkReason, database);
  if (!(observation.origin === 'user' && existingCanonical && isMirrorBackedCanonical(existingCanonical))) {
    await projectPriceObservation(observation, canonical, database);
  }
  return canonical;
}

export async function storeListingPreviewResult(
  plan: ListingPreviewPlan,
  userId?: string | null,
  executor?: ReconciliationDb,
): Promise<StoredPreviewResult> {
  const previewToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const baseIdempotencyKey = stablePreviewIdempotencyKey(plan);
  const sourceStatus = plan.sourceStatus === 'available'
    || plan.sourceStatus === 'sold'
    || plan.sourceStatus === 'rented'
    || plan.sourceStatus === 'withdrawn'
    || plan.sourceStatus === 'not_found'
    ? plan.sourceStatus
    : null;
  const diagnosticStatus = sourceStatus ? null : plan.sourceStatus === 'unknown' ? 'unknown' : plan.sourceStatus;
  const previewValues = {
    sourceName: plan.sourceName,
    propertyId: plan.submittedPropertyId,
    userId: userId ?? null,
    sourceUrlRaw: plan.rawUrl,
    sourceUrlCanonical: plan.canonicalUrl,
    sourceListingId: plan.sourceListingId,
    sourceListingIdKind: normalizeSourceListingIdKind(plan.sourceListingIdKind),
    sourceListingAliases: plan.aliases,
    validationState: plan.validationState,
    matchState: plan.matchState,
    reasonCode: plan.reasonCode,
    propertyMatchKind: plan.propertyMatchKind,
    lifecycleStatus: sourceStatus,
    diagnosticStatus: diagnosticStatus as ListingDiagnosticStatus | null,
    askingPrice: plan.askingPrice,
    priceCurrency: plan.currency ?? 'EUR',
    listingType: plan.priceType,
    title: plan.title,
    description: plan.description,
    imageUrl: plan.imageUrl,
    addressNormalized: plan.address ?? null,
    tokenHash: tokenHash(previewToken),
    idempotencyKey: baseIdempotencyKey,
    expiresAt,
    payload: {
      matchedPropertyId: plan.matchedPropertyId,
      previewedAt: new Date().toISOString(),
    },
  } satisfies NewListingPreviewResult;

  const database = targetDb(executor);
  const [preview] = await database
    .insert(listingPreviewResults)
    .values(previewValues)
    .onConflictDoUpdate({
      target: listingPreviewResults.idempotencyKey,
      set: {
        tokenHash: tokenHash(previewToken),
        expiresAt,
        payload: {
          matchedPropertyId: plan.matchedPropertyId,
          previewedAt: new Date().toISOString(),
        },
      },
      where: sql`
        ${listingPreviewResults.consumedAt} IS NULL
        AND ${previewOwnerConflictPredicate(userId)}
      `,
    })
    .returning();

  if (preview) {
    return { preview, previewToken };
  }

  const [freshPreview] = await database
    .insert(listingPreviewResults)
    .values({
      ...previewValues,
      idempotencyKey: `${baseIdempotencyKey}:${crypto.randomUUID()}`,
    })
    .returning();

  const storedPreview = freshPreview;
  if (!storedPreview) throw new Error('Preview result insert did not return a row');
  return { preview: storedPreview, previewToken };
}

export async function consumeListingPreviewResult(
  previewToken: string,
  userId: string,
  executor?: ReconciliationDb,
): Promise<ListingPreviewResult> {
  const [preview] = await targetDb(executor)
    .update(listingPreviewResults)
    .set({ consumedAt: new Date(), userId })
    .where(sql`
      ${listingPreviewResults.tokenHash} = ${tokenHash(previewToken)}
      AND ${listingPreviewResults.consumedAt} IS NULL
      AND ${listingPreviewResults.expiresAt} > now()
      AND (${listingPreviewResults.userId} IS NULL OR ${listingPreviewResults.userId} = ${userId})
      AND (
        (
          ${listingPreviewResults.validationState} = 'valid'
          AND ${listingPreviewResults.matchState} = 'matched'
          AND ${listingPreviewResults.lifecycleStatus} IS NOT NULL
        )
        OR (
          ${listingPreviewResults.validationState} = 'provisional'
          AND ${listingPreviewResults.matchState} = 'unverified'
          AND ${listingPreviewResults.reasonCode} IN ('mirror_unavailable', 'parser_error', 'validation_pending')
        )
      )
    `)
    .returning();
  if (!preview) throw new Error('Invalid, expired, or already consumed preview token');
  return preview;
}

export async function createUserListingSubmission(
  executor: ReconciliationDb,
  input: UserListingSubmissionInput,
): Promise<UserListingSubmissionResult> {
  const observation = await insertListingObservation(
    {
      sourceName: input.preview.sourceName,
      sourceListingId: input.preview.sourceListingId,
      sourceListingIdKind: input.preview.sourceListingIdKind,
      sourceListingAliases: input.preview.sourceListingAliases,
      sourceUrlRaw: input.preview.sourceUrlRaw,
      sourceUrlCanonical: input.preview.sourceUrlCanonical,
      submittedBy: input.userId,
      origin: 'user',
      propertyId: input.preview.propertyId,
      propertyMatchKind: input.preview.propertyMatchKind,
      sourceStatus: input.preview.lifecycleStatus ?? 'available',
      diagnosticStatus: null,
      askingPrice: input.preview.askingPrice,
      priceCurrency: input.preview.priceCurrency ?? 'EUR',
      addressRaw: input.preview.addressNormalized ? JSON.stringify(input.preview.addressNormalized) : null,
      addressNormalized: input.preview.addressNormalized,
      postalCode: typeof input.preview.addressNormalized?.postalCode === 'string'
        ? input.preview.addressNormalized.postalCode
        : null,
      houseNumber: houseNumberFromAddress(input.preview.addressNormalized),
      houseNumberAddition: typeof input.preview.addressNormalized?.houseNumberAddition === 'string'
        ? input.preview.addressNormalized.houseNumberAddition
        : null,
      previewResultId: input.preview.id,
      payload: {
        preview: {
          sourceProvenance: 'user_submitted',
          title: input.preview.title,
          description: input.preview.description,
          imageUrl: input.preview.imageUrl,
          priceType: input.preview.listingType,
        },
      },
    },
    executor,
  );

  const canonicalListing = await reconcileListingObservation(observation.id, executor);
  if (!canonicalListing) throw new Error('Preview submission did not project a canonical listing');

  const [existingHandoff] = await executor
    .select()
    .from(listingCandidateHandoffs)
    .where(
      and(
        eq(listingCandidateHandoffs.sourceName, input.preview.sourceName),
        eq(listingCandidateHandoffs.propertyId, input.preview.propertyId),
        eq(listingCandidateHandoffs.sourceUrlCanonical, input.preview.sourceUrlCanonical),
        sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error', 'delivered')`,
      ),
    )
    .orderBy(
      sql`CASE ${listingCandidateHandoffs.state}
        WHEN 'pending' THEN 0
        WHEN 'queued' THEN 1
        WHEN 'retryable_error' THEN 2
        WHEN 'delivered' THEN 3
        ELSE 4
      END`,
      desc(listingCandidateHandoffs.updatedAt),
      desc(listingCandidateHandoffs.createdAt),
    )
    .limit(1);

  if (existingHandoff) {
    await executor
      .update(listingObservations)
      .set({ candidateHandoffId: existingHandoff.id })
      .where(eq(listingObservations.id, observation.id));

    return {
      canonicalListing,
      observationId: observation.id,
      candidateId: existingHandoff.id,
      candidateHandoffState: existingHandoff.state,
      reasonCode: input.preview.reasonCode,
    };
  }

  const [candidate] = await executor
    .insert(listingCandidateHandoffs)
    .values({
      previewResultId: input.preview.id,
      canonicalListingId: canonicalListing.id,
      observationId: observation.id,
      sourceName: input.preview.sourceName,
      propertyId: input.preview.propertyId,
      submittedBy: input.userId,
      sourceUrlRaw: input.preview.sourceUrlRaw,
      sourceUrlCanonical: input.preview.sourceUrlCanonical,
      sourceListingId: input.preview.sourceListingId,
      previewFacts: {
        title: input.preview.title,
        description: input.preview.description,
        imageUrl: input.preview.imageUrl,
        askingPrice: input.preview.askingPrice,
        currency: input.preview.priceCurrency,
        listingType: input.preview.listingType,
      },
      matchEvidence: {
        propertyId: input.preview.propertyId,
        propertyMatchKind: input.preview.propertyMatchKind,
        sourceListingAliases: input.preview.sourceListingAliases,
      },
      state: 'queued',
    })
    .returning();

  if (!candidate) throw new Error('Candidate handoff insert did not return a row');

  return {
    canonicalListing,
    observationId: observation.id,
    candidateId: candidate.id,
    candidateHandoffState: candidate.state,
    reasonCode: input.preview.reasonCode,
  };
}

export async function persistMirrorObservationForIngest(
  executor: ReconciliationDb,
  input: PersistMirrorObservationForIngestInput,
): Promise<ListingWriteResult> {
  if (input.sourceListingId) {
    await upsertListingSourceAliases(input.sourceName, input.sourceListingId, normalizeSourceAliases(input.aliases), executor);
  }

  const sourceUpdatedAt = toOptionalDate(input.sourceUpdatedAt);
  const lastSeenAt = toOptionalDate(input.lastSeenAt);
  const firstSeenAt = toOptionalDate(input.firstSeenAt);
  const observedAt = toOptionalDate(input.observedAt) ?? sourceUpdatedAt ?? lastSeenAt ?? firstSeenAt ?? new Date();

  const { observation, reusedExisting, madeFreshForProjection } = await insertListingObservationInternal(
    {
      sourceName: input.sourceName,
      sourceListingId: input.sourceListingId,
      sourceListingIdKind: normalizeSourceListingIdKind(input.sourceListingIdKind),
      sourceListingAliases: input.aliases ?? [],
      sourceUrlRaw: input.sourceUrl,
      sourceUrlCanonical: input.sourceUrl,
      origin: input.staleForProjection ? 'replay' : 'mirror',
      propertyId: input.propertyId,
      propertyMatchKind: input.propertyMatchKind,
      sourceStatus: input.sourceStatus ?? null,
      diagnosticStatus: input.diagnosticStatus ?? null,
      askingPrice: input.askingPrice ?? null,
      priceCurrency: input.priceCurrency ?? 'EUR',
      addressRaw: input.address
        ? [
            input.address.street,
            input.address.houseNumber,
            input.address.houseNumberAddition,
            input.address.postalCode,
            input.address.city,
          ].filter((part) => part !== null && part !== undefined && part !== '').join(' ')
        : null,
      addressNormalized: input.address ?? null,
      postalCode: input.address?.postalCode ?? null,
      houseNumber: typeof input.address?.houseNumber === 'number'
        ? input.address.houseNumber
        : Number.parseInt(String(input.address?.houseNumber ?? ''), 10) || null,
      houseNumberAddition: input.address?.houseNumberAddition ?? null,
      firstSeenAt,
      lastSeenAt,
      sourceUpdatedAt,
      observedAt,
      ingestBatchId: input.batchId,
      scopeCompletionId: input.scopeCompletionId ?? null,
      sourceRunId: input.sourceRunId ?? null,
      sourceHighWatermark: toOptionalDate(input.sourceHighWatermark),
      staleForProjection: input.staleForProjection ?? false,
      previewResultId: input.previewResultId ?? null,
      candidateHandoffId: input.candidateHandoffId ?? null,
      payload: {
        ...input.payload,
        sourceProvenance: input.sourceProvenance ?? null,
        title: input.title ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    },
    executor,
  );

  const canonicalListing = reusedExisting && observation.staleForProjection
    ? await findCanonicalListing(
        observation,
        await resolvePrimarySourceListingId(observation, executor),
        executor,
      )
    : await reconcileListingObservation(observation.id, executor);
  if (canonicalListing) {
    if (observation.staleForProjection) {
      // Stale compatible replays refresh lineage but do not project candidate state.
    } else if (observation.diagnosticStatus) {
      await markCandidateHandoffForDiagnosticObservation(observation, canonicalListing, executor);
    } else {
      await completeCandidateHandoffForObservation(observation, canonicalListing, executor);
    }
  }
  const diagnosticRetiredProvisional = Boolean(
    canonicalListing
    && observation.diagnosticStatus
    && shouldRetireProvisionalForDiagnostic(observation)
    && canonicalListing.status === 'withdrawn'
    && canonicalListing.statusSource === 'mirror'
    && canonicalListing.originSummary === 'user_and_mirror'
  );
  const projectedCanonicalFacts = Boolean(canonicalListing && !observation.diagnosticStatus);
  return {
    canonicalListing,
    observationId: observation.id,
    propertyId: canonicalListing?.propertyId ?? input.propertyId,
    inserted: !reusedExisting && projectedCanonicalFacts && !input.staleForProjection,
    changed: (!reusedExisting || madeFreshForProjection)
      && (projectedCanonicalFacts || diagnosticRetiredProvisional)
      && !input.staleForProjection,
  };
}

export async function listCanonicalListingsForProperty(
  propertyId: string,
  executor?: ReconciliationDb,
): Promise<CanonicalListingReadModel[]> {
  const rows = await targetDb(executor)
    .select({
      id: canonicalListings.id,
      propertyId: canonicalListings.propertyId,
      sourceName: canonicalListings.sourceName,
      primarySourceListingId: canonicalListings.primarySourceListingId,
      canonicalUrl: canonicalListings.canonicalUrl,
      displayUrl: canonicalListings.displayUrl,
      askingPrice: canonicalListings.askingPrice,
      priceCurrency: canonicalListings.priceCurrency,
      thumbnailUrl: canonicalListings.thumbnailUrl,
      title: canonicalListings.title,
      description: canonicalListings.description,
      status: canonicalListings.status,
      verificationState: canonicalListings.verificationState,
      createdAt: canonicalListings.createdAt,
      candidateHandoffState: listingCandidateHandoffs.state,
      reasonCode: listingPreviewResults.reasonCode,
    })
    .from(canonicalListings)
    .leftJoin(
      listingCandidateHandoffs,
      eq(
        listingCandidateHandoffs.id,
        sql`(
          SELECT handoff.id
          FROM listing_candidate_handoffs handoff
          WHERE handoff.canonical_listing_id = ${canonicalListings.id}
          ORDER BY
            CASE handoff.state
              WHEN 'pending' THEN 0
              WHEN 'queued' THEN 1
              WHEN 'retryable_error' THEN 2
              WHEN 'delivered' THEN 3
              ELSE 4
            END,
            handoff.updated_at DESC,
            handoff.created_at DESC,
            handoff.id DESC
          LIMIT 1
        )`,
      ),
    )
    .leftJoin(listingPreviewResults, eq(listingPreviewResults.id, listingCandidateHandoffs.previewResultId))
    .where(
      and(
        eq(canonicalListings.propertyId, propertyId),
        sql`${canonicalListings.verificationState} <> 'invalid'`,
      ),
    )
    .orderBy(desc(canonicalListings.createdAt));

  return rows.map((row) => ({
    ...row,
    displayUrl: row.displayUrl ?? row.canonicalUrl ?? '',
    createdAt: row.createdAt.toISOString(),
  }));
}

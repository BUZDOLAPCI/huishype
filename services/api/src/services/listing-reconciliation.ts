import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  canonicalListings,
  db,
  listingObservationLinks,
  listingObservations,
  listingPriceObservations,
  listingSourceAliases,
  mirrorListingWatches,
  priceHistory,
  type CanonicalListing,
  type DbTransaction,
  type ListingObservation,
  type NewListingObservation,
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

type WatchState = 'not_required' | 'will_enqueue' | 'unsupported';
type SourceListingIdKind = NonNullable<NewListingObservation['sourceListingIdKind']>;

export type ListingSourceStatus = ListingObservation['sourceStatus'];

export type ListingWriteResult = {
  canonicalListing: CanonicalListing;
  observationId: string;
  propertyId: string;
  inserted: boolean;
  changed: boolean;
};

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
  watchState: string | null;
  reasonCode: string | null;
  createdAt: string;
};

export type UserListingSubmissionInput = {
  userId: string;
  plan: ListingPreviewPlan;
};

export type UserListingSubmissionResult = {
  canonicalListing: CanonicalListing;
  observationId: string;
  watchId: string | null;
  watchState: WatchState;
  reasonCode: string;
};

export type ListingValidationOutcomeInput = {
  watchId: string;
  state: 'matched' | 'not_found' | 'blocked' | 'invalid' | 'parser_error' | 'unsupported' | 'retryable_error';
  sourceName: string;
  rawUrl: string;
  canonicalUrl: string;
  sourceListingId?: string | null;
  sourceListingIdKind?: string | null;
  aliases?: Array<{ kind: string; value: string }>;
  sourceStatus?: ListingSourceStatus;
  address?: Record<string, unknown> | null;
  matchedPropertyEvidence?: {
    propertyId?: string | null;
    matchKind?: ListingObservation['propertyMatchKind'];
  } | null;
  price?: number | null;
  currency?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  description?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  sourceUpdatedAt?: string | null;
  payload?: Record<string, unknown>;
};

export type PersistMirrorObservationForIngestInput = {
  batchId: string;
  sourceName: string;
  sourceUrl: string;
  sourceListingId: string;
  sourceListingIdKind: string;
  aliases?: Array<{ kind: string; value: string }>;
  propertyId: string;
  propertyMatchKind: ListingObservation['propertyMatchKind'];
  sourceStatus: ListingSourceStatus;
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
  payload?: Record<string, unknown>;
};

function targetDb(executor?: ReconciliationDb): ReconciliationDb {
  return executor ?? db;
}

function supportsTransaction(executor: ReconciliationDb): executor is typeof db {
  return 'transaction' in executor;
}

function toTimestamp(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toOptionalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeSourceListingIdKind(kind: string | null | undefined): SourceListingIdKind {
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
  return 'unknown';
}

function isListingSourceAlias(alias: { kind: string; value: string }): alias is ListingSourceAlias {
  return ['tiny_id', 'global_id', 'detail_id', 'canonical_url', 'relative_path', 'url_path'].includes(alias.kind);
}

function normalizeSourceAliases(aliases: readonly { kind: string; value: string }[] | undefined): ListingSourceAlias[] {
  return (aliases ?? []).filter(isListingSourceAlias);
}

function observationStatusToCanonicalStatus(status: ListingObservation['sourceStatus']): CanonicalStatus {
  if (status === 'available') return 'active';
  return status;
}

function validationStateToSourceStatus(state: ListingValidationOutcomeInput['state']): ListingObservation['sourceStatus'] {
  if (state === 'matched') return 'available';
  if (state === 'unsupported' || state === 'retryable_error') return 'unknown';
  return state;
}

function observationStatusSource(origin: ListingObservation['origin']): StatusSource {
  return origin === 'user' ? 'user' : 'mirror';
}

function observationVerificationState(observation: ListingObservation): VerificationState {
  if (observation.propertyMatchKind === 'source_mismatch' || observation.sourceStatus === 'invalid') {
    return 'invalid';
  }
  if (observation.sourceStatus === 'blocked') return 'validation_blocked';
  if (observation.sourceStatus === 'parser_error') return 'validation_failed';
  if (observation.origin === 'user') {
    if (observation.validationWatchId) {
      return 'validation_pending';
    }
    if (
      observation.sourceStatus !== 'unknown'
      && (observation.propertyMatchKind === 'source_exact' || observation.propertyMatchKind === 'source_spatial')
    ) {
      return 'validated';
    }
    return 'provisional';
  }
  return observation.sourceStatus === 'unknown' ? 'validation_pending' : 'validated';
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

function legacyPriceHistoryEventType(
  observation: ListingObservation,
  eventType: 'initial' | 'mirror_refresh' | 'user_submission' | 'status_change',
): string {
  if (eventType === 'status_change') {
    return observation.sourceStatus === 'rented' ? 'rented' : 'sold';
  }
  return 'asking_price';
}

function publicWatchState(plan: ListingPreviewPlan): WatchState {
  if (plan.watchState === 'unsupported') return 'unsupported';
  if (plan.watchState === 'will_enqueue') return 'will_enqueue';
  return 'not_required';
}

function houseNumberFromAddress(address: ListingSourceAddress | null | undefined): number | null {
  if (typeof address?.houseNumber === 'number') {
    return address.houseNumber;
  }

  const parsed = Number.parseInt(String(address?.houseNumber ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

export async function insertListingObservation(
  observation: NewListingObservation,
  executor?: ReconciliationDb,
): Promise<ListingObservation> {
  const [inserted] = await targetDb(executor)
    .insert(listingObservations)
    .values(observation)
    .returning();

  if (!inserted) {
    throw new Error('Listing observation insert did not return a row');
  }

  return inserted;
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
  const predicates = [];
  if (primarySourceListingId) {
    predicates.push(
      and(
        eq(canonicalListings.sourceName, observation.sourceName),
        eq(canonicalListings.primarySourceListingId, primarySourceListingId),
      ),
    );
  }
  if (observation.sourceUrlCanonical) {
    predicates.push(
      and(
        eq(canonicalListings.sourceName, observation.sourceName),
        eq(canonicalListings.canonicalUrl, observation.sourceUrlCanonical),
      ),
    );
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

async function createCanonicalListing(
  observation: ListingObservation,
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing> {
  if (!observation.propertyId) {
    throw new Error('Cannot create canonical listing without a property id');
  }

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
      firstSeenAt: observation.firstSeenAt ?? observation.observedAt,
      lastSeenAt: observation.lastSeenAt ?? observation.observedAt,
      lastMirrorSeenAt: observation.origin === 'user' ? null : observation.lastSeenAt ?? observation.observedAt,
      lastUserSeenAt: observation.origin === 'user' ? observation.observedAt : null,
      lastReconciledAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new Error('Canonical listing insert did not return a row');
  }
  return created;
}

async function updateCanonicalListingFromObservation(
  canonical: CanonicalListing,
  observation: ListingObservation,
  primarySourceListingId: string | null,
  executor: ReconciliationDb,
): Promise<CanonicalListing> {
  const mirrorBacked = observation.origin !== 'user';
  const [updated] = await executor
    .update(canonicalListings)
    .set({
      primarySourceListingId: canonical.primarySourceListingId ?? primarySourceListingId,
      canonicalUrl: canonical.canonicalUrl ?? observation.sourceUrlCanonical,
      displayUrl: observation.sourceUrlCanonical ?? canonical.displayUrl ?? observation.sourceUrlRaw,
      status: mirrorBacked || canonical.statusSource !== 'mirror'
        ? observationStatusToCanonicalStatus(observation.sourceStatus)
        : canonical.status,
      statusSource: mirrorBacked ? 'mirror' : canonical.statusSource,
      verificationState: observationVerificationState(observation),
      originSummary: mergeOriginSummary(canonical.originSummary, observation.origin),
      submittedBy: canonical.submittedBy ?? observation.submittedBy,
      thumbnailUrl: observationDisplayString(observation, 'imageUrl') ?? canonical.thumbnailUrl,
      title: observationDisplayString(observation, 'title') ?? canonical.title,
      description: observationDisplayString(observation, 'description') ?? canonical.description,
      askingPrice: mirrorBacked || canonical.askingPrice === null ? observation.askingPrice : canonical.askingPrice,
      priceCurrency: observation.priceCurrency ?? canonical.priceCurrency,
      firstSeenAt: canonical.firstSeenAt ?? observation.firstSeenAt ?? observation.observedAt,
      lastSeenAt: observation.lastSeenAt ?? observation.observedAt,
      lastMirrorSeenAt: mirrorBacked ? observation.lastSeenAt ?? observation.observedAt : canonical.lastMirrorSeenAt,
      lastUserSeenAt: observation.origin === 'user' ? observation.observedAt : canonical.lastUserSeenAt,
      lastReconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(canonicalListings.id, canonical.id))
    .returning();

  if (!updated) {
    throw new Error(`Canonical listing ${canonical.id} could not be updated`);
  }
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
    .values({
      canonicalListingId,
      listingObservationId: observationId,
      linkReason,
    })
    .onConflictDoNothing();
}

export async function projectPriceObservation(
  observation: ListingObservation,
  canonical: CanonicalListing,
  executor?: ReconciliationDb,
): Promise<void> {
  if (!observation.askingPrice || !observation.propertyId) return;
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

export async function reconcileListingObservation(
  observationId: string,
  executor?: ReconciliationDb,
): Promise<CanonicalListing> {
  const database = targetDb(executor);
  const [observation] = await database
    .select()
    .from(listingObservations)
    .where(eq(listingObservations.id, observationId))
    .limit(1);

  if (!observation) {
    throw new Error(`Listing observation ${observationId} not found`);
  }

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
  const linkReason = primarySourceListingId
    ? primarySourceListingId === observation.sourceListingId ? 'source_identity' : 'source_alias'
    : observation.sourceUrlCanonical
      ? 'canonical_url'
      : 'user_provisional';

  const canonical = existingCanonical
    ? await updateCanonicalListingFromObservation(existingCanonical, observation, primarySourceListingId, database)
    : await createCanonicalListing(observation, primarySourceListingId, database);

  await linkObservationToCanonical(observation.id, canonical.id, linkReason, database);
  await projectPriceObservation(observation, canonical, database);
  return canonical;
}

export async function createOrUpdateMirrorWatch(
  input: {
    sourceName: string;
    propertyId: string;
    submittedBy?: string | null;
    sourceUrlRaw: string;
    sourceUrlCanonical: string;
    sourceListingId?: string | null;
    canonicalListingId?: string | null;
    state?: 'pending' | 'queued' | 'fetching' | 'matched' | 'not_found' | 'blocked' | 'invalid' | 'parser_error' | 'unsupported' | 'retryable_error';
    stateReason?: string | null;
    nextAttemptAt?: Date | null;
  },
  executor?: ReconciliationDb,
): Promise<{ id: string; state: string }> {
  const rows = await targetDb(executor).execute<{ id: string; state: string }>(sql`
    INSERT INTO mirror_listing_watches (
      source_name,
      property_id,
      submitted_by,
      source_url_raw,
      source_url_canonical,
      source_listing_id,
      canonical_listing_id,
      state,
      state_reason,
      next_attempt_at
    )
    VALUES (
      ${input.sourceName},
      ${input.propertyId},
      ${input.submittedBy ?? null},
      ${input.sourceUrlRaw},
      ${input.sourceUrlCanonical},
      ${input.sourceListingId ?? null},
      ${input.canonicalListingId ?? null},
      ${input.state ?? 'pending'}::mirror_listing_watch_state,
      ${input.stateReason ?? null},
      ${input.nextAttemptAt ?? null}
    )
    ON CONFLICT (source_name, property_id, source_url_canonical)
    WHERE state IN ('pending', 'queued', 'fetching', 'retryable_error')
    DO UPDATE SET
      source_url_raw = EXCLUDED.source_url_raw,
      source_listing_id = COALESCE(EXCLUDED.source_listing_id, mirror_listing_watches.source_listing_id),
      canonical_listing_id = COALESCE(EXCLUDED.canonical_listing_id, mirror_listing_watches.canonical_listing_id),
      state = EXCLUDED.state,
      state_reason = EXCLUDED.state_reason,
      next_attempt_at = EXCLUDED.next_attempt_at,
      updated_at = now()
    RETURNING id, state
  `);

  const row = Array.from(rows)[0];
  if (!row) {
    throw new Error('Mirror listing watch upsert did not return a row');
  }
  return row;
}

export async function createUserListingSubmission(
  executor: ReconciliationDb,
  input: UserListingSubmissionInput,
): Promise<UserListingSubmissionResult> {
  const watchState = publicWatchState(input.plan);
  const observation = await insertListingObservation(
    {
      sourceName: input.plan.sourceName,
      sourceListingId: input.plan.sourceListingId,
      sourceListingIdKind: input.plan.sourceListingIdKind,
      sourceListingAliases: input.plan.aliases,
      sourceUrlRaw: input.plan.rawUrl,
      sourceUrlCanonical: input.plan.canonicalUrl,
      submittedBy: input.userId,
      origin: 'user',
      propertyId: input.plan.submittedPropertyId,
      propertyMatchKind: input.plan.propertyMatchKind,
      sourceStatus: input.plan.sourceStatus,
      askingPrice: input.plan.askingPrice,
      priceCurrency: input.plan.currency ?? 'EUR',
      addressRaw: input.plan.address
        ? [
            input.plan.address.street,
            input.plan.address.houseNumber,
            input.plan.address.houseNumberAddition,
            input.plan.address.postalCode,
            input.plan.address.city,
          ].filter((part) => part !== null && part !== undefined && part !== '').join(' ')
        : null,
      addressNormalized: input.plan.address ?? null,
      postalCode: input.plan.address?.postalCode ?? null,
      houseNumber: houseNumberFromAddress(input.plan.address),
      houseNumberAddition: input.plan.address?.houseNumberAddition ?? null,
      payload: {
        preview: {
          title: input.plan.title,
          description: input.plan.description,
          imageUrl: input.plan.imageUrl,
          priceType: input.plan.priceType,
        },
      },
    },
    executor,
  );

  const canonicalListing = await reconcileListingObservation(observation.id, executor);
  let watchId: string | null = null;
  if (watchState === 'will_enqueue') {
    const watch = await createOrUpdateMirrorWatch(
      {
        sourceName: input.plan.sourceName,
        propertyId: input.plan.submittedPropertyId,
        submittedBy: input.userId,
        sourceUrlRaw: input.plan.rawUrl,
        sourceUrlCanonical: input.plan.canonicalUrl,
        sourceListingId: input.plan.sourceListingId,
        canonicalListingId: canonicalListing.id,
        state: 'queued',
        stateReason: input.plan.reasonCode,
      },
      executor,
    );
    watchId = watch.id;
  }

  return {
    canonicalListing,
    observationId: observation.id,
    watchId,
    watchState,
    reasonCode: input.plan.reasonCode,
  };
}

export async function persistMirrorObservationForIngest(
  executor: ReconciliationDb,
  input: PersistMirrorObservationForIngestInput,
): Promise<ListingWriteResult> {
  if (input.sourceListingId) {
    await upsertListingSourceAliases(input.sourceName, input.sourceListingId, normalizeSourceAliases(input.aliases), executor);
  }

  const observation = await insertListingObservation(
    {
      sourceName: input.sourceName,
      sourceListingId: input.sourceListingId,
      sourceListingIdKind: normalizeSourceListingIdKind(input.sourceListingIdKind),
      sourceListingAliases: input.aliases ?? [],
      sourceUrlRaw: input.sourceUrl,
      sourceUrlCanonical: input.sourceUrl,
      origin: 'mirror',
      propertyId: input.propertyId,
      propertyMatchKind: input.propertyMatchKind,
      sourceStatus: input.sourceStatus,
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
      firstSeenAt: toOptionalDate(input.firstSeenAt),
      lastSeenAt: toOptionalDate(input.lastSeenAt),
      sourceUpdatedAt: toOptionalDate(input.sourceUpdatedAt),
      observedAt: toOptionalDate(input.lastSeenAt) ?? new Date(),
      ingestBatchId: input.batchId,
      payload: {
        ...input.payload,
        title: input.title ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    },
    executor,
  );

  const canonicalListing = await reconcileListingObservation(observation.id, executor);
  return {
    canonicalListing,
    observationId: observation.id,
    propertyId: canonicalListing.propertyId,
    inserted: true,
    changed: true,
  };
}

export async function applyListingValidationOutcome(
  executorOrOutcome: ReconciliationDb | ListingValidationOutcomeInput,
  maybeOutcome?: ListingValidationOutcomeInput,
): Promise<{ canonicalListing: CanonicalListing; observationId: string; watchId: string; state: string }> {
  const database = maybeOutcome ? (executorOrOutcome as ReconciliationDb) : db;
  const outcome = maybeOutcome ?? (executorOrOutcome as ListingValidationOutcomeInput);
  const apply = async (tx: ReconciliationDb) => {
    const [watch] = await tx
      .select()
      .from(mirrorListingWatches)
      .where(eq(mirrorListingWatches.id, outcome.watchId))
      .limit(1);

    if (!watch) {
      throw new Error(`Mirror listing watch ${outcome.watchId} not found`);
    }

    if (outcome.sourceListingId) {
      await upsertListingSourceAliases(outcome.sourceName, outcome.sourceListingId, normalizeSourceAliases(outcome.aliases), tx);
    }

    const observation = await insertListingObservation(
      {
        sourceName: outcome.sourceName,
        sourceListingId: outcome.sourceListingId ?? null,
        sourceListingIdKind: normalizeSourceListingIdKind(outcome.sourceListingIdKind),
        sourceListingAliases: outcome.aliases ?? [],
        sourceUrlRaw: outcome.rawUrl,
        sourceUrlCanonical: outcome.canonicalUrl,
        origin: 'validation',
        propertyId: outcome.matchedPropertyEvidence?.propertyId ?? watch.propertyId,
        propertyMatchKind: outcome.matchedPropertyEvidence?.matchKind ?? 'source_unmatched',
        sourceStatus: outcome.sourceStatus ?? validationStateToSourceStatus(outcome.state),
        askingPrice: outcome.price ?? null,
        priceCurrency: outcome.currency ?? 'EUR',
        addressRaw: outcome.address ? JSON.stringify(outcome.address) : null,
        addressNormalized: outcome.address ?? null,
        postalCode: typeof outcome.address?.postalCode === 'string' ? outcome.address.postalCode : null,
        houseNumber: typeof outcome.address?.houseNumber === 'number' ? outcome.address.houseNumber : null,
        houseNumberAddition: typeof outcome.address?.houseNumberAddition === 'string'
          ? outcome.address.houseNumberAddition
          : null,
        firstSeenAt: toTimestamp(outcome.firstSeenAt),
        lastSeenAt: toTimestamp(outcome.lastSeenAt),
        sourceUpdatedAt: toTimestamp(outcome.sourceUpdatedAt),
        validationWatchId: outcome.watchId,
        payload: {
          ...(outcome.payload ?? {}),
          title: outcome.title ?? null,
          description: outcome.description ?? null,
          imageUrl: outcome.thumbnailUrl ?? null,
        },
      },
      tx,
    );
    const canonicalListing = await reconcileListingObservation(observation.id, tx);

    await tx
      .update(mirrorListingWatches)
      .set({
        state: outcome.state,
        stateReason: outcome.state === 'retryable_error' ? watch.stateReason : null,
        sourceListingId: outcome.sourceListingId ?? watch.sourceListingId,
        canonicalListingId: canonicalListing.id,
        lastValidationObservationId: observation.id,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(mirrorListingWatches.id, outcome.watchId));

    return {
      canonicalListing,
      observationId: observation.id,
      watchId: outcome.watchId,
      state: outcome.state,
    };
  };

  return supportsTransaction(database) ? database.transaction(apply) : apply(database);
}

export async function listCanonicalListingsForProperty(propertyId: string, executor?: ReconciliationDb): Promise<CanonicalListingReadModel[]> {
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
      watchState: mirrorListingWatches.state,
      reasonCode: mirrorListingWatches.stateReason,
    })
    .from(canonicalListings)
    .leftJoin(mirrorListingWatches, eq(mirrorListingWatches.canonicalListingId, canonicalListings.id))
    .where(
      and(
        eq(canonicalListings.propertyId, propertyId),
        sql`${canonicalListings.verificationState} NOT IN ('invalid', 'validation_blocked', 'validation_failed')`,
      ),
    )
    .orderBy(desc(canonicalListings.createdAt));

  return rows.map((row) => ({
    ...row,
    displayUrl: row.displayUrl ?? row.canonicalUrl ?? '',
    createdAt: row.createdAt.toISOString(),
  }));
}

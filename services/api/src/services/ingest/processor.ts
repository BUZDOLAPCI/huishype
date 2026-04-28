import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  db,
  type DbTransaction,
  ingestBatches,
  ingestSources,
  listingObservations,
} from '../../db/index.js';
import type { CountryCode } from '@huishype/shared';
import {
  canonicalizeAddressWithDiagnostics,
  type CanonicalizeAddressFailureReason,
  normalizeSourceUrl,
} from '../../utils/address.js';
import type { IngestBatchRequest, IngestListing } from './contracts.js';
import { ingestBatchRequestSchema } from './contracts.js';
import { decodeOpaqueIngestCursor } from './cursor.js';
import { requestLatestListingsRefresh } from './queue.js';
import type { MaintenanceRefreshJobData } from './jobs.js';
import {
  finalizeIngestRunLifecycle,
  listForceSkippedBatchRecoveryCandidates,
  listSkippedBatchRecoveryCandidates,
  SKIPPED_BATCH_RECOVERY_COOLDOWN_MS,
  type SkippedBatchRecoveryCandidate,
} from './store.js';
import { advancePropertyChangeVersion } from '../property-read-state.js';
import {
  persistMirrorObservationForIngest,
  type ListingSourceStatus,
  type ListingWriteResult,
} from '../listing-reconciliation.js';

interface CanonicalizedListing {
  item: IngestListing;
  canonical: {
    countryCode: string;
    street: string;
    streetNorm: string;
    postalCode: string;
    houseNumber: number;
    houseNumberAddition: string | null;
    city: string;
  } | null;
  spatialCandidate: {
    countryCode: string;
    latitude: number;
    longitude: number;
  } | null;
}

interface MatchedListing {
  item: IngestListing;
  propertyId: string;
}

interface RecoveryIdentity {
  sourceListingId: string;
  sourceUrl: string;
  propertyId: string;
}

interface RecoveredMatchClassification {
  unresolved: MatchedListing[];
  resolvedCount: number;
}

interface ClaimedBatch {
  id: string;
  sourceName: string;
  runId: string | null;
  cursorEnd: string;
  payload: IngestBatchRequest;
  attemptCount: number;
}

export interface IngestProcessResult {
  status: 'completed' | 'noop';
  ingested: number;
  updated: number;
  skipped: number;
}

export interface ForcedSkippedBatchRecoveryResult {
  sourceName: string;
  candidateCount: number;
  recoveredObservationCount: number;
  recoveredBatchIds: string[];
}

export interface IngestLogger {
  debug?(payload: Record<string, unknown>, message: string): void;
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface ProcessIngestBatchOptions {
  batchId: string;
  maxAttempts?: number;
  logger?: IngestLogger;
  enqueueMaintenanceRefresh?: (data: MaintenanceRefreshJobData) => Promise<void>;
}

export interface RefreshMaintenanceOptions {
  logger?: IngestLogger;
  skippedBatchRecoveryLimit?: number;
}

function normalizeStreetForMatch(street: string): string {
  return street.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePostalCodeForMatch(postalCode: string): string {
  return postalCode.replace(/\s+/g, '').toUpperCase();
}

function buildAddressMatchKey(
  countryCode: string,
  streetNorm: string,
  postalCode: string,
  houseNumber: number,
  addition: string | null,
): string {
  return `${countryCode}|${streetNorm}|${postalCode}|${houseNumber}|${addition ?? ''}`;
}

function defaultLogger(): IngestLogger {
  return {
    info(payload, message) {
      console.info(message, payload);
    },
    warn(payload, message) {
      console.warn(message, payload);
    },
    error(payload, message) {
      console.error(message, payload);
    },
  };
}

type IngestSkipReason =
  | CanonicalizeAddressFailureReason
  | `${CanonicalizeAddressFailureReason}_without_spatial_candidate`
  | 'empty_street_without_spatial_candidate'
  | 'unmatched_property';

interface IngestSkipDiagnostic {
  reason: IngestSkipReason;
  mirrorListingId: string;
  sourceListingId: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  address: {
    countryCode: string;
    street: string;
    postalCode: string;
    houseNumber: string | number;
    houseNumberAddition: string | null;
    city: string | null;
    hasCoordinates: boolean;
  };
}

function isValidCoordinate(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return (
    typeof latitude === 'number'
    && typeof longitude === 'number'
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  );
}

function getSpatialCandidate(item: IngestListing): CanonicalizedListing['spatialCandidate'] {
  if (!isValidCoordinate(item.address.latitude, item.address.longitude)) {
    return null;
  }

  const countryCode = item.address.countryCode.trim().toUpperCase();
  if (countryCode.length !== 2) {
    return null;
  }

  return {
    countryCode,
    latitude: item.address.latitude as number,
    longitude: item.address.longitude as number,
  };
}

function hasBlankHouseNumber(item: IngestListing): boolean {
  return typeof item.address.houseNumber === 'string' && item.address.houseNumber.trim() === '';
}

function canUseSpatialOnlyForCanonicalizationFailure(
  item: IngestListing,
  failureReason: CanonicalizeAddressFailureReason | null,
  spatialCandidate: CanonicalizedListing['spatialCandidate'],
): boolean {
  return (
    failureReason === 'invalid_house_number'
    && hasBlankHouseNumber(item)
    && item.address.street.trim().length > 0
    && spatialCandidate !== null
  );
}

function toSkipDiagnostic(item: IngestListing, reason: IngestSkipReason): IngestSkipDiagnostic {
  return {
    reason,
    mirrorListingId: item.mirrorListingId,
    sourceListingId: item.sourceListingId ?? null,
    sourceUrl: item.sourceUrl,
    canonicalUrl: item.canonicalUrl ?? null,
    address: {
      countryCode: item.address.countryCode,
      street: item.address.street,
      postalCode: item.address.postalCode,
      houseNumber: item.address.houseNumber,
      houseNumberAddition: item.address.houseNumberAddition ?? null,
      city: item.address.city ?? null,
      hasCoordinates: isValidCoordinate(item.address.latitude, item.address.longitude),
    },
  };
}

function summarizeSkipDiagnostics(diagnostics: IngestSkipDiagnostic[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    summary[diagnostic.reason] = (summary[diagnostic.reason] ?? 0) + 1;
  }
  return summary;
}

function logSkipDiagnostics(
  logger: IngestLogger,
  context: { batchId: string; sourceName: string },
  diagnostics: IngestSkipDiagnostic[],
): void {
  if (diagnostics.length === 0) {
    return;
  }

  try {
    logger.debug?.(
      {
        ...context,
        skippedCount: diagnostics.length,
        skipReasons: summarizeSkipDiagnostics(diagnostics),
        skippedListings: diagnostics.slice(0, 100),
        omittedSkippedListingCount: Math.max(0, diagnostics.length - 100),
      },
      'Ingest batch skipped listing diagnostics',
    );
  } catch {
    // Ingest logging is diagnostic only; it must not affect batch commits.
  }
}

function getCanonicalizationSkipReason(
  failureReason: CanonicalizeAddressFailureReason | null,
): IngestSkipReason {
  if (failureReason === null) {
    return 'empty_street_without_spatial_candidate';
  }

  if (failureReason === 'invalid_house_number') {
    return 'invalid_house_number_without_spatial_candidate';
  }

  return failureReason;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown ingest processing error',
  };
}

async function claimBatchForProcessing(batchId: string): Promise<ClaimedBatch | null> {
  return db.transaction(async (tx) => {
    const candidateRows = await tx
      .select({
        id: ingestBatches.id,
        sourceName: ingestBatches.sourceName,
        cursorStart: ingestBatches.cursorStart,
      })
      .from(ingestBatches)
      .where(
        and(
          eq(ingestBatches.id, batchId),
          inArray(ingestBatches.status, ['accepted', 'queued', 'retryable']),
        ),
      )
      .limit(1);

    const candidate = candidateRows[0];
    if (!candidate) {
      return null;
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.sourceName}))`);

    const sourceRows = await tx
      .select({ lastCommittedCursor: ingestSources.lastCommittedCursor })
      .from(ingestSources)
      .where(eq(ingestSources.sourceName, candidate.sourceName))
      .limit(1);

    const lastCommittedCursor = sourceRows[0]?.lastCommittedCursor ?? null;
    const isNextBatch =
      (candidate.cursorStart == null && lastCommittedCursor == null) ||
      candidate.cursorStart === lastCommittedCursor;

    if (!isNextBatch) {
      return null;
    }

    const updatedRows = await tx
      .update(ingestBatches)
      .set({
        status: 'processing',
        attemptCount: sql<number>`${ingestBatches.attemptCount} + 1`,
        startedAt: new Date(),
        errorJson: null,
      })
      .where(
        and(
          eq(ingestBatches.id, batchId),
          inArray(ingestBatches.status, ['accepted', 'queued', 'retryable']),
        ),
      )
      .returning();

    const claimed = updatedRows[0];
    if (!claimed) {
      return null;
    }

    return {
      id: claimed.id,
      sourceName: claimed.sourceName,
      runId: claimed.runId,
      cursorEnd: claimed.cursorEnd,
      payload: ingestBatchRequestSchema.parse(claimed.payloadJson),
      attemptCount: claimed.attemptCount,
    };
  });
}

function canonicalizeListings(listings: IngestListing[]): {
  canonicalized: CanonicalizedListing[];
  skippedCount: number;
  skipDiagnostics: IngestSkipDiagnostic[];
} {
  const canonicalized: CanonicalizedListing[] = [];
  const skipDiagnostics: IngestSkipDiagnostic[] = [];
  let skippedCount = 0;

  for (const item of listings) {
    const canonicalResult = canonicalizeAddressWithDiagnostics({
      countryCode: item.address.countryCode as CountryCode,
      street: item.address.street,
      postalCode: item.address.postalCode,
      houseNumber: item.address.houseNumber,
      houseNumberAddition: item.address.houseNumberAddition ?? null,
      city: item.address.city,
    });
    const spatialCandidate = getSpatialCandidate(item);
    const canonical = canonicalResult.canonical;
    const canUseSpatialOnly = canUseSpatialOnlyForCanonicalizationFailure(
      item,
      canonicalResult.failureReason,
      spatialCandidate,
    );

    if (!canonical && !canUseSpatialOnly) {
      skippedCount += 1;
      skipDiagnostics.push(toSkipDiagnostic(item, getCanonicalizationSkipReason(canonicalResult.failureReason)));
      continue;
    }

    if (canonical && canonical.street.length === 0) {
      skippedCount += 1;
      skipDiagnostics.push(toSkipDiagnostic(item, 'empty_street_without_spatial_candidate'));
      continue;
    }

    canonicalized.push({
      item,
      canonical:
        canonical && canonical.street.length > 0
          ? {
              countryCode: item.address.countryCode,
              street: canonical.street,
              streetNorm: normalizeStreetForMatch(canonical.street),
              postalCode: normalizePostalCodeForMatch(canonical.postalCode),
              houseNumber: canonical.houseNumber,
              houseNumberAddition: canonical.houseNumberAddition,
              city: canonical.city,
            }
          : null,
      spatialCandidate,
    });
  }

  return { canonicalized, skippedCount, skipDiagnostics };
}

async function exactMatchProperties(
  tx: DbTransaction,
  canonicalized: CanonicalizedListing[],
): Promise<Map<string, string>> {
  const matchMap = new Map<string, string>();
  const uniqueAddresses = new Map<
    string,
    {
      countryCode: string;
      streetNorm: string;
      postalCode: string;
      houseNumber: number;
      addition: string | null;
    }
  >();

  for (const entry of canonicalized) {
    if (!entry.canonical) {
      continue;
    }

    const key = buildAddressMatchKey(
      entry.canonical.countryCode,
      entry.canonical.streetNorm,
      entry.canonical.postalCode,
      entry.canonical.houseNumber,
      entry.canonical.houseNumberAddition,
    );

    if (!uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, {
        countryCode: entry.canonical.countryCode,
        streetNorm: entry.canonical.streetNorm,
        postalCode: entry.canonical.postalCode,
        houseNumber: entry.canonical.houseNumber,
        addition: entry.canonical.houseNumberAddition,
      });
    }
  }

  const addressChunks = Array.from(uniqueAddresses.entries());
  const chunkSize = 10_000;
  if (addressChunks.length === 0) {
    return matchMap;
  }

  for (let offset = 0; offset < addressChunks.length; offset += chunkSize) {
    const chunk = addressChunks.slice(offset, offset + chunkSize);
    const valueFragments = chunk.map(([, address]) => sql`(
      ${address.countryCode}::text,
      ${address.streetNorm}::text,
      ${address.postalCode}::text,
      ${address.houseNumber}::int,
      ${address.addition ?? ''}::text
    )`);

    const rows = await tx.execute<{
      id: string;
      country_code: string;
      street_norm: string;
      postal_code: string;
      house_number: number;
      house_number_addition: string | null;
    }>(sql`
      SELECT
        p.id,
        p.country_code,
        LOWER(REGEXP_REPLACE(BTRIM(p.street), '\\s+', ' ', 'g')) AS street_norm,
        UPPER(REGEXP_REPLACE(p.postal_code, '\\s+', '', 'g')) AS postal_code,
        p.house_number,
        p.house_number_addition
      FROM properties p
      JOIN (
        VALUES ${sql.join(valueFragments, sql`, `)}
      ) AS v(country_code, street_norm, postal_code, house_number, addition)
        ON p.country_code = v.country_code
       AND LOWER(REGEXP_REPLACE(BTRIM(p.street), '\\s+', ' ', 'g')) = v.street_norm
       AND UPPER(REGEXP_REPLACE(p.postal_code, '\\s+', '', 'g')) = v.postal_code
       AND p.house_number = v.house_number
       AND COALESCE(p.house_number_addition, '') = v.addition
    `);

    for (const row of rows) {
      const key = buildAddressMatchKey(
        row.country_code,
        row.street_norm,
        row.postal_code,
        row.house_number,
        row.house_number_addition,
      );
      matchMap.set(key, row.id);
    }
  }

  return matchMap;
}

async function spatialMatchProperties(
  tx: DbTransaction,
  canonicalized: CanonicalizedListing[],
  propertyIdsByListingIndex: Map<number, string>,
): Promise<void> {
  const candidates = canonicalized
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => entry.spatialCandidate !== null && !propertyIdsByListingIndex.has(index));

  const chunkSize = 5_000;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    const valueFragments = chunk.map(({ entry, index }) => sql`(
      ${index}::int,
      ${entry.spatialCandidate!.countryCode}::text,
      ${entry.spatialCandidate!.longitude}::float8,
      ${entry.spatialCandidate!.latitude}::float8
    )`);

    const rows = await tx.execute<{ idx: number; id: string }>(sql`
      WITH coords AS (
        SELECT * FROM (
          VALUES ${sql.join(valueFragments, sql`, `)}
        ) AS t(idx, country_code, lon, lat)
      )
      SELECT DISTINCT ON (c.idx)
        c.idx,
        p.id
      FROM coords c
      JOIN properties p
        ON p.country_code = c.country_code
       AND p.geometry IS NOT NULL
       AND ST_DWithin(
         p.geometry,
         ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326),
         0.001
       )
      ORDER BY c.idx, ST_Distance(p.geometry, ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326))
    `);

    for (const row of rows) {
      const candidate = chunk.find((value) => value.index === row.idx);
      if (!candidate) {
        continue;
      }

      propertyIdsByListingIndex.set(candidate.index, row.id);
    }
  }
}

function mapExactMatchesToListings(
  canonicalized: CanonicalizedListing[],
  propertyIdByAddress: Map<string, string>,
): Map<number, string> {
  const propertyIdsByListingIndex = new Map<number, string>();

  for (let index = 0; index < canonicalized.length; index += 1) {
    const entry = canonicalized[index];
    if (!entry) {
      continue;
    }

    if (!entry.canonical) {
      continue;
    }

    const key = buildAddressMatchKey(
      entry.canonical.countryCode,
      entry.canonical.streetNorm,
      entry.canonical.postalCode,
      entry.canonical.houseNumber,
      entry.canonical.houseNumberAddition,
    );
    const propertyId = propertyIdByAddress.get(key);
    if (propertyId) {
      propertyIdsByListingIndex.set(index, propertyId);
    }
  }

  return propertyIdsByListingIndex;
}

function dedupeMatchedListings(
  canonicalized: CanonicalizedListing[],
  propertyIdsByListingIndex: Map<number, string>,
): { matched: MatchedListing[]; skippedCount: number; skipDiagnostics: IngestSkipDiagnostic[] } {
  const deduped = new Map<string, MatchedListing>();
  const skipDiagnostics: IngestSkipDiagnostic[] = [];
  let skippedCount = 0;

  for (let index = 0; index < canonicalized.length; index += 1) {
    const entry = canonicalized[index];
    if (!entry) {
      continue;
    }

    const propertyId = propertyIdsByListingIndex.get(index);
    if (!propertyId) {
      skippedCount += 1;
      skipDiagnostics.push(toSkipDiagnostic(entry.item, 'unmatched_property'));
      continue;
    }

    deduped.set(entry.item.mirrorListingId, {
      item: entry.item,
      propertyId,
    });
  }

  return {
    matched: Array.from(deduped.values()),
    skippedCount,
    skipDiagnostics,
  };
}

function toSourceStatus(item: IngestListing): ListingSourceStatus {
  if (item.sourceStatus) {
    return item.sourceStatus;
  }
  return item.status === 'active' ? 'available' : item.status;
}

async function persistMatchedListingObservations(
  tx: DbTransaction,
  sourceName: string,
  batchId: string,
  matched: MatchedListing[],
): Promise<ListingWriteResult[]> {
  const results: ListingWriteResult[] = [];
  const chunkSize = 500;

  for (let offset = 0; offset < matched.length; offset += chunkSize) {
    const chunk = matched.slice(offset, offset + chunkSize);
    for (const { propertyId, item } of chunk) {
      const sourceListingId = item.sourceListingId ?? item.mirrorListingId;
      const persisted = await persistMirrorObservationForIngest(tx, {
        batchId,
        sourceName,
        sourceUrl: normalizeSourceUrl(item.canonicalUrl ?? item.sourceUrl),
        sourceListingId,
        sourceListingIdKind: item.sourceListingIdKind ?? 'unknown',
        aliases: item.sourceListingAliases,
        propertyId,
        propertyMatchKind: 'source_exact',
        sourceStatus: toSourceStatus(item),
        askingPrice: item.askingPrice,
        priceCurrency: item.currency ?? 'EUR',
        address: {
          countryCode: item.address.countryCode,
          street: item.address.street,
          postalCode: item.address.postalCode,
          houseNumber: item.address.houseNumber,
          houseNumberAddition: item.address.houseNumberAddition ?? null,
          city: item.address.city,
          latitude: item.address.latitude ?? null,
          longitude: item.address.longitude ?? null,
        },
        title: item.ogTitle ?? null,
        description: item.description ?? null,
        imageUrl: item.thumbnailUrl ?? null,
        firstSeenAt: item.mirrorFirstSeenAt,
        lastSeenAt: item.mirrorLastSeenAt,
        sourceUpdatedAt: item.mirrorLastChangedAt,
        payload: {
          mirrorListingId: item.mirrorListingId,
          priceType: item.priceType,
          livingAreaM2: item.livingAreaM2 ?? null,
          numRooms: item.numRooms ?? null,
          energyLabel: item.energyLabel ?? null,
          priceHistory: item.priceHistory ?? [],
        },
      });
      results.push(persisted);
    }
  }

  return results;
}

function getRecoveryIdentity(match: MatchedListing): RecoveryIdentity {
  const sourceListingId = match.item.sourceListingId ?? match.item.mirrorListingId;
  const sourceUrl = normalizeSourceUrl(match.item.canonicalUrl ?? match.item.sourceUrl);

  return {
    sourceListingId,
    sourceUrl,
    propertyId: match.propertyId,
  };
}

async function classifyRecoveredMatchedListings(
  tx: DbTransaction,
  sourceName: string,
  batchId: string,
  matched: MatchedListing[],
): Promise<RecoveredMatchClassification> {
  if (matched.length === 0) {
    return {
      unresolved: [],
      resolvedCount: 0,
    };
  }

  const sourceListingIds = new Set<string>();
  const sourceUrls = new Set<string>();

  for (const entry of matched) {
    const identity = getRecoveryIdentity(entry);
    sourceListingIds.add(identity.sourceListingId);
    sourceUrls.add(identity.sourceUrl);
  }

  const sourceListingIdList = Array.from(sourceListingIds);
  const sourceUrlList = Array.from(sourceUrls);

  const rows = await tx
    .select({
      propertyId: listingObservations.propertyId,
      sourceListingId: listingObservations.sourceListingId,
      sourceUrl: listingObservations.sourceUrlCanonical,
    })
    .from(listingObservations)
    .where(
      and(
        eq(listingObservations.sourceName, sourceName),
        eq(listingObservations.origin, 'mirror'),
        eq(listingObservations.ingestBatchId, batchId),
        or(
          inArray(listingObservations.sourceListingId, sourceListingIdList),
          inArray(listingObservations.sourceUrlCanonical, sourceUrlList),
        ),
      ),
    );

  const recoveredSourceListingIds = new Set<string>();
  const recoveredSourceUrls = new Set<string>();

  for (const row of rows) {
    if (row.sourceListingId) {
      recoveredSourceListingIds.add(row.sourceListingId);
    }
    if (row.sourceUrl) {
      recoveredSourceUrls.add(row.sourceUrl);
    }
  }

  let resolvedCount = 0;
  const unresolved: MatchedListing[] = [];

  for (const entry of matched) {
    const identity = getRecoveryIdentity(entry);
    const alreadyObserved =
      recoveredSourceListingIds.has(identity.sourceListingId)
      || recoveredSourceUrls.has(identity.sourceUrl);

    if (alreadyObserved) {
      resolvedCount += 1;
      continue;
    }

    unresolved.push(entry);
  }

  return {
    unresolved,
    resolvedCount,
  };
}

async function lockSkippedBatchRecoveryCandidate(
  tx: DbTransaction,
  batchId: string,
  recoveryStartedAt: Date,
  options: { force?: boolean } = {},
): Promise<SkippedBatchRecoveryCandidate | null> {
  const dueBefore = new Date(recoveryStartedAt.getTime() - SKIPPED_BATCH_RECOVERY_COOLDOWN_MS).toISOString();
  const missingObservationPredicate = options.force
    ? sql`) > 0`
    : sql`) > GREATEST(skipped_count, 0)
      AND (
        maintenance_completed_at IS NULL
        OR maintenance_completed_at <= ${dueBefore}
      )`;
  const rows = await tx.execute<{
    id: string;
    source_name: string;
    payload_json: Record<string, unknown>;
    ingested_count: number;
    updated_count: number;
    skipped_count: number;
    maintenance_requested_at: Date | string | null;
    maintenance_completed_at: Date | string | null;
  }>(sql`
    SELECT
      id,
      source_name,
      payload_json,
      ingested_count,
      updated_count,
      skipped_count,
      maintenance_requested_at,
      maintenance_completed_at
    FROM ingest_batches
    WHERE id = ${batchId}
      AND status = 'completed'
      AND jsonb_typeof(payload_json->'listings') = 'array'
      AND jsonb_array_length(payload_json->'listings') > 0
      AND (
        SELECT count(*)
        FROM jsonb_array_elements(payload_json->'listings') AS payload_listing(listing)
        WHERE NOT EXISTS (
          SELECT 1
          FROM listing_observations observation
          WHERE (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_listing_id = COALESCE(
                NULLIF(payload_listing.listing->>'sourceListingId', ''),
                payload_listing.listing->>'mirrorListingId'
              )
            )
            OR (
              observation.ingest_batch_id = ingest_batches.id
              AND observation.source_name = ingest_batches.source_name
              AND observation.origin = 'mirror'
              AND observation.source_url_canonical = regexp_replace(
                regexp_replace(
                  COALESCE(
                    NULLIF(payload_listing.listing->>'canonicalUrl', ''),
                    payload_listing.listing->>'sourceUrl'
                  ),
                  '[?#].*$',
                  ''
                ),
                '/+$',
                ''
              )
            )
        )
      ${missingObservationPredicate}
    FOR UPDATE SKIP LOCKED
  `);

  const row = Array.from(rows)[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    sourceName: row.source_name,
    payload: ingestBatchRequestSchema.parse(row.payload_json),
    ingestedCount: row.ingested_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    maintenanceRequestedAt:
      row.maintenance_requested_at == null ? null : new Date(row.maintenance_requested_at).toISOString(),
    maintenanceCompletedAt:
      row.maintenance_completed_at == null ? null : new Date(row.maintenance_completed_at).toISOString(),
  };
}

async function recoverSkippedCompletedBatch(
  candidateId: string,
  recoveryStartedAt: Date,
  options: { force?: boolean } = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    const claimed = await lockSkippedBatchRecoveryCandidate(tx, candidateId, recoveryStartedAt, options);
    if (!claimed) {
      return 0;
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${claimed.sourceName}))`);

    const {
      canonicalized,
      skippedCount: canonicalizationSkips,
    } = canonicalizeListings(claimed.payload.listings);
    const exactMatches = await exactMatchProperties(tx, canonicalized);
    const propertyIdsByListingIndex = mapExactMatchesToListings(canonicalized, exactMatches);
    await spatialMatchProperties(tx, canonicalized, propertyIdsByListingIndex);

    const { matched, skippedCount: unmatchedSkips } = dedupeMatchedListings(
      canonicalized,
      propertyIdsByListingIndex,
    );
    const { unresolved, resolvedCount } = await classifyRecoveredMatchedListings(
      tx,
      claimed.sourceName,
      claimed.id,
      matched,
    );
    const skippedCount = canonicalizationSkips + unmatchedSkips;

    if (unresolved.length === 0) {
      const hasPendingRefresh =
        claimed.maintenanceRequestedAt !== null && claimed.maintenanceCompletedAt === null;
      const update: Partial<typeof ingestBatches.$inferInsert> = {
        ingestedCount: resolvedCount,
        updatedCount: 0,
        skippedCount,
      };

      if (!hasPendingRefresh) {
        update.maintenanceRequestedAt = recoveryStartedAt;
        update.maintenanceCompletedAt = recoveryStartedAt;
      }

      await tx.update(ingestBatches).set(update).where(eq(ingestBatches.id, claimed.id));
      return 0;
    }

    const listingWrites = await persistMatchedListingObservations(
      tx,
      claimed.sourceName,
      claimed.id,
      unresolved,
    );

    await advancePropertyChangeVersion(
      listingWrites
        .filter((row) => row.inserted || row.changed)
        .map((row) => row.propertyId),
      tx,
    );

    const insertedCount = listingWrites.filter((row) => row.inserted).length;
    const updatedCount = listingWrites.length - insertedCount;
    const ingestedCount = resolvedCount + insertedCount;
    await tx
      .update(ingestBatches)
      .set({
        ingestedCount,
        updatedCount,
        skippedCount,
        maintenanceRequestedAt: recoveryStartedAt,
        maintenanceCompletedAt: null,
      })
      .where(eq(ingestBatches.id, claimed.id));

    return listingWrites.length;
  });
}

async function recoverSkippedCompletedIngestBatches(
  recoveryStartedAt: Date,
  limit = 100,
): Promise<number> {
  const candidates = await listSkippedBatchRecoveryCandidates(recoveryStartedAt, limit);
  let recoveredCount = 0;

  for (const candidate of candidates) {
    recoveredCount += await recoverSkippedCompletedBatch(candidate.id, recoveryStartedAt);
  }

  return recoveredCount;
}

export async function forceRecoverSkippedCompletedIngestBatches(
  sourceName: string,
  limit = 100,
): Promise<ForcedSkippedBatchRecoveryResult> {
  const recoveryStartedAt = new Date();
  const candidates = await listForceSkippedBatchRecoveryCandidates(sourceName, limit);
  const recoveredBatchIds: string[] = [];
  let recoveredObservationCount = 0;

  for (const candidate of candidates) {
    const recoveredCount = await recoverSkippedCompletedBatch(candidate.id, recoveryStartedAt, { force: true });
    if (recoveredCount > 0) {
      recoveredBatchIds.push(candidate.id);
      recoveredObservationCount += recoveredCount;
    }
  }

  return {
    sourceName,
    candidateCount: candidates.length,
    recoveredObservationCount,
    recoveredBatchIds,
  };
}

async function advanceCommittedSourceCursor(tx: DbTransaction, sourceName: string): Promise<void> {
  const sourceRows = await tx
    .select()
    .from(ingestSources)
    .where(eq(ingestSources.sourceName, sourceName))
    .limit(1);

  let currentCursor = sourceRows[0]?.lastCommittedCursor ?? null;

  for (;;) {
    const cursorCondition =
      currentCursor === null
        ? sql`${ingestBatches.cursorStart} IS NULL`
        : sql`${ingestBatches.cursorStart} = ${currentCursor}`;

    const nextRows = await tx
      .select({
        id: ingestBatches.id,
        runId: ingestBatches.runId,
        cursorEnd: ingestBatches.cursorEnd,
      })
      .from(ingestBatches)
      .where(
        and(
          eq(ingestBatches.sourceName, sourceName),
          eq(ingestBatches.status, 'completed'),
          sql`NOT (${ingestBatches.payloadJson} ? 'requestedBy')`,
          cursorCondition,
        ),
      )
      .orderBy(asc(ingestBatches.receivedAt), asc(ingestBatches.batchSequence))
      .limit(1);

    const next = nextRows[0];
    if (!next) {
      break;
    }

    const decodedCursor = decodeOpaqueIngestCursor(next.cursorEnd);
    await tx
      .update(ingestSources)
      .set({
        lastCommittedCursor: next.cursorEnd,
        lastCommittedChangedAt: new Date(decodedCursor.changedAt),
        lastCommittedListingKey: decodedCursor.listingKey,
        lastBatchId: next.id,
      })
      .where(eq(ingestSources.sourceName, sourceName));

    currentCursor = next.cursorEnd;
  }
}

async function markBatchFailure(
  batchId: string,
  status: 'retryable' | 'failed',
  error: unknown,
): Promise<void> {
  await db
    .update(ingestBatches)
    .set({
      status,
      errorJson: serializeError(error),
      lastErrorAt: new Date(),
    })
    .where(eq(ingestBatches.id, batchId));
}

async function finalizeRunLifecycle(
  claimed: ClaimedBatch,
  logger: IngestLogger,
  terminalError?: unknown,
): Promise<void> {
  if (!claimed.runId) {
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await finalizeIngestRunLifecycle(
        tx,
        {
          runId: claimed.runId as string,
          sourceName: claimed.sourceName,
        },
        claimed.id,
        terminalError,
      );
    });
  } catch (error) {
    logger.error(
      {
        batchId: claimed.id,
        runId: claimed.runId,
        sourceName: claimed.sourceName,
        error: serializeError(error),
      },
      'Failed to finalize ingest run lifecycle',
    );
  }
}

export async function processIngestBatch(
  options: ProcessIngestBatchOptions,
): Promise<IngestProcessResult> {
  const logger = options.logger ?? defaultLogger();
  const enqueueMaintenanceRefresh = options.enqueueMaintenanceRefresh ?? requestLatestListingsRefresh;
  const maxAttempts = options.maxAttempts ?? 5;
  const claimed = await claimBatchForProcessing(options.batchId);

  if (!claimed) {
    return {
      status: 'noop',
      ingested: 0,
      updated: 0,
      skipped: 0,
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${claimed.sourceName}))`);
      await tx.execute(sql`
        INSERT INTO ingest_sources (source_name)
        VALUES (${claimed.sourceName})
        ON CONFLICT (source_name) DO NOTHING
      `);

      const {
        canonicalized,
        skippedCount: canonicalizationSkips,
        skipDiagnostics: canonicalizationSkipDiagnostics,
      } = canonicalizeListings(claimed.payload.listings);
      const exactMatches = await exactMatchProperties(tx, canonicalized);
      const propertyIdsByListingIndex = mapExactMatchesToListings(canonicalized, exactMatches);
      await spatialMatchProperties(tx, canonicalized, propertyIdsByListingIndex);

      const {
        matched,
        skippedCount: unmatchedSkips,
        skipDiagnostics: unmatchedSkipDiagnostics,
      } = dedupeMatchedListings(canonicalized, propertyIdsByListingIndex);
      logSkipDiagnostics(
        logger,
        { batchId: claimed.id, sourceName: claimed.sourceName },
        [...canonicalizationSkipDiagnostics, ...unmatchedSkipDiagnostics],
      );
      const listingWrites = await persistMatchedListingObservations(
        tx,
        claimed.sourceName,
        claimed.id,
        matched,
      );
      await advancePropertyChangeVersion(
        listingWrites
          .filter((row) => row.inserted || row.changed)
          .map((row) => row.propertyId),
        tx,
      );

      const ingestedCount = listingWrites.filter((row) => row.inserted).length;
      const updatedCount = listingWrites.length - ingestedCount;
      const skippedCount = canonicalizationSkips + unmatchedSkips;
      const maintenanceRequestedAt = listingWrites.length > 0 ? new Date() : null;

      await tx
        .update(ingestBatches)
        .set({
          status: 'completed',
          completedAt: new Date(),
          ingestedCount,
          updatedCount,
          skippedCount,
          errorJson: null,
          maintenanceRequestedAt,
        })
        .where(eq(ingestBatches.id, claimed.id));

      await advanceCommittedSourceCursor(tx, claimed.sourceName);

      return {
        ingestedCount,
        updatedCount,
        skippedCount,
        maintenanceRequested: maintenanceRequestedAt !== null,
      };
    });

    if (result.maintenanceRequested) {
      try {
        await enqueueMaintenanceRefresh({
          requestedBy: 'ingest-batch',
          batchId: claimed.id,
        });
      } catch (error) {
        logger.warn(
          {
            batchId: claimed.id,
            sourceName: claimed.sourceName,
            error: serializeError(error),
          },
          'Maintenance refresh enqueue failed after ingest batch commit',
        );
      }
    }

    await finalizeRunLifecycle(claimed, logger);

    return {
      status: 'completed',
      ingested: result.ingestedCount,
      updated: result.updatedCount,
      skipped: result.skippedCount,
    };
  } catch (error) {
    const nextStatus = claimed.attemptCount >= maxAttempts ? 'failed' : 'retryable';
    await markBatchFailure(claimed.id, nextStatus, error);
    if (nextStatus === 'failed') {
      await finalizeRunLifecycle(claimed, logger, error);
    }
    throw error;
  }
}

export async function refreshLatestListingsMaintenance(
  refreshViews: (() => Promise<void>) | Array<() => Promise<void>>,
  options: RefreshMaintenanceOptions = {},
): Promise<number> {
  const logger = options.logger ?? defaultLogger();
  const viewRefreshers = Array.isArray(refreshViews) ? refreshViews : [refreshViews];
  const refreshStartedAt = new Date();
  const skippedBatchRecoveryLimit = options.skippedBatchRecoveryLimit ?? 1;

  await recoverSkippedCompletedIngestBatches(refreshStartedAt, skippedBatchRecoveryLimit);

  const pendingRows = await db
    .select({ id: ingestBatches.id })
    .from(ingestBatches)
    .where(
      sql`${ingestBatches.maintenanceRequestedAt} IS NOT NULL
        AND ${ingestBatches.maintenanceCompletedAt} IS NULL
        AND ${ingestBatches.maintenanceRequestedAt} <= ${refreshStartedAt.toISOString()}`,
    );

  if (pendingRows.length === 0) {
    return 0;
  }

  try {
    for (const refreshView of viewRefreshers) {
      await refreshView();
    }
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Maintenance refresh failed');
    throw error;
  }

  await db
    .update(ingestBatches)
    .set({ maintenanceCompletedAt: new Date() })
    .where(inArray(ingestBatches.id, pendingRows.map((row) => row.id)));

  return pendingRows.length;
}

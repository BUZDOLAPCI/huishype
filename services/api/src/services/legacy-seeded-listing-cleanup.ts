import { sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/index.js';
import { createMaintenanceRefreshRequest } from './ingest/store.js';
import {
  applyListingValidationOutcome,
  createOrUpdateMirrorWatch,
  type ListingValidationOutcomeInput,
} from './listing-reconciliation.js';
import {
  resolveListingSourceUrl,
  SourceServiceTemporaryError,
  validateListingSource,
  type ListingSourceName,
  type ListingSourceResolution,
  type ListingValidationResponse,
  type SupportedListingSourceResolution,
} from './listing-source-resolution.js';
import { advancePropertyChangeVersion } from './property-read-state.js';
import { advancePropertyTileSnapshotWatermark } from './property-tile-snapshots.js';

type CleanupDb = typeof db | DbTransaction;

export type LegacySeededListingCleanupSource = ListingSourceName | 'both';

export type LegacySeededListingCleanupCandidate = {
  canonicalListingId: string;
  propertyId: string;
  sourceName: ListingSourceName;
  primarySourceListingId: string | null;
  canonicalUrl: string | null;
  displayUrl: string | null;
  status: string;
  property: {
    id: string;
    countryCode: string;
    street: string;
    postalCode: string;
    houseNumber: number;
    houseNumberAddition: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};

export type LegacySeededListingObservationProfile = {
  hasLegacySeedEvidence: boolean;
  hasIngestBackedEvidence: boolean;
  hasNonLegacyEvidence: boolean;
};

export type LegacySeededListingOutcomeClassification =
  | { action: 'apply'; reason: 'matched_status' | 'not_found' | 'explicit_property_mismatch' }
  | { action: 'skip'; reason: string };

export type LegacySeededListingCleanupResult = {
  candidate: LegacySeededListingCleanupCandidate;
  resolution: ListingSourceResolution | null;
  validation: ListingValidationResponse | null;
  classification: LegacySeededListingOutcomeClassification;
  applied: boolean;
  changed: boolean;
  keptActive: boolean;
  watchId: string | null;
  observationId: string | null;
  maintenanceBatchId: string | null;
  error: string | null;
};

export type LegacySeededListingCleanupSummary = {
  execute: boolean;
  source: LegacySeededListingCleanupSource;
  limit: number;
  delayMs: number;
  maxConsecutiveTemporaryErrors: number | null;
  candidateCounts: Record<ListingSourceName, number>;
  candidates: LegacySeededListingCleanupCandidate[];
  processedCandidateCount: number;
  unprocessedCandidateCount: number;
  validatedCount: number;
  appliedCount: number;
  changedCount: number;
  keptActiveCount: number;
  skippedCount: number;
  temporaryErrorCount: number;
  maintenanceRefreshRequestCount: number;
  maintenanceBatchIds: string[];
  stoppedEarlyReason: string | null;
  results: LegacySeededListingCleanupResult[];
};

const ACTIVE_SOURCES = ['funda', 'pararius'] as const satisfies readonly ListingSourceName[];
const STRONG_MATCHED_SOURCE_STATUSES = ['available', 'sold', 'rented', 'withdrawn'] as const;

function targetDb(executor?: CleanupDb): CleanupDb {
  return executor ?? db;
}

function sourcePredicate(source: LegacySeededListingCleanupSource) {
  if (source === 'both') {
    return sql`cl.source_name IN ('funda', 'pararius')`;
  }
  return sql`cl.source_name = ${source}`;
}

export function isLegacySeededListingObservationProfileCandidate(
  profile: LegacySeededListingObservationProfile,
): boolean {
  return profile.hasLegacySeedEvidence && !profile.hasIngestBackedEvidence && !profile.hasNonLegacyEvidence;
}

export function classifyLegacySeededListingValidationOutcome(
  validation: ListingValidationResponse,
  resolution: SupportedListingSourceResolution,
): LegacySeededListingOutcomeClassification {
  if (
    validation.state === 'matched'
    && validation.sourceStatus
    && STRONG_MATCHED_SOURCE_STATUSES.includes(validation.sourceStatus as typeof STRONG_MATCHED_SOURCE_STATUSES[number])
  ) {
    return { action: 'apply', reason: 'matched_status' };
  }

  if (validation.state === 'not_found') {
    return { action: 'apply', reason: 'not_found' };
  }

  if (
    validation.state === 'invalid'
    && resolution.sourceListingId.length > 0
    && validation.matchedPropertyEvidence?.matchKind === 'source_mismatch'
  ) {
    return { action: 'apply', reason: 'explicit_property_mismatch' };
  }

  return {
    action: 'skip',
    reason: validation.state === 'matched'
      ? `matched_without_strong_status:${validation.sourceStatus ?? 'missing'}`
      : validation.state,
  };
}

export async function countLegacySeededListingCleanupCandidates(
  options: { source: LegacySeededListingCleanupSource },
  executor?: CleanupDb,
): Promise<Record<ListingSourceName, number>> {
  const rows = await targetDb(executor).execute<{ sourceName: ListingSourceName; count: string }>(sql`
    SELECT cl.source_name AS "sourceName", count(*)::text AS count
    FROM canonical_listings cl
    WHERE cl.status = 'active'
      AND ${sourcePredicate(options.source)}
      AND (cl.canonical_url IS NOT NULL OR cl.display_url IS NOT NULL OR cl.primary_source_listing_id IS NOT NULL)
      AND EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.origin IN ('mirror', 'replay')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.ingest_batch_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.origin NOT IN ('mirror', 'replay')
      )
    GROUP BY cl.source_name
  `);

  const counts: Record<ListingSourceName, number> = { funda: 0, pararius: 0 };
  for (const row of rows) {
    if (ACTIVE_SOURCES.includes(row.sourceName)) {
      counts[row.sourceName] = Number(row.count);
    }
  }
  return counts;
}

export async function listLegacySeededListingCleanupCandidates(
  options: { source: LegacySeededListingCleanupSource; limit: number },
  executor?: CleanupDb,
): Promise<LegacySeededListingCleanupCandidate[]> {
  if (!Number.isInteger(options.limit) || options.limit <= 0) return [];

  const rows = await targetDb(executor).execute<LegacySeededListingCleanupCandidate>(sql`
    SELECT
      cl.id AS "canonicalListingId",
      cl.property_id AS "propertyId",
      cl.source_name AS "sourceName",
      cl.primary_source_listing_id AS "primarySourceListingId",
      cl.canonical_url AS "canonicalUrl",
      cl.display_url AS "displayUrl",
      cl.status AS status,
      json_build_object(
        'id', p.id,
        'countryCode', p.country_code,
        'street', p.street,
        'postalCode', p.postal_code,
        'houseNumber', p.house_number,
        'houseNumberAddition', p.house_number_addition,
        'city', p.city,
        'latitude', CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_Y(p.geometry) END,
        'longitude', CASE WHEN p.geometry IS NULL THEN NULL ELSE ST_X(p.geometry) END
      ) AS property
    FROM canonical_listings cl
    INNER JOIN properties p ON p.id = cl.property_id
    WHERE cl.status = 'active'
      AND ${sourcePredicate(options.source)}
      AND (cl.canonical_url IS NOT NULL OR cl.display_url IS NOT NULL OR cl.primary_source_listing_id IS NOT NULL)
      AND EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.origin IN ('mirror', 'replay')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.ingest_batch_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM listing_observation_links link
        INNER JOIN listing_observations obs ON obs.id = link.listing_observation_id
        WHERE link.canonical_listing_id = cl.id
          AND obs.origin NOT IN ('mirror', 'replay')
      )
    ORDER BY cl.source_name, COALESCE(cl.last_reconciled_at, cl.updated_at, cl.created_at), cl.id
    LIMIT ${options.limit}
  `);

  return Array.from(rows);
}

function rawUrlForCandidate(candidate: LegacySeededListingCleanupCandidate): string {
  return candidate.canonicalUrl ?? candidate.displayUrl ?? candidate.primarySourceListingId ?? '';
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function validationOutcomeInput(
  candidate: LegacySeededListingCleanupCandidate,
  watchId: string,
  resolution: SupportedListingSourceResolution,
  validation: ListingValidationResponse,
): ListingValidationOutcomeInput {
  return {
    watchId,
    state: validation.state,
    sourceName: validation.sourceName,
    rawUrl: validation.rawUrl,
    canonicalUrl: validation.canonicalUrl || resolution.canonicalUrl,
    sourceListingId: validation.sourceListingId ?? resolution.sourceListingId,
    sourceListingIdKind: validation.sourceListingIdKind ?? resolution.sourceListingIdKind,
    aliases: validation.aliases ?? resolution.aliases,
    sourceStatus: validation.sourceStatus,
    address: validation.address,
    matchedPropertyEvidence: validation.matchedPropertyEvidence ?? {
      propertyId: candidate.propertyId,
      matchKind: 'source_unmatched',
    },
    price: validation.price,
    currency: validation.currency,
    thumbnailUrl: validation.thumbnailUrl,
    title: validation.title,
    description: validation.description,
    firstSeenAt: validation.firstSeenAt,
    lastSeenAt: validation.lastSeenAt,
    sourceUpdatedAt: validation.sourceUpdatedAt,
    payload: {
      ...(validation.payload ?? {}),
      legacySeededCleanup: true,
    },
  };
}

async function applyStrongOutcome(
  candidate: LegacySeededListingCleanupCandidate,
  resolution: SupportedListingSourceResolution,
  validation: ListingValidationResponse,
): Promise<{
  watchId: string;
  observationId: string;
  maintenanceBatchId: string;
  changed: boolean;
  keptActive: boolean;
}> {
  return db.transaction(async (tx) => {
    const watch = await createOrUpdateMirrorWatch(
      {
        sourceName: candidate.sourceName,
        propertyId: candidate.propertyId,
        sourceUrlRaw: rawUrlForCandidate(candidate),
        sourceUrlCanonical: resolution.canonicalUrl,
        sourceListingId: validation.sourceListingId ?? resolution.sourceListingId,
        canonicalListingId: candidate.canonicalListingId,
        state: 'queued',
        stateReason: 'legacy_seed_cleanup',
      },
      tx,
    );

    const applied = await applyListingValidationOutcome(
      tx,
      validationOutcomeInput(candidate, watch.id, resolution, validation),
    );

    await advancePropertyChangeVersion(applied.canonicalListing.propertyId, tx);
    await advancePropertyTileSnapshotWatermark(['listing', 'property'], tx);
    const maintenance = await createMaintenanceRefreshRequest(tx, {
      sourceName: candidate.sourceName,
      requestedBy: 'validation-outcome',
      idempotencyKey: `legacy-seed-cleanup:${watch.id}:${applied.observationId}`,
      payload: {
        canonicalListingId: applied.canonicalListing.id,
        observationId: applied.observationId,
        watchId: watch.id,
        state: validation.state,
      },
    });

    return {
      watchId: watch.id,
      observationId: applied.observationId,
      maintenanceBatchId: maintenance.batchId,
      changed: applied.canonicalListing.status !== candidate.status,
      keptActive: applied.canonicalListing.status === 'active',
    };
  });
}

export async function validateLegacySeededListingCleanupCandidate(
  candidate: LegacySeededListingCleanupCandidate,
  options: { execute: boolean },
): Promise<LegacySeededListingCleanupResult> {
  const rawUrl = rawUrlForCandidate(candidate);
  let resolution: ListingSourceResolution;
  try {
    resolution = await resolveListingSourceUrl(rawUrl, candidate.sourceName);
  } catch (error) {
    if (error instanceof SourceServiceTemporaryError) {
      return {
        candidate,
        resolution: null,
        validation: null,
        classification: { action: 'skip', reason: 'temporary_resolution_error' },
        applied: false,
        changed: false,
        keptActive: false,
        watchId: null,
        observationId: null,
        maintenanceBatchId: null,
        error: error.message,
      };
    }
    throw error;
  }

  if (!resolution.supported) {
    return {
      candidate,
      resolution,
      validation: null,
      classification: { action: 'skip', reason: resolution.reasonCode },
      applied: false,
      changed: false,
      keptActive: false,
      watchId: null,
      observationId: null,
      maintenanceBatchId: null,
      error: null,
    };
  }

  let validation: ListingValidationResponse;
  try {
    validation = await validateListingSource({
      watchId: null,
      sourceName: resolution.sourceName,
      rawUrl,
      canonicalUrl: resolution.canonicalUrl,
      sourceListingId: resolution.sourceListingId,
      sourceListingIdKind: resolution.sourceListingIdKind,
      aliases: resolution.aliases,
      property: candidate.property,
    });
  } catch (error) {
    if (error instanceof SourceServiceTemporaryError) {
      return {
        candidate,
        resolution,
        validation: null,
        classification: { action: 'skip', reason: 'temporary_validation_error' },
        applied: false,
        changed: false,
        keptActive: false,
        watchId: null,
        observationId: null,
        maintenanceBatchId: null,
        error: error.message,
      };
    }
    throw error;
  }

  const classification = classifyLegacySeededListingValidationOutcome(validation, resolution);
  if (!options.execute || classification.action === 'skip') {
    return {
      candidate,
      resolution,
      validation,
      classification,
      applied: false,
      changed: false,
      keptActive: false,
      watchId: null,
      observationId: null,
      maintenanceBatchId: null,
      error: null,
    };
  }

  const applied = await applyStrongOutcome(candidate, resolution, validation);
  return {
    candidate,
    resolution,
    validation,
    classification,
    applied: true,
    changed: applied.changed,
    keptActive: applied.keptActive,
    watchId: applied.watchId,
    observationId: applied.observationId,
    maintenanceBatchId: applied.maintenanceBatchId,
    error: null,
  };
}

export async function cleanupLegacySeededListings(options: {
  source: LegacySeededListingCleanupSource;
  limit: number;
  execute: boolean;
  delayMs?: number;
  maxConsecutiveTemporaryErrors?: number | null;
}): Promise<LegacySeededListingCleanupSummary> {
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 0));
  const maxConsecutiveTemporaryErrors = options.maxConsecutiveTemporaryErrors == null
    ? null
    : Math.max(0, Math.trunc(options.maxConsecutiveTemporaryErrors));
  const candidateCounts = await countLegacySeededListingCleanupCandidates({ source: options.source });
  const candidates = await listLegacySeededListingCleanupCandidates({
    source: options.source,
    limit: options.limit,
  });
  const results: LegacySeededListingCleanupResult[] = [];
  let consecutiveTemporaryErrors = 0;
  let stoppedEarlyReason: string | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0) {
      await sleep(delayMs);
    }

    const result = await validateLegacySeededListingCleanupCandidate(candidates[index], { execute: options.execute });
    results.push(result);

    if (result.error !== null) {
      consecutiveTemporaryErrors += 1;
    } else {
      consecutiveTemporaryErrors = 0;
    }

    if (
      maxConsecutiveTemporaryErrors !== null
      && maxConsecutiveTemporaryErrors > 0
      && consecutiveTemporaryErrors >= maxConsecutiveTemporaryErrors
    ) {
      stoppedEarlyReason = `max_consecutive_temporary_errors:${maxConsecutiveTemporaryErrors}`;
      break;
    }
  }

  const maintenanceBatchIds = results
    .map((result) => result.maintenanceBatchId)
    .filter((batchId): batchId is string => batchId !== null);

  return {
    execute: options.execute,
    source: options.source,
    limit: options.limit,
    delayMs,
    maxConsecutiveTemporaryErrors,
    candidateCounts,
    candidates,
    processedCandidateCount: results.length,
    unprocessedCandidateCount: candidates.length - results.length,
    validatedCount: results.filter((result) => result.validation !== null).length,
    appliedCount: results.filter((result) => result.applied).length,
    changedCount: results.filter((result) => result.changed).length,
    keptActiveCount: results.filter((result) => result.keptActive).length,
    skippedCount: results.filter((result) => !result.applied).length,
    temporaryErrorCount: results.filter((result) => result.error !== null).length,
    maintenanceRefreshRequestCount: maintenanceBatchIds.length,
    maintenanceBatchIds,
    stoppedEarlyReason,
    results,
  };
}

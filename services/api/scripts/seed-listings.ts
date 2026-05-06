// ---------------------------------------------------------------------------
// seed-listings.ts
//
// Whole-mirror replay entrypoint for Funda and Pararius mirror databases.
// This script deliberately routes writes through the shared ingest contract and
// processor; it must not write canonical listing tables directly.
//
// Usage:
//   pnpm --filter @huishype/api db:seed-listings -- --dry-run --source both
//   pnpm --filter @huishype/api db:seed-listings -- --source funda
//   pnpm --filter @huishype/api db:seed-listings -- --source pararius --scope rent --reason "repair rent scope"
// ---------------------------------------------------------------------------

import dotenv from 'dotenv';
import postgres from 'postgres';
import { pathToFileURL } from 'node:url';
import type { IngestListing } from '../src/services/ingest/contracts.js';
import {
  acceptIngestBatch,
  encodeOpaqueIngestCursor,
  getIngestWatermark,
  processIngestBatch,
  refreshLatestListingsMaintenance,
} from '../src/services/ingest/index.js';
import {
  refreshLatestListingsView,
  refreshPriceGuessStartMarketSummaries,
} from '../src/services/listings-view.js';
import { closeConnection } from '../src/db/index.js';
import type { ListingSourceAlias } from '../src/services/listing-source-resolution.js';
import {
  buildListingReplayExecutionAssessment,
  buildListingReplayThresholds,
  collectListingReplayThresholdViolations,
  computePlannedListingReplayBatchCount,
  hasCompleteMirrorAddress,
  shouldPreserveMirrorRowForIngest,
} from '../src/scripts/seed-listings-safety.js';

dotenv.config();

type SourceName = 'funda' | 'pararius';
type SourceFilter = SourceName | 'both';
type PublicListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';
type LifecycleStatus = 'available' | 'sold' | 'rented' | 'withdrawn' | 'not_found';
type DiagnosticStatus =
  | 'blocked'
  | 'parser_error'
  | 'retryable_error'
  | 'unsupported'
  | 'invalid'
  | 'unknown'
  | 'mirror_unavailable';

interface CliOptions {
  dryRun: boolean;
  source: SourceFilter;
  scope: string | null;
  reason: string | null;
  repair: boolean;
  batchSize: number;
  fetchSize: number;
  maxSkipped: number;
  maxSkipRatio: number;
  maxAffectedCanonical: number;
  maxStaleRows: number;
}

interface MirrorListing {
  id: number;
  funda_id?: string | null;
  pararius_id?: string | null;
  listing_url: string;
  price_type: string | null;
  asking_price_cents: string | null;
  living_area_m2: number | null;
  num_rooms: number | null;
  energy_label: string | null;
  status: string;
  photo_urls: string[] | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  last_changed_at: Date | null;
  street: string | null;
  house_number: string | null;
  house_number_addition: string | null;
  postal_code: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface SourceSummary {
  sourceName: SourceName;
  scopeKey: string;
  scopeMode: 'whole_mirror' | 'scoped';
  dryRun: boolean;
  repairMode: boolean;
  replayReason: string | null;
  mirrorSnapshotId: string;
  sourceRunId: string;
  sourceHighWatermark: string;
  oldestSourceTimestamp: string | null;
  newestSourceTimestamp: string | null;
  existingCursor: string | null;
  mirrorListingCount: number;
  fullMirrorListingCount: number;
  excludedMirrorListingCount: number;
  preparedListingCount: number;
  skippedBeforeIngestCount: number;
  diagnosticListingCount: number;
  transitionCounts: {
    projectable: number;
    diagnostic: number;
    skipped: number;
    completion: number;
    staleObservations: number;
    reactivationCandidates: number;
    duplicateCanonicalCandidates: number;
    terminalLifecycleChanges: number;
    absenceWithoutCompletion: number;
    readModelRefreshes: number;
  };
  affectedCanonicalCount: number;
  staleObservationCount: number;
  reactivationCandidateCount: number;
  duplicateCanonicalCandidateCount: number;
  terminalLifecycleChangeCount: number;
  absenceWithoutCompletionCount: number;
  readModelRefreshCount: number;
  batchCount: number;
  processedBatchCount: number;
  ingestedCount: number;
  updatedCount: number;
  skippedByProcessorCount: number;
  staleForProjection: boolean;
  thresholds: {
    maxSkipped: number;
    maxSkipRatio: number;
    maxAffectedCanonical: number | null;
    maxStaleRows: number | null;
    skipRatio: number;
    violations: string[];
  };
  executionAssessment: {
    executeAllowed: boolean;
    repairExecuteAllowed: boolean;
    abortReasons: string[];
  };
  limitations: string[];
  excludedMirrorRange: {
    reason: string;
    excludedListingCount: number;
  } | null;
  examples: {
    skippedBeforeIngest: Array<Record<string, unknown>>;
    diagnosticListings: Array<Record<string, unknown>>;
    projectableListings: Array<Record<string, unknown>>;
    staleRows: Array<Record<string, unknown>>;
  };
}

interface ReplayIdentityEstimateSets {
  presentSourceListingIds: Set<string>;
  presentCanonicalUrls: Set<string>;
  activeSourceListingIds: Set<string>;
  activeCanonicalUrls: Set<string>;
  terminalSourceListingIds: Set<string>;
  terminalCanonicalUrls: Set<string>;
}

const MAIN_DB_URL = process.env.DATABASE_URL || 'postgresql://huishype:huishype_dev@localhost:5440/huishype';
const FUNDA_DB_URL = process.env.FUNDA_MIRROR_URL || 'postgresql://scraper:secret@localhost:5441/funda_mirror';
const PARARIUS_DB_URL = process.env.PARARIUS_MIRROR_URL || 'postgresql://scraper:secret@localhost:5442/pararius_mirror';

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const source = (getArgValue(args, '--source') ?? 'both') as SourceFilter;
  if (source !== 'funda' && source !== 'pararius' && source !== 'both') {
    throw new Error('--source must be one of: funda, pararius, both');
  }

  const dryRun = args.includes('--dry-run');
  const repair = args.includes('--repair');
  const scope = getArgValue(args, '--scope') ?? null;
  const reason = getArgValue(args, '--reason') ?? null;

  if (repair && !scope) {
    throw new Error('--repair requires --scope so the repair is explicitly bounded');
  }
  if (!dryRun && scope && !reason) {
    throw new Error('Executing a scoped replay requires --reason');
  }
  if (dryRun && scope && !reason) {
    throw new Error('Dry-running a scoped replay requires --reason');
  }
  if (repair && !reason) {
    throw new Error('--repair requires --reason');
  }

  return {
    dryRun,
    source,
    scope,
    reason,
    repair,
    batchSize: parsePositiveInteger(getArgValue(args, '--batch-size'), 1_000),
    fetchSize: parsePositiveInteger(getArgValue(args, '--fetch-size'), 5_000),
    maxSkipped: parseNonNegativeInteger(getArgValue(args, '--max-skipped'), 50_000),
    maxSkipRatio: parseRatio(getArgValue(args, '--max-skip-ratio'), 0.1),
    maxAffectedCanonical: parseNonNegativeInteger(getArgValue(args, '--max-affected-canonical'), 250_000),
    maxStaleRows: parseNonNegativeInteger(getArgValue(args, '--max-stale-rows'), 250_000),
  };
}

function selectedSources(source: SourceFilter): SourceName[] {
  return source === 'both' ? ['funda', 'pararius'] : [source];
}

function normalizePriceType(value: string | null | undefined, source: SourceName): 'sale' | 'rent' | 'unknown' {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'rent' || normalized === 'rental') return 'rent';
  if (normalized === 'sale' || normalized === 'sell' || normalized === 'buy' || normalized === 'koop') return 'sale';
  if (source === 'pararius') return 'rent';
  if (source === 'funda') return 'sale';
  return 'unknown';
}

function normalizeScope(scope: string | null): string | null {
  return scope?.trim().toLowerCase() || null;
}

function centsToEuros(cents: string | null): number | null {
  if (cents == null) return null;
  const parsed = Number(cents);
  return Number.isFinite(parsed) ? Math.round(parsed / 100) : null;
}

function extractThumbnailUrl(photoUrls: string[] | null): string | null {
  return Array.isArray(photoUrls) && photoUrls.length > 0 ? photoUrls[0] ?? null : null;
}

function buildTitle(row: MirrorListing, source: SourceName): string {
  const prefix = normalizePriceType(row.price_type, source) === 'rent' ? 'Te huur' : 'Te koop';
  const address = [row.street, row.house_number, row.house_number_addition].filter(Boolean).join(' ');
  return [prefix, address, row.city].filter(Boolean).join(': ').replace(': :', ':');
}

function mapStatus(status: string): {
  publicStatus: PublicListingStatus;
  lifecycleStatus: LifecycleStatus | undefined;
  diagnosticStatus: DiagnosticStatus | undefined;
} {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'available' || normalized === 'active') {
    return { publicStatus: 'active', lifecycleStatus: 'available', diagnosticStatus: undefined };
  }
  if (normalized === 'sold') {
    return { publicStatus: 'sold', lifecycleStatus: 'sold', diagnosticStatus: undefined };
  }
  if (normalized === 'rented') {
    return { publicStatus: 'rented', lifecycleStatus: 'rented', diagnosticStatus: undefined };
  }
  if (normalized === 'withdrawn') {
    return { publicStatus: 'withdrawn', lifecycleStatus: 'withdrawn', diagnosticStatus: undefined };
  }
  if (normalized === 'not_found') {
    return { publicStatus: 'withdrawn', lifecycleStatus: 'not_found', diagnosticStatus: undefined };
  }
  if (
    normalized === 'blocked'
    || normalized === 'parser_error'
    || normalized === 'retryable_error'
    || normalized === 'unsupported'
    || normalized === 'invalid'
    || normalized === 'unknown'
    || normalized === 'mirror_unavailable'
  ) {
    return {
      publicStatus: 'active',
      lifecycleStatus: undefined,
      diagnosticStatus: normalized,
    };
  }
  return { publicStatus: 'active', lifecycleStatus: undefined, diagnosticStatus: 'unknown' };
}

function uniqueAliases(aliases: ListingSourceAlias[]): ListingSourceAlias[] {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.kind}:${alias.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveIdentity(source: SourceName, rawUrl: string, mirrorId: string | null | undefined) {
  const aliases: ListingSourceAlias[] = [];
  const canonicalUrl = rawUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '/');
  let sourceListingId = mirrorId?.trim() || '';
  let sourceListingIdKind: 'tiny_id' | 'canonical_path' | 'url_path' | 'unknown' = mirrorId
    ? source === 'funda' ? 'tiny_id' : 'url_path'
    : 'unknown';

  try {
    const parsed = new URL(canonicalUrl);
    if (source === 'funda') {
      const match = parsed.pathname.match(/(\d{6,})(?:\/)?$/);
      if (match?.[1]) {
        sourceListingId = match[1];
        sourceListingIdKind = 'tiny_id';
        aliases.push({ kind: 'tiny_id', value: match[1] });
      }
    } else {
      sourceListingId = parsed.pathname.replace(/\/+$/, '');
      sourceListingIdKind = 'canonical_path';
      aliases.push({ kind: 'url_path', value: sourceListingId });
    }
  } catch {
    // Keep the mirror id/raw URL fallback below.
  }

  if (mirrorId && !aliases.some((alias) => alias.value === mirrorId)) {
    aliases.push({ kind: source === 'funda' ? 'tiny_id' : 'url_path', value: mirrorId });
  }

  const fallbackId = sourceListingId || mirrorId?.trim() || rawUrl.trim();
  aliases.push({ kind: 'canonical_url', value: rawUrl.trim() });
  return {
    sourceListingId: fallbackId,
    sourceListingIdKind,
    canonicalUrl,
    aliases: uniqueAliases(aliases),
  };
}

function toIngestListing(
  row: MirrorListing,
  source: SourceName,
  scopeKey: string,
  sourceHighWatermark: string,
): IngestListing | null {
  const status = mapStatus(row.status);
  const preparationEvidence = {
    listingUrl: row.listing_url,
    street: row.street,
    postalCode: row.postal_code,
    houseNumber: row.house_number,
    diagnosticStatus: status.diagnosticStatus,
  };
  if (!shouldPreserveMirrorRowForIngest(preparationEvidence)) {
    return null;
  }

  const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
  const identity = resolveIdentity(source, row.listing_url, mirrorId);
  const priceType = normalizePriceType(row.price_type, source);
  const diagnosticStatus = status.diagnosticStatus
    ?? (hasCompleteMirrorAddress(preparationEvidence) ? undefined : 'unknown');
  const address = row.street || row.postal_code || row.house_number || row.city
    ? {
        countryCode: 'NL',
        street: row.street ?? '',
        postalCode: row.postal_code ?? '',
        houseNumber: row.house_number ?? '',
        houseNumberAddition: row.house_number_addition,
        city: row.city ?? '',
        latitude: row.latitude,
        longitude: row.longitude,
      }
    : undefined;

  return {
    sourceUrl: row.listing_url,
    mirrorListingId: String(mirrorId ?? row.id),
    scopeKey,
    sourceListingId: identity.sourceListingId,
    sourceListingIdKind: identity.sourceListingIdKind,
    sourceListingAliases: identity.aliases,
    canonicalUrl: identity.canonicalUrl,
    askingPrice: centsToEuros(row.asking_price_cents),
    priceType: priceType === 'unknown' ? 'sale' : priceType,
    currency: 'EUR',
    livingAreaM2: row.living_area_m2,
    numRooms: row.num_rooms,
    energyLabel: row.energy_label,
    thumbnailUrl: extractThumbnailUrl(row.photo_urls),
    ogTitle: buildTitle(row, source),
    status: status.publicStatus,
    lifecycleStatus: diagnosticStatus ? undefined : status.lifecycleStatus,
    diagnosticStatus,
    mirrorFirstSeenAt: row.first_seen_at?.toISOString(),
    mirrorLastChangedAt: row.last_changed_at?.toISOString(),
    mirrorLastSeenAt: row.last_seen_at?.toISOString(),
    observedAt: (row.last_changed_at ?? row.last_seen_at ?? row.first_seen_at ?? new Date()).toISOString(),
    sourceHighWatermark,
    sourceProvenance: 'import',
    address,
  };
}

async function getMirrorSnapshot(mirrorDb: postgres.Sql, source: SourceName, scope: string | null): Promise<{
  count: number;
  fullCount: number;
  excludedCount: number;
  oldestTimestamp: string | null;
  highWatermark: string;
  snapshotId: string;
}> {
  const scopeValue = normalizeScope(scope);
  const rows = await mirrorDb<[{
    count: string;
    full_count: string;
    oldest_timestamp: Date | null;
    high_watermark: Date | null;
  }]>`
    SELECT
      COUNT(*) FILTER (
        WHERE (
          ${scopeValue}::text IS NULL
          OR ${scopeValue}::text IN ('all', 'full-mirror')
          OR CASE
            WHEN lower(COALESCE(l.price_type, '')) IN ('rent', 'rental') THEN 'rent'
            WHEN lower(COALESCE(l.price_type, '')) IN ('sale', 'sell', 'buy', 'koop') THEN 'sale'
            WHEN ${source}::text = 'pararius' THEN 'rent'
            WHEN ${source}::text = 'funda' THEN 'sale'
            ELSE 'unknown'
          END = ${scopeValue}::text
        )
      )::text AS count,
      COUNT(*)::text AS full_count,
      MIN(COALESCE(l.last_changed_at, l.last_seen_at, l.first_seen_at)) FILTER (
        WHERE (
          ${scopeValue}::text IS NULL
          OR ${scopeValue}::text IN ('all', 'full-mirror')
          OR CASE
            WHEN lower(COALESCE(l.price_type, '')) IN ('rent', 'rental') THEN 'rent'
            WHEN lower(COALESCE(l.price_type, '')) IN ('sale', 'sell', 'buy', 'koop') THEN 'sale'
            WHEN ${source}::text = 'pararius' THEN 'rent'
            WHEN ${source}::text = 'funda' THEN 'sale'
            ELSE 'unknown'
          END = ${scopeValue}::text
        )
      ) AS oldest_timestamp,
      MAX(COALESCE(l.last_changed_at, l.last_seen_at, l.first_seen_at)) FILTER (
        WHERE (
          ${scopeValue}::text IS NULL
          OR ${scopeValue}::text IN ('all', 'full-mirror')
          OR CASE
            WHEN lower(COALESCE(l.price_type, '')) IN ('rent', 'rental') THEN 'rent'
            WHEN lower(COALESCE(l.price_type, '')) IN ('sale', 'sell', 'buy', 'koop') THEN 'sale'
            WHEN ${source}::text = 'pararius' THEN 'rent'
            WHEN ${source}::text = 'funda' THEN 'sale'
            ELSE 'unknown'
          END = ${scopeValue}::text
        )
      ) AS high_watermark
    FROM listings l
    LEFT JOIN addresses a ON l.address_id = a.id
  `;
  const count = Number(rows[0]?.count ?? 0);
  const fullCount = Number(rows[0]?.full_count ?? count);
  const highWatermark = (rows[0]?.high_watermark ?? new Date()).toISOString();
  const oldestTimestamp = rows[0]?.oldest_timestamp?.toISOString() ?? null;

  return {
    count,
    fullCount,
    excludedCount: Math.max(0, fullCount - count),
    oldestTimestamp,
    highWatermark,
    snapshotId: [
      source,
      scopeValue ?? 'full-mirror',
      count,
      highWatermark,
    ].join(':'),
  };
}

async function fetchMirrorListings(
  mirrorDb: postgres.Sql,
  source: SourceName,
  scope: string | null,
  limit: number,
  offset: number,
): Promise<MirrorListing[]> {
  const scopeValue = normalizeScope(scope);
  const rows = await mirrorDb<MirrorListing[]>`
    SELECT
      l.*,
      a.street,
      a.house_number,
      a.house_number_addition,
      a.postal_code,
      a.city,
      a.latitude,
      a.longitude
    FROM listings l
    LEFT JOIN addresses a ON l.address_id = a.id
    WHERE (
      ${scopeValue}::text IS NULL
      OR ${scopeValue}::text IN ('all', 'full-mirror')
      OR CASE
        WHEN lower(COALESCE(l.price_type, '')) IN ('rent', 'rental') THEN 'rent'
        WHEN lower(COALESCE(l.price_type, '')) IN ('sale', 'sell', 'buy', 'koop') THEN 'sale'
        WHEN ${source}::text = 'pararius' THEN 'rent'
        WHEN ${source}::text = 'funda' THEN 'sale'
        ELSE 'unknown'
      END = ${scopeValue}::text
    )
    ORDER BY
      COALESCE(l.last_changed_at, l.last_seen_at, l.first_seen_at, '-infinity'::timestamptz),
      CASE
        WHEN ${source}::text = 'funda' THEN COALESCE(l.funda_id, '')
        ELSE COALESCE(l.pararius_id, '')
      END,
      l.listing_url,
      l.id
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return rows;
}

async function estimateAffectedCanonicalCount(
  mainDb: postgres.Sql,
  source: SourceName,
  scope: string | null,
): Promise<number> {
  const scopeValue = normalizeScope(scope);
  const rows = await mainDb<[{ count: string }]>`
    SELECT COUNT(*)::text AS count
    FROM canonical_listings
    WHERE source_name = ${source}
      AND status = 'active'
      AND (
        ${scopeValue}::text IS NULL
        OR ${scopeValue}::text IN ('all', 'full-mirror')
        OR price_type = ${scopeValue}::text
      )
  `;

  return Number(rows[0]?.count ?? 0);
}

async function estimateDuplicateCanonicalCandidateCount(
  mainDb: postgres.Sql,
  source: SourceName,
  scope: string | null,
): Promise<number> {
  const scopeValue = normalizeScope(scope);
  const rows = await mainDb<[{ count: string }]>`
    SELECT COUNT(*)::text AS count
    FROM (
      SELECT canonical_url
      FROM canonical_listings
      WHERE source_name = ${source}
        AND canonical_url IS NOT NULL
        AND (
          ${scopeValue}::text IS NULL
          OR ${scopeValue}::text IN ('all', 'full-mirror')
          OR price_type = ${scopeValue}::text
        )
      GROUP BY canonical_url
      HAVING COUNT(*) > 1
    ) duplicate_urls
  `;

  return Number(rows[0]?.count ?? 0);
}

function buildCompletion(input: {
  source: SourceName;
  scopeKey: string;
  sourceRunId: string;
  sourceHighWatermark: string;
  observedListingCount: number;
  coverageStatus: 'complete' | 'partial';
  reason: string | null;
  diagnostics?: Record<string, unknown>;
}) {
  const listingType: 'sale' | 'rent' | 'unknown' =
    input.scopeKey === 'sale' || input.scopeKey === 'rent' ? input.scopeKey : 'unknown';
  const isSourceWideScope = input.scopeKey === 'full-mirror' || input.scopeKey === 'all';
  return {
    scopeKey: input.scopeKey,
    listingType,
    normalizedFilters: isSourceWideScope ? {} : { replayScope: input.scopeKey },
    sourceRunId: input.sourceRunId,
    sourceRunCompletedAt: input.sourceHighWatermark,
    coverageStatus: input.coverageStatus,
    observedListingCount: input.observedListingCount,
    sourceHighWatermark: input.sourceHighWatermark,
    diagnostics: input.diagnostics ?? (input.reason ? { reason: input.reason } : null),
  };
}

function createReplayIdentityEstimateSets(): ReplayIdentityEstimateSets {
  return {
    presentSourceListingIds: new Set(),
    presentCanonicalUrls: new Set(),
    activeSourceListingIds: new Set(),
    activeCanonicalUrls: new Set(),
    terminalSourceListingIds: new Set(),
    terminalCanonicalUrls: new Set(),
  };
}

function recordReplayIdentityEstimate(sets: ReplayIdentityEstimateSets, listing: IngestListing): void {
  const sourceListingId = listing.sourceListingId || listing.mirrorListingId;
  const canonicalUrl = listing.canonicalUrl ?? listing.sourceUrl;
  if (sourceListingId) sets.presentSourceListingIds.add(sourceListingId);
  if (canonicalUrl) sets.presentCanonicalUrls.add(canonicalUrl);

  if (!listing.diagnosticStatus && listing.lifecycleStatus === 'available') {
    if (sourceListingId) sets.activeSourceListingIds.add(sourceListingId);
    if (canonicalUrl) sets.activeCanonicalUrls.add(canonicalUrl);
  } else if (
    !listing.diagnosticStatus
    && (
      listing.lifecycleStatus === 'sold'
      || listing.lifecycleStatus === 'rented'
      || listing.lifecycleStatus === 'withdrawn'
      || listing.lifecycleStatus === 'not_found'
    )
  ) {
    if (sourceListingId) sets.terminalSourceListingIds.add(sourceListingId);
    if (canonicalUrl) sets.terminalCanonicalUrls.add(canonicalUrl);
  }
}

async function estimateCanonicalIdentityMatches(
  mainDb: postgres.Sql,
  input: {
    source: SourceName;
    scope: string | null;
    sourceListingIds: Set<string>;
    canonicalUrls: Set<string>;
    statusMode: 'active' | 'not_active';
  },
): Promise<number> {
  const sourceListingIds = Array.from(input.sourceListingIds);
  const canonicalUrls = Array.from(input.canonicalUrls);
  if (sourceListingIds.length === 0 && canonicalUrls.length === 0) return 0;
  const scopeValue = normalizeScope(input.scope);
  const rows = await mainDb<[{ count: string }]>`
    SELECT COUNT(DISTINCT id)::text AS count
    FROM canonical_listings
    WHERE source_name = ${input.source}
      AND (
        (${input.statusMode}::text = 'active' AND status = 'active')
        OR (${input.statusMode}::text = 'not_active' AND status <> 'active')
      )
      AND (
        ${scopeValue}::text IS NULL
        OR ${scopeValue}::text IN ('all', 'full-mirror')
        OR price_type = ${scopeValue}::text
      )
      AND (
        primary_source_listing_id = ANY(${sourceListingIds}::text[])
        OR canonical_url = ANY(${canonicalUrls}::text[])
      )
  `;

  return Number(rows[0]?.count ?? 0);
}

async function estimateAbsentActiveCanonicalCount(
  mainDb: postgres.Sql,
  source: SourceName,
  scope: string | null,
  sets: ReplayIdentityEstimateSets,
): Promise<number> {
  const sourceListingIds = Array.from(sets.presentSourceListingIds);
  const canonicalUrls = Array.from(sets.presentCanonicalUrls);
  const scopeValue = normalizeScope(scope);
  const rows = await mainDb<[{ count: string }]>`
    SELECT COUNT(*)::text AS count
    FROM canonical_listings
    WHERE source_name = ${source}
      AND status = 'active'
      AND (
        ${scopeValue}::text IS NULL
        OR ${scopeValue}::text IN ('all', 'full-mirror')
        OR price_type = ${scopeValue}::text
      )
      AND NOT (
        COALESCE(primary_source_listing_id, '') = ANY(${sourceListingIds}::text[])
        OR COALESCE(canonical_url, '') = ANY(${canonicalUrls}::text[])
      )
  `;

  return Number(rows[0]?.count ?? 0);
}

async function planSource(
  source: SourceName,
  mirrorDb: postgres.Sql,
  mainDb: postgres.Sql,
  options: CliOptions,
): Promise<SourceSummary> {
  const scopeKey = options.scope?.trim().toLowerCase() || 'full-mirror';
  const watermark = await getIngestWatermark(source);
  const mirrorState = await getMirrorSnapshot(mirrorDb, source, options.scope);
  const sourceRunId = [
    'seed-listings',
    source,
    scopeKey,
    mirrorState.highWatermark,
    mirrorState.count,
    options.repair ? 'repair' : 'replay',
  ].join(':');
  const estimateSets = createReplayIdentityEstimateSets();

  const summary: SourceSummary = {
    sourceName: source,
    scopeKey,
    scopeMode: options.scope ? 'scoped' : 'whole_mirror',
    dryRun: options.dryRun,
    repairMode: options.repair,
    replayReason: options.reason,
    mirrorSnapshotId: mirrorState.snapshotId,
    sourceRunId,
    sourceHighWatermark: mirrorState.highWatermark,
    oldestSourceTimestamp: mirrorState.oldestTimestamp,
    newestSourceTimestamp: mirrorState.highWatermark,
    existingCursor: watermark.cursor,
    mirrorListingCount: mirrorState.count,
    fullMirrorListingCount: mirrorState.fullCount,
    excludedMirrorListingCount: mirrorState.excludedCount,
    preparedListingCount: 0,
    skippedBeforeIngestCount: 0,
    diagnosticListingCount: 0,
    transitionCounts: {
      projectable: 0,
      diagnostic: 0,
      skipped: 0,
      completion: 1,
      staleObservations: 0,
      reactivationCandidates: 0,
      duplicateCanonicalCandidates: 0,
      terminalLifecycleChanges: 0,
      absenceWithoutCompletion: 0,
      readModelRefreshes: 0,
    },
    affectedCanonicalCount: await estimateAffectedCanonicalCount(mainDb, source, options.scope),
    staleObservationCount: 0,
    reactivationCandidateCount: 0,
    duplicateCanonicalCandidateCount: await estimateDuplicateCanonicalCandidateCount(mainDb, source, options.scope),
    terminalLifecycleChangeCount: 0,
    absenceWithoutCompletionCount: 0,
    readModelRefreshCount: 0,
    batchCount: 0,
    processedBatchCount: 0,
    ingestedCount: 0,
    updatedCount: 0,
    skippedByProcessorCount: 0,
    staleForProjection: false,
    thresholds: {
      maxSkipped: options.maxSkipped,
      maxSkipRatio: options.maxSkipRatio,
      maxAffectedCanonical: options.maxAffectedCanonical,
      maxStaleRows: options.maxStaleRows,
      skipRatio: 0,
      violations: [],
    },
    executionAssessment: {
      executeAllowed: false,
      repairExecuteAllowed: false,
      abortReasons: [],
    },
    limitations: [
      'Dry-run counts are based on mirror snapshots and canonical summaries; exact canonical diffs are computed only by ingest execution.',
      'Scoped replay excludes mirror rows outside the selected price-type scope.',
      'Absence projection requires a completion batch; this replay plans one final scoped completion.',
    ],
    excludedMirrorRange: options.scope
      ? {
          reason: `--scope ${scopeKey} excludes mirror rows whose normalized price type is outside this scope`,
          excludedListingCount: mirrorState.excludedCount,
        }
      : null,
    examples: {
      skippedBeforeIngest: [],
      diagnosticListings: [],
      projectableListings: [],
      staleRows: [],
    },
  };

  for (let offset = 0; offset < mirrorState.count; offset += options.fetchSize) {
    const rows = await fetchMirrorListings(mirrorDb, source, options.scope, options.fetchSize, offset);
    for (const row of rows) {
      const listing = toIngestListing(row, source, scopeKey, summary.sourceHighWatermark);
      if (!listing) {
        summary.skippedBeforeIngestCount += 1;
        summary.transitionCounts.skipped += 1;
        if (summary.examples.skippedBeforeIngest.length < 5) {
          summary.examples.skippedBeforeIngest.push({
            id: row.id,
            listingUrl: row.listing_url,
            postalCode: row.postal_code,
            houseNumber: row.house_number,
            street: row.street,
          });
        }
        continue;
      }

      if (listing.diagnosticStatus) {
        summary.diagnosticListingCount += 1;
        summary.transitionCounts.diagnostic += 1;
        if (summary.examples.diagnosticListings.length < 5) {
          summary.examples.diagnosticListings.push({
            mirrorListingId: listing.mirrorListingId,
            sourceUrl: listing.sourceUrl,
            diagnosticStatus: listing.diagnosticStatus,
          });
        }
      } else {
        summary.transitionCounts.projectable += 1;
        if (summary.examples.projectableListings.length < 5) {
          summary.examples.projectableListings.push({
            mirrorListingId: listing.mirrorListingId,
            sourceUrl: listing.sourceUrl,
            priceType: listing.priceType,
          });
        }
      }

      summary.preparedListingCount += 1;
      recordReplayIdentityEstimate(estimateSets, listing);
    }
  }

  summary.staleForProjection = Boolean(
    watermark.lastCommittedChangedAt
      && new Date(watermark.lastCommittedChangedAt).getTime() > new Date(summary.sourceHighWatermark).getTime(),
  );
  summary.transitionCounts.staleObservations = summary.staleForProjection ? summary.preparedListingCount : 0;
  summary.staleObservationCount = summary.transitionCounts.staleObservations;
  summary.reactivationCandidateCount = await estimateCanonicalIdentityMatches(mainDb, {
    source,
    scope: options.scope,
    sourceListingIds: estimateSets.activeSourceListingIds,
    canonicalUrls: estimateSets.activeCanonicalUrls,
    statusMode: 'not_active',
  });
  summary.terminalLifecycleChangeCount = await estimateCanonicalIdentityMatches(mainDb, {
    source,
    scope: options.scope,
    sourceListingIds: estimateSets.terminalSourceListingIds,
    canonicalUrls: estimateSets.terminalCanonicalUrls,
    statusMode: 'active',
  });
  summary.absenceWithoutCompletionCount = summary.skippedBeforeIngestCount > 0
    ? await estimateAbsentActiveCanonicalCount(mainDb, source, options.scope, estimateSets)
    : 0;
  summary.transitionCounts.reactivationCandidates = summary.reactivationCandidateCount;
  summary.transitionCounts.duplicateCanonicalCandidates = summary.duplicateCanonicalCandidateCount;
  summary.transitionCounts.terminalLifecycleChanges = summary.terminalLifecycleChangeCount;
  summary.transitionCounts.absenceWithoutCompletion = summary.absenceWithoutCompletionCount;
  summary.transitionCounts.readModelRefreshes = summary.preparedListingCount > 0 ? 1 : 0;
  summary.readModelRefreshCount = summary.transitionCounts.readModelRefreshes;
  if (summary.staleForProjection && summary.examples.staleRows.length < 5) {
    summary.examples.staleRows.push({
      sourceHighWatermark: summary.sourceHighWatermark,
      lastCommittedChangedAt: watermark.lastCommittedChangedAt,
      plannedStaleObservationCount: summary.transitionCounts.staleObservations,
    });
  }
  summary.thresholds = buildListingReplayThresholds(summary, options);
  summary.executionAssessment = buildListingReplayExecutionAssessment(
    summary,
    summary.thresholds.violations,
  );
  summary.batchCount = computePlannedListingReplayBatchCount(summary, options);

  return summary;
}

async function executeSource(
  source: SourceName,
  mirrorDb: postgres.Sql,
  options: CliOptions,
  summary: SourceSummary,
): Promise<SourceSummary> {
  const mirrorState = await getMirrorSnapshot(mirrorDb, source, options.scope);
  if (
    mirrorState.count !== summary.mirrorListingCount
    || mirrorState.highWatermark !== summary.sourceHighWatermark
  ) {
    throw new Error(
      `Mirror changed after safety plan for ${source}; rerun db:seed-listings to recompute thresholds`,
    );
  }

  const resultSummary: SourceSummary = {
    ...summary,
    batchCount: 0,
    processedBatchCount: 0,
    ingestedCount: 0,
    updatedCount: 0,
    skippedByProcessorCount: 0,
  };

  const listingsBuffer: IngestListing[] = [];
  let cursorStart = summary.existingCursor;
  let batchSequence = 0;
  let executedPreparedListingCount = 0;

  async function flushBatch(finalBatch: boolean): Promise<void> {
    if (listingsBuffer.length === 0 && !finalBatch) return;

    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: summary.sourceHighWatermark,
      listingKey: `${source}:${summary.scopeKey}:${batchSequence}:${executedPreparedListingCount}`,
    });
    const completions = finalBatch
      ? [buildCompletion({
          source,
          scopeKey: summary.scopeKey,
          sourceRunId: summary.sourceRunId,
          sourceHighWatermark: summary.sourceHighWatermark,
          observedListingCount: summary.preparedListingCount,
          coverageStatus: summary.skippedBeforeIngestCount > 0 ? 'partial' : 'complete',
          reason: options.reason,
          diagnostics: {
            reason: options.reason,
            transitionCounts: summary.transitionCounts,
            skippedBeforeIngestCount: summary.skippedBeforeIngestCount,
            diagnosticListingCount: summary.diagnosticListingCount,
          },
        })]
      : [];
    const payload = {
      sourceName: source,
      idempotencyKey: `${summary.sourceRunId}:batch:${batchSequence}`,
      batchSequence,
      cursorStart,
      cursorEnd,
      upstreamRunKey: summary.sourceRunId,
      batchKind: finalBatch
        ? (listingsBuffer.length > 0 ? 'observations_and_completion' : 'completion')
        : 'observations',
      scopeKey: summary.scopeKey,
      sourceHighWatermark: summary.sourceHighWatermark,
      sourceProvenance: 'import',
      repairMode: options.repair,
      repairReason: options.reason ?? undefined,
      listings: listingsBuffer.splice(0, listingsBuffer.length),
      completions,
    } as const;

    resultSummary.batchCount += 1;

    const normalizedPayload = JSON.parse(JSON.stringify(payload)) as typeof payload;
    const accepted = await acceptIngestBatch(normalizedPayload);
    const result = await processIngestBatch({
      batchId: accepted.batchId,
      logger: {
        info: () => {},
        warn: (payload, message) => console.warn(JSON.stringify({ level: 'warn', message, payload })),
        error: (payload, message) => console.error(JSON.stringify({ level: 'error', message, payload })),
        debug: () => {},
      },
      enqueueMaintenanceRefresh: async () => {},
    });

    resultSummary.processedBatchCount += result.status === 'completed' ? 1 : 0;
    resultSummary.ingestedCount += result.ingested;
    resultSummary.updatedCount += result.updated;
    resultSummary.skippedByProcessorCount += result.skipped;
    cursorStart = cursorEnd;
    batchSequence += 1;
  }

  for (let offset = 0; offset < summary.mirrorListingCount; offset += options.fetchSize) {
    const rows = await fetchMirrorListings(mirrorDb, source, options.scope, options.fetchSize, offset);
    for (const row of rows) {
      const listing = toIngestListing(row, source, summary.scopeKey, summary.sourceHighWatermark);
      if (!listing) {
        continue;
      }

      executedPreparedListingCount += 1;
      listingsBuffer.push(listing);
      if (listingsBuffer.length >= options.batchSize) {
        await flushBatch(false);
      }
    }
  }

  if (executedPreparedListingCount !== summary.preparedListingCount) {
    throw new Error(
      `Prepared listing count changed during replay for ${source}; expected ${summary.preparedListingCount}, got ${executedPreparedListingCount}`,
    );
  }

  await flushBatch(true);
  const refreshedBatchCount = await refreshLatestListingsMaintenance([
    refreshLatestListingsView,
    refreshPriceGuessStartMarketSummaries,
  ], {
    skippedBatchRecoveryLimit: 100,
  });
  resultSummary.readModelRefreshCount = refreshedBatchCount;
  resultSummary.transitionCounts = {
    ...resultSummary.transitionCounts,
    readModelRefreshes: refreshedBatchCount,
  };
  return resultSummary;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const mirrorDbs: Record<SourceName, postgres.Sql> = {
    funda: postgres(FUNDA_DB_URL, { max: 3, onnotice: () => {} }),
    pararius: postgres(PARARIUS_DB_URL, { max: 3, onnotice: () => {} }),
  };
  const mainDb = postgres(MAIN_DB_URL, { max: 1, onnotice: () => {} });
  const summaries: SourceSummary[] = [];

  try {
    await mainDb`SELECT 1`;
    const sources = selectedSources(options.source);
    for (const source of sources) {
      summaries.push(await planSource(source, mirrorDbs[source], mainDb, options));
    }

    const violations = collectListingReplayThresholdViolations(summaries);
    const abortReasons = summaries.flatMap((summary) =>
      summary.executionAssessment.abortReasons.map((reason) => `${summary.sourceName}:${reason}`)
    );
    const executeBlocked = options.repair
      ? summaries.some((summary) => !summary.executionAssessment.repairExecuteAllowed)
      : summaries.some((summary) => !summary.executionAssessment.executeAllowed);
    if (!options.dryRun && (violations.length > 0 || executeBlocked)) {
      console.log(JSON.stringify({
        dryRun: options.dryRun,
        source: options.source,
        scope: options.scope,
        repair: options.repair,
        summaries,
      }, null, 2));
      throw new Error(`Replay safety violation: ${abortReasons.join(', ')}`);
    }

    if (!options.dryRun) {
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        const summary = summaries[index];
        if (!source || !summary) continue;
        summaries[index] = await executeSource(source, mirrorDbs[source], options, summary);
      }
    }
  } finally {
    await Promise.all([mainDb.end(), mirrorDbs.funda.end(), mirrorDbs.pararius.end(), closeConnection()]);
  }

  console.log(JSON.stringify({
    dryRun: options.dryRun,
    source: options.source,
    scope: options.scope,
    repair: options.repair,
    summaries,
  }, null, 2));
}

const directRunUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === directRunUrl) {
  main().catch((error) => {
    console.error(JSON.stringify({
      error: 'SEED_LISTINGS_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  });
}

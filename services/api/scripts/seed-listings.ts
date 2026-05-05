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
import type { IngestListing } from '../src/services/ingest/contracts.js';
import {
  acceptIngestBatch,
  encodeOpaqueIngestCursor,
  getIngestWatermark,
  processIngestBatch,
} from '../src/services/ingest/index.js';
import { closeConnection } from '../src/db/index.js';
import type { ListingSourceAlias } from '../src/services/listing-source-resolution.js';

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
  dryRun: boolean;
  repairMode: boolean;
  sourceRunId: string;
  sourceHighWatermark: string;
  existingCursor: string | null;
  mirrorListingCount: number;
  preparedListingCount: number;
  skippedBeforeIngestCount: number;
  diagnosticListingCount: number;
  batchCount: number;
  processedBatchCount: number;
  ingestedCount: number;
  updatedCount: number;
  skippedByProcessorCount: number;
  staleForProjection: boolean;
  thresholds: {
    maxSkipped: number;
    maxSkipRatio: number;
    skipRatio: number;
    violations: string[];
  };
  examples: {
    skippedBeforeIngest: Array<Record<string, unknown>>;
    diagnosticListings: Array<Record<string, unknown>>;
  };
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

function toIngestListing(row: MirrorListing, source: SourceName, scopeKey: string, sourceHighWatermark: string): IngestListing | null {
  if (!row.listing_url || !row.postal_code || !row.house_number || !row.street) {
    return null;
  }

  const mirrorId = source === 'funda' ? row.funda_id : row.pararius_id;
  const identity = resolveIdentity(source, row.listing_url, mirrorId);
  const status = mapStatus(row.status);
  const priceType = normalizePriceType(row.price_type, source);

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
    lifecycleStatus: status.lifecycleStatus,
    diagnosticStatus: status.diagnosticStatus,
    mirrorFirstSeenAt: row.first_seen_at?.toISOString(),
    mirrorLastChangedAt: row.last_changed_at?.toISOString(),
    mirrorLastSeenAt: row.last_seen_at?.toISOString(),
    observedAt: (row.last_changed_at ?? row.last_seen_at ?? row.first_seen_at ?? new Date()).toISOString(),
    sourceHighWatermark,
    address: {
      countryCode: 'NL',
      street: row.street,
      postalCode: row.postal_code,
      houseNumber: row.house_number,
      houseNumberAddition: row.house_number_addition,
      city: row.city ?? '',
      latitude: row.latitude,
      longitude: row.longitude,
    },
  };
}

function buildThresholds(summary: Pick<SourceSummary, 'mirrorListingCount' | 'skippedBeforeIngestCount'>, options: CliOptions) {
  const skipRatio = summary.mirrorListingCount === 0
    ? 0
    : summary.skippedBeforeIngestCount / summary.mirrorListingCount;
  const violations: string[] = [];
  if (summary.skippedBeforeIngestCount > options.maxSkipped) {
    violations.push('max_skipped');
  }
  if (skipRatio > options.maxSkipRatio) {
    violations.push('max_skip_ratio');
  }

  return {
    maxSkipped: options.maxSkipped,
    maxSkipRatio: options.maxSkipRatio,
    skipRatio,
    violations,
  };
}

async function getMirrorHighWatermark(mirrorDb: postgres.Sql, source: SourceName, scope: string | null): Promise<{ count: number; highWatermark: string }> {
  const scopeValue = normalizeScope(scope);
  const rows = await mirrorDb<[{ count: string; high_watermark: Date | null }]>`
    SELECT
      COUNT(*)::text AS count,
      MAX(COALESCE(l.last_changed_at, l.last_seen_at, l.first_seen_at)) AS high_watermark
    FROM listings l
    JOIN addresses a ON l.address_id = a.id
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
  `;

  return {
    count: Number(rows[0]?.count ?? 0),
    highWatermark: (rows[0]?.high_watermark ?? new Date()).toISOString(),
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
    JOIN addresses a ON l.address_id = a.id
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
    ORDER BY l.id
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return rows;
}

function buildCompletion(input: {
  source: SourceName;
  scopeKey: string;
  sourceRunId: string;
  sourceHighWatermark: string;
  observedListingCount: number;
  reason: string | null;
}) {
  const listingType: 'sale' | 'rent' | 'unknown' =
    input.scopeKey === 'sale' || input.scopeKey === 'rent' ? input.scopeKey : 'unknown';
  return {
    scopeKey: input.scopeKey,
    listingType,
    normalizedFilters: { replayScope: input.scopeKey },
    sourceRunId: input.sourceRunId,
    sourceRunCompletedAt: input.sourceHighWatermark,
    coverageStatus: 'complete' as const,
    observedListingCount: input.observedListingCount,
    sourceHighWatermark: input.sourceHighWatermark,
    diagnostics: input.reason ? { reason: input.reason } : null,
  };
}

async function processSource(source: SourceName, mirrorDb: postgres.Sql, options: CliOptions): Promise<SourceSummary> {
  const scopeKey = options.scope?.trim().toLowerCase() || 'full-mirror';
  const watermark = await getIngestWatermark(source);
  const mirrorState = await getMirrorHighWatermark(mirrorDb, source, options.scope);
  const sourceRunId = [
    'seed-listings',
    source,
    scopeKey,
    mirrorState.highWatermark,
    mirrorState.count,
    options.repair ? 'repair' : 'replay',
  ].join(':');

  const summary: SourceSummary = {
    sourceName: source,
    scopeKey,
    dryRun: options.dryRun,
    repairMode: options.repair,
    sourceRunId,
    sourceHighWatermark: mirrorState.highWatermark,
    existingCursor: watermark.cursor,
    mirrorListingCount: mirrorState.count,
    preparedListingCount: 0,
    skippedBeforeIngestCount: 0,
    diagnosticListingCount: 0,
    batchCount: 0,
    processedBatchCount: 0,
    ingestedCount: 0,
    updatedCount: 0,
    skippedByProcessorCount: 0,
    staleForProjection: false,
    thresholds: {
      maxSkipped: options.maxSkipped,
      maxSkipRatio: options.maxSkipRatio,
      skipRatio: 0,
      violations: [],
    },
    examples: {
      skippedBeforeIngest: [],
      diagnosticListings: [],
    },
  };

  const listingsBuffer: IngestListing[] = [];
  let cursorStart = watermark.cursor;
  let batchSequence = 0;

  async function flushBatch(finalBatch: boolean): Promise<void> {
    if (listingsBuffer.length === 0 && !finalBatch) return;

    const cursorEnd = encodeOpaqueIngestCursor({
      changedAt: summary.sourceHighWatermark,
      listingKey: `${source}:${scopeKey}:${batchSequence}:${summary.preparedListingCount}`,
    });
    const completions = finalBatch
      ? [buildCompletion({
          source,
          scopeKey,
          sourceRunId,
          sourceHighWatermark: summary.sourceHighWatermark,
          observedListingCount: summary.preparedListingCount,
          reason: options.reason,
        })]
      : [];
    const payload = {
      sourceName: source,
      idempotencyKey: `${sourceRunId}:batch:${batchSequence}`,
      batchSequence,
      cursorStart,
      cursorEnd,
      upstreamRunKey: sourceRunId,
      batchKind: finalBatch
        ? (listingsBuffer.length > 0 ? 'observations_and_completion' : 'completion')
        : 'observations',
      scopeKey,
      sourceHighWatermark: summary.sourceHighWatermark,
      repairMode: options.repair,
      repairReason: options.reason ?? undefined,
      listings: listingsBuffer.splice(0, listingsBuffer.length),
      completions,
    } as const;

    summary.batchCount += 1;
    if (options.dryRun) {
      cursorStart = cursorEnd;
      batchSequence += 1;
      return;
    }

    const accepted = await acceptIngestBatch(payload);
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

    summary.processedBatchCount += result.status === 'completed' ? 1 : 0;
    summary.ingestedCount += result.ingested;
    summary.updatedCount += result.updated;
    summary.skippedByProcessorCount += result.skipped;
    cursorStart = cursorEnd;
    batchSequence += 1;
  }

  for (let offset = 0; offset < mirrorState.count; offset += options.fetchSize) {
    const rows = await fetchMirrorListings(mirrorDb, source, options.scope, options.fetchSize, offset);
    for (const row of rows) {
      const listing = toIngestListing(row, source, scopeKey, summary.sourceHighWatermark);
      if (!listing) {
        summary.skippedBeforeIngestCount += 1;
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
        if (summary.examples.diagnosticListings.length < 5) {
          summary.examples.diagnosticListings.push({
            mirrorListingId: listing.mirrorListingId,
            sourceUrl: listing.sourceUrl,
            diagnosticStatus: listing.diagnosticStatus,
          });
        }
      }

      summary.preparedListingCount += 1;
      listingsBuffer.push(listing);
      if (listingsBuffer.length >= options.batchSize) {
        await flushBatch(false);
      }
    }
  }

  summary.thresholds = buildThresholds(summary, options);
  if (!options.dryRun && summary.thresholds.violations.length > 0) {
    throw new Error(`Replay threshold violation for ${source}: ${summary.thresholds.violations.join(', ')}`);
  }

  await flushBatch(true);
  summary.staleForProjection = Boolean(
    watermark.lastCommittedChangedAt
      && new Date(watermark.lastCommittedChangedAt).getTime() > new Date(summary.sourceHighWatermark).getTime(),
  );

  return summary;
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
    for (const source of selectedSources(options.source)) {
      summaries.push(await processSource(source, mirrorDbs[source], options));
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

main().catch((error) => {
  console.error(JSON.stringify({
    error: 'SEED_LISTINGS_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});

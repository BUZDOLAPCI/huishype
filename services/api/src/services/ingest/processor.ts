import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  type DbTransaction,
  ingestBatches,
  ingestSources,
} from '../../db/index.js';
import type { CountryCode } from '@huishype/shared';
import { canonicalizeAddress, normalizeSourceUrl } from '../../utils/address.js';
import type { IngestBatchRequest, IngestListing } from './contracts.js';
import { ingestBatchRequestSchema } from './contracts.js';
import { decodeOpaqueIngestCursor } from './cursor.js';
import { requestLatestListingsRefresh } from './queue.js';
import type { MaintenanceRefreshJobData } from './jobs.js';
import { finalizeIngestRunLifecycle } from './store.js';

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
  };
}

interface MatchedListing {
  item: IngestListing;
  propertyId: string;
}

interface ListingWriteResult {
  listingId: string;
  propertyId: string;
  mirrorListingId: string;
  inserted: boolean;
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

export interface IngestLogger {
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
}

function normalizeStreetForMatch(street: string): string {
  return street.trim().replace(/\s+/g, ' ').toLowerCase();
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
} {
  const canonicalized: CanonicalizedListing[] = [];
  let skippedCount = 0;

  for (const item of listings) {
    const canonical = canonicalizeAddress({
      countryCode: item.address.countryCode as CountryCode,
      street: item.address.street,
      postalCode: item.address.postalCode,
      houseNumber: item.address.houseNumber,
      houseNumberAddition: item.address.houseNumberAddition ?? null,
      city: item.address.city,
    });

    if (!canonical || canonical.street.length === 0) {
      skippedCount += 1;
      continue;
    }

    canonicalized.push({
      item,
      canonical: {
        countryCode: item.address.countryCode,
        street: canonical.street,
        streetNorm: normalizeStreetForMatch(canonical.street),
        postalCode: canonical.postalCode,
        houseNumber: canonical.houseNumber,
        houseNumberAddition: canonical.houseNumberAddition,
        city: canonical.city,
      },
    });
  }

  return { canonicalized, skippedCount };
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
        LOWER(REGEXP_REPLACE(BTRIM(p.street), '\s+', ' ', 'g')) AS street_norm,
        p.postal_code,
        p.house_number,
        p.house_number_addition
      FROM properties p
      JOIN (
        VALUES ${sql.join(valueFragments, sql`, `)}
      ) AS v(country_code, street_norm, postal_code, house_number, addition)
        ON p.country_code = v.country_code
       AND LOWER(REGEXP_REPLACE(BTRIM(p.street), '\s+', ' ', 'g')) = v.street_norm
       AND p.postal_code = v.postal_code
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
  exactMatches: Map<string, string>,
): Promise<void> {
  const candidates = canonicalized
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const key = buildAddressMatchKey(
        entry.canonical.countryCode,
        entry.canonical.streetNorm,
        entry.canonical.postalCode,
        entry.canonical.houseNumber,
        entry.canonical.houseNumberAddition,
      );
      return !exactMatches.has(key) && entry.item.address.latitude != null && entry.item.address.longitude != null;
    });

  const chunkSize = 5_000;

  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    const valueFragments = chunk.map(({ entry, index }) => sql`(
      ${index}::int,
      ${entry.canonical.countryCode}::text,
      ${entry.item.address.longitude!}::float8,
      ${entry.item.address.latitude!}::float8
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

      const key = buildAddressMatchKey(
        candidate.entry.canonical.countryCode,
        candidate.entry.canonical.streetNorm,
        candidate.entry.canonical.postalCode,
        candidate.entry.canonical.houseNumber,
        candidate.entry.canonical.houseNumberAddition,
      );
      exactMatches.set(key, row.id);
    }
  }
}

function dedupeMatchedListings(
  canonicalized: CanonicalizedListing[],
  propertyIdByAddress: Map<string, string>,
): { matched: MatchedListing[]; skippedCount: number } {
  const deduped = new Map<string, MatchedListing>();
  let skippedCount = 0;

  for (const entry of canonicalized) {
    const key = buildAddressMatchKey(
      entry.canonical.countryCode,
      entry.canonical.streetNorm,
      entry.canonical.postalCode,
      entry.canonical.houseNumber,
      entry.canonical.houseNumberAddition,
    );

    const propertyId = propertyIdByAddress.get(key);
    if (!propertyId) {
      skippedCount += 1;
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
  };
}

async function upsertMatchedListings(
  tx: DbTransaction,
  sourceName: string,
  matched: MatchedListing[],
): Promise<ListingWriteResult[]> {
  const results: ListingWriteResult[] = [];
  const chunkSize = 500;

  for (let offset = 0; offset < matched.length; offset += chunkSize) {
    const chunk = matched.slice(offset, offset + chunkSize);
    const valueFragments = chunk.map(({ propertyId, item }) => sql`(
      ${propertyId}::uuid,
      ${normalizeSourceUrl(item.sourceUrl)},
      ${sourceName},
      ${item.mirrorListingId},
      ${item.askingPrice}::bigint,
      ${item.priceType},
      ${item.livingAreaM2 ?? null}::int,
      ${item.numRooms ?? null}::int,
      ${item.energyLabel ?? null},
      ${item.thumbnailUrl ?? null},
      ${item.ogTitle ?? null},
      ${item.status}::listing_status,
      ${item.mirrorFirstSeenAt ?? null}::timestamptz,
      ${item.mirrorLastChangedAt ?? null}::timestamptz,
      ${item.mirrorLastSeenAt ?? null}::timestamptz,
      NOW()
    )`);

    const rows = await tx.execute<{
      id: string;
      property_id: string;
      mirror_listing_id: string;
      inserted: boolean;
    }>(sql`
      INSERT INTO listings (
        property_id,
        source_url,
        source_name,
        mirror_listing_id,
        asking_price,
        price_type,
        living_area_m2,
        num_rooms,
        energy_label,
        thumbnail_url,
        og_title,
        status,
        mirror_first_seen_at,
        mirror_last_changed_at,
        mirror_last_seen_at,
        updated_at
      )
      VALUES ${sql.join(valueFragments, sql`, `)}
      ON CONFLICT (source_name, mirror_listing_id) WHERE mirror_listing_id IS NOT NULL
      DO UPDATE SET
        property_id = EXCLUDED.property_id,
        asking_price = EXCLUDED.asking_price,
        price_type = EXCLUDED.price_type,
        living_area_m2 = EXCLUDED.living_area_m2,
        num_rooms = EXCLUDED.num_rooms,
        energy_label = EXCLUDED.energy_label,
        thumbnail_url = EXCLUDED.thumbnail_url,
        og_title = EXCLUDED.og_title,
        status = EXCLUDED.status,
        source_url = EXCLUDED.source_url,
        mirror_first_seen_at = COALESCE(listings.mirror_first_seen_at, EXCLUDED.mirror_first_seen_at),
        mirror_last_changed_at = EXCLUDED.mirror_last_changed_at,
        mirror_last_seen_at = EXCLUDED.mirror_last_seen_at,
        updated_at = NOW()
      RETURNING
        id,
        property_id,
        mirror_listing_id,
        xmax = 0 AS inserted
    `);

    for (const row of rows) {
      results.push({
        listingId: row.id,
        propertyId: row.property_id,
        mirrorListingId: row.mirror_listing_id,
        inserted: row.inserted,
      });
    }
  }

  return results;
}

async function insertPriceHistory(
  tx: DbTransaction,
  sourceName: string,
  matched: MatchedListing[],
  listingWrites: ListingWriteResult[],
): Promise<void> {
  const listingByMirrorId = new Map<string, ListingWriteResult>();
  for (const write of listingWrites) {
    listingByMirrorId.set(write.mirrorListingId, write);
  }

  const values: Array<{
    propertyId: string;
    listingId: string;
    price: number;
    priceDate: string;
    eventType: string;
  }> = [];

  for (const matchedListing of matched) {
    const listingWrite = listingByMirrorId.get(matchedListing.item.mirrorListingId);
    if (!listingWrite || !matchedListing.item.priceHistory) {
      continue;
    }

    for (const priceEntry of matchedListing.item.priceHistory) {
      values.push({
        propertyId: listingWrite.propertyId,
        listingId: listingWrite.listingId,
        price: priceEntry.price,
        priceDate: priceEntry.priceDate,
        eventType: priceEntry.eventType,
      });
    }
  }

  const chunkSize = 5_000;
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    const valueFragments = chunk.map((entry) => sql`(
      ${entry.propertyId}::uuid,
      ${entry.listingId}::uuid,
      ${entry.price}::bigint,
      ${entry.priceDate},
      ${entry.eventType},
      ${sourceName}
    )`);

    await tx.execute(sql`
      INSERT INTO price_history (
        property_id,
        listing_id,
        price,
        price_date,
        event_type,
        source
      )
      VALUES ${sql.join(valueFragments, sql`, `)}
      ON CONFLICT (property_id, price_date, price, event_type) DO NOTHING
    `);
  }
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

      const { canonicalized, skippedCount: canonicalizationSkips } = canonicalizeListings(claimed.payload.listings);
      const exactMatches = await exactMatchProperties(tx, canonicalized);
      await spatialMatchProperties(tx, canonicalized, exactMatches);

      const { matched, skippedCount: unmatchedSkips } = dedupeMatchedListings(canonicalized, exactMatches);
      const listingWrites = await upsertMatchedListings(tx, claimed.sourceName, matched);
      await insertPriceHistory(tx, claimed.sourceName, matched, listingWrites);

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
  refreshView: () => Promise<void>,
  options: RefreshMaintenanceOptions = {},
): Promise<number> {
  const logger = options.logger ?? defaultLogger();
  const refreshStartedAt = new Date();
  const pendingRows = await db
    .select({ id: ingestBatches.id })
    .from(ingestBatches)
    .where(
      sql`${ingestBatches.maintenanceRequestedAt} IS NOT NULL
        AND ${ingestBatches.maintenanceCompletedAt} IS NULL
        AND ${ingestBatches.maintenanceRequestedAt} <= ${refreshStartedAt.toISOString()}`,
    );

  try {
    await refreshView();
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Maintenance refresh failed');
    throw error;
  }

  if (pendingRows.length === 0) {
    return 0;
  }

  await db
    .update(ingestBatches)
    .set({ maintenanceCompletedAt: new Date() })
    .where(inArray(ingestBatches.id, pendingRows.map((row) => row.id)));

  return pendingRows.length;
}

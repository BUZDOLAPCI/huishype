import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties, listings, priceHistory } from '../db/index.js';
import { eq, sql, desc } from 'drizzle-orm';
import { canonicalizeAddress, normalizeSourceUrl } from '../utils/address.js';
import { fetchOgMetadata } from '../services/og-fetcher.js';
import { checkAddressMatch } from '../services/address-matcher.js';
import rateLimit from '@fastify/rate-limit';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const propertyParamsSchema = z.object({
  id: z.string().uuid(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// ---------------------------------------------------------------------------
// 1. GET /properties/:id/listings
// ---------------------------------------------------------------------------

const listingResponseSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string(),
  sourceName: z.enum(['funda', 'pararius', 'other']),
  askingPrice: z.number().nullable(),
  priceType: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  ogTitle: z.string().nullable(),
  livingAreaM2: z.number().nullable(),
  numRooms: z.number().nullable(),
  energyLabel: z.string().nullable(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']),
  createdAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// 2. GET /properties/:id/price-history
// ---------------------------------------------------------------------------

const priceHistoryResponseSchema = z.object({
  price: z.number(),
  priceDate: z.string(),
  eventType: z.string(),
  source: z.string(),
});

// ---------------------------------------------------------------------------
// 3. POST /listings/preview
// ---------------------------------------------------------------------------

const previewRequestSchema = z.object({
  url: z.string().url(),
  propertyId: z.string().uuid(),
});

const previewResponseSchema = z.object({
  ogTitle: z.string().nullable(),
  ogImage: z.string().nullable(),
  ogDescription: z.string().nullable(),
  sourceName: z.enum(['funda', 'pararius', 'other']),
  addressMatch: z.boolean(),
  warning: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// 4. POST /listings/submit
// ---------------------------------------------------------------------------

const submitRequestSchema = z.object({
  url: z.string().url(),
  propertyId: z.string().uuid(),
  ogTitle: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

const submitResponseSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  sourceUrl: z.string(),
  sourceName: z.enum(['funda', 'pararius', 'other']),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']),
  createdAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// 5. POST /api/ingest/listings
// ---------------------------------------------------------------------------

const ingestListingSchema = z.object({
  sourceUrl: z.string().url(),
  sourceName: z.enum(['funda', 'pararius']),
  mirrorListingId: z.string(),
  askingPrice: z.number().nullable(),
  priceType: z.enum(['sale', 'rent']),
  livingAreaM2: z.number().nullable().optional(),
  numRooms: z.number().nullable().optional(),
  energyLabel: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']).default('active'),
  mirrorFirstSeenAt: z.string().datetime().optional(),
  mirrorLastChangedAt: z.string().datetime().optional(),
  mirrorLastSeenAt: z.string().datetime().optional(),
  address: z.object({
    postalCode: z.string(),
    houseNumber: z.union([z.string(), z.number()]),
    houseNumberAddition: z.string().nullable().optional(),
    city: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  }),
  priceHistory: z.array(z.object({
    price: z.number(),
    priceDate: z.string(),
    eventType: z.string(),
  })).optional(),
});

const ingestRequestSchema = z.object({
  listings: z.array(ingestListingSchema),
});

const ingestResponseSchema = z.object({
  ingested: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({
    sourceUrl: z.string(),
    message: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// 6. GET /api/ingest/watermark
// ---------------------------------------------------------------------------

const watermarkQuerySchema = z.object({
  source: z.enum(['funda', 'pararius']),
});

const watermarkResponseSchema = z.object({
  lastChangedAt: z.string().datetime().nullable(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect listing source from a URL domain.
 */
function detectSourceName(url: string): 'funda' | 'pararius' | 'other' {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('funda.nl')) return 'funda';
    if (hostname.includes('pararius.nl') || hostname.includes('pararius.com')) return 'pararius';
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Validate API key from request header against env var.
 */
function isValidApiKey(apiKey: string | undefined): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return false;
  return apiKey === expected;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function listingRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Register rate limiting plugin (scoped to this route plugin)
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    // Only apply to specific routes via route-level config
    global: false,
  });

  // =========================================================================
  // 1. GET /properties/:id/listings
  // =========================================================================
  typedApp.get(
    '/properties/:id/listings',
    {
      schema: {
        tags: ['listings'],
        summary: 'Get listings for a property',
        description: 'Returns all listings for a property, ordered by creation date descending',
        params: propertyParamsSchema,
        response: {
          200: z.object({ data: z.array(listingResponseSchema) }),
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;

      // Check property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const results = await db
        .select()
        .from(listings)
        .where(eq(listings.propertyId, propertyId))
        .orderBy(desc(listings.createdAt));

      return reply.send({
        data: results.map((l) => ({
          id: l.id,
          sourceUrl: l.sourceUrl,
          sourceName: l.sourceName,
          askingPrice: l.askingPrice != null ? Number(l.askingPrice) : null,
          priceType: l.priceType,
          thumbnailUrl: l.thumbnailUrl,
          ogTitle: l.ogTitle,
          livingAreaM2: l.livingAreaM2,
          numRooms: l.numRooms,
          energyLabel: l.energyLabel,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        })),
      });
    },
  );

  // =========================================================================
  // 2. GET /properties/:id/price-history
  // =========================================================================
  typedApp.get(
    '/properties/:id/price-history',
    {
      schema: {
        tags: ['listings'],
        summary: 'Get price history for a property',
        description: 'Returns all price history events for a property, ordered by date descending',
        params: propertyParamsSchema,
        response: {
          200: z.array(priceHistoryResponseSchema),
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;

      // Check property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const results = await db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.propertyId, propertyId))
        .orderBy(desc(priceHistory.priceDate));

      return reply.send(
        results.map((ph) => ({
          price: Number(ph.price),
          priceDate: ph.priceDate,
          eventType: ph.eventType,
          source: ph.source,
        })),
      );
    },
  );

  // =========================================================================
  // 3. POST /listings/preview
  // =========================================================================
  typedApp.post(
    '/listings/preview',
    {
      schema: {
        tags: ['listings'],
        summary: 'Preview a listing URL',
        description: 'Fetches OG metadata from a URL and checks if the address matches the property',
        body: previewRequestSchema,
        response: {
          200: previewResponseSchema,
          404: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { url, propertyId } = request.body;

      // Fetch property to get address info
      const propertyResult = await db
        .select()
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyResult.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const property = propertyResult[0];
      const sourceName = detectSourceName(url);

      // Fetch OG metadata from the URL (never throws — returns nulls on failure)
      const ogData = await fetchOgMetadata(url);
      const ogTitle = ogData.ogTitle;
      const ogImage = ogData.ogImage;
      const ogDescription = ogData.ogDescription;

      // Check if the OG title contains the property address
      const matchResult = checkAddressMatch(ogTitle, property);
      const addressMatch = matchResult.match;
      const warning = matchResult.warning;

      return reply.send({
        ogTitle,
        ogImage,
        ogDescription,
        sourceName,
        addressMatch,
        warning,
      });
    },
  );

  // =========================================================================
  // 4. POST /listings/submit
  // =========================================================================
  typedApp.post(
    '/listings/submit',
    {
      schema: {
        tags: ['listings'],
        summary: 'Submit a listing',
        description: 'Creates a listing from a user-submitted URL. Requires authentication.',
        body: submitRequestSchema,
        response: {
          201: submitResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Require authentication
      if (!request.userId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required to submit a listing.',
        });
      }

      const { url, propertyId, ogTitle, thumbnailUrl } = request.body;

      // Check property exists
      const propertyExists = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const normalizedUrl = normalizeSourceUrl(url);
      const sourceName = detectSourceName(url);

      try {
        const result = await db
          .insert(listings)
          .values({
            propertyId,
            sourceUrl: normalizedUrl,
            sourceName,
            ogTitle: ogTitle ?? null,
            thumbnailUrl: thumbnailUrl ?? null,
            submittedBy: request.userId,
            status: 'active',
          })
          .returning();

        const created = result[0];
        return reply.status(201).send({
          id: created.id,
          propertyId: created.propertyId,
          sourceUrl: created.sourceUrl,
          sourceName: created.sourceName,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        });
      } catch (err: unknown) {
        // Handle unique constraint violation on source_url
        const pgError = err as { code?: string };
        if (pgError.code === '23505') {
          return reply.status(409).send({
            error: 'DUPLICATE_LISTING',
            message: 'A listing with this URL already exists.',
          });
        }
        throw err;
      }
    },
  );

  // =========================================================================
  // 5. POST /api/ingest/listings — batch mirror ingestion
  // =========================================================================
  typedApp.post(
    '/api/ingest/listings',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Batch ingest listings from mirror',
        description: 'Internal endpoint for mirror sync workers. Requires API key authentication.',
        body: ingestRequestSchema,
        response: {
          200: ingestResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // API key authentication
      const apiKey = request.headers['x-api-key'] as string | undefined;
      if (!isValidApiKey(apiKey)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key',
        });
      }

      const { listings: incomingListings } = request.body;

      let ingested = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { sourceUrl: string; message: string }[] = [];

      // ---------------------------------------------------------------
      // Phase 1: Canonicalize all addresses
      // ---------------------------------------------------------------
      interface Canonicalized {
        item: typeof incomingListings[number];
        canonical: NonNullable<ReturnType<typeof canonicalizeAddress>>;
        index: number;
      }

      const canonicalized: Canonicalized[] = [];

      for (let i = 0; i < incomingListings.length; i++) {
        const item = incomingListings[i];
        try {
          const canonical = canonicalizeAddress({
            postalCode: item.address.postalCode,
            houseNumber: item.address.houseNumber,
            houseNumberAddition: item.address.houseNumberAddition ?? null,
            city: item.address.city,
          });

          if (canonical === null) {
            errors.push({
              sourceUrl: item.sourceUrl,
              message: 'Address canonicalization failed: invalid address (empty postal code?)',
            });
            skipped++;
            continue;
          }

          canonicalized.push({ item, canonical, index: i });
        } catch (err) {
          errors.push({
            sourceUrl: item.sourceUrl,
            message: err instanceof Error ? err.message : 'Unknown error during canonicalization',
          });
          skipped++;
        }
      }

      if (canonicalized.length === 0) {
        return reply.send({ ingested, updated, skipped, errors });
      }

      // ---------------------------------------------------------------
      // Phase 2: Batch exact address match
      // ---------------------------------------------------------------
      // Build a single query matching ALL listings against properties
      // using (postal_code, house_number, house_number_addition).
      //
      // We generate a VALUES list as parameterized SQL fragments and
      // JOIN against properties.
      // ---------------------------------------------------------------

      // Map from "postalCode|houseNumber|addition" -> property UUID
      const propertyIdMap = new Map<string, string>();

      function buildMatchKey(postalCode: string, houseNumber: number, addition: string | null): string {
        return `${postalCode}|${houseNumber}|${addition ?? ''}`;
      }

      // Deduplicate addresses before querying (many listings may share the same address)
      const uniqueAddresses = new Map<string, { postalCode: string; houseNumber: number; addition: string | null }>();
      for (const c of canonicalized) {
        const key = buildMatchKey(c.canonical.postalCode, c.canonical.houseNumber, c.canonical.houseNumberAddition);
        if (!uniqueAddresses.has(key)) {
          uniqueAddresses.set(key, {
            postalCode: c.canonical.postalCode,
            houseNumber: c.canonical.houseNumber,
            addition: c.canonical.houseNumberAddition,
          });
        }
      }

      // Batch exact match in chunks (3 params per address, limit ~20000 addresses per batch)
      const EXACT_MATCH_CHUNK = 20000;
      const uniqueAddressEntries = Array.from(uniqueAddresses.entries());

      for (let i = 0; i < uniqueAddressEntries.length; i += EXACT_MATCH_CHUNK) {
        const chunk = uniqueAddressEntries.slice(i, i + EXACT_MATCH_CHUNK);

        // Build VALUES clause: ($1::text, $2::int, $3::text), ($4::text, $5::int, $6::text), ...
        const valueFragments = chunk.map(([, addr]) =>
          sql`(${addr.postalCode}::text, ${addr.houseNumber}::int, ${addr.addition ?? ''}::text)`
        );

        const matchRows = await db.execute<{
          id: string;
          postal_code: string;
          house_number: number;
          house_number_addition: string | null;
        }>(sql`
          SELECT p.id, p.postal_code, p.house_number, p.house_number_addition
          FROM properties p
          JOIN (VALUES ${sql.join(valueFragments, sql`, `)})
            AS v(postal_code, house_number, addition)
          ON p.postal_code = v.postal_code
            AND p.house_number = v.house_number
            AND COALESCE(p.house_number_addition, '') = v.addition
        `);

        for (const row of matchRows) {
          const key = buildMatchKey(
            row.postal_code,
            row.house_number,
            row.house_number_addition,
          );
          propertyIdMap.set(key, row.id);
        }
      }

      // ---------------------------------------------------------------
      // Phase 3: Batch spatial fallback for unmatched listings
      // ---------------------------------------------------------------
      // For listings that didn't get an exact match and have lat/lon,
      // do a single spatial query using geometry (NOT ::geography which
      // bypasses the GiST index). Use 0.001 degrees (~100m in NL).
      // ---------------------------------------------------------------

      interface UnmatchedWithCoords {
        canonIndex: number; // index into canonicalized[]
        lon: number;
        lat: number;
      }

      const unmatchedWithCoords: UnmatchedWithCoords[] = [];

      for (let ci = 0; ci < canonicalized.length; ci++) {
        const c = canonicalized[ci];
        const key = buildMatchKey(c.canonical.postalCode, c.canonical.houseNumber, c.canonical.houseNumberAddition);
        if (!propertyIdMap.has(key)) {
          const lat = c.item.address.latitude;
          const lon = c.item.address.longitude;
          if (lat != null && lon != null) {
            unmatchedWithCoords.push({ canonIndex: ci, lon, lat });
          }
        }
      }

      if (unmatchedWithCoords.length > 0) {
        // Batch spatial query in chunks (3 params per coord: idx, lon, lat)
        const SPATIAL_CHUNK = 20000;
        for (let i = 0; i < unmatchedWithCoords.length; i += SPATIAL_CHUNK) {
          const chunk = unmatchedWithCoords.slice(i, i + SPATIAL_CHUNK);

          // Build CTE VALUES: (idx, lon::float, lat::float)
          const coordFragments = chunk.map((u, j) =>
            sql`(${i + j}::int, ${u.lon}::float, ${u.lat}::float)`
          );

          const spatialRows = await db.execute<{ idx: number; id: string }>(sql`
            WITH coords AS (
              SELECT * FROM (VALUES ${sql.join(coordFragments, sql`, `)}) AS t(idx, lon, lat)
            )
            SELECT DISTINCT ON (c.idx) c.idx, p.id
            FROM coords c
            JOIN properties p ON ST_DWithin(
              p.geometry,
              ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326),
              0.001
            )
            ORDER BY c.idx, ST_Distance(p.geometry, ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326))
          `);

          for (const row of spatialRows) {
            const localIdx = row.idx - i; // offset back to chunk-relative
            const u = chunk[localIdx];
            const c = canonicalized[u.canonIndex];
            const key = buildMatchKey(c.canonical.postalCode, c.canonical.houseNumber, c.canonical.houseNumberAddition);
            propertyIdMap.set(key, row.id);
          }
        }
      }

      // ---------------------------------------------------------------
      // Phase 4: Batch upsert matched listings
      // ---------------------------------------------------------------
      // Build a single INSERT ... ON CONFLICT for all matched listings.
      // Use the xmax trick to distinguish inserts from updates.
      // ---------------------------------------------------------------

      interface MatchedListing {
        propertyId: string;
        item: typeof incomingListings[number];
      }

      const matched: MatchedListing[] = [];

      for (const c of canonicalized) {
        const key = buildMatchKey(c.canonical.postalCode, c.canonical.houseNumber, c.canonical.houseNumberAddition);
        const propertyId = propertyIdMap.get(key);
        if (propertyId) {
          matched.push({ propertyId, item: c.item });
        } else {
          skipped++;
        }
      }

      // Batch upsert in chunks to stay within PG parameter limit
      // 16 columns per row * 500 = 8000 params (safe under 65534)
      const UPSERT_CHUNK = 500;

      for (let i = 0; i < matched.length; i += UPSERT_CHUNK) {
        const chunk = matched.slice(i, i + UPSERT_CHUNK);

        try {
          const valueFragments = chunk.map(({ propertyId, item }) =>
            sql`(
              ${propertyId}::uuid,
              ${normalizeSourceUrl(item.sourceUrl)},
              ${item.sourceName}::listing_source,
              ${item.mirrorListingId},
              ${item.askingPrice}::bigint,
              ${item.priceType},
              ${item.livingAreaM2 ?? null}::int,
              ${item.numRooms ?? null}::int,
              ${item.energyLabel ?? null},
              ${item.thumbnailUrl ?? null},
              ${item.ogTitle ?? null},
              ${item.status}::listing_status,
              ${item.mirrorFirstSeenAt ? new Date(item.mirrorFirstSeenAt) : null}::timestamptz,
              ${item.mirrorLastChangedAt ? new Date(item.mirrorLastChangedAt) : null}::timestamptz,
              ${item.mirrorLastSeenAt ? new Date(item.mirrorLastSeenAt) : null}::timestamptz,
              NOW()
            )`
          );

          const upsertResult = await db.execute<{ xmax: string }>(sql`
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
              asking_price = EXCLUDED.asking_price,
              price_type = EXCLUDED.price_type,
              living_area_m2 = EXCLUDED.living_area_m2,
              num_rooms = EXCLUDED.num_rooms,
              energy_label = EXCLUDED.energy_label,
              thumbnail_url = EXCLUDED.thumbnail_url,
              og_title = EXCLUDED.og_title,
              status = EXCLUDED.status,
              source_url = EXCLUDED.source_url,
              mirror_last_changed_at = EXCLUDED.mirror_last_changed_at,
              mirror_last_seen_at = EXCLUDED.mirror_last_seen_at,
              updated_at = NOW()
            RETURNING (xmax::text)
          `);

          const rows = Array.from(upsertResult);
          for (const row of rows) {
            if (row.xmax === '0') {
              ingested++;
            } else {
              updated++;
            }
          }
        } catch (err) {
          // On batch failure, report error for all items in chunk
          for (const { item } of chunk) {
            errors.push({
              sourceUrl: item.sourceUrl,
              message: err instanceof Error ? err.message : 'Unknown error during batch upsert',
            });
          }
        }
      }

      // ---------------------------------------------------------------
      // Phase 5: Batch upsert price history
      // ---------------------------------------------------------------
      // Collect all price history entries from matched listings and
      // insert them in a single batch query.
      // ---------------------------------------------------------------

      interface PriceHistoryEntry {
        propertyId: string;
        price: number;
        priceDate: string;
        eventType: string;
        sourceName: string;
      }

      const allPriceHistory: PriceHistoryEntry[] = [];

      for (const { propertyId, item } of matched) {
        if (item.priceHistory && item.priceHistory.length > 0) {
          for (const ph of item.priceHistory) {
            allPriceHistory.push({
              propertyId,
              price: ph.price,
              priceDate: ph.priceDate,
              eventType: ph.eventType,
              sourceName: item.sourceName,
            });
          }
        }
      }

      // 5 columns per row * 10000 = 50000 params (safe under 65534)
      const PH_CHUNK = 10000;
      for (let i = 0; i < allPriceHistory.length; i += PH_CHUNK) {
        const chunk = allPriceHistory.slice(i, i + PH_CHUNK);

        try {
          const valueFragments = chunk.map((ph) =>
            sql`(${ph.propertyId}::uuid, ${ph.price}::bigint, ${ph.priceDate}, ${ph.eventType}, ${ph.sourceName})`
          );

          await db.execute(sql`
            INSERT INTO price_history (property_id, price, price_date, event_type, source)
            VALUES ${sql.join(valueFragments, sql`, `)}
            ON CONFLICT (property_id, price_date, price, event_type) DO NOTHING
          `);
        } catch (err) {
          // Price history errors are non-fatal; log but don't fail the batch
          request.log.error({ err }, 'Price history batch insert failed');
        }
      }

      return reply.send({ ingested, updated, skipped, errors });
    },
  );

  // =========================================================================
  // 6. GET /api/ingest/watermark
  // =========================================================================
  typedApp.get(
    '/api/ingest/watermark',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Get mirror sync watermark',
        description: 'Returns the latest mirror_last_changed_at for a given source. Used by sync workers to know where to resume.',
        querystring: watermarkQuerySchema,
        response: {
          200: watermarkResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // API key authentication
      const apiKey = request.headers['x-api-key'] as string | undefined;
      if (!isValidApiKey(apiKey)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key',
        });
      }

      const { source } = request.query;

      const result = await db.execute<{ last_changed_at: string | null }>(sql`
        SELECT TO_CHAR(MAX(mirror_last_changed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_changed_at
        FROM listings
        WHERE source_name = ${source} AND mirror_listing_id IS NOT NULL
      `);

      const rows = Array.from(result);
      const lastChangedAt = rows[0]?.last_changed_at ?? null;

      return reply.send({ lastChangedAt });
    },
  );
}

// ---------------------------------------------------------------------------
// Export types for client usage
// ---------------------------------------------------------------------------

export type ListingResponse = z.infer<typeof listingResponseSchema>;
export type PriceHistoryResponse = z.infer<typeof priceHistoryResponseSchema>;
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type SubmitRequest = z.infer<typeof submitRequestSchema>;
export type SubmitResponse = z.infer<typeof submitResponseSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
export type WatermarkResponse = z.infer<typeof watermarkResponseSchema>;

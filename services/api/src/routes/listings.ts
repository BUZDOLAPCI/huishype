import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties, listings, priceHistory } from '../db/index.js';
import { eq, sql, and, desc, isNull } from 'drizzle-orm';
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
    latitude: z.number().optional(),
    longitude: z.number().optional(),
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
// Staleness detection
// ---------------------------------------------------------------------------

/**
 * Mark mirror-sourced listings as withdrawn if they haven't been seen in the
 * mirror for more than 7 days.  Runs once on startup (after a short delay)
 * and then every 24 hours.
 */
async function runStalenessCheck(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE listings
      SET status = 'withdrawn', updated_at = NOW()
      WHERE status = 'active'
        AND mirror_listing_id IS NOT NULL
        AND mirror_last_seen_at < NOW() - INTERVAL '7 days'
    `);
    // postgres-js returns an array whose length is the affected row count
    const count = Array.isArray(result) ? result.length : 0;
    console.log(`[staleness] ${count} listing(s) marked as withdrawn`);
  } catch (err) {
    console.error('[staleness] check failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function listingRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Start staleness detection timer (runs daily)
  const STALENESS_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const stalenessTimer = setInterval(runStalenessCheck, STALENESS_INTERVAL_MS);
  // Run once on startup after a short delay (10 s)
  const startupTimer = setTimeout(runStalenessCheck, 10_000);

  // Ensure timers are cleaned up when the server shuts down
  app.addHook('onClose', () => {
    clearInterval(stalenessTimer);
    clearTimeout(startupTimer);
  });

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

      for (const item of incomingListings) {
        try {
          // 1. Canonicalize the address
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

          // 2. Find property by (postal_code, house_number, house_number_addition)
          const conditions = [
            eq(properties.postalCode, canonical.postalCode),
            eq(properties.houseNumber, canonical.houseNumber),
          ];
          if (canonical.houseNumberAddition != null) {
            conditions.push(eq(properties.houseNumberAddition, canonical.houseNumberAddition));
          } else {
            conditions.push(isNull(properties.houseNumberAddition));
          }

          let propertyResult = await db
            .select({ id: properties.id })
            .from(properties)
            .where(and(...conditions))
            .limit(1);

          // 3. Fallback: PostGIS proximity if lat/lon provided and no exact match
          if (propertyResult.length === 0 && item.address.latitude != null && item.address.longitude != null) {
            propertyResult = await db
              .select({ id: properties.id })
              .from(properties)
              .where(
                sql`ST_DWithin(
                  ${properties.geometry}::geography,
                  ST_SetSRID(ST_MakePoint(${item.address.longitude}, ${item.address.latitude}), 4326)::geography,
                  50
                )`,
              )
              .limit(1);
          }

          // 4. If no property found: skip
          if (propertyResult.length === 0) {
            skipped++;
            continue;
          }

          const propertyId = propertyResult[0].id;

          // 5. Upsert listing by (source_name, mirror_listing_id)
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
            ) VALUES (
              ${propertyId},
              ${normalizeSourceUrl(item.sourceUrl)},
              ${item.sourceName},
              ${item.mirrorListingId},
              ${item.askingPrice},
              ${item.priceType},
              ${item.livingAreaM2 ?? null},
              ${item.numRooms ?? null},
              ${item.energyLabel ?? null},
              ${item.thumbnailUrl ?? null},
              ${item.ogTitle ?? null},
              ${item.status},
              ${item.mirrorFirstSeenAt ? new Date(item.mirrorFirstSeenAt) : null},
              ${item.mirrorLastChangedAt ? new Date(item.mirrorLastChangedAt) : null},
              ${item.mirrorLastSeenAt ? new Date(item.mirrorLastSeenAt) : null},
              NOW()
            )
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

          // xmax = '0' means INSERT, otherwise UPDATE
          const rows = Array.from(upsertResult);
          const wasInsert = rows.length > 0 && rows[0].xmax === '0';
          if (wasInsert) {
            ingested++;
          } else {
            updated++;
          }

          // 6. Upsert price history entries if provided
          if (item.priceHistory && item.priceHistory.length > 0) {
            for (const ph of item.priceHistory) {
              await db.execute(sql`
                INSERT INTO price_history (
                  property_id,
                  price,
                  price_date,
                  event_type,
                  source
                ) VALUES (
                  ${propertyId},
                  ${ph.price},
                  ${ph.priceDate},
                  ${ph.eventType},
                  ${item.sourceName}
                )
                ON CONFLICT (property_id, price_date, price, event_type)
                DO NOTHING
              `);
            }
          }
        } catch (err) {
          errors.push({
            sourceUrl: item.sourceUrl,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
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
        SELECT MAX(mirror_last_changed_at)::text as last_changed_at
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

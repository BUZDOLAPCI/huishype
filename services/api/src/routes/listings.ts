import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties, listings, priceHistory } from '../db/index.js';
import { desc, eq } from 'drizzle-orm';
import { normalizeSourceUrl } from '../utils/address.js';
import { fetchOgMetadata } from '../services/og-fetcher.js';
import { checkAddressMatch } from '../services/address-matcher.js';
import rateLimit from '@fastify/rate-limit';
import { getAllListingDomains, getSourceNameForDomain, getAllListingSourceNames } from '@huishype/shared/config';
import {
  acceptIngestBatch,
  createMaintenanceRefreshRequest,
  enqueueIngestBatch,
  IngestIdempotencyConflictError,
  getIngestWatermark,
  ingestAcceptedResponseSchema,
  ingestBatchRequestSchema,
  ingestWatermarkResponseSchema,
  markBatchQueued,
  requestLatestListingsRefresh,
} from '../services/ingest/index.js';
import { advancePropertyChangeVersion } from '../services/property-read-state.js';

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
  sourceName: z.string(),
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
  sourceName: z.string(),
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
  sourceName: z.string(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']),
  createdAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// 5. POST /api/ingest/listings
// ---------------------------------------------------------------------------

/** All valid listing source names from the country-config registry (cached at import time). */
const ALL_SOURCE_NAMES = getAllListingSourceNames();

const watermarkQuerySchema = z.object({
  source: z.string().refine(
    (val) => ALL_SOURCE_NAMES.includes(val),
    { message: `Must be one of: ${getAllListingSourceNames().join(', ')}` },
  ),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All listing domains from the country-config registry (cached at import time). */
const ALL_LISTING_DOMAINS = getAllListingDomains();

/**
 * Detect listing source from a URL domain.
 * Uses the country-config registry for domain→source mapping.
 * Returns the config-derived source name (e.g. 'funda', 'immobilienscout24'),
 * or 'other' if the domain is not recognized.
 */
function detectSourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return getSourceNameForDomain(hostname) ?? 'other';
  } catch {
    return 'other';
  }
}

/**
 * Validate that a URL is an allowed listing domain (SSRF protection at route level).
 * Only allows HTTPS URLs pointing to domains registered in the country-config registry
 * (and their subdomains). Blocks private IP ranges by rejecting non-whitelisted hostnames.
 */
export function isAllowedListingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALL_LISTING_DOMAINS.some(
      (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
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
        description: 'Fetches OG metadata from a URL and checks if the address matches the property.',
        body: previewRequestSchema,
        response: {
          200: previewResponseSchema,
          400: errorResponseSchema,
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

      // SSRF protection: only allow whitelisted domains
      if (!isAllowedListingUrl(url)) {
        return reply.status(400).send({
          error: 'INVALID_URL',
          message: 'URL must be from a recognized listing platform.',
        });
      }

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
      onRequest: [app.authenticate],
      schema: {
        tags: ['listings'],
        summary: 'Submit a listing',
        description: 'Creates a listing from a user-submitted URL. Requires authentication.',
        body: submitRequestSchema,
        response: {
          201: submitResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { url, propertyId, ogTitle, thumbnailUrl } = request.body;

      // SSRF protection: only allow whitelisted domains
      if (!isAllowedListingUrl(url)) {
        return reply.status(400).send({
          error: 'INVALID_URL',
          message: 'URL must be from a recognized listing platform.',
        });
      }

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
        const { created, maintenanceRequest } = await db.transaction(async (tx) => {
          const result = await tx
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

          const createdListing = result[0];
          if (!createdListing) {
            throw new Error('Failed to create listing');
          }

          await advancePropertyChangeVersion(propertyId, tx);

          const maintenance = await createMaintenanceRefreshRequest(tx, {
            sourceName,
            requestedBy: 'listing-submit',
            idempotencyKey: `listing-submit:${createdListing.id}`,
            payload: {
              listingId: createdListing.id,
              propertyId,
              sourceUrl: normalizedUrl,
              sourceName,
            },
          });

          return {
            created: createdListing,
            maintenanceRequest: maintenance,
          };
        });

        requestLatestListingsRefresh({
          requestedBy: 'listing-submit',
          batchId: maintenanceRequest.batchId,
        }).catch((err) =>
          request.log.warn(
            { err, listingId: created.id, maintenanceBatchId: maintenanceRequest.batchId },
            'Failed to enqueue latest listings refresh after submit',
          ),
        );

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
        body: ingestBatchRequestSchema,
        response: {
          202: ingestAcceptedResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
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

      try {
        const accepted = await acceptIngestBatch(request.body);
        let responseStatus = accepted.status;

        if (accepted.status === 'accepted' || accepted.status === 'retryable') {
          try {
            await enqueueIngestBatch(accepted.batchId);
            await markBatchQueued(accepted.batchId);
            responseStatus = 'queued';
          } catch (err) {
            request.log.warn(
              { err, batchId: accepted.batchId, sourceName: accepted.sourceName },
              'Failed to enqueue accepted ingest batch; leaving durable batch recoverable',
            );
          }
        }

        return reply.status(202).send({
          ...accepted,
          status: responseStatus,
        });
      } catch (err) {
        if (err instanceof IngestIdempotencyConflictError) {
          return reply.status(409).send({
            error: 'IDEMPOTENCY_CONFLICT',
            message: err.message,
          });
        }

        throw err;
      }
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
        description: 'Returns the durable ingest cursor for a given source. Used by sync workers to resume without skipping rows.',
        querystring: watermarkQuerySchema,
        response: {
          200: ingestWatermarkResponseSchema,
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
      const watermark = await getIngestWatermark(source);
      return reply.send(watermark);
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
export type IngestRequest = z.infer<typeof ingestBatchRequestSchema>;
export type IngestResponse = z.infer<typeof ingestAcceptedResponseSchema>;
export type WatermarkResponse = z.infer<typeof ingestWatermarkResponseSchema>;

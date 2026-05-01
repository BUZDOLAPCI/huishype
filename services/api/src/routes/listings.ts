import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { db, properties, priceHistory } from '../db/index.js';
import { desc, eq, sql } from 'drizzle-orm';
import rateLimit from '@fastify/rate-limit';
import { getAllListingDomains, getAllListingSourceNames } from '@huishype/shared/config';
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
import {
  advancePropertyTileSnapshotWatermark,
  safeRequestPropertyTileSnapshotRefresh,
} from '../services/property-tile-snapshots.js';
import {
  applyListingValidationOutcome,
  createUserListingSubmission,
  listCanonicalListingsForProperty,
} from '../services/listing-reconciliation.js';
import {
  buildListingPreviewPlan,
  type ListingPreviewPlan,
  type PropertyValidationContext,
  toPublicListingPreviewResponse,
} from '../services/listing-source-resolution.js';
import { fetchOgMetadata } from '../services/og-fetcher.js';

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
  canonicalUrl: z.string().nullable(),
  sourceListingId: z.string().nullable(),
  askingPrice: z.number().nullable(),
  priceType: z.string().nullable(),
  currency: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  ogTitle: z.string().nullable(),
  description: z.string().nullable(),
  livingAreaM2: z.number().nullable(),
  numRooms: z.number().nullable(),
  energyLabel: z.string().nullable(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']),
  verificationState: z.enum([
    'provisional',
    'validated',
    'invalid',
    'validation_pending',
    'validation_blocked',
    'validation_failed',
  ]),
  watchState: z.string().nullable(),
  reasonCode: z.string().nullable(),
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
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  imageUrl: z.string().url().optional(),
  askingPrice: z.number().int().positive().optional(),
  priceType: z.enum(['sale', 'rent', 'unknown']).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
});

const previewResponseSchema = z.object({
  sourceName: z.string(),
  rawUrl: z.string(),
  canonicalUrl: z.string(),
  sourceListingId: z.string().nullable(),
  sourceListingIdKind: z.string().nullable(),
  validationState: z.enum(['valid', 'invalid', 'provisional']),
  matchState: z.enum(['matched', 'mismatch', 'unverified', 'unsupported']),
  watchState: z.enum(['not_required', 'will_enqueue', 'unsupported']),
  reasonCode: z.enum([
    'source_identity_match',
    'address_match',
    'address_mismatch',
    'source_not_supported',
    'source_not_found',
    'mirror_unavailable',
    'parser_error',
    'og_unavailable',
    'validation_pending',
  ]),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  askingPrice: z.number().nullable(),
  priceType: z.enum(['sale', 'rent', 'unknown']),
  currency: z.string().nullable(),
  address: z.unknown().nullable(),
  submittedPropertyId: z.string().uuid(),
  matchedPropertyId: z.string().uuid().nullable(),
});

// ---------------------------------------------------------------------------
// 4. POST /listings/submit
// ---------------------------------------------------------------------------

const submitRequestSchema = z.object({
  url: z.string().url(),
  propertyId: z.string().uuid(),
  ogTitle: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  imageUrl: z.string().url().optional(),
  askingPrice: z.number().int().positive().optional(),
  priceType: z.enum(['sale', 'rent', 'unknown']).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
});

const submitResponseSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  sourceUrl: z.string(),
  sourceName: z.string(),
  canonicalUrl: z.string().nullable(),
  sourceListingId: z.string().nullable(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']),
  verificationState: z.enum([
    'provisional',
    'validated',
    'invalid',
    'validation_pending',
    'validation_blocked',
    'validation_failed',
  ]),
  watchState: z.enum(['not_required', 'will_enqueue', 'unsupported']),
  watchId: z.string().uuid().nullable(),
  reasonCode: z.string(),
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

const validationOutcomeSchema = z.object({
  watchId: z.string().uuid(),
  state: z.enum([
    'matched',
    'not_found',
    'blocked',
    'invalid',
    'parser_error',
    'unsupported',
    'retryable_error',
  ]),
  sourceName: z.string(),
  rawUrl: z.string().url(),
  canonicalUrl: z.string().url(),
  sourceListingId: z.string().nullable().optional(),
  sourceListingIdKind: z.string().nullable().optional(),
  aliases: z.array(z.object({ kind: z.string(), value: z.string() })).optional(),
  sourceStatus: z.enum([
    'available',
    'sold',
    'rented',
    'withdrawn',
    'not_found',
    'blocked',
    'invalid',
    'parser_error',
    'unknown',
  ]).optional(),
  address: z.object({
    countryCode: z.string().optional(),
    street: z.string().optional(),
    postalCode: z.string().optional(),
    houseNumber: z.union([z.string(), z.number()]).optional(),
    houseNumberAddition: z.string().nullable().optional(),
    city: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  }).nullable().optional(),
  matchedPropertyEvidence: z.object({
    propertyId: z.string().uuid().nullable().optional(),
    matchKind: z.enum([
      'user_selected',
      'source_exact',
      'source_spatial',
      'source_unmatched',
      'source_mismatch',
    ]).optional(),
  }).nullable().optional(),
  price: z.number().int().positive().nullable().optional(),
  currency: z.string().trim().min(3).max(3).nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  firstSeenAt: z.string().datetime().nullable().optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const validationOutcomeResponseSchema = z.object({
  canonicalListingId: z.string().uuid(),
  observationId: z.string().uuid(),
  watchId: z.string().uuid(),
  state: z.string(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All listing domains from the country-config registry (cached at import time). */
const ALL_LISTING_DOMAINS = getAllListingDomains();

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

function toPublicListingStatus(status: string): 'active' | 'sold' | 'rented' | 'withdrawn' {
  if (status === 'active' || status === 'sold' || status === 'rented' || status === 'withdrawn') {
    return status;
  }
  return 'withdrawn';
}

async function getPropertyValidationContext(propertyId: string): Promise<PropertyValidationContext | null> {
  const rows = await db
    .select({
      id: properties.id,
      countryCode: properties.countryCode,
      street: properties.street,
      postalCode: properties.postalCode,
      houseNumber: properties.houseNumber,
      houseNumberAddition: properties.houseNumberAddition,
      city: properties.city,
      latitude: sql<number | null>`CASE WHEN ${properties.geometry} IS NULL THEN NULL ELSE ST_Y(${properties.geometry}) END`,
      longitude: sql<number | null>`CASE WHEN ${properties.geometry} IS NULL THEN NULL ELSE ST_X(${properties.geometry}) END`,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0] ?? null;
}

function toSourceDisplayName(sourceName: string): string {
  if (sourceName.length === 0) return 'listing platform';
  return sourceName
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildDeterministicDisplayFallback(plan: ListingPreviewPlan): {
  title: string;
  description: string;
} {
  const sourceDisplayName = toSourceDisplayName(plan.sourceName);
  let host = plan.sourceName;

  try {
    host = new URL(plan.canonicalUrl || plan.rawUrl).hostname.replace(/^www\./, '');
  } catch {
    // Keep the source name fallback when URL parsing unexpectedly fails.
  }

  return {
    title: `${sourceDisplayName} listing`,
    description: `Listing submitted from ${host}`,
  };
}

async function enrichListingPreviewDisplay(plan: ListingPreviewPlan): Promise<ListingPreviewPlan> {
  const needsOgMetadata = plan.title == null || plan.description == null || plan.imageUrl == null;
  if (!needsOgMetadata) return plan;

  const ogMetadata = await fetchOgMetadata(plan.canonicalUrl || plan.rawUrl).catch(() => ({
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
  }));

  const fallback = buildDeterministicDisplayFallback(plan);

  return {
    ...plan,
    title: plan.title ?? ogMetadata.ogTitle ?? fallback.title,
    description: plan.description ?? ogMetadata.ogDescription ?? fallback.description,
    imageUrl: plan.imageUrl ?? ogMetadata.ogImage ?? null,
  };
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

      const canonicalListings = await listCanonicalListingsForProperty(propertyId);

      return reply.send({
        data: canonicalListings.map((l) => ({
          id: l.id,
          sourceUrl: l.displayUrl,
          sourceName: l.sourceName,
          canonicalUrl: l.canonicalUrl,
          sourceListingId: l.primarySourceListingId,
          askingPrice: l.askingPrice,
          priceType: null,
          currency: l.priceCurrency,
          thumbnailUrl: l.thumbnailUrl,
          ogTitle: l.title,
          description: l.description,
          livingAreaM2: null,
          numRooms: null,
          energyLabel: null,
          status: toPublicListingStatus(l.status),
          verificationState: l.verificationState,
          watchState: l.watchState,
          reasonCode: l.reasonCode,
          createdAt: l.createdAt,
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
        description: 'Validates a listing URL against source services and enriches display metadata from caller input or Open Graph fallback.',
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
      const propertyContext = await getPropertyValidationContext(propertyId);

      if (!propertyContext) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const plan = await buildListingPreviewPlan({
        rawUrl: url,
        property: propertyContext,
        display: {
          title: request.body.title,
          description: request.body.description,
          imageUrl: request.body.imageUrl,
          askingPrice: request.body.askingPrice,
          priceType: request.body.priceType,
          currency: request.body.currency,
        },
      });
      const enrichedPlan = await enrichListingPreviewDisplay(plan);

      return reply.send(toPublicListingPreviewResponse(enrichedPlan));
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
      const { url, propertyId } = request.body;

      // SSRF protection: only allow whitelisted domains
      if (!isAllowedListingUrl(url)) {
        return reply.status(400).send({
          error: 'INVALID_URL',
          message: 'URL must be from a recognized listing platform.',
        });
      }

      // Check property exists
      const propertyContext = await getPropertyValidationContext(propertyId);

      if (!propertyContext) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Property with ID ${propertyId} not found`,
        });
      }

      const plan = await buildListingPreviewPlan({
        rawUrl: url,
        property: propertyContext,
        display: {
          title: request.body.title ?? request.body.ogTitle,
          description: request.body.description,
          imageUrl: request.body.imageUrl ?? request.body.thumbnailUrl,
          askingPrice: request.body.askingPrice,
          priceType: request.body.priceType,
          currency: request.body.currency,
        },
      });
      const enrichedPlan = await enrichListingPreviewDisplay(plan);

      if (
        enrichedPlan.validationState === 'invalid' ||
        enrichedPlan.matchState === 'mismatch' ||
        enrichedPlan.matchState === 'unsupported'
      ) {
        return reply.status(400).send({
          error: 'LISTING_VALIDATION_FAILED',
          message: `Listing validation failed: ${enrichedPlan.reasonCode}`,
        });
      }

      try {
        const userId = request.userId;
        if (!userId) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Authentication required',
          });
        }

        const { submission, maintenanceRequest } = await db.transaction(async (tx) => {
          const createdSubmission = await createUserListingSubmission(tx, {
            userId,
            plan: enrichedPlan,
          });
          await advancePropertyChangeVersion(propertyId, tx);
          await advancePropertyTileSnapshotWatermark(['listing', 'property'], tx);

          const maintenance = await createMaintenanceRefreshRequest(tx, {
            sourceName: enrichedPlan.sourceName,
            requestedBy: 'listing-submit',
            idempotencyKey: `listing-submit:${createdSubmission.canonicalListing.id}`,
            payload: {
              canonicalListingId: createdSubmission.canonicalListing.id,
              observationId: createdSubmission.observationId,
              watchId: createdSubmission.watchId,
              propertyId,
              sourceUrl: enrichedPlan.canonicalUrl,
              sourceName: enrichedPlan.sourceName,
              sourceListingId: enrichedPlan.sourceListingId,
            },
          });

          return { submission: createdSubmission, maintenanceRequest: maintenance };
        });

        requestLatestListingsRefresh({
          requestedBy: 'listing-submit',
          batchId: maintenanceRequest.batchId,
        }).catch((err) =>
          request.log.warn(
            {
              err,
              canonicalListingId: submission.canonicalListing.id,
              maintenanceBatchId: maintenanceRequest.batchId,
            },
            'Failed to enqueue latest listings refresh after submit',
          ),
        );
        void safeRequestPropertyTileSnapshotRefresh(
          { reason: 'listing-submit' },
          request.log,
          { canonicalListingId: submission.canonicalListing.id },
        );

        return reply.status(201).send({
          id: submission.canonicalListing.id,
          propertyId: submission.canonicalListing.propertyId,
          sourceUrl: submission.canonicalListing.displayUrl ?? submission.canonicalListing.canonicalUrl ?? enrichedPlan.rawUrl,
          sourceName: submission.canonicalListing.sourceName,
          canonicalUrl: submission.canonicalListing.canonicalUrl,
          sourceListingId: submission.canonicalListing.primarySourceListingId,
          status: toPublicListingStatus(submission.canonicalListing.status),
          verificationState: submission.canonicalListing.verificationState,
          watchState: submission.watchState,
          watchId: submission.watchId,
          reasonCode: submission.reasonCode,
          createdAt: submission.canonicalListing.createdAt.toISOString(),
        });
      } catch (err: unknown) {
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
  // 6. POST /api/ingest/listing-validation-outcomes
  // =========================================================================
  typedApp.post(
    '/api/ingest/listing-validation-outcomes',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Persist listing validation outcome',
        description: 'Internal callback for source services validating user-submitted listing URLs.',
        body: validationOutcomeSchema,
        response: {
          202: validationOutcomeResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const apiKey = request.headers['x-api-key'] as string | undefined;
      if (!isValidApiKey(apiKey)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key',
        });
      }

      try {
        const { outcome, maintenanceRequest } = await db.transaction(async (tx) => {
          const applied = await applyListingValidationOutcome(tx, {
            watchId: request.body.watchId,
            state: request.body.state,
            sourceName: request.body.sourceName,
            rawUrl: request.body.rawUrl,
            canonicalUrl: request.body.canonicalUrl,
            sourceListingId: request.body.sourceListingId ?? null,
            sourceListingIdKind: request.body.sourceListingIdKind ?? null,
            aliases: request.body.aliases,
            sourceStatus: request.body.sourceStatus,
            address: request.body.address,
            matchedPropertyEvidence: request.body.matchedPropertyEvidence,
            price: request.body.price,
            currency: request.body.currency,
            thumbnailUrl: request.body.thumbnailUrl,
            title: request.body.title,
            description: request.body.description,
            firstSeenAt: request.body.firstSeenAt,
            lastSeenAt: request.body.lastSeenAt,
            sourceUpdatedAt: request.body.sourceUpdatedAt,
            payload: request.body.payload,
          });

          await advancePropertyChangeVersion(applied.canonicalListing.propertyId, tx);
          await advancePropertyTileSnapshotWatermark(['listing', 'property'], tx);
          const maintenance = await createMaintenanceRefreshRequest(tx, {
            sourceName: request.body.sourceName,
            requestedBy: 'validation-outcome',
            idempotencyKey: `validation-outcome:${request.body.watchId}:${applied.observationId}`,
            payload: {
              watchId: request.body.watchId,
              canonicalListingId: applied.canonicalListing.id,
              observationId: applied.observationId,
              state: request.body.state,
            },
          });

          return { outcome: applied, maintenanceRequest: maintenance };
        });

        requestLatestListingsRefresh({
          requestedBy: 'validation-outcome',
          batchId: maintenanceRequest.batchId,
        }).catch((err) =>
          request.log.warn(
            {
              err,
              watchId: request.body.watchId,
              maintenanceBatchId: maintenanceRequest.batchId,
            },
            'Failed to enqueue latest listings refresh after validation outcome',
          ),
        );
        void safeRequestPropertyTileSnapshotRefresh(
          { reason: 'listing-validation-outcome' },
          request.log,
          { watchId: request.body.watchId },
        );

        return reply.status(202).send({
          canonicalListingId: outcome.canonicalListing.id,
          observationId: outcome.observationId,
          watchId: request.body.watchId,
          state: request.body.state,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.status(404).send({
            error: 'NOT_FOUND',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  // =========================================================================
  // 7. GET /api/ingest/watermark
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
export type ValidationOutcomeRequest = z.infer<typeof validationOutcomeSchema>;

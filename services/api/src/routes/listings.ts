import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  canonicalListings,
  db,
  listingCandidateHandoffs,
  properties,
  priceHistory,
} from '../db/index.js';
import { config } from '../config.js';
import { and, desc, eq, or, sql } from 'drizzle-orm';
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
  advancePropertyTilePyramidSourceWatermark,
  safeRequestPropertyTilePyramidBuildAfterMutation,
} from '../services/property-tile-pyramid.js';
import {
  consumeListingPreviewResult,
  createUserListingSubmission,
  listCanonicalListingsForProperty,
  storeListingPreviewResult,
} from '../services/listing-reconciliation.js';
import { enqueueCandidateHandoff } from '../services/candidate-handoffs/index.js';
import {
  buildListingPreviewPlan,
  type ListingPreviewPlan,
  type PropertyValidationContext,
  toPublicListingPreviewResponse,
} from '../services/listing-source-resolution.js';

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
  propertyId: z.string().uuid(),
  sourceUrl: z.string(),
  displayUrl: z.string().nullable(),
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
  candidateHandoffState: z.enum([
    'pending',
    'queued',
    'delivered',
    'retryable_error',
    'dead_letter',
  ]).nullable(),
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

type RouteRefreshLogger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

async function requestListingWriteRefreshes(input: {
  requestedBy: 'listing-submit';
  maintenanceBatchId: string;
  propertyTileReason: 'listing-submit';
  logger: RouteRefreshLogger;
  context: Record<string, unknown>;
}): Promise<void> {
  const latestListingsRefresh = requestLatestListingsRefresh({
    requestedBy: input.requestedBy,
    batchId: input.maintenanceBatchId,
  }).catch((err) =>
    input.logger.warn(
      {
        err,
        maintenanceBatchId: input.maintenanceBatchId,
        ...input.context,
      },
      'Failed to enqueue latest listings refresh after submit',
    ),
  );

  await Promise.all([
    latestListingsRefresh,
    safeRequestPropertyTilePyramidBuildAfterMutation(
      {
        reason: input.propertyTileReason,
        policy: 'listing',
        watermarkScopes: ['listing_facts', 'property_status'],
      },
      input.logger,
      {
        maintenanceBatchId: input.maintenanceBatchId,
        ...input.context,
      },
    ),
  ]);
}

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
  validationState: z.enum(['valid', 'provisional']),
  matchState: z.enum(['matched', 'unverified']),
  handoffState: z.literal('will_create'),
  reasonCode: z.enum([
    'source_identity_match',
    'address_match',
    'mirror_unavailable',
    'parser_error',
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
  previewToken: z.string(),
  previewId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// 4. POST /listings/submit
// ---------------------------------------------------------------------------

const submitRequestSchema = z.object({
  previewToken: z.string().min(32),
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
  candidateHandoffState: z.enum(['pending', 'queued', 'delivered', 'retryable_error', 'dead_letter']),
  candidateId: z.string().uuid(),
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

function isSubmittablePreviewPlan(plan: ListingPreviewPlan): boolean {
  if (plan.handoffState !== 'will_create') return false;
  if (plan.validationState === 'valid' && plan.matchState === 'matched') return true;
  return plan.validationState === 'provisional'
    && plan.matchState === 'unverified'
    && (
      plan.reasonCode === 'mirror_unavailable'
      || plan.reasonCode === 'parser_error'
      || plan.reasonCode === 'validation_pending'
    );
}

async function enrichListingPreviewDisplay(plan: ListingPreviewPlan): Promise<ListingPreviewPlan> {
  const needsOgMetadata = plan.title == null || plan.description == null || plan.imageUrl == null;
  if (!needsOgMetadata) return plan;

  const fallback = buildDeterministicDisplayFallback(plan);

  return {
    ...plan,
    title: plan.title ?? fallback.title,
    description: plan.description ?? fallback.description,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function listingRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Register rate limiting plugin (scoped to this route plugin)
  await app.register(rateLimit, {
    max: config.isTest ? 1_000 : 10,
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
          propertyId: l.propertyId,
          sourceUrl: l.displayUrl,
          displayUrl: l.displayUrl,
          sourceName: l.sourceName,
          canonicalUrl: l.canonicalUrl,
          sourceListingId: l.primarySourceListingId,
          askingPrice: l.askingPrice,
          priceType: l.priceType,
          currency: l.priceCurrency,
          thumbnailUrl: l.thumbnailUrl,
          ogTitle: l.title,
          description: l.description,
          livingAreaM2: l.livingAreaM2,
          numRooms: l.numRooms,
          energyLabel: l.energyLabel,
          status: toPublicListingStatus(l.status),
          verificationState: l.verificationState,
          candidateHandoffState: l.candidateHandoffState as
            | 'pending'
            | 'queued'
            | 'delivered'
            | 'retryable_error'
            | 'dead_letter'
            | null,
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
      onRequest: [app.optionalAuth],
      schema: {
        tags: ['listings'],
        summary: 'Preview a listing URL',
        description: 'Validates a listing URL against source services and enriches display metadata from caller input or Open Graph fallback.',
        body: previewRequestSchema,
        response: {
          200: previewResponseSchema,
          400: errorResponseSchema,
          422: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
      config: {
        rateLimit: {
          max: config.isTest ? 1_000 : 10,
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

      if (!isSubmittablePreviewPlan(plan)) {
        return reply.status(plan.reasonCode === 'source_blocked' ? 422 : 400).send({
          error: 'LISTING_VALIDATION_FAILED',
          message: `Listing validation failed: ${plan.reasonCode}`,
        });
      }

      const enrichedPlan = await enrichListingPreviewDisplay(plan);
      const stored = await storeListingPreviewResult(enrichedPlan, request.userId);
      const publicPreview = toPublicListingPreviewResponse(enrichedPlan);

      return reply.send({
        ...publicPreview,
        validationState: enrichedPlan.validationState as 'valid' | 'provisional',
        matchState: enrichedPlan.matchState as 'matched' | 'unverified',
        handoffState: 'will_create',
        reasonCode: publicPreview.reasonCode as
          | 'source_identity_match'
          | 'address_match'
          | 'mirror_unavailable'
          | 'parser_error'
          | 'validation_pending',
        previewToken: stored.previewToken,
        previewId: stored.preview.id,
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
        description: 'Creates a listing from a validated preview token. Requires authentication.',
        body: submitRequestSchema,
        response: {
          201: submitResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: z.union([submitResponseSchema, errorResponseSchema]),
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Authentication required',
          });
        }

        const { submission, maintenanceRequest, duplicate } = await db.transaction(async (tx) => {
          const preview = await consumeListingPreviewResult(request.body.previewToken, userId, tx);
          const duplicatePredicates: ReturnType<typeof sql>[] = [];
          if (preview.sourceListingId) {
            const sourceListingPredicate = and(
              eq(canonicalListings.sourceName, preview.sourceName),
              eq(canonicalListings.primarySourceListingId, preview.sourceListingId),
            );
            if (sourceListingPredicate) duplicatePredicates.push(sourceListingPredicate);
          }
          if (preview.sourceUrlCanonical) {
            const canonicalUrlPredicate = and(
              eq(canonicalListings.sourceName, preview.sourceName),
              eq(canonicalListings.canonicalUrl, preview.sourceUrlCanonical),
            );
            if (canonicalUrlPredicate) duplicatePredicates.push(canonicalUrlPredicate);
          }

          const [existingCanonical] = duplicatePredicates.length > 0
            ? await tx
                .select({ id: canonicalListings.id })
                .from(canonicalListings)
                .where(duplicatePredicates.length === 1 ? duplicatePredicates[0] : or(...duplicatePredicates))
                .limit(1)
            : [];
          const [existingHandoff] = await tx
            .select({ id: listingCandidateHandoffs.id })
            .from(listingCandidateHandoffs)
            .where(and(
              eq(listingCandidateHandoffs.sourceName, preview.sourceName),
              eq(listingCandidateHandoffs.propertyId, preview.propertyId),
              eq(listingCandidateHandoffs.sourceUrlCanonical, preview.sourceUrlCanonical),
              sql`${listingCandidateHandoffs.state} IN ('pending', 'queued', 'retryable_error', 'delivered')`,
            ))
            .limit(1);

          const createdSubmission = await createUserListingSubmission(tx, {
            userId,
            preview,
          });
          await advancePropertyChangeVersion(createdSubmission.canonicalListing.propertyId, tx);
          await advancePropertyTilePyramidSourceWatermark(['listing_facts', 'property_status'], tx);

          const maintenance = await createMaintenanceRefreshRequest(tx, {
            sourceName: preview.sourceName,
            requestedBy: 'listing-submit',
            idempotencyKey: `listing-submit:${createdSubmission.canonicalListing.id}`,
            payload: {
              canonicalListingId: createdSubmission.canonicalListing.id,
              observationId: createdSubmission.observationId,
              candidateId: createdSubmission.candidateId,
              propertyId: createdSubmission.canonicalListing.propertyId,
              sourceUrl: preview.sourceUrlCanonical,
              sourceName: preview.sourceName,
              sourceListingId: preview.sourceListingId,
            },
          });

          return {
            submission: createdSubmission,
            maintenanceRequest: maintenance,
            duplicate: Boolean(existingCanonical || existingHandoff),
          };
        });

        await requestListingWriteRefreshes({
          requestedBy: 'listing-submit',
          maintenanceBatchId: maintenanceRequest.batchId,
          propertyTileReason: 'listing-submit',
          logger: request.log,
          context: { canonicalListingId: submission.canonicalListing.id },
        });
        await enqueueCandidateHandoff(submission.candidateId).catch((err) => {
          request.log.warn(
            { err, candidateId: submission.candidateId, canonicalListingId: submission.canonicalListing.id },
            'Failed to enqueue candidate handoff after submit; durable handoff remains recoverable',
          );
        });

        return reply.status(duplicate ? 409 : 201).send({
          id: submission.canonicalListing.id,
          propertyId: submission.canonicalListing.propertyId,
          sourceUrl: submission.canonicalListing.displayUrl ?? submission.canonicalListing.canonicalUrl ?? '',
          sourceName: submission.canonicalListing.sourceName,
          canonicalUrl: submission.canonicalListing.canonicalUrl,
          sourceListingId: submission.canonicalListing.primarySourceListingId,
          status: toPublicListingStatus(submission.canonicalListing.status),
          verificationState: submission.canonicalListing.verificationState,
          candidateHandoffState: submission.candidateHandoffState as 'pending' | 'queued' | 'delivered' | 'retryable_error' | 'dead_letter',
          candidateId: submission.candidateId,
          reasonCode: submission.reasonCode,
          createdAt: submission.canonicalListing.createdAt.toISOString(),
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('preview token')) {
          return reply.status(400).send({
            error: 'INVALID_PREVIEW_TOKEN',
            message: err.message,
          });
        }
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
      bodyLimit: config.ingest.listingBodyLimitBytes,
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

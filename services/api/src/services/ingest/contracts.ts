import { z } from 'zod';
import { getAllListingSourceNames } from '@huishype/shared/config';
import { isOpaqueIngestCursor } from './cursor.js';
import { ingestEvidenceV2Schema } from './v2-contracts.js';

const ALL_SOURCE_NAMES = getAllListingSourceNames();

const ingestCursorSchema = z
  .string()
  .min(1)
  .refine((value) => isOpaqueIngestCursor(value), 'Invalid opaque cursor');

const ingestPriceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid price date');

function normalizeSourceTimestamp(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
      ? parsed.toISOString()
      : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const ingestSourceTimestampSchema = z
  .string()
  .refine((value) => normalizeSourceTimestamp(value) !== null, 'Invalid source timestamp')
  .transform((value) => normalizeSourceTimestamp(value) as string);

export const listingLifecycleStatusSchema = z.enum([
  'available',
  'sold',
  'rented',
  'withdrawn',
  'not_found',
]);

export const listingDiagnosticStatusSchema = z.enum([
  'blocked',
  'parser_error',
  'retryable_error',
  'unsupported',
  'invalid',
  'unknown',
  'mirror_unavailable',
]);

const legacyListingSourceStatusSchema = z.enum([
  'available',
  'sold',
  'rented',
  'withdrawn',
  'not_found',
  'blocked',
  'invalid',
  'parser_error',
  'unknown',
]);

const listingTypeSchema = z.enum(['sale', 'rent', 'unknown']);
const mirrorListingTypeSchema = z.enum(['sale', 'rent']);
export const ingestSourceProvenanceSchema = z.enum([
  'crawler_discovered',
  'user_submitted',
  'replay',
  'import',
]);
const optionalNullableCoordinateSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.coerce.number().nullable(),
).optional();

const scopeCompletionSchema = z.object({
  scopeKey: z.string().trim().min(1).max(255),
  listingType: listingTypeSchema.optional(),
  normalizedFilters: z.record(z.string(), z.unknown()).optional(),
  sourceRunId: z.string().trim().min(1).max(255).optional(),
  sourceRunStartedAt: z.string().datetime().nullable().optional(),
  sourceRunCompletedAt: z.string().datetime(),
  coverageStatus: z.enum(['complete', 'partial', 'failed']).optional(),
  observedListingCount: z.number().int().nonnegative().optional(),
  sourceHighWatermark: z.string().datetime(),
  diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
});

const ingestListingAddressSchema = z.object({
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  street: z.string().trim().optional(),
  postalCode: z.string().optional(),
  houseNumber: z.union([z.string(), z.number()]).optional(),
  houseNumberAddition: z.string().nullable().optional(),
  city: z.string().optional(),
  latitude: optionalNullableCoordinateSchema,
  longitude: optionalNullableCoordinateSchema,
});

export const ingestListingSchema = z.object({
  sourceUrl: z.string().url(),
  mirrorListingId: z.string().min(1),
  sourceCandidateId: z.string().min(1).optional(),
  previewResultId: z.string().uuid().optional(),
  scopeKey: z.string().trim().min(1).max(255).optional(),
  sourceListingId: z.string().min(1).optional(),
  sourceListingIdKind: z.string().min(1).optional(),
  sourceListingAliases: z.array(z.object({ kind: z.string().min(1), value: z.string().min(1) })).optional(),
  canonicalUrl: z.string().url().optional(),
  reasonCode: z.string().trim().min(1).nullable().optional(),
  matchEvidence: z.record(z.string(), z.unknown()).nullable().optional(),
  askingPrice: z.number().nullable(),
  priceType: listingTypeSchema.optional(),
  listingType: listingTypeSchema.optional(),
  currency: z.string().trim().length(3).optional(),
  livingAreaM2: z.number().nullable().optional(),
  numRooms: z.number().nullable().optional(),
  energyLabel: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'sold', 'rented', 'withdrawn']).default('active'),
  lifecycleStatus: listingLifecycleStatusSchema.optional(),
  diagnosticStatus: listingDiagnosticStatusSchema.optional(),
  sourceStatus: legacyListingSourceStatusSchema.optional(),
  listedAt: ingestSourceTimestampSchema.optional(),
  soldAt: ingestSourceTimestampSchema.optional(),
  rentedAt: ingestSourceTimestampSchema.optional(),
  withdrawnAt: ingestSourceTimestampSchema.optional(),
  mirrorFirstSeenAt: z.string().datetime().optional(),
  mirrorLastChangedAt: z.string().datetime().optional(),
  mirrorLastSeenAt: z.string().datetime().optional(),
  observedAt: z.string().datetime().optional(),
  sourceRunId: z.string().trim().min(1).max(255).optional(),
  sourceHighWatermark: z.string().datetime().optional(),
  sourceProvenance: ingestSourceProvenanceSchema.optional(),
  provenance: ingestSourceProvenanceSchema.optional(),
  address: ingestListingAddressSchema.optional(),
  priceHistory: z.array(z.object({
    price: z.number(),
    priceDate: ingestPriceDateSchema,
    eventType: z.string(),
  })).optional(),
}).transform(({ provenance, ...value }) => {
  const sourceProvenance = value.sourceProvenance ?? provenance;
  return {
    ...value,
    ...(sourceProvenance ? { sourceProvenance } : {}),
    priceType: value.priceType ?? value.listingType ?? 'unknown',
  };
});

function hasDiagnosticStatus(listing: z.infer<typeof ingestListingSchema>): boolean {
  return Boolean(
    listing.diagnosticStatus
      || [
        'blocked',
        'parser_error',
        'retryable_error',
        'unsupported',
        'invalid',
        'unknown',
        'mirror_unavailable',
      ].includes(listing.sourceStatus ?? ''),
  );
}

function isTerminalLifecycleStatus(value: string | undefined): boolean {
  return value === 'sold'
    || value === 'rented'
    || value === 'withdrawn'
    || value === 'not_found';
}

function hasSourceIdentity(listing: z.infer<typeof ingestListingSchema>): boolean {
  return Boolean(listing.sourceListingId?.trim() || listing.canonicalUrl?.trim());
}

function hasTerminalLifecycleSourceIdentity(listing: z.infer<typeof ingestListingSchema>): boolean {
  return hasSourceIdentity(listing)
    && (
      isTerminalLifecycleStatus(listing.lifecycleStatus)
      || isTerminalLifecycleStatus(listing.sourceStatus)
      || isTerminalLifecycleStatus(listing.status)
    );
}

function isCandidateScopedListing(
  batch: { scopeKey?: string },
  listing: { scopeKey?: string; sourceCandidateId?: string },
): boolean {
  return batch.scopeKey === 'candidate'
    || listing.scopeKey === 'candidate'
    || Boolean(listing.sourceCandidateId);
}

function hasCompleteAddress(listing: z.infer<typeof ingestListingSchema>): boolean {
  const address = listing.address;
  return Boolean(
    address?.countryCode
      && address.street
      && address.postalCode
      && address.houseNumber !== undefined
      && address.houseNumber !== null,
  );
}

export const ingestBatchRequestSchema = z.object({
  ingestVersion: z.literal(2).optional(),
  writerGeneration: z.number().int().positive().safe().optional(),
  records: z.array(ingestEvidenceV2Schema).min(1).max(1000).optional(),
  sourceName: z.string().refine(
    (value) => ALL_SOURCE_NAMES.includes(value),
    { message: `Must be one of: ${ALL_SOURCE_NAMES.join(', ')}` },
  ),
  idempotencyKey: z.string().trim().min(1).max(255),
  batchSequence: z.number().int().nonnegative(),
  cursorStart: ingestCursorSchema.nullable().optional().default(null),
  cursorEnd: ingestCursorSchema,
  upstreamRunKey: z.string().trim().min(1).max(255).optional(),
  runId: z.string().trim().min(1).max(255).optional(),
  batchKind: z.enum(['observations', 'completion', 'observations_and_completion']).optional(),
  scopeKey: z.string().trim().min(1).max(255).optional(),
  sourceHighWatermark: z.string().datetime().optional(),
  sourceProvenance: ingestSourceProvenanceSchema.optional(),
  provenance: ingestSourceProvenanceSchema.optional(),
  repairMode: z.boolean().optional(),
  repairReason: z.string().trim().min(1).optional(),
  listings: z.array(ingestListingSchema).optional(),
  completions: z.array(scopeCompletionSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.ingestVersion === 2) {
    if (value.sourceName !== 'funda' || !value.writerGeneration || !value.records?.length) {
      ctx.addIssue({ code: 'custom', message: 'Funda v2 requires writerGeneration and evidence records' });
    }
    if (value.listings?.length || value.completions?.length) {
      ctx.addIssue({ code: 'custom', message: 'V2 evidence cannot be mixed with v1 listings or completions' });
    }
    for (let index = 1; index < (value.records?.length ?? 0); index += 1) {
      if (value.records![index].sequence !== value.records![index - 1].sequence + 1) {
        ctx.addIssue({ code: 'custom', path: ['records', index, 'sequence'], message: 'Evidence records must have contiguous ascending sequences' });
      }
    }
  } else if (value.records || value.writerGeneration) {
    ctx.addIssue({ code: 'custom', message: 'Evidence records and writerGeneration require ingestVersion 2' });
  }
  if (value.ingestVersion !== 2 && (value.listings ?? []).length === 0 && (value.completions ?? []).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['listings'],
      message: 'Ingest batch must include listing observations or scoped completion evidence',
    });
  }
  if (value.repairMode && !value.repairReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['repairReason'],
      message: 'repairReason is required when repairMode is true',
    });
  }

  for (let index = 0; index < (value.listings ?? []).length; index += 1) {
    const listing = value.listings?.[index];
    if (!listing) continue;
    const isDiagnostic = hasDiagnosticStatus(listing);
    const isCandidateListing = isCandidateScopedListing(value, listing);

    const hasTerminalIdentity = hasTerminalLifecycleSourceIdentity(listing);

    if (
      !isCandidateListing
      && !isDiagnostic
      && !hasTerminalIdentity
      && !mirrorListingTypeSchema.safeParse(listing.priceType).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listings', index, 'priceType'],
        message: 'priceType must be sale or rent for mirrored listing observations',
      });
    }

    if (!isCandidateListing && !isDiagnostic && !hasTerminalIdentity && !hasCompleteAddress(listing)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listings', index, 'address'],
        message: 'Complete address is required for mirrored listing observations',
      });
    }
  }
}).transform(({ runId, provenance, ...value }) => {
  const sourceProvenance = value.sourceProvenance ?? provenance;
  return {
    ...value,
    upstreamRunKey: value.upstreamRunKey ?? runId,
    ...(value.ingestVersion !== 2 && value.completions ? {
      completions: value.completions.map(completion => ({
        ...completion,
        coverageStatus: completion.coverageStatus === 'failed' ? 'failed' as const : 'partial' as const,
        diagnostics: {
          ...completion.diagnostics,
          upstreamCoverageStatus: completion.diagnostics?.upstreamCoverageStatus ?? completion.coverageStatus ?? 'complete',
          remoteCoverageVerified: false,
          normalizationVersion: 1,
        },
      })),
    } : {}),
    ...(sourceProvenance ? { sourceProvenance } : {}),
  };
});

export const ingestAcceptedResponseSchema = z.object({
  batchId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  sourceName: z.string(),
  acceptedAt: z.string().datetime(),
  idempotencyKey: z.string(),
  status: z.enum(['accepted', 'queued', 'processing', 'completed', 'retryable', 'superseded', 'failed']),
  duplicate: z.boolean(),
});

export const ingestWatermarkResponseSchema = z.object({
  sourceName: z.string(),
  cursor: z.string().nullable(),
  lastCommittedChangedAt: z.string().datetime().nullable(),
  lastCommittedListingKey: z.string().nullable(),
  lastBatchId: z.string().uuid().nullable(),
  writerGeneration: z.number().int().nonnegative(),
  lastSequence: z.number().int().nonnegative(),
});

export type IngestBatchRequest = z.infer<typeof ingestBatchRequestSchema>;
export type IngestListing = z.infer<typeof ingestListingSchema>;
export type IngestAcceptedResponse = z.infer<typeof ingestAcceptedResponseSchema>;
export type IngestWatermarkResponse = z.infer<typeof ingestWatermarkResponseSchema>;

export const ingestBatchStatusResponseSchema = z.object({
  batchId: z.string().uuid(), sourceName: z.string(),
  status: z.enum(['accepted', 'queued', 'processing', 'completed', 'retryable', 'superseded', 'failed']),
  completedAt: z.string().datetime().nullable(),
  ingestedCount: z.number().int(), updatedCount: z.number().int(), skippedCount: z.number().int(),
  error: z.record(z.string(), z.unknown()).nullable(),
});

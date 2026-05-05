import { z } from 'zod';
import { getAllListingSourceNames } from '@huishype/shared/config';
import { isOpaqueIngestCursor } from './cursor.js';

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

const scopeCompletionSchema = z.object({
  scopeKey: z.string().trim().min(1).max(255),
  listingType: z.enum(['sale', 'rent', 'unknown']).optional(),
  normalizedFilters: z.record(z.string(), z.unknown()).optional(),
  sourceRunId: z.string().trim().min(1).max(255).optional(),
  sourceRunStartedAt: z.string().datetime().nullable().optional(),
  sourceRunCompletedAt: z.string().datetime(),
  coverageStatus: z.enum(['complete', 'partial', 'failed']).optional(),
  observedListingCount: z.number().int().nonnegative().optional(),
  sourceHighWatermark: z.string().datetime(),
  diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
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
  askingPrice: z.number().nullable(),
  priceType: z.enum(['sale', 'rent']),
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
  mirrorFirstSeenAt: z.string().datetime().optional(),
  mirrorLastChangedAt: z.string().datetime().optional(),
  mirrorLastSeenAt: z.string().datetime().optional(),
  observedAt: z.string().datetime().optional(),
  sourceRunId: z.string().trim().min(1).max(255).optional(),
  sourceHighWatermark: z.string().datetime().optional(),
  address: z.object({
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    street: z.string().trim().min(1),
    postalCode: z.string().min(1),
    houseNumber: z.union([z.string(), z.number()]),
    houseNumberAddition: z.string().nullable().optional(),
    city: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  }),
  priceHistory: z.array(z.object({
    price: z.number(),
    priceDate: ingestPriceDateSchema,
    eventType: z.string(),
  })).optional(),
});

export const ingestBatchRequestSchema = z.object({
  sourceName: z.string().refine(
    (value) => ALL_SOURCE_NAMES.includes(value),
    { message: `Must be one of: ${ALL_SOURCE_NAMES.join(', ')}` },
  ),
  idempotencyKey: z.string().trim().min(1).max(255),
  batchSequence: z.number().int().nonnegative(),
  cursorStart: ingestCursorSchema.nullable().optional().default(null),
  cursorEnd: ingestCursorSchema,
  upstreamRunKey: z.string().trim().min(1).max(255).optional(),
  batchKind: z.enum(['observations', 'completion', 'observations_and_completion']).optional(),
  scopeKey: z.string().trim().min(1).max(255).optional(),
  sourceHighWatermark: z.string().datetime().optional(),
  repairMode: z.boolean().optional(),
  repairReason: z.string().trim().min(1).optional(),
  listings: z.array(ingestListingSchema).optional(),
  completions: z.array(scopeCompletionSchema).optional(),
}).superRefine((value, ctx) => {
  if ((value.listings ?? []).length === 0 && (value.completions ?? []).length === 0) {
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
});

export type IngestBatchRequest = z.infer<typeof ingestBatchRequestSchema>;
export type IngestListing = z.infer<typeof ingestListingSchema>;
export type IngestAcceptedResponse = z.infer<typeof ingestAcceptedResponseSchema>;
export type IngestWatermarkResponse = z.infer<typeof ingestWatermarkResponseSchema>;

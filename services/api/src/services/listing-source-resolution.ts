import { getSourceNameForDomain } from '@huishype/shared/config';
import { z } from 'zod';
import { config } from '../config.js';

export type ListingSourceName = 'funda' | 'pararius';
export type ListingSourceAlias = {
  kind: 'tiny_id' | 'global_id' | 'detail_id' | 'canonical_url' | 'relative_path' | 'url_path';
  value: string;
};

export type PropertyValidationContext = {
  id: string;
  countryCode: string;
  street: string;
  postalCode: string;
  houseNumber: number;
  houseNumberAddition?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SupportedListingSourceResolution = {
  supported: true;
  sourceName: ListingSourceName;
  rawUrl: string;
  canonicalUrl: string;
  sourceListingId: string;
  sourceListingIdKind: 'tiny_id' | 'global_id' | 'detail_id' | 'canonical_path' | 'relative_path' | 'url_path' | 'unknown';
  aliases: ListingSourceAlias[];
  listingPath: string;
  reasonCode: null;
};

export type UnsupportedListingSourceResolution = {
  supported: false;
  sourceName: string;
  rawUrl: string;
  reasonCode: 'invalid_url' | 'source_not_supported' | 'unsupported_url_shape' | 'id_only_unsupported';
};

export type ListingSourceResolution = SupportedListingSourceResolution | UnsupportedListingSourceResolution;

type ListingValidationState =
  | 'matched'
  | 'not_found'
  | 'blocked'
  | 'invalid'
  | 'parser_error'
  | 'unsupported'
  | 'retryable_error';

type ListingSourceStatus =
  | 'available'
  | 'sold'
  | 'rented'
  | 'withdrawn'
  | 'not_found'
  | 'blocked'
  | 'invalid'
  | 'parser_error'
  | 'unknown';

type ListingPropertyMatchKind =
  | 'user_selected'
  | 'source_exact'
  | 'source_spatial'
  | 'source_unmatched'
  | 'source_mismatch';

const listingSourceAliasSchema = z.object({
  kind: z.enum(['tiny_id', 'global_id', 'detail_id', 'canonical_url', 'relative_path', 'url_path']),
  value: z.string().min(1),
});

const supportedListingSourceResolutionSchema = z.object({
  supported: z.literal(true),
  sourceName: z.enum(['funda', 'pararius']),
  rawUrl: z.string().min(1),
  canonicalUrl: z.string().min(1),
  sourceListingId: z.string().min(1),
  sourceListingIdKind: z.enum([
    'tiny_id',
    'global_id',
    'detail_id',
    'canonical_path',
    'relative_path',
    'url_path',
    'unknown',
  ]),
  aliases: z.array(listingSourceAliasSchema).default([]),
  listingPath: z.string().min(1),
  reasonCode: z.null(),
});

const unsupportedListingSourceResolutionSchema = z.object({
  supported: z.literal(false),
  sourceName: z.string().min(1),
  rawUrl: z.string().min(1),
  reasonCode: z.enum([
    'invalid_url',
    'source_not_supported',
    'unsupported_url_shape',
    'id_only_unsupported',
  ]),
});

const listingSourceResolutionSchema = z.union([
  supportedListingSourceResolutionSchema,
  unsupportedListingSourceResolutionSchema,
]);

const validationAddressSchema = z.object({
  countryCode: z.string().optional(),
  street: z.string().optional(),
  postalCode: z.string().optional(),
  houseNumber: z.union([z.string(), z.number()]).optional(),
  houseNumberAddition: z.string().nullable().optional(),
  city: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
}).nullable().optional();
export type ListingSourceAddress = NonNullable<z.infer<typeof validationAddressSchema>>;

const listingValidationResponseSchema = z.object({
  state: z.enum(['matched', 'not_found', 'blocked', 'invalid', 'parser_error', 'unsupported', 'retryable_error']),
  reasonCode: z.string().nullable().optional(),
  sourceName: z.string().min(1),
  rawUrl: z.string().min(1),
  canonicalUrl: z.string().min(1),
  sourceListingId: z.string().nullable().optional(),
  sourceListingIdKind: supportedListingSourceResolutionSchema.shape.sourceListingIdKind.nullable().optional(),
  aliases: z.array(listingSourceAliasSchema).optional(),
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
  address: validationAddressSchema,
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
  thumbnailUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  firstSeenAt: z.string().datetime().nullable().optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

type ListingValidationResponse = z.infer<typeof listingValidationResponseSchema>;
type PreviewReasonCode =
  | 'source_identity_match'
  | 'address_match'
  | 'address_mismatch'
  | 'source_not_supported'
  | 'source_not_found'
  | 'mirror_unavailable'
  | 'parser_error'
  | 'og_unavailable'
  | 'validation_pending';

type ListingPreviewPublicShape = {
  sourceName: string;
  rawUrl: string;
  canonicalUrl: string;
  sourceListingId: string | null;
  sourceListingIdKind: SupportedListingSourceResolution['sourceListingIdKind'] | null;
  validationState: 'valid' | 'invalid' | 'provisional';
  matchState: 'matched' | 'mismatch' | 'unverified' | 'unsupported';
  watchState: 'not_required' | 'will_enqueue' | 'unsupported';
  reasonCode: PreviewReasonCode;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  askingPrice: number | null;
  priceType: 'sale' | 'rent' | 'unknown';
  currency: string | null;
  address: ListingSourceAddress | null;
  submittedPropertyId: string;
  matchedPropertyId: string | null;
  aliases: ListingSourceAlias[];
};

export type ListingPreviewPlan = ListingPreviewPublicShape & {
  propertyMatchKind: ListingPropertyMatchKind;
  sourceStatus: ListingSourceStatus;
};

export type PublicListingPreviewPlan = ListingPreviewPublicShape;

export type BuildListingPreviewPlanInput = {
  rawUrl: string;
  property: PropertyValidationContext;
  display?: {
    title?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    askingPrice?: number | null;
    priceType?: 'sale' | 'rent' | 'unknown' | null;
    currency?: string | null;
  };
};

type SourceServiceValidateInput = {
  watchId?: string | null;
  sourceName: ListingSourceName;
  rawUrl: string;
  canonicalUrl: string;
  sourceListingId: string;
  sourceListingIdKind: SupportedListingSourceResolution['sourceListingIdKind'];
  aliases: ListingSourceAlias[];
  property: PropertyValidationContext;
};

class SourceServiceTemporaryError extends Error {}

function uniqueAliases(aliases: readonly ListingSourceAlias[]): ListingSourceAlias[] {
  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = `${alias.kind}:${alias.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectSourceName(rawUrl: string): string {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return getSourceNameForDomain(hostname) ?? 'other';
  } catch {
    return 'other';
  }
}

function isSourceServiceBacked(sourceName: string): sourceName is ListingSourceName {
  return sourceName === 'funda' || sourceName === 'pararius';
}

function getSourceServiceBaseUrl(sourceName: ListingSourceName): string {
  return sourceName === 'funda'
    ? config.sourceServices.fundaBaseUrl
    : config.sourceServices.parariusBaseUrl;
}

async function postJson<T>(
  sourceName: ListingSourceName,
  pathname: string,
  body: Record<string, unknown>,
  schema: z.ZodSchema<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getSourceServiceBaseUrl(sourceName)}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new SourceServiceTemporaryError(`Source service request failed: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new SourceServiceTemporaryError(
      `Source service ${pathname} returned ${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SourceServiceTemporaryError(`Source service ${pathname} returned invalid JSON`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new SourceServiceTemporaryError(
      `Source service ${pathname} returned an unexpected payload`,
    );
  }

  return parsed.data;
}

export async function resolveListingSourceUrl(rawUrl: string, sourceName: ListingSourceName): Promise<ListingSourceResolution> {
  return postJson(sourceName, '/api/v1/listings/resolve-url', {
    sourceName,
    rawUrl,
  }, listingSourceResolutionSchema);
}

export async function validateListingSource(input: SourceServiceValidateInput): Promise<ListingValidationResponse> {
  return postJson(input.sourceName, '/api/v1/listings/validate', {
    watchId: input.watchId ?? null,
    sourceName: input.sourceName,
    rawUrl: input.rawUrl,
    canonicalUrl: input.canonicalUrl,
    sourceListingId: input.sourceListingId,
    sourceListingIdKind: input.sourceListingIdKind,
    aliases: input.aliases,
    property: input.property,
  }, listingValidationResponseSchema);
}

function basePlan(
  input: BuildListingPreviewPlanInput,
  sourceName: string,
  overrides?: Partial<ListingPreviewPlan>,
): ListingPreviewPlan {
  return {
    sourceName,
    rawUrl: input.rawUrl,
    canonicalUrl: input.rawUrl,
    sourceListingId: null,
    sourceListingIdKind: null,
    validationState: 'provisional',
    matchState: 'unverified',
    watchState: 'will_enqueue',
    reasonCode: 'validation_pending',
    title: input.display?.title ?? null,
    description: input.display?.description ?? null,
    imageUrl: input.display?.imageUrl ?? null,
    askingPrice: input.display?.askingPrice ?? null,
    priceType: input.display?.priceType ?? 'unknown',
    currency: input.display?.currency ?? null,
    address: null,
    submittedPropertyId: input.property.id,
    matchedPropertyId: null,
    aliases: [],
    propertyMatchKind: 'user_selected',
    sourceStatus: 'unknown',
    ...overrides,
  };
}

function toReasonCodeForTemporaryFailure(state?: ListingValidationState): PreviewReasonCode {
  if (state === 'parser_error') return 'parser_error';
  return 'mirror_unavailable';
}

function toUnsupportedReasonCode(reasonCode: UnsupportedListingSourceResolution['reasonCode']): PreviewReasonCode {
  return reasonCode === 'source_not_supported' ? 'source_not_supported' : 'source_not_supported';
}

function toMatchedReasonCode(matchKind: ListingPropertyMatchKind | undefined): PreviewReasonCode {
  return matchKind === 'source_spatial' ? 'address_match' : 'source_identity_match';
}

function buildProvisionalPlanFromSupportedResolution(
  input: BuildListingPreviewPlanInput,
  resolution: SupportedListingSourceResolution,
  reasonCode: PreviewReasonCode,
): ListingPreviewPlan {
  return basePlan(input, resolution.sourceName, {
    canonicalUrl: resolution.canonicalUrl,
    sourceListingId: resolution.sourceListingId,
    sourceListingIdKind: resolution.sourceListingIdKind,
    watchState: 'will_enqueue',
    reasonCode,
    aliases: resolution.aliases,
  });
}

function buildPlanFromValidation(
  input: BuildListingPreviewPlanInput,
  resolution: SupportedListingSourceResolution,
  validation: ListingValidationResponse,
): ListingPreviewPlan {
  const aliases = uniqueAliases([...(resolution.aliases ?? []), ...(validation.aliases ?? [])]);
  const matchedPropertyEvidence = validation.matchedPropertyEvidence ?? null;
  const matchedPropertyId = matchedPropertyEvidence?.propertyId ?? null;
  const matchKind = matchedPropertyEvidence?.matchKind;
  const serviceCanonicalUrl = validation.canonicalUrl || resolution.canonicalUrl;
  const serviceSourceListingId = validation.sourceListingId ?? resolution.sourceListingId;
  const serviceSourceListingIdKind = validation.sourceListingIdKind ?? resolution.sourceListingIdKind;
  const displayTitle = validation.title ?? input.display?.title ?? null;
  const displayDescription = validation.description ?? input.display?.description ?? null;
  const displayImageUrl = validation.thumbnailUrl ?? input.display?.imageUrl ?? null;
  const displayPrice = validation.price ?? input.display?.askingPrice ?? null;
  const displayCurrency = validation.currency ?? input.display?.currency ?? null;

  if (
    validation.state === 'matched'
    && matchKind !== 'source_mismatch'
    && (matchedPropertyId == null || matchedPropertyId === input.property.id)
  ) {
    const resolvedMatchKind: ListingPropertyMatchKind = matchKind ?? 'source_exact';
    return basePlan(input, resolution.sourceName, {
      canonicalUrl: serviceCanonicalUrl,
      sourceListingId: serviceSourceListingId,
      sourceListingIdKind: serviceSourceListingIdKind,
      validationState: 'valid',
      matchState: 'matched',
      watchState: 'not_required',
      reasonCode: toMatchedReasonCode(resolvedMatchKind),
      title: displayTitle,
      description: displayDescription,
      imageUrl: displayImageUrl,
      askingPrice: displayPrice,
      currency: displayCurrency,
      address: validation.address ?? null,
      matchedPropertyId: matchedPropertyId ?? input.property.id,
      aliases,
      propertyMatchKind: resolvedMatchKind,
      sourceStatus: validation.sourceStatus ?? 'available',
    });
  }

  if (validation.state === 'matched' || validation.state === 'invalid') {
    return basePlan(input, resolution.sourceName, {
      canonicalUrl: serviceCanonicalUrl,
      sourceListingId: serviceSourceListingId,
      sourceListingIdKind: serviceSourceListingIdKind,
      validationState: 'invalid',
      matchState: 'mismatch',
      watchState: 'not_required',
      reasonCode: 'address_mismatch',
      title: displayTitle,
      description: displayDescription,
      imageUrl: displayImageUrl,
      askingPrice: displayPrice,
      currency: displayCurrency,
      address: validation.address ?? null,
      matchedPropertyId,
      aliases,
      propertyMatchKind: 'source_mismatch',
      sourceStatus: validation.sourceStatus ?? 'invalid',
    });
  }

  if (validation.state === 'not_found') {
    return basePlan(input, resolution.sourceName, {
      canonicalUrl: serviceCanonicalUrl,
      sourceListingId: serviceSourceListingId,
      sourceListingIdKind: serviceSourceListingIdKind,
      validationState: 'invalid',
      matchState: 'unverified',
      watchState: 'not_required',
      reasonCode: 'source_not_found',
      title: displayTitle,
      description: displayDescription,
      imageUrl: displayImageUrl,
      askingPrice: displayPrice,
      currency: displayCurrency,
      address: validation.address ?? null,
      aliases,
      propertyMatchKind: matchKind ?? 'source_unmatched',
      sourceStatus: validation.sourceStatus ?? 'not_found',
    });
  }

  if (validation.state === 'unsupported') {
    return basePlan(input, resolution.sourceName, {
      canonicalUrl: serviceCanonicalUrl,
      sourceListingId: serviceSourceListingId,
      sourceListingIdKind: serviceSourceListingIdKind,
      validationState: 'provisional',
      matchState: 'unsupported',
      watchState: 'unsupported',
      reasonCode: 'source_not_supported',
      title: displayTitle,
      description: displayDescription,
      imageUrl: displayImageUrl,
      askingPrice: displayPrice,
      currency: displayCurrency,
      address: validation.address ?? null,
      aliases,
      propertyMatchKind: matchKind ?? 'source_unmatched',
      sourceStatus: validation.sourceStatus ?? 'unknown',
    });
  }

  return basePlan(input, resolution.sourceName, {
    canonicalUrl: serviceCanonicalUrl,
    sourceListingId: serviceSourceListingId,
    sourceListingIdKind: serviceSourceListingIdKind,
    validationState: 'provisional',
    matchState: 'unverified',
    watchState: 'will_enqueue',
    reasonCode: toReasonCodeForTemporaryFailure(validation.state),
    title: displayTitle,
    description: displayDescription,
    imageUrl: displayImageUrl,
    askingPrice: displayPrice,
    currency: displayCurrency,
    address: validation.address ?? null,
    aliases,
    propertyMatchKind: matchKind ?? 'source_unmatched',
    sourceStatus: validation.sourceStatus ?? 'unknown',
  });
}

export async function buildListingPreviewPlan(input: BuildListingPreviewPlanInput): Promise<ListingPreviewPlan> {
  const detectedSourceName = detectSourceName(input.rawUrl);
  if (!isSourceServiceBacked(detectedSourceName)) {
    return basePlan(input, detectedSourceName, {
      watchState: 'unsupported',
      matchState: 'unsupported',
      reasonCode: 'source_not_supported',
    });
  }

  let resolution: ListingSourceResolution;
  try {
    resolution = await resolveListingSourceUrl(input.rawUrl, detectedSourceName);
  } catch (error) {
    if (!(error instanceof SourceServiceTemporaryError)) {
      throw error;
    }
    return basePlan(input, detectedSourceName, {
      reasonCode: 'mirror_unavailable',
    });
  }

  if (!resolution.supported) {
    return basePlan(input, resolution.sourceName, {
      watchState: 'unsupported',
      matchState: 'unsupported',
      reasonCode: toUnsupportedReasonCode(resolution.reasonCode),
    });
  }

  let validation: ListingValidationResponse;
  try {
    validation = await validateListingSource({
      sourceName: resolution.sourceName,
      rawUrl: input.rawUrl,
      canonicalUrl: resolution.canonicalUrl,
      sourceListingId: resolution.sourceListingId,
      sourceListingIdKind: resolution.sourceListingIdKind,
      aliases: resolution.aliases,
      property: input.property,
    });
  } catch (error) {
    if (!(error instanceof SourceServiceTemporaryError)) {
      throw error;
    }
    return buildProvisionalPlanFromSupportedResolution(input, resolution, 'mirror_unavailable');
  }

  return buildPlanFromValidation(input, resolution, validation);
}

export function toPublicListingPreviewResponse(plan: ListingPreviewPlan): PublicListingPreviewPlan {
  const {
    propertyMatchKind: _propertyMatchKind,
    sourceStatus: _sourceStatus,
    ...publicPlan
  } = plan;
  return publicPlan;
}

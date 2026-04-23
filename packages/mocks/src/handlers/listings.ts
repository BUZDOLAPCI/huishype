/**
 * Listing API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getAllListingDomains, getSourceNameForDomain } from '@huishype/shared/config';
import { previewListingSchema, submitListingSchema } from '@huishype/shared/utils';
import type {
  ListingPreviewResponse,
  ListingReadItem,
  ListingSubmitResult,
  ListingValidationState,
} from '@huishype/shared';
import { mockListings, mockPropertyDetails, getMockProperty } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALL_LISTING_DOMAINS = getAllListingDomains();

function detectSourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return getSourceNameForDomain(hostname) ?? 'other';
  } catch {
    return 'other';
  }
}

function canonicalizeMockUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  parsed.search = '';
  parsed.hash = '';

  const sourceName = detectSourceName(rawUrl);
  if (sourceName === 'funda') {
    const detailId = parsed.pathname.match(/\/detail(?:\/.*)?\/(\d+)\/?$/)?.[1];
    return {
      canonicalUrl: detailId ? `https://www.funda.nl/detail/${detailId}` : parsed.toString(),
      sourceListingId: detailId ?? null,
      sourceListingIdKind: detailId ? 'tiny_id' : null,
    };
  }

  if (sourceName === 'pararius') {
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const sourceListingId = pathParts.find((part) => /^[a-f0-9]{8}$/i.test(part)) ?? null;
    return {
      canonicalUrl: parsed.toString(),
      sourceListingId,
      sourceListingIdKind: sourceListingId ? 'url_path' : null,
    };
  }

  return {
    canonicalUrl: parsed.toString(),
    sourceListingId: null,
    sourceListingIdKind: null,
  };
}

function getMockPriceType(rawUrl: string): 'sale' | 'rent' | 'unknown' {
  const lowerUrl = rawUrl.toLowerCase();
  if (lowerUrl.includes('/huur/') || lowerUrl.includes('for-rent')) return 'rent';
  if (lowerUrl.includes('/koop/') || lowerUrl.includes('for-sale')) return 'sale';
  return 'unknown';
}

function getMockPreviewState(rawUrl: string): {
  validationState: ListingValidationState;
  matchState: ListingPreviewResponse['matchState'];
  watchState: ListingPreviewResponse['watchState'];
  reasonCode: ListingPreviewResponse['reasonCode'];
  matchedPropertyId: string | null;
} {
  if (rawUrl.includes('mismatch')) {
    return {
      validationState: 'invalid',
      matchState: 'mismatch',
      watchState: 'not_required',
      reasonCode: 'address_mismatch',
      matchedPropertyId: null,
    };
  }
  if (rawUrl.includes('pending') || rawUrl.includes('unavailable')) {
    return {
      validationState: 'provisional',
      matchState: 'unverified',
      watchState: 'will_enqueue',
      reasonCode: 'mirror_unavailable',
      matchedPropertyId: null,
    };
  }
  return {
    validationState: 'valid',
    matchState: 'matched',
    watchState: 'not_required',
    reasonCode: 'source_identity_match',
    matchedPropertyId: null,
  };
}

function buildMockPreviewResponse(
  rawUrl: string,
  property: NonNullable<ReturnType<typeof getMockProperty>>,
  submittedPropertyId: string
): ListingPreviewResponse {
  const sourceName = detectSourceName(rawUrl);
  const identity = canonicalizeMockUrl(rawUrl);
  const state = getMockPreviewState(rawUrl);
  return {
    sourceName,
    rawUrl,
    canonicalUrl: identity.canonicalUrl,
    sourceListingId: identity.sourceListingId,
    sourceListingIdKind: identity.sourceListingIdKind,
    validationState: state.validationState,
    matchState: state.matchState,
    watchState: state.watchState,
    reasonCode: state.reasonCode,
    title: `Te koop: ${property.address}`,
    description: `A mock listing for ${property.address}`,
    imageUrl: 'https://example.com/listing-preview.jpg',
    askingPrice: property.activeListing?.askingPrice ?? null,
    priceType: getMockPriceType(rawUrl),
    currency: 'EUR',
    address: `${property.address}, ${property.postalCode} ${property.city}`,
    submittedPropertyId,
    matchedPropertyId:
      state.matchState === 'matched' ? submittedPropertyId : state.matchedPropertyId,
  };
}

function resolveMockProperty(propertyId: string) {
  return (
    getMockProperty(propertyId) ??
    (UUID_SHAPE_REGEX.test(propertyId) ? mockPropertyDetails[0] : null)
  );
}

function validationError(details: unknown) {
  return HttpResponse.json(
    {
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    },
    { status: 400 }
  );
}

export const listingHandlers = [
  /**
   * GET /properties/:id/listings - Get listings for a property
   */
  http.get('*/properties/:propertyId/listings', ({ params }) => {
    const { propertyId } = params;

    const property = resolveMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    const listings: ListingReadItem[] = mockListings
      .filter((l) => l.propertyId === property.id)
      .map((listing) => {
        const identity = canonicalizeMockUrl(listing.sourceUrl);
        const verificationState = listing.userSubmitted ? 'validation_pending' : 'validated';
        return {
          id: listing.id,
          propertyId: listing.propertyId,
          sourceUrl: listing.sourceUrl,
          canonicalUrl: identity.canonicalUrl,
          displayUrl: identity.canonicalUrl,
          sourceName: listing.sourceName,
          sourceListingId: identity.sourceListingId,
          sourceListingIdKind: identity.sourceListingIdKind,
          askingPrice: listing.askingPrice ?? null,
          priceType: listing.priceType ?? null,
          currency: listing.currency ?? 'EUR',
          thumbnailUrl: listing.thumbnailUrl ?? null,
          ogTitle: listing.title ?? null,
          livingAreaM2: null,
          numRooms: null,
          energyLabel: null,
          status: listing.status,
          validationState: listing.userSubmitted ? 'provisional' : 'valid',
          matchState: listing.userSubmitted ? 'unverified' : 'matched',
          watchState: listing.userSubmitted ? 'queued' : 'not_required',
          verificationState,
          originSummary: listing.userSubmitted ? 'user' : 'mirror',
          reasonCode: listing.userSubmitted ? 'validation_pending' : 'source_identity_match',
          createdAt: new Date(listing.discoveredAt).toISOString(),
        };
      });

    return HttpResponse.json({
      data: listings,
    });
  }),

  /**
   * GET /properties/:id/price-history - Get price history for a property
   */
  http.get('*/properties/:propertyId/price-history', ({ params }) => {
    const { propertyId } = params;

    const property = resolveMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json([
      {
        price: property.activeListing?.askingPrice ?? 500000,
        priceDate: '2024-11-15T10:00:00Z',
        eventType: 'listed',
        source: 'listing',
      },
    ]);
  }),

  /**
   * POST /listings/preview - Preview a listing URL
   */
  http.post('*/listings/preview', async ({ request }) => {
    const body = (await request.json()) as unknown;
    const parsed = previewListingSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error.issues);
    }

    const property = resolveMockProperty(parsed.data.propertyId);

    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    if (!parsed.data.url.startsWith('https://')) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    const hostname = new URL(parsed.data.url).hostname.toLowerCase();
    if (
      !ALL_LISTING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    ) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    return HttpResponse.json(
      buildMockPreviewResponse(parsed.data.url, property, parsed.data.propertyId)
    );
  }),

  /**
   * POST /listings/submit - Submit a listing URL
   */
  http.post('*/listings/submit', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as unknown;
    const parsed = submitListingSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error.issues);
    }

    const property = resolveMockProperty(parsed.data.propertyId);

    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    if (!parsed.data.url.startsWith('https://')) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    const hostname = new URL(parsed.data.url).hostname.toLowerCase();
    if (
      !ALL_LISTING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    ) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    const preview = buildMockPreviewResponse(parsed.data.url, property, parsed.data.propertyId);
    if (preview.validationState === 'invalid' || preview.matchState === 'mismatch') {
      return HttpResponse.json(
        {
          error: 'LISTING_VALIDATION_FAILED',
          message: 'This listing does not match this property.',
          reasonCode: preview.reasonCode,
        },
        { status: 422 }
      );
    }

    const response: ListingSubmitResult = {
      id: '11111111-1111-4111-8111-111111111111',
      propertyId: parsed.data.propertyId,
      sourceUrl: parsed.data.url,
      sourceName: preview.sourceName,
      status: 'active',
      createdAt: new Date().toISOString(),
      canonicalListingId: '11111111-1111-4111-8111-111111111111',
      canonicalUrl: preview.canonicalUrl,
      displayUrl: preview.canonicalUrl ?? parsed.data.url,
      sourceListingId: preview.sourceListingId,
      sourceListingIdKind: preview.sourceListingIdKind,
      validationState: preview.validationState,
      matchState: preview.matchState,
      watchState: preview.watchState,
      verificationState:
        preview.validationState === 'valid' && preview.matchState === 'matched'
          ? 'validated'
          : 'validation_pending',
      reasonCode: preview.reasonCode,
    };

    return HttpResponse.json(response, { status: 201 });
  }),
];

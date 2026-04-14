/**
 * Listing API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getAllListingDomains, getSourceNameForDomain } from '@huishype/shared/config';
import { previewListingSchema, submitListingSchema } from '@huishype/shared/utils';
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

function resolveMockProperty(propertyId: string) {
  return getMockProperty(propertyId) ?? (UUID_SHAPE_REGEX.test(propertyId) ? mockPropertyDetails[0] : null);
}

function validationError(details: unknown) {
  return HttpResponse.json(
    {
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    },
    { status: 400 },
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

    const listings = mockListings
      .filter((l) => l.propertyId === property.id)
      .map((listing) => ({
        id: listing.id,
        sourceUrl: listing.sourceUrl,
        sourceName: listing.sourceName,
        askingPrice: listing.askingPrice ?? null,
        priceType: null,
        thumbnailUrl: listing.thumbnailUrl ?? null,
        ogTitle: listing.title ?? null,
        livingAreaM2: null,
        numRooms: null,
        energyLabel: null,
        status: listing.status,
        createdAt: new Date(listing.discoveredAt).toISOString(),
      }));

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
    const body = await request.json() as unknown;
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
    if (!ALL_LISTING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      ogTitle: `Te koop: ${property.address}`,
      ogImage: 'https://example.com/listing-preview.jpg',
      ogDescription: `A mock listing for ${property.address}`,
      sourceName: detectSourceName(parsed.data.url),
      addressMatch: true,
      warning: null,
    });
  }),

  /**
   * POST /listings/submit - Submit a listing URL
   */
  http.post('*/listings/submit', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as unknown;
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
    if (!ALL_LISTING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return HttpResponse.json(
        { error: 'INVALID_URL', message: 'URL must be from a recognized listing platform.' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      id: '11111111-1111-4111-8111-111111111111',
      propertyId: parsed.data.propertyId,
      sourceUrl: parsed.data.url,
      sourceName: detectSourceName(parsed.data.url),
      status: 'active',
      createdAt: new Date().toISOString(),
    }, { status: 201 });
  }),
];

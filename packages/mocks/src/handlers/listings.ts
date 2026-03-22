/**
 * Listing API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockListings, getMockProperty } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

export const listingHandlers = [
  /**
   * GET /properties/:id/listings - Get listings for a property
   */
  http.get('/properties/:propertyId/listings', ({ params }) => {
    const { propertyId } = params;

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    const listings = mockListings.filter((l) => l.propertyId === propertyId);

    return HttpResponse.json({
      listings,
      total: listings.length,
    });
  }),

  /**
   * GET /properties/:id/price-history - Get price history for a property
   */
  http.get('/properties/:propertyId/price-history', ({ params }) => {
    const { propertyId } = params;

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    // Return mock price history
    return HttpResponse.json({
      history: [
        {
          date: '2024-11-15T10:00:00Z',
          price: property.activeListing?.askingPrice ?? 500000,
          source: 'listing',
        },
      ],
    });
  }),

  /**
   * POST /listings/preview - Preview a listing URL
   */
  http.post('/listings/preview', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as { url: string };

    return HttpResponse.json({
      url: body.url,
      title: 'Mock Listing Preview',
      description: 'A beautiful property in Amsterdam',
      imageUrl: 'https://example.com/listing-preview.jpg',
      price: 475000,
      source: 'funda',
    });
  }),

  /**
   * POST /listings/submit - Submit a listing URL
   */
  http.post('/listings/submit', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as { url: string };

    return HttpResponse.json({
      id: `listing-${Date.now()}`,
      url: body.url,
      status: 'pending',
      message: 'Listing submitted for review',
    }, { status: 201 });
  }),
];

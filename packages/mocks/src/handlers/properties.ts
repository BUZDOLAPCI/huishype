/**
 * Property API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import {
  mockMapProperties,
  mockPropertyDetails,
  mockPropertySummaries,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type { PropertyResolveResponse } from '@huishype/shared';

export const propertyHandlers = [
  /**
   * GET /properties - List properties
   */
  http.get('/properties', ({ request }) => {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const page = parseInt(url.searchParams.get('page') || '1', 10);

    const start = (page - 1) * limit;
    const items = mockPropertySummaries.slice(start, start + limit);

    return HttpResponse.json({
      items,
      pagination: {
        page,
        limit,
        total: mockPropertySummaries.length,
        hasMore: start + limit < mockPropertySummaries.length,
      },
    });
  }),

  /**
   * GET /properties/resolve - Resolve address to property
   */
  http.get('/properties/resolve', ({ request }) => {
    const url = new URL(request.url);
    const postalCode = url.searchParams.get('postalCode');
    const houseNumber = url.searchParams.get('houseNumber');

    if (!postalCode || !houseNumber) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'postalCode and houseNumber are required' },
        { status: 400 }
      );
    }

    const response: PropertyResolveResponse = {
      id: 'a0000000-0000-4000-a000-000000000001',
      address: `Mockstraat ${houseNumber}, ${postalCode} Amsterdam`,
      postalCode: postalCode.replace(/\s/g, '').toUpperCase(),
      city: 'Amsterdam',
      coordinates: { lon: 4.8952, lat: 52.3702 },
      hasListing: true,
      officialValuation: 450000,
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/nearby - Nearby properties
   */
  http.get('/properties/nearby', ({ request }) => {
    const url = new URL(request.url);
    const cluster = url.searchParams.get('cluster');
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    if (cluster === 'true') {
      // Return a single result in cluster-aware format
      return HttpResponse.json({
        type: 'single' as const,
        id: 'prop-001',
        address: 'Prinsengracht 263',
        city: 'Amsterdam',
        postalCode: '1016 GV',
        officialValuation: 2850000,
        hasListing: true,
        askingPrice: 2950000,
        activityScore: 85,
        distanceMeters: 12,
        geometry: { type: 'Point', coordinates: [4.884, 52.3752] },
      });
    }

    // Return array of nearby properties
    return HttpResponse.json(
      mockMapProperties.slice(0, limit).map((p, i) => ({
        id: p.id,
        address: `Mock address ${i}`,
        city: 'Amsterdam',
        postalCode: '1016 GV',
        officialValuation: 450000,
        hasListing: !p.isGhost,
        activityScore: 50,
        distanceMeters: i * 10 + 5,
        geometry: { type: 'Point', coordinates: [p.coordinates.lon, p.coordinates.lat] },
      }))
    );
  }),

  /**
   * GET /properties/batch - Batch property lookup
   */
  http.get('/properties/batch', ({ request }) => {
    const url = new URL(request.url);
    const ids = url.searchParams.get('ids')?.split(',') || [];

    const results = ids
      .map((id) => getMockProperty(id))
      .filter(Boolean)
      .map((p) => ({
        id: p!.id,
        nationalId: p!.nationalId,
        address: p!.address,
        city: p!.city,
        postalCode: p!.postalCode,
        geometry: { type: 'Point', coordinates: [p!.coordinates.lon, p!.coordinates.lat] },
        yearBuilt: p!.yearBuilt,
        floorAreaM2: p!.floorAreaM2,
        status: 'active',
        officialValuation: p!.officialValuation,
        hasListing: !!p!.activeListing,
        askingPrice: p!.activeListing?.askingPrice ?? null,
        commentCount: p!.activity.commentCount,
        guessCount: p!.activity.guessCount,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-12-01T00:00:00Z',
      }));

    return HttpResponse.json(results);
  }),

  /**
   * GET /properties/:id - Get property details
   */
  http.get('/properties/:propertyId', ({ params }) => {
    const { propertyId } = params;
    const property = getMockProperty(propertyId as string);

    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json(property);
  }),

  /**
   * POST /properties/:id/save - Save a property
   */
  http.post('/properties/:propertyId/save', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(params.propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({ saved: true });
  }),

  /**
   * DELETE /properties/:id/save - Unsave a property
   */
  http.delete('/properties/:propertyId/save', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(params.propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /saved-properties - Get saved properties
   */
  http.get('*/saved-properties', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // Return a deterministic saved subset that matches the live envelope shape.
    const saved = mockPropertyDetails.slice(0, 2);
    const paged = saved.slice(offset, offset + limit).map((property, index) => ({
      id: property.id,
      nationalId: property.nationalId,
      countryCode: property.countryCode,
      region: property.region ?? null,
      street: property.streetName,
      houseNumber: Number.parseInt(property.houseNumber, 10) || 0,
      houseNumberAddition: property.houseNumberAddition ?? null,
      address: property.address,
      city: property.city,
      postalCode: property.postalCode ?? null,
      geometry: {
        type: 'Point' as const,
        coordinates: [property.coordinates.lon, property.coordinates.lat] as [number, number],
      },
      yearBuilt: property.yearBuilt ?? null,
      floorAreaM2: property.floorAreaM2 ?? null,
      status: 'active' as const,
      officialValuation: property.officialValuation ?? null,
      hasListing: Boolean(property.activeListing),
      askingPrice: property.activeListing?.askingPrice ?? null,
      commentCount: property.activity.commentCount,
      guessCount: property.activity.guessCount,
      savedAt: new Date(Date.now() - index * 60_000).toISOString(),
      createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2024-12-01T00:00:00.000Z').toISOString(),
    }));
    const total = saved.length;

    return HttpResponse.json({
      data: paged,
      total,
      hasMore: offset + limit < total,
    });
  }),

  /**
   * POST /properties/:id/like - Like a property
   */
  http.post('/properties/:propertyId/like', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
    return HttpResponse.json({ liked: true });
  }),

  /**
   * DELETE /properties/:id/like - Unlike a property
   */
  http.delete('/properties/:propertyId/like', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * POST /properties/:id/view - Track property view
   */
  http.post('/properties/:propertyId/view', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /properties/:id/my-guess - Get user's guess for a property
   */
  http.get('/properties/:propertyId/my-guess', ({ params, request }) => {
    const { propertyId } = params;
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    const guess = getMockGuesses(propertyId as string).find(
      (g) => g.userId === authUser.id
    );

    if (!guess) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'No guess found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      guess,
      consensus: {
        alignmentPercentage: 85,
        alignsWithTopPredictors: true,
        message: 'Your guess aligns with 85% of top predictors',
      },
      updatedFmv: property.fmv,
    });
  }),

];

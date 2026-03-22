/**
 * Property API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import {
  mockMapProperties,
  mockPropertyClusters,
  mockPropertySummaries,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type {
  GetMapPropertiesResponse,
  PropertyResolveResponse,
} from '@huishype/shared';

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
        { code: 'BAD_REQUEST', message: 'postalCode and houseNumber are required' },
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
        { code: 'NOT_FOUND', message: 'Property not found' },
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
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(params.propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
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
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(params.propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /saved-properties - Get saved properties
   */
  http.get('/saved-properties', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);

    // Return first 2 properties as "saved"
    const items = mockPropertySummaries.slice(0, 2);

    return HttpResponse.json({
      items,
      pagination: {
        page,
        limit: pageSize,
        total: items.length,
        hasMore: false,
      },
    });
  }),

  /**
   * POST /properties/:id/like - Like a property
   */
  http.post('/properties/:propertyId/like', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
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
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
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
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    const guess = getMockGuesses(propertyId as string).find(
      (g) => g.userId === authUser.id
    );

    if (!guess) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'No guess found' },
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

  /**
   * POST /properties/map - Get properties for map display
   */
  http.post('/properties/map', async ({ request }) => {
    const body = await request.json() as {
      bounds: { north: number; south: number; east: number; west: number };
      zoom: number;
      filters?: {
        minPrice?: number;
        maxPrice?: number;
        activityLevel?: string[];
        hasListing?: boolean;
      };
    };

    const { bounds, zoom, filters } = body;

    let properties = mockMapProperties.filter((p) => {
      const { lat, lon } = p.coordinates;
      return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lon >= bounds.west &&
        lon <= bounds.east
      );
    });

    if (filters) {
      if (filters.minPrice !== undefined) {
        properties = properties.filter(
          (p) => p.askingPrice === undefined || p.askingPrice >= filters.minPrice!
        );
      }
      if (filters.maxPrice !== undefined) {
        properties = properties.filter(
          (p) => p.askingPrice === undefined || p.askingPrice <= filters.maxPrice!
        );
      }
      if (filters.activityLevel?.length) {
        properties = properties.filter((p) =>
          filters.activityLevel!.includes(p.activityLevel)
        );
      }
      if (filters.hasListing !== undefined) {
        properties = properties.filter((p) =>
          filters.hasListing ? !p.isGhost : p.isGhost
        );
      }
    }

    const response: GetMapPropertiesResponse =
      zoom < 12
        ? {
            properties: [],
            clusters: mockPropertyClusters.filter((c) => {
              return (
                c.coordinates.lat >= bounds.south &&
                c.coordinates.lat <= bounds.north &&
                c.coordinates.lon >= bounds.west &&
                c.coordinates.lon <= bounds.east
              );
            }),
          }
        : {
            properties,
            clusters: [],
          };

    return HttpResponse.json(response);
  }),
];

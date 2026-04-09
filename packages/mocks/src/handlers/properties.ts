/**
 * Property API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import {
  mockPropertyDetails,
  mockPropertySummaries,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type { PropertyResolveResponse } from '@huishype/shared';

const MOCK_NEARBY_CLUSTER_IDS = [
  'a0000000-0000-4000-a000-000000000001',
  'a0000000-0000-4000-a000-000000000002',
  'a0000000-0000-4000-a000-000000000003',
  'a0000000-0000-4000-a000-000000000004',
  'a0000000-0000-4000-a000-000000000005',
  'a0000000-0000-4000-a000-000000000006',
];

const MOCK_NEARBY_ACTIVE_SINGLE_ID = 'a0000000-0000-4000-a000-000000000007';
const MOCK_NEARBY_GHOST_SINGLE_ID = 'a0000000-0000-4000-a000-000000000008';

function buildNearbySingleResponse({
  nodeClass,
  id,
  property,
  hasListing,
  activityScore,
  activityScoreTotal,
  likeCount,
  commentCount,
  guessCount,
  distanceMeters,
}: {
  nodeClass: 'active' | 'ghost';
  id: string;
  property: (typeof mockPropertyDetails)[number];
  hasListing: boolean;
  activityScore: number;
  activityScoreTotal: number;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  distanceMeters: number;
}) {
  return {
    nodeClass,
    groupKind: 'single' as const,
    primaryPropertyId: id,
    pointCount: 1,
    propertyIds: [id],
    previewPropertyIds: [id],
    coordinate: [property.coordinates.lon, property.coordinates.lat] as [number, number],
    bbox: null,
    countryCode: property.countryCode,
    address: property.address,
    city: property.city,
    postalCode: property.postalCode,
    officialValuation: property.officialValuation ?? null,
    hasListing,
    askingPrice: hasListing ? property.activeListing?.askingPrice ?? null : null,
    activityScore,
    activityScoreTotal,
    likeCount,
    commentCount,
    guessCount,
    thumbnailUrl: hasListing ? property.activeListing?.thumbnailUrl ?? null : null,
    yearBuilt: property.yearBuilt ?? null,
    floorAreaM2: property.floorAreaM2 ?? null,
    distanceMeters,
  };
}

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
    const countryCode = (url.searchParams.get('countryCode') || 'NL').toUpperCase();

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
      countryCode,
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/nearby - Nearby properties
   */
  http.get('/properties/nearby', ({ request }) => {
    const url = new URL(request.url);
    const zoom = Number.parseFloat(url.searchParams.get('zoom') || '17');
    const lon = Number.parseFloat(url.searchParams.get('lon') || '0');
    const lat = Number.parseFloat(url.searchParams.get('lat') || '0');

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'lon and lat are required' },
        { status: 400 },
      );
    }

    // Match the live endpoint's null branch for taps with no nearby grouped feature.
    if (lon < 4 || lat > 54) {
      return HttpResponse.json(null);
    }

    if (zoom < 14) {
      return HttpResponse.json({
        nodeClass: 'active' as const,
        groupKind: 'cluster' as const,
        primaryPropertyId: MOCK_NEARBY_CLUSTER_IDS[0],
        pointCount: 6,
        propertyIds: MOCK_NEARBY_CLUSTER_IDS,
        previewPropertyIds: MOCK_NEARBY_CLUSTER_IDS,
        coordinate: [4.884, 52.3752] as [number, number],
        bbox: [4.8836, 52.3748, 4.8844, 52.3756] as [number, number, number, number],
        countryCode: null,
        address: null,
        city: null,
        postalCode: null,
        officialValuation: null,
        hasListing: true,
        askingPrice: null,
        activityScore: 85,
        activityScoreTotal: 210,
        likeCount: 12,
        commentCount: 4,
        guessCount: 3,
        thumbnailUrl: null,
        yearBuilt: null,
        floorAreaM2: null,
        distanceMeters: 12,
      });
    }

    if (zoom >= 17 && lon > 5.3) {
      const property = mockPropertyDetails[3] ?? mockPropertyDetails[0];
      return HttpResponse.json(
        buildNearbySingleResponse({
          nodeClass: 'ghost',
          id: MOCK_NEARBY_GHOST_SINGLE_ID,
          property,
          hasListing: false,
          activityScore: 0,
          activityScoreTotal: 0,
          likeCount: 0,
          commentCount: 0,
          guessCount: 0,
          distanceMeters: 9,
        }),
      );
    }

    const property = mockPropertyDetails[0];
    return HttpResponse.json(
      buildNearbySingleResponse({
        nodeClass: 'active',
        id: MOCK_NEARBY_ACTIVE_SINGLE_ID,
        property,
        hasListing: true,
        activityScore: 85,
        activityScoreTotal: 85,
        likeCount: 12,
        commentCount: 4,
        guessCount: 3,
        distanceMeters: 12,
      }),
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

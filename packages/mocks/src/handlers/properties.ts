/**
 * Property API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import {
  mockComments,
  mockPropertyDetails,
  getMockProperty,
  getMockGuesses,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

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

function getCommentBreakdown(propertyId: string) {
  const comments = mockComments.filter((comment) => comment.propertyId === propertyId);
  const topLevelCommentCount = comments.length;
  const replyCount = comments.reduce((count, comment) => count + comment.replies.length, 0);
  const commentLikeCount = comments.reduce((count, comment) => {
    const replyLikes = comment.replies.reduce((replyTotal, reply) => replyTotal + reply.likes, 0);
    return count + comment.likes + replyLikes;
  }, 0);

  return {
    topLevelCommentCount,
    replyCount,
    commentCount: topLevelCommentCount + replyCount,
    commentLikeCount,
  };
}

function getMockPublicProperty(property: (typeof mockPropertyDetails)[number]) {
  const { topLevelCommentCount, replyCount, commentLikeCount } = getCommentBreakdown(property.id);
  const hasListing = Boolean(property.activeListing);
  const hasActiveListing = hasListing;
  const propertyLikeCount = property.likeCount;
  const socialScore = topLevelCommentCount * 2 + replyCount + propertyLikeCount + property.activity.guessCount;
  const recentSocialScore = Math.min(socialScore, Math.max(1, topLevelCommentCount + replyCount));

  return {
    id: property.id,
    nationalId: property.nationalId,
    countryCode: property.countryCode,
    region: property.region ?? null,
    street: property.streetName,
    houseNumber: Number.parseInt(property.houseNumber, 10) || 0,
    houseNumberAddition: property.houseNumberAddition ?? null,
    address: `${property.address}, ${property.postalCode} ${property.city}`,
    city: property.city,
    postalCode: property.postalCode ?? null,
    geometry: {
      type: 'Point' as const,
      coordinates: [property.coordinates.lon, property.coordinates.lat] as [number, number],
    },
    imageryGeometry: {
      type: 'Point' as const,
      coordinates: [property.coordinates.lon, property.coordinates.lat] as [number, number],
    },
    yearBuilt: property.yearBuilt ?? null,
    floorAreaM2: property.floorAreaM2 ?? null,
    status: 'active' as const,
    officialValuation: property.officialValuation ?? null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-12-01T00:00:00.000Z',
    hasListing,
    hasActiveListing,
    marketState: hasActiveListing ? ('for-sale' as const) : ('not-listed' as const),
    latestListingStatus: hasActiveListing ? ('active' as const) : null,
    askingPrice: property.activeListing?.askingPrice ?? null,
    thumbnailUrl: property.activeListing?.thumbnailUrl ?? null,
    socialScore,
    recentSocialScore,
    lastSocialAt: property.activity.lastActivityAt ?? null,
    topLevelCommentCount,
    replyCount,
    propertyLikeCount,
    commentLikeCount,
    guessCount: property.activity.guessCount,
    viewCount: property.activity.viewCount,
    uniqueViewerCount: property.activity.uniqueViewerCount,
    recentTopLevelCommentCount: Math.min(topLevelCommentCount, 1),
    recentReplyCount: Math.min(replyCount, 1),
    recentPropertyLikeCount: Math.min(propertyLikeCount, 3),
    recentCommentLikeCount: Math.min(commentLikeCount, 2),
    recentGuessCount: Math.min(property.activity.guessCount, 1),
    recentViewCount: Math.min(property.activity.viewCount, 12),
    recentUniqueViewerCount: Math.min(property.activity.uniqueViewerCount, 8),
  };
}

function getMockPropertyDetail(property: (typeof mockPropertyDetails)[number]) {
  const base = getMockPublicProperty(property);

  return {
    ...base,
    commentCount: base.topLevelCommentCount + base.replyCount,
    likeCount: property.likeCount,
    uniqueViewers: property.activity.uniqueViewerCount,
    activityLevel:
      base.recentSocialScore > 0
        ? ('hot' as const)
        : base.hasActiveListing
          ? ('warm' as const)
          : ('cold' as const),
    isLiked: property.isLiked,
    isSaved: property.isSaved,
    fmv: {
      fmv: property.fmv?.value ?? null,
      confidence: property.fmv?.confidence ?? 'none',
      guessCount: property.fmv?.guessCount ?? 0,
      distribution: property.fmv
        ? {
            p10: property.fmv.distribution.min,
            p25: property.fmv.distribution.p25,
            p50: property.fmv.distribution.median,
            p75: property.fmv.distribution.p75,
            p90: property.fmv.distribution.max,
            min: property.fmv.distribution.min,
            max: property.fmv.distribution.max,
          }
        : null,
      officialValuation: property.officialValuation ?? null,
      askingPrice: property.activeListing?.askingPrice ?? null,
      divergence:
        property.fmv?.value != null && property.activeListing?.askingPrice != null
          ? property.fmv.value - property.activeListing.askingPrice
          : null,
    },
  };
}

function buildNearbySingleResponse({
  nodeClass,
  id,
  property,
  hasActiveListing,
  marketState,
  socialCount,
  recentSocialCount,
  socialScoreTotal,
  socialScoreMax,
  recentSocialScoreTotal,
  commentCount,
  distanceMeters,
}: {
  nodeClass: 'active' | 'ghost';
  id: string;
  property: (typeof mockPropertyDetails)[number];
  hasActiveListing: boolean;
  marketState: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed';
  socialCount: number;
  recentSocialCount: number;
  socialScoreTotal: number;
  socialScoreMax: number;
  recentSocialScoreTotal: number;
  commentCount: number;
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
    activeListingCount: hasActiveListing ? 1 : 0,
    socialCount,
    recentSocialCount,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount,
    askingPrice: hasActiveListing ? property.activeListing?.askingPrice ?? null : null,
    thumbnailUrl: hasActiveListing ? property.activeListing?.thumbnailUrl ?? null : null,
    yearBuilt: property.yearBuilt ?? null,
    floorAreaM2: property.floorAreaM2 ?? null,
    hasActiveListing,
    marketState,
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
    const allProperties = mockPropertyDetails.map((property) => getMockPublicProperty(property));
    const data = allProperties.slice(start, start + limit);

    return HttpResponse.json({
      data,
      meta: {
        page,
        limit,
        total: allProperties.length,
        totalPages: Math.ceil(allProperties.length / limit),
      },
    });
  }),

  /**
   * GET /properties/resolve - Resolve address to property
   */
  http.get('*/properties/resolve', ({ request }) => {
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

    const response = {
      id: 'a0000000-0000-4000-a000-000000000001',
      address: `Mockstraat ${houseNumber}, ${postalCode} Amsterdam`,
      postalCode: postalCode.replace(/\s/g, '').toUpperCase(),
      city: 'Amsterdam',
      coordinates: { lon: 4.8952, lat: 52.3702 },
      hasActiveListing: true,
      marketState: 'for-sale' as const,
      officialValuation: 450000,
      countryCode,
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/nearby - Nearby properties
   */
  http.get('*/properties/nearby', ({ request }) => {
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
        activeListingCount: 3,
        socialCount: 4,
        recentSocialCount: 2,
        socialScoreTotal: 210,
        socialScoreMax: 85,
        recentSocialScoreTotal: 94,
        commentCount: 4,
        askingPrice: null,
        thumbnailUrl: null,
        yearBuilt: null,
        floorAreaM2: null,
        hasActiveListing: null,
        marketState: null,
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
          hasActiveListing: false,
          marketState: 'not-listed',
          socialCount: 0,
          recentSocialCount: 0,
          socialScoreTotal: 0,
          socialScoreMax: 0,
          recentSocialScoreTotal: 0,
          commentCount: 0,
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
        hasActiveListing: true,
        marketState: 'for-sale',
        socialCount: 1,
        recentSocialCount: 1,
        socialScoreTotal: 85,
        socialScoreMax: 85,
        recentSocialScoreTotal: 28,
        commentCount: 4,
        distanceMeters: 12,
      }),
    );
  }),

  /**
   * GET /properties/following-viewport - Following-only sparse overlay
   */
  http.get('*/properties/following-viewport', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const bbox = url.searchParams.get('bbox');
    if (!bbox) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'bbox is required' },
        { status: 400 },
      );
    }

    const [first, second] = mockPropertyDetails;
    const items = [first, second]
      .filter((property): property is (typeof mockPropertyDetails)[number] => Boolean(property))
      .filter((property) => {
        const marketState = property.activeListing ? 'for-sale' : 'not-listed';
        const requestedStates = url.searchParams.get('marketState')?.split(',').filter(Boolean) ?? [];
        if (requestedStates.length === 0) {
          return true;
        }
        return requestedStates.includes(marketState);
      })
      .map((property, index) => ({
        id: property.id,
        coordinate: [property.coordinates.lon, property.coordinates.lat] as [number, number],
        address: property.address,
        city: property.city,
        postalCode: property.postalCode ?? null,
        countryCode: property.countryCode,
        askingPrice: property.activeListing?.askingPrice ?? null,
        thumbnailUrl: property.activeListing?.thumbnailUrl ?? null,
        hasActiveListing: Boolean(property.activeListing),
        marketState: property.activeListing ? 'for-sale' as const : 'not-listed' as const,
        activityTypes:
          index === 0
            ? (['property_like', 'comment'] as const)
            : (['price_guess'] as const),
        actorCount: index === 0 ? 2 : 1,
        lastActivityAt: ['2026-04-18T12:00:00.000Z', '2026-04-17T09:30:00.000Z'][index],
      }));

    return HttpResponse.json({ items });
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
      .map((property) => getMockPublicProperty(property!));

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

    return HttpResponse.json(getMockPropertyDetail(property));
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
      ...getMockPublicProperty(property),
      savedAt: new Date(Date.now() - index * 60_000).toISOString(),
      isSaved: true as const,
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
  http.post('*/properties/:propertyId/view', ({ params, request }) => {
    const property = getMockProperty(params.propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 },
      );
    }

    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    const sessionId = request.headers.get('x-session-id');
    if (!authUser && !sessionId) {
      return HttpResponse.json(
        {
          error: 'BAD_REQUEST',
          message: 'Authenticated user or x-session-id header is required.',
        },
        { status: 400 },
      );
    }

    return HttpResponse.json({
      viewCount: property.activity.viewCount + 1,
      uniqueViewers: property.activity.uniqueViewerCount + (sessionId ? 1 : 0),
    });
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

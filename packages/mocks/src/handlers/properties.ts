/**
 * Property API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import {
  PROPERTY_PREVIEW_MEMBER_LIMIT,
  buildFollowingPropertyTileTemplateUrl,
  getMapFilterSearchString,
  isMapActivityFilter,
  parseMapFiltersFromSearchParams,
} from '@huishype/shared';
import type { FollowingPropertyFilters, MapActivityFilter } from '@huishype/shared';
import {
  mockComments,
  mockPropertyDetails,
  getMockProperty,
  getMockGuesses,
  getMockPropertyThumbnailUrl,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import { getMockActivityEvents } from './activity.js';
import { getFollowedUserIds } from './users.js';

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
const MOCK_FOLLOWING_ACTIVITY_NOW_MS = Date.parse('2026-04-21T12:00:00.000Z');
const MOCK_OFFICIAL_VALUATION_EXPECTED_YEAR = 2024;
const MOCK_WOZ_SOURCE_FETCH = {
  source: 'woz' as const,
  expectedValuationYear: MOCK_OFFICIAL_VALUATION_EXPECTED_YEAR,
  supportsClientFetch: {
    web: true,
    native: true,
  },
};
const mockReadPropertyIdsByViewer = new Map<string, Set<string>>();
const mockOfficialValuationOverrides = new Map<
  string,
  {
    officialValuation: number;
    officialValuationYear: number;
  }
>();

export function resetMockReadState(): void {
  mockReadPropertyIdsByViewer.clear();
  mockOfficialValuationOverrides.clear();
}

function normalizePostalCode(postalCode: string) {
  return postalCode.replace(/\s/g, '').toUpperCase();
}

function normalizeAddressPart(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function validationErrorResponse() {
  return HttpResponse.json(
    {
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    },
    { status: 400 }
  );
}

function getMockReadViewerKey(request: Request): string | null {
  const authUser = getMockAuthUser(request.headers.get('Authorization'));
  if (authUser) {
    return `user:${authUser.id}`;
  }

  const sessionId = request.headers.get('x-session-id')?.trim();
  return sessionId ? `session:${sessionId}` : null;
}

function markMockPropertyRead(propertyId: string, viewerKey: string): void {
  const readIds = mockReadPropertyIdsByViewer.get(viewerKey) ?? new Set<string>();
  readIds.add(propertyId);
  mockReadPropertyIdsByViewer.set(viewerKey, readIds);
}

function isMockPropertyRead(propertyId: string, viewerKey: string | null): boolean {
  return viewerKey ? mockReadPropertyIdsByViewer.get(viewerKey)?.has(propertyId) === true : false;
}

function areAllMockPropertiesRead(propertyIds: string[], viewerKey: string | null): boolean {
  return (
    propertyIds.length > 0 &&
    propertyIds.every((propertyId) => isMockPropertyRead(propertyId, viewerKey))
  );
}

function buildReadPropertyTileTemplateUrl(baseUrl: string, searchParams: URLSearchParams): string {
  const filters = parseMapFiltersFromSearchParams(searchParams);
  return `${baseUrl}/tiles/properties/read/{z}/{x}/{y}.pbf${getMapFilterSearchString(filters)}`;
}

function getMockMarketState(
  property: (typeof mockPropertyDetails)[number]
): 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' {
  return property.activeListing ? ('for-sale' as const) : ('not-listed' as const);
}

function getMockOfficialValuation(property: (typeof mockPropertyDetails)[number]) {
  return (
    mockOfficialValuationOverrides.get(property.id) ?? {
      officialValuation: property.officialValuation ?? null,
      officialValuationYear: property.officialValuationYear ?? null,
    }
  );
}

function supportsMockOfficialValuationHydration(property: (typeof mockPropertyDetails)[number]) {
  return property.countryCode === 'NL';
}

function getMockOfficialValuationSourceFetch(property: (typeof mockPropertyDetails)[number]) {
  return supportsMockOfficialValuationHydration(property) ? MOCK_WOZ_SOURCE_FETCH : null;
}

function propertyMatchesFollowingFilters(
  property: (typeof mockPropertyDetails)[number],
  searchParams: URLSearchParams
) {
  const marketState = getMockMarketState(property);
  const requestedStates = searchParams.get('marketState')?.split(',').filter(Boolean) ?? [];
  if (requestedStates.length > 0 && !requestedStates.includes(marketState)) {
    return false;
  }

  const askingPrice = property.activeListing?.askingPrice ?? null;
  const salePriceFrom = searchParams.get('salePriceFrom');
  const salePriceTo = searchParams.get('salePriceTo');
  const rentPriceFrom = searchParams.get('rentPriceFrom');
  const rentPriceTo = searchParams.get('rentPriceTo');

  if ((salePriceFrom || salePriceTo) && marketState !== 'for-sale') {
    return false;
  }

  if ((rentPriceFrom || rentPriceTo) && marketState !== 'for-rent') {
    return false;
  }

  if (salePriceFrom && (askingPrice == null || askingPrice < Number(salePriceFrom))) {
    return false;
  }

  if (salePriceTo && (askingPrice == null || askingPrice > Number(salePriceTo))) {
    return false;
  }

  if (rentPriceFrom && (askingPrice == null || askingPrice < Number(rentPriceFrom))) {
    return false;
  }

  if (rentPriceTo && (askingPrice == null || askingPrice > Number(rentPriceTo))) {
    return false;
  }

  return true;
}

function parseFollowingMapFiltersFromSearchParams(
  searchParams: URLSearchParams
): FollowingPropertyFilters {
  const filters = parseMapFiltersFromSearchParams(searchParams);
  const requestedActivity = searchParams.get('activity');
  const activity: MapActivityFilter =
    isMapActivityFilter(requestedActivity) && requestedActivity !== 'all'
      ? requestedActivity
      : 'all-time';

  return {
    ...filters,
    activity,
  };
}

function followingActivityMatches(createdAt: string, activity: MapActivityFilter) {
  if (activity === 'all' || activity === 'all-time') {
    return true;
  }

  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  const activityWindowMs =
    activity === 'today'
      ? 24 * 60 * 60 * 1000
      : activity === '10d'
        ? 10 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

  return createdAtMs >= MOCK_FOLLOWING_ACTIVITY_NOW_MS - activityWindowMs;
}

function getFollowingActivityByProperty(authUserId: string, searchParams: URLSearchParams) {
  const followedUserIds = new Set(getFollowedUserIds(authUserId));
  const filters = parseFollowingMapFiltersFromSearchParams(searchParams);
  const activityByProperty = new Map<
    string,
    {
      actorIds: Set<string>;
      lastActivityAt: string;
      propertyLikeCount: number;
      commentCount: number;
      guessCount: number;
    }
  >();

  for (const event of getMockActivityEvents()) {
    if (event.eventType === 'save' || !followedUserIds.has(event.actorUserId)) {
      continue;
    }

    if (!followingActivityMatches(event.createdAt, filters.activity ?? 'all-time')) {
      continue;
    }

    const property = getMockProperty(event.propertyId);
    if (!property || !propertyMatchesFollowingFilters(property, searchParams)) {
      continue;
    }

    const aggregate = activityByProperty.get(property.id) ?? {
      actorIds: new Set<string>(),
      lastActivityAt: event.createdAt,
      propertyLikeCount: 0,
      commentCount: 0,
      guessCount: 0,
    };

    aggregate.actorIds.add(event.actorUserId);
    if (Date.parse(event.createdAt) > Date.parse(aggregate.lastActivityAt)) {
      aggregate.lastActivityAt = event.createdAt;
    }

    if (event.eventType === 'property_like') {
      aggregate.propertyLikeCount += 1;
    } else if (event.eventType === 'comment') {
      aggregate.commentCount += 1;
    } else if (event.eventType === 'price_guess') {
      aggregate.guessCount += 1;
    }

    activityByProperty.set(property.id, aggregate);
  }

  return Array.from(activityByProperty.entries())
    .map(([propertyId, aggregate]) => {
      const property = getMockProperty(propertyId);
      if (!property) {
        return null;
      }

      return {
        property,
        aggregate,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      const byTime =
        Date.parse(right.aggregate.lastActivityAt) - Date.parse(left.aggregate.lastActivityAt);
      return byTime !== 0 ? byTime : left.property.id.localeCompare(right.property.id);
    });
}

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

function getMockPublicProperty(
  property: (typeof mockPropertyDetails)[number],
  viewerKey: string | null = null
) {
  const { topLevelCommentCount, replyCount, commentLikeCount } = getCommentBreakdown(property.id);
  const hasListing = Boolean(property.activeListing);
  const hasActiveListing = hasListing;
  const propertyLikeCount = property.likeCount;
  const socialScore =
    topLevelCommentCount * 2 + replyCount + propertyLikeCount + property.activity.guessCount;
  const recentSocialScore = Math.min(socialScore, Math.max(1, topLevelCommentCount + replyCount));
  const valuation = getMockOfficialValuation(property);

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
    officialValuation: valuation.officialValuation,
    officialValuationYear: valuation.officialValuationYear,
    officialValuationSourceFetch: getMockOfficialValuationSourceFetch(property),
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-12-01T00:00:00.000Z',
    hasListing,
    hasActiveListing,
    marketState: hasActiveListing ? ('for-sale' as const) : ('not-listed' as const),
    latestListingStatus: hasActiveListing ? ('active' as const) : null,
    askingPrice: property.activeListing?.askingPrice ?? null,
    thumbnailUrl: getMockPropertyThumbnailUrl(property.id),
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
    isRead: isMockPropertyRead(property.id, viewerKey),
  };
}

function getMockPropertyDetail(
  property: (typeof mockPropertyDetails)[number],
  viewerKey: string | null = null
) {
  const base = getMockPublicProperty(property, viewerKey);

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
      officialValuation: base.officialValuation,
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
  isRead = false,
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
  isRead?: boolean;
}) {
  return {
    nodeClass,
    groupKind: 'single' as const,
    primaryPropertyId: id,
    pointCount: 1,
    propertyIds: [id],
    previewPropertyIds: [id],
    pyramidVersionId: null,
    pyramidNodeId: null,
    membershipComplete: true,
    readStateCoverage: 'complete' as const,
    coordinate: [property.coordinates.lon, property.coordinates.lat] as [number, number],
    bbox: null,
    address: property.address,
    city: property.city,
    activeListingCount: hasActiveListing ? 1 : 0,
    socialCount,
    recentSocialCount,
    socialScoreTotal,
    socialScoreMax,
    recentSocialScoreTotal,
    commentCount,
    askingPrice: hasActiveListing ? (property.activeListing?.askingPrice ?? null) : null,
    thumbnailUrl: getMockPropertyThumbnailUrl(id),
    hasActiveListing,
    marketState,
    distanceMeters,
    isRead,
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
    const houseNumberRaw = url.searchParams.get('houseNumber');
    const houseNumber = Number(houseNumberRaw);
    const houseNumberAddition =
      url.searchParams.get('houseNumberAddition')?.trim().toUpperCase() || null;
    const countryCode = (url.searchParams.get('countryCode') || 'NL').toUpperCase();
    const street = url.searchParams.get('street');
    const city = url.searchParams.get('city');

    if (!postalCode || !houseNumberRaw) {
      return validationErrorResponse();
    }

    if (!Number.isInteger(houseNumber) || houseNumber <= 0) {
      return validationErrorResponse();
    }

    const normalizedPostalCode = normalizePostalCode(postalCode);
    const normalizedStreet = normalizeAddressPart(street);
    const normalizedCity = normalizeAddressPart(city);

    const matches = mockPropertyDetails.filter((property) => {
      if (property.countryCode !== countryCode) {
        return false;
      }

      if (normalizePostalCode(property.postalCode ?? '') !== normalizedPostalCode) {
        return false;
      }

      if (Number(property.houseNumber) !== houseNumber) {
        return false;
      }

      if ((property.houseNumberAddition?.trim().toUpperCase() || null) !== houseNumberAddition) {
        return false;
      }

      if (normalizedStreet && normalizeAddressPart(property.streetName) !== normalizedStreet) {
        return false;
      }

      if (normalizedCity && normalizeAddressPart(property.city) !== normalizedCity) {
        return false;
      }

      return true;
    });

    if (matches.length === 0) {
      return HttpResponse.json(null);
    }

    if (matches.length > 1) {
      return HttpResponse.json(
        {
          error: 'AMBIGUOUS_ADDRESS',
          message:
            'Multiple properties matched this address. Provide street and city to disambiguate.',
        },
        { status: 409 }
      );
    }

    const property = matches[0];
    const publicProperty = getMockPublicProperty(property);
    const response = {
      id: property.id,
      address: `${property.address}, ${normalizedPostalCode} ${property.city}`,
      postalCode: normalizedPostalCode,
      city: property.city,
      coordinates: {
        lon: property.coordinates.lon,
        lat: property.coordinates.lat,
      },
      hasActiveListing: publicProperty.hasActiveListing,
      marketState: publicProperty.marketState,
      officialValuation: publicProperty.officialValuation,
      officialValuationYear: publicProperty.officialValuationYear,
      officialValuationSourceFetch: getMockOfficialValuationSourceFetch(property),
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
    const viewerKey = getMockReadViewerKey(request);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'lon and lat are required' },
        { status: 400 }
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
        propertyIds: [],
        previewPropertyIds: MOCK_NEARBY_CLUSTER_IDS.slice(0, PROPERTY_PREVIEW_MEMBER_LIMIT),
        pyramidVersionId: '9b3b7e0e-7f10-4d8c-9d75-43ce369c7a11',
        pyramidNodeId: 'mock-pyramid-node-public-cluster',
        membershipComplete: false,
        readStateCoverage: 'partial' as const,
        coordinate: [4.884, 52.3752] as [number, number],
        bbox: [4.8836, 52.3748, 4.8844, 52.3756] as [number, number, number, number],
        activeListingCount: 3,
        socialCount: 4,
        recentSocialCount: 2,
        socialScoreTotal: 210,
        socialScoreMax: 85,
        recentSocialScoreTotal: 94,
        commentCount: 4,
        distanceMeters: 12,
        isRead: false,
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
          isRead: areAllMockPropertiesRead([MOCK_NEARBY_GHOST_SINGLE_ID], viewerKey),
        })
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
        isRead: areAllMockPropertiesRead([MOCK_NEARBY_ACTIVE_SINGLE_ID], viewerKey),
      })
    );
  }),

  /**
   * GET /tiles/properties/read.json - Viewer-specific read-state TileJSON
   */
  http.get('*/tiles/properties/read.json', ({ request }) => {
    const viewerKey = getMockReadViewerKey(request);
    if (!viewerKey) {
      return HttpResponse.json(
        {
          error: 'BAD_REQUEST',
          message: 'Authenticated user or x-session-id header is required.',
        },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    return HttpResponse.json({
      tilejson: '2.1.0',
      name: 'HuisHype Read Properties',
      description: 'Viewer-specific read property overlay data with clustering',
      tiles: [buildReadPropertyTileTemplateUrl(url.origin, url.searchParams)],
      minzoom: 0,
      maxzoom: 22,
      bounds: [-180, -85, 180, 85] as [number, number, number, number],
    });
  }),

  /**
   * GET /tiles/properties/read/:z/:x/:y.pbf - Viewer-specific read-state vector tile
   */
  http.get('*/tiles/properties/read/:z/:x/:y.pbf', ({ request }) => {
    const viewerKey = getMockReadViewerKey(request);
    if (!viewerKey) {
      return HttpResponse.json(
        {
          error: 'BAD_REQUEST',
          message: 'Authenticated user or x-session-id header is required.',
        },
        { status: 400 }
      );
    }

    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * GET /tiles/following/properties.json - Authenticated Following TileJSON
   */
  http.get('*/tiles/following/properties.json', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const filters = parseFollowingMapFiltersFromSearchParams(url.searchParams);
    return HttpResponse.json({
      tilejson: '2.1.0',
      name: 'HuisHype Following Properties',
      description: 'Personalized grouped property data from followed-user qualifying activity',
      tiles: [buildFollowingPropertyTileTemplateUrl(url.origin, filters)],
      minzoom: 0,
      maxzoom: 22,
      bounds: [-180, -85, 180, 85] as [number, number, number, number],
    });
  }),

  /**
   * GET /properties/following-nearby - Following grouped nearby lookup
   */
  http.get('*/properties/following-nearby', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const zoom = Number.parseFloat(url.searchParams.get('zoom') || '17');
    const lon = Number.parseFloat(url.searchParams.get('lon') || '0');
    const lat = Number.parseFloat(url.searchParams.get('lat') || '0');

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'lon and lat are required' },
        { status: 400 }
      );
    }

    if (lon < 4 || lat > 54) {
      return HttpResponse.json(null);
    }

    const matching = getFollowingActivityByProperty(authUser.id, url.searchParams);
    if (matching.length === 0) {
      return HttpResponse.json(null);
    }

    if (zoom < 14) {
      const clustered = matching.slice(0, 6);
      const primary = clustered[0]!.property;
      const viewerKey = `user:${authUser.id}`;
      const propertyIds = clustered.map(({ property }) => property.id);
      return HttpResponse.json({
        nodeClass: 'active' as const,
        groupKind: 'cluster' as const,
        primaryPropertyId: primary.id,
        pointCount: clustered.length,
        propertyIds,
        previewPropertyIds: clustered.slice(0, 3).map(({ property }) => property.id),
        pyramidVersionId: null,
        pyramidNodeId: null,
        membershipComplete: true,
        readStateCoverage: 'complete' as const,
        coordinate: [primary.coordinates.lon, primary.coordinates.lat] as [number, number],
        bbox: [
          Math.min(...clustered.map(({ property }) => property.coordinates.lon)),
          Math.min(...clustered.map(({ property }) => property.coordinates.lat)),
          Math.max(...clustered.map(({ property }) => property.coordinates.lon)),
          Math.max(...clustered.map(({ property }) => property.coordinates.lat)),
        ] as [number, number, number, number],
        activeListingCount: clustered.filter(({ property }) => property.activeListing).length,
        socialCount: clustered.length,
        recentSocialCount: clustered.length,
        socialScoreTotal: clustered.reduce(
          (sum, { aggregate }) =>
            sum + aggregate.propertyLikeCount + aggregate.commentCount + aggregate.guessCount,
          0
        ),
        socialScoreMax: Math.max(
          ...clustered.map(
            ({ aggregate }) =>
              aggregate.propertyLikeCount + aggregate.commentCount + aggregate.guessCount
          )
        ),
        recentSocialScoreTotal: clustered.reduce(
          (sum, { aggregate }) => sum + aggregate.commentCount + aggregate.guessCount,
          0
        ),
        commentCount: clustered.reduce((sum, { aggregate }) => sum + aggregate.commentCount, 0),
        distanceMeters: 12,
        isRead: areAllMockPropertiesRead(propertyIds, viewerKey),
      });
    }

    const { property, aggregate } = matching[0]!;
    const hasActiveListing = Boolean(property.activeListing);
    const viewerKey = `user:${authUser.id}`;
    return HttpResponse.json(
      buildNearbySingleResponse({
        nodeClass: 'active',
        id: property.id,
        property,
        hasActiveListing,
        marketState: getMockMarketState(property),
        socialCount: aggregate.actorIds.size,
        recentSocialCount: aggregate.actorIds.size,
        socialScoreTotal:
          aggregate.propertyLikeCount + aggregate.commentCount + aggregate.guessCount,
        socialScoreMax: aggregate.propertyLikeCount + aggregate.commentCount + aggregate.guessCount,
        recentSocialScoreTotal: aggregate.commentCount + aggregate.guessCount,
        commentCount: aggregate.commentCount,
        distanceMeters: 12,
        isRead: isMockPropertyRead(property.id, viewerKey),
      })
    );
  }),

  /**
   * GET /properties/batch - Batch property lookup
   */
  http.get('/properties/batch', ({ request }) => {
    const url = new URL(request.url);
    const ids = url.searchParams.get('ids')?.split(',') || [];
    const viewerKey = getMockReadViewerKey(request);

    const results = ids
      .map((id) => getMockProperty(id))
      .filter(Boolean)
      .map((property) => getMockPublicProperty(property!, viewerKey));

    return HttpResponse.json(results);
  }),

  /**
   * GET /properties/:id - Get property details
   */
  http.get('*/properties/:propertyId', ({ params, request }) => {
    const { propertyId } = params;
    const property = getMockProperty(propertyId as string);

    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json(getMockPropertyDetail(property, getMockReadViewerKey(request)));
  }),

  /**
   * POST /properties/:id/official-valuations/hydrate - Accept client-observed valuation cache.
   */
  http.post('*/properties/:propertyId/official-valuations/hydrate', async ({ params, request }) => {
    const property = getMockProperty(params.propertyId as string);

    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    if (!supportsMockOfficialValuationHydration(property)) {
      return HttpResponse.json({
        propertyId: property.id,
        source: 'woz',
        status: 'unsupported',
        officialValuation: property.officialValuation ?? null,
        officialValuationYear: property.officialValuationYear ?? null,
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      source?: unknown;
      valuation?: unknown;
      valuationYear?: unknown;
    };

    if (body.source !== 'woz') {
      return validationErrorResponse();
    }

    const valuation =
      typeof body.valuation === 'number' && Number.isFinite(body.valuation) ? body.valuation : null;
    const valuationYear =
      typeof body.valuationYear === 'number' && Number.isInteger(body.valuationYear)
        ? body.valuationYear
        : null;

    if (valuation !== null && valuationYear !== null) {
      mockOfficialValuationOverrides.set(property.id, {
        officialValuation: valuation,
        officialValuationYear: valuationYear,
      });
    }

    const accepted = getMockOfficialValuation(property);

    return HttpResponse.json({
      propertyId: property.id,
      source: 'woz',
      status: valuation !== null && valuationYear !== null ? 'accepted' : 'queued',
      officialValuation: accepted.officialValuation,
      officialValuationYear: accepted.officialValuationYear,
    });
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
    const viewerKey = `user:${authUser.id}`;
    const paged = saved.slice(offset, offset + limit).map((property, index) => ({
      ...getMockPublicProperty(property, viewerKey),
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
        { status: 404 }
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
        { status: 400 }
      );
    }

    markMockPropertyRead(property.id, authUser ? `user:${authUser.id}` : `session:${sessionId}`);

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

    const guess = getMockGuesses(propertyId as string).find((g) => g.userId === authUser.id);

    if (!guess) {
      return HttpResponse.json({ error: 'NOT_FOUND', message: 'No guess found' }, { status: 404 });
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

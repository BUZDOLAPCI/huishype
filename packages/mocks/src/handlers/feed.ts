/**
 * Feed API mock handlers
 *
 * Paths match the live Fastify routes.
 * Final feed chips: Trending, Latest, Recent Activity
 * Backend query values for the property feed: trending, latest
 *
 * The design spec maps chips to backend filters:
 *   - "Trending"         → filter=trending
 *   - "Latest"           → filter=latest
 * Recent Activity is a separate /activity feed and is mocked elsewhere.
 */

import { http, HttpResponse } from 'msw';
import { feedQuerySchema } from '@huishype/shared';
import { getMockPropertyThumbnailUrl, mockPropertyDetails } from '../data/fixtures.js';

const MOCK_OFFICIAL_VALUATION_EXPECTED_YEAR = 2025;

function getMockOfficialValuationSourceFetch(countryCode: string) {
  return countryCode === 'NL'
    ? {
        source: 'woz' as const,
        expectedValuationYear: MOCK_OFFICIAL_VALUATION_EXPECTED_YEAR,
        supportsClientFetch: {
          web: false,
          native: false,
        },
      }
    : null;
}

export const feedHandlers = [
  /**
   * GET /feed - Get property feed
   */
  http.get('*/feed', ({ request }) => {
    const url = new URL(request.url);
    const parsedQuery = feedQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsedQuery.success) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
        { status: 400 }
      );
    }

    const { filter, page, limit } = parsedQuery.data;

    // Build deterministic feed items from mock property data
    const feedItems = mockPropertyDetails
      .filter((p) => p.activeListing)
      .map((p) => ({
        id: p.id,
        address: p.address,
        city: p.city,
        zipCode: p.postalCode,
        countryCode: p.countryCode,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.coordinates.lon, p.coordinates.lat] as [number, number],
        },
        askingPrice: p.activeListing?.askingPrice ?? null,
        fmv: p.fmv?.value ?? null,
        officialValuation: p.officialValuation ?? null,
        officialValuationYear: p.officialValuationYear ?? null,
        officialValuationSourceFetch: getMockOfficialValuationSourceFetch(p.countryCode),
        thumbnailUrl: getMockPropertyThumbnailUrl(p.id),
        likeCount: p.activity.likeCount,
        commentCount: p.activity.commentCount,
        guessCount: p.activity.guessCount,
        viewCount: p.activity.viewCount,
        activityLevel:
          p.activity.trend === 'rising'
            ? ('hot' as const)
            : p.activity.trend === 'falling'
              ? ('cold' as const)
              : ('warm' as const),
        marketState: 'for-sale' as const,
        lastActivityAt: p.activity.lastActivityAt ?? new Date().toISOString(),
        hasListing: true,
      }));

    // Sort based on filter
    const sorted = [...feedItems];
    switch (filter) {
      case 'latest':
        sorted.sort(
          (a, b) =>
            new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
        );
        break;
      case 'trending':
      default:
        sorted.sort((a, b) => b.viewCount - a.viewCount);
    }

    const start = (page - 1) * limit;
    const items = sorted.slice(start, start + limit);

    return HttpResponse.json({
      items,
      pagination: {
        page,
        limit,
        hasMore: start + limit < sorted.length,
      },
    });
  }),
];

/**
 * Feed API mock handlers
 *
 * Paths match the live Fastify routes.
 * Final feed chips: Trending, Latest, Recent Activity
 * Backend query values: trending, recent, controversial, price-mismatch
 *
 * The design spec maps chips to backend filters:
 *   - "Trending"         → filter=trending
 *   - "Latest"           → filter=recent
 *   - "Recent Activity"  → filter=controversial  (most active debate)
 */

import { http, HttpResponse } from 'msw';
import { mockPropertyDetails } from '../data/fixtures.js';

export const feedHandlers = [
  /**
   * GET /feed - Get property feed
   */
  http.get('/feed', ({ request }) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter') || 'trending';
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    // Build deterministic feed items from mock property data
    const feedItems = mockPropertyDetails
      .filter((p) => p.activeListing)
      .map((p) => ({
        id: p.id,
        address: p.address,
        city: p.city,
        zipCode: p.postalCode,
        askingPrice: p.activeListing?.askingPrice ?? null,
        fmv: p.fmv?.value ?? null,
        officialValuation: p.officialValuation ?? null,
        thumbnailUrl: p.activeListing?.thumbnailUrl ?? null,
        likeCount: p.activity.likeCount,
        commentCount: p.activity.commentCount,
        guessCount: p.activity.guessCount,
        viewCount: p.activity.viewCount,
        activityLevel: p.activity.trend === 'rising' ? 'hot' as const :
                       p.activity.trend === 'falling' ? 'cold' as const : 'warm' as const,
        lastActivityAt: p.activity.lastActivityAt ?? new Date().toISOString(),
        hasListing: true,
      }));

    // Sort based on filter
    const sorted = [...feedItems];
    switch (filter) {
      case 'recent':
        sorted.sort((a, b) =>
          new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
        );
        break;
      case 'controversial':
        sorted.sort((a, b) => b.guessCount - a.guessCount);
        break;
      case 'price-mismatch':
        sorted.sort((a, b) => {
          const diffA = Math.abs((a.askingPrice ?? 0) - (a.fmv ?? 0));
          const diffB = Math.abs((b.askingPrice ?? 0) - (b.fmv ?? 0));
          return diffB - diffA;
        });
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
        total: sorted.length,
        hasMore: start + limit < sorted.length,
      },
    });
  }),
];

/**
 * useFeed Hook
 * Fetches the feed from the dedicated /feed backend endpoint.
 * Server-side sorting/filtering replaces the old client-side approach.
 */

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';

// Feed filter types — match the backend enum exactly
export type FeedFilter = 'trending' | 'recent' | 'controversial' | 'price-mismatch';

// Item returned by GET /feed
export interface FeedProperty {
  id: string;
  address: string;
  city: string;
  zipCode: string;
  askingPrice: number | null;
  fmv: number | null;
  wozValue: number | null;
  thumbnailUrl: string | null;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  viewCount: number;
  activityLevel: 'hot' | 'warm' | 'cold';
  lastActivityAt: string;
  hasListing: boolean;
  // Computed on the client from address parts (kept for component compat)
  postalCode: string | null;
  coordinates: { lat: number; lon: number } | null;
  photoUrl?: string;
  fmvValue?: number;
  bouwjaar: number | null;
  oppervlakte: number | null;
}

// Raw response from GET /feed
interface FeedApiResponse {
  items: Array<{
    id: string;
    address: string;
    city: string;
    zipCode: string;
    askingPrice: number | null;
    fmv: number | null;
    wozValue: number | null;
    thumbnailUrl: string | null;
    likeCount: number;
    commentCount: number;
    guessCount: number;
    viewCount: number;
    activityLevel: 'hot' | 'warm' | 'cold';
    lastActivityAt: string;
    hasListing: boolean;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// Query keys
export const feedKeys = {
  all: ['feed'] as const,
  lists: () => [...feedKeys.all, 'list'] as const,
  list: (filter: FeedFilter, city?: string) =>
    [...feedKeys.lists(), { filter, city }] as const,
  infinite: (filter: FeedFilter, city?: string) =>
    [...feedKeys.all, 'infinite', { filter, city }] as const,
};

// Transform API item to FeedProperty (adds compat fields used by PropertyFeedCard)
function transformFeedItem(item: FeedApiResponse['items'][0]): FeedProperty {
  return {
    ...item,
    // PropertyFeedCard compat fields
    postalCode: item.zipCode,
    coordinates: null, // feed endpoint doesn't return geometry
    photoUrl: item.thumbnailUrl ?? undefined,
    fmvValue: item.fmv ?? undefined,
    bouwjaar: null, // not returned by feed endpoint
    oppervlakte: null, // not returned by feed endpoint
  };
}

// Fetch from dedicated /feed endpoint
async function fetchFeed(
  page: number = 1,
  limit: number = 20,
  filter: FeedFilter = 'trending',
  _city?: string
): Promise<{ properties: FeedProperty[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    filter,
  });

  const response = await fetch(`${API_URL}/feed?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  const data: FeedApiResponse = await response.json();

  return {
    properties: data.items.map(transformFeedItem),
    meta: {
      page: data.pagination.page,
      limit: data.pagination.limit,
      total: data.pagination.total,
      totalPages: Math.ceil(data.pagination.total / data.pagination.limit),
    },
  };
}

/**
 * Hook to fetch feed properties with pagination
 */
export function useFeed(filter: FeedFilter = 'trending', city?: string) {
  return useQuery({
    queryKey: feedKeys.list(filter, city),
    queryFn: () => fetchFeed(1, 20, filter, city),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch feed properties with infinite scrolling
 */
export function useInfiniteFeed(filter: FeedFilter = 'trending', city?: string) {
  return useInfiniteQuery({
    queryKey: feedKeys.infinite(filter, city),
    queryFn: ({ pageParam = 1 }) => fetchFeed(pageParam, 20, filter, city),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

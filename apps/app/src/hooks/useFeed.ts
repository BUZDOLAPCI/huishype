/**
 * useFeed Hook
 * Fetches the feed from the dedicated /feed backend endpoint.
 * Server-side sorting/filtering replaces the old client-side approach.
 */

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import type { FeedTab, PropertyFeedFilter } from '@huishype/shared';

export type { FeedTab, PropertyFeedFilter } from '@huishype/shared';

// Item returned by GET /feed
export interface FeedProperty {
  id: string;
  address: string;
  city: string;
  zipCode: string;
  askingPrice: number | null;
  fmv: number | null;
  officialValuation: number | null;
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
  yearBuilt: number | null;
  floorAreaM2: number | null;
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
    officialValuation: number | null;
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
    hasMore: boolean;
  };
}

// Query keys
export const feedKeys = {
  all: ['feed'] as const,
  lists: () => [...feedKeys.all, 'list'] as const,
  list: (filter: PropertyFeedFilter, city?: string) =>
    [...feedKeys.lists(), { filter, city }] as const,
  infinite: (filter: PropertyFeedFilter, city?: string) =>
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
    yearBuilt: null, // not returned by feed endpoint
    floorAreaM2: null, // not returned by feed endpoint
  };
}

// Fetch from dedicated /feed endpoint
async function fetchFeed(
  page: number = 1,
  limit: number = 20,
  filter: PropertyFeedFilter = 'trending',
  _city?: string
): Promise<{ properties: FeedProperty[]; meta: { page: number; limit: number; hasMore: boolean } }> {
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
      hasMore: data.pagination.hasMore,
    },
  };
}

/**
 * Hook to fetch feed properties with pagination
 */
export function useFeed(filter: PropertyFeedFilter = 'trending', city?: string) {
  return useQuery({
    queryKey: feedKeys.list(filter, city),
    queryFn: () => fetchFeed(1, 20, filter, city),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch feed properties with infinite scrolling
 */
export function useInfiniteFeed(filter: PropertyFeedFilter = 'trending', city?: string) {
  return useInfiniteQuery({
    queryKey: feedKeys.infinite(filter, city),
    queryFn: ({ pageParam = 1 }) => fetchFeed(pageParam, 20, filter, city),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      return lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * useFeed Hook
 * Fetches the feed from the dedicated /feed backend endpoint.
 * Server-side sorting/filtering replaces the old client-side approach.
 */

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import type { PropertyFeedFilter } from '@huishype/shared';
import { withDerivedPropertyImageData } from '../utils/property-image';

export type { FeedTab, PropertyFeedFilter } from '@huishype/shared';

export interface FeedScope {
  country?: string;
  lat?: number;
  lon?: number;
}

// Item returned by GET /feed
export interface FeedProperty {
  id: string;
  address: string;
  city: string;
  zipCode: string;
  countryCode: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  askingPrice: number | null;
  fmv: number | null;
  officialValuation: number | null;
  officialValuationYear?: number | null;
  thumbnailUrl: string | null;
  aerialImageUrl?: string | null;
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
    countryCode: string;
    geometry: { type: 'Point'; coordinates: [number, number] } | null;
    askingPrice: number | null;
    fmv: number | null;
    officialValuation: number | null;
    officialValuationYear?: number | null;
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
  list: (filter: PropertyFeedFilter, scope?: FeedScope) =>
    [...feedKeys.lists(), { filter, ...scope }] as const,
  infinite: (filter: PropertyFeedFilter, scope?: FeedScope) =>
    [...feedKeys.all, 'infinite', { filter, ...scope }] as const,
};

// Transform API item to FeedProperty (adds compat fields used by PropertyFeedCard)
function transformFeedItem(item: FeedApiResponse['items'][0]): FeedProperty {
  const property = withDerivedPropertyImageData({
    ...item,
    // PropertyFeedCard compat fields
    postalCode: item.zipCode,
    coordinates: item.geometry
      ? { lon: item.geometry.coordinates[0], lat: item.geometry.coordinates[1] }
      : null,
    fmvValue: item.fmv ?? undefined,
    yearBuilt: null, // not returned by feed endpoint
    floorAreaM2: null, // not returned by feed endpoint
  });

  return property;
}

// Fetch from dedicated /feed endpoint
async function fetchFeed(
  page: number = 1,
  limit: number = 20,
  filter: PropertyFeedFilter = 'trending',
  scope?: FeedScope,
): Promise<{ properties: FeedProperty[]; meta: { page: number; limit: number; hasMore: boolean } }> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    filter,
  });

  if (scope?.country) {
    params.set('country', scope.country);
  }

  if (scope?.lat != null) {
    params.set('lat', String(scope.lat));
  }

  if (scope?.lon != null) {
    params.set('lon', String(scope.lon));
  }

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
export function useFeed(
  filter: PropertyFeedFilter = 'trending',
  scope?: FeedScope,
  enabled = true,
) {
  return useQuery({
    queryKey: feedKeys.list(filter, scope),
    queryFn: () => fetchFeed(1, 20, filter, scope),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch feed properties with infinite scrolling
 */
export function useInfiniteFeed(
  filter: PropertyFeedFilter = 'trending',
  scope?: FeedScope,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: feedKeys.infinite(filter, scope),
    queryFn: ({ pageParam = 1 }) => fetchFeed(pageParam, 20, filter, scope),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      return lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined;
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

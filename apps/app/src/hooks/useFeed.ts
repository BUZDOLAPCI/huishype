/**
 * useFeed Hook
 * Provides feed data fetching with TanStack Query
 */

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { FeedType, PropertySummary } from '@huishype/shared';
import { API_URL } from '../utils/api';

// Feed filter types
export type FeedFilter = 'all' | 'new' | 'trending' | 'price_mismatch' | 'polarizing';

// Property response from API (matches backend schema)
interface PropertyApiResponse {
  id: string;
  bagIdentificatie: string | null;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string; // computed display string from backend
  city: string;
  postalCode: string | null;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  } | null;
  bouwjaar: number | null;
  oppervlakte: number | null;
  status: 'active' | 'inactive' | 'demolished';
  wozValue: number | null;
  hasListing: boolean;
  askingPrice: number | null;
  commentCount: number;
  guessCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PropertyListResponse {
  data: PropertyApiResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Feed property type with computed fields
export interface FeedProperty {
  id: string;
  address: string;
  city: string;
  postalCode: string | null;
  coordinates: { lat: number; lon: number } | null;
  wozValue: number | null;
  askingPrice?: number;
  fmvValue?: number;
  activityLevel: 'hot' | 'warm' | 'cold';
  photoUrl?: string;
  commentCount: number;
  guessCount: number;
  viewCount: number;
  bouwjaar: number | null;
  oppervlakte: number | null;
  createdAt: string;
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

// Transform API response to feed property
function transformProperty(property: PropertyApiResponse): FeedProperty {
  // Calculate activity level based on various factors
  // For now, we'll simulate based on creation date recency
  const createdDate = new Date(property.createdAt);
  const now = new Date();
  const daysSinceCreation = Math.floor(
    (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  let activityLevel: 'hot' | 'warm' | 'cold' = 'cold';
  if (daysSinceCreation < 7) {
    activityLevel = 'hot';
  } else if (daysSinceCreation < 30) {
    activityLevel = 'warm';
  }

  // Properties with active listings are at least "warm"
  if (property.hasListing && activityLevel === 'cold') {
    activityLevel = 'warm';
  }

  return {
    id: property.id,
    address: property.address,
    city: property.city,
    postalCode: property.postalCode,
    coordinates: property.geometry
      ? {
          lon: property.geometry.coordinates[0],
          lat: property.geometry.coordinates[1],
        }
      : null,
    wozValue: property.wozValue,
    askingPrice: property.askingPrice ?? undefined,
    fmvValue: undefined, // Will be populated when FMV is calculated
    activityLevel,
    photoUrl: `https://picsum.photos/seed/${property.id}/400/300`, // Placeholder images
    commentCount: property.commentCount,
    guessCount: property.guessCount,
    viewCount: 0, // No view tracking exists yet
    bouwjaar: property.bouwjaar,
    oppervlakte: property.oppervlakte,
    createdAt: property.createdAt,
  };
}

// Fetch properties from API
async function fetchFeedProperties(
  page: number = 1,
  limit: number = 20,
  filter: FeedFilter = 'all',
  city?: string
): Promise<{ properties: FeedProperty[]; meta: PropertyListResponse['meta'] }> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (city) {
    params.append('city', city);
  }

  // Apply filter-based sorting/filtering
  // Note: The backend currently doesn't support these filters,
  // so we'll handle them client-side for now
  const response = await fetch(`${API_URL}/properties?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  const data: PropertyListResponse = await response.json();

  let properties = data.data.map(transformProperty);

  // Apply client-side filtering based on filter type
  switch (filter) {
    case 'new':
      // Sort by most recently created
      properties = properties.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      break;
    case 'trending':
      // Sort by activity level (hot first)
      const activityOrder = { hot: 0, warm: 1, cold: 2 };
      properties = properties.sort(
        (a, b) => activityOrder[a.activityLevel] - activityOrder[b.activityLevel]
      );
      break;
    case 'price_mismatch':
      // Filter to only properties with WOZ value (potential price mismatches)
      properties = properties.filter((p) => p.wozValue !== null);
      break;
    case 'polarizing':
      // Sort by highest engagement (comments + guesses combined)
      // Polarizing properties have high engagement suggesting mixed opinions
      properties = properties.sort(
        (a, b) =>
          b.commentCount + b.guessCount - (a.commentCount + a.guessCount)
      );
      break;
    default:
      // 'all' - no additional filtering
      break;
  }

  return { properties, meta: data.meta };
}

/**
 * Hook to fetch feed properties with pagination
 */
export function useFeed(filter: FeedFilter = 'all', city?: string) {
  return useQuery({
    queryKey: feedKeys.list(filter, city),
    queryFn: () => fetchFeedProperties(1, 20, filter, city),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch feed properties with infinite scrolling
 */
export function useInfiniteFeed(filter: FeedFilter = 'all', city?: string) {
  return useInfiniteQuery({
    queryKey: feedKeys.infinite(filter, city),
    queryFn: ({ pageParam = 1 }) =>
      fetchFeedProperties(pageParam, 20, filter, city),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * useSavedProperties Hook
 * Fetches the authenticated user's saved properties list with pagination.
 */

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import type { FeedProperty } from './useFeed';

interface SavedPropertyApiResponse {
  id: string;
  bagIdentificatie: string | null;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  bouwjaar: number | null;
  oppervlakte: number | null;
  status: 'active' | 'inactive' | 'demolished';
  wozValue: number | null;
  hasListing: boolean;
  askingPrice: number | null;
  commentCount: number;
  guessCount: number;
  savedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface SavedPropertiesApiResponse {
  data: SavedPropertyApiResponse[];
  total: number;
  hasMore: boolean;
}

export const savedPropertyKeys = {
  all: ['saved-properties'] as const,
  list: () => [...savedPropertyKeys.all, 'list'] as const,
};

const PAGE_SIZE = 20;

function transformSavedProperty(property: SavedPropertyApiResponse): FeedProperty {
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
  if (property.hasListing && activityLevel === 'cold') {
    activityLevel = 'warm';
  }

  return {
    id: property.id,
    address: property.address,
    city: property.city,
    postalCode: property.postalCode,
    coordinates: property.geometry
      ? { lon: property.geometry.coordinates[0], lat: property.geometry.coordinates[1] }
      : null,
    wozValue: property.wozValue,
    askingPrice: property.askingPrice ?? undefined,
    fmvValue: undefined,
    activityLevel,
    photoUrl: `https://picsum.photos/seed/${property.id}/400/300`,
    commentCount: property.commentCount,
    guessCount: property.guessCount,
    viewCount: 0,
    bouwjaar: property.bouwjaar,
    oppervlakte: property.oppervlakte,
    createdAt: property.createdAt,
  };
}

async function fetchSavedProperties(
  accessToken: string,
  offset: number = 0,
  limit: number = PAGE_SIZE,
): Promise<{ properties: FeedProperty[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const response = await fetch(`${API_URL}/saved-properties?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch saved properties: ${response.status}`);
  }

  const data: SavedPropertiesApiResponse = await response.json();

  return {
    properties: data.data.map(transformSavedProperty),
    total: data.total,
    hasMore: data.hasMore,
  };
}

export function useSavedProperties() {
  const { user, accessToken } = useAuthContext();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: savedPropertyKeys.list(),
    queryFn: ({ pageParam = 0 }) => fetchSavedProperties(accessToken!, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: !!user && !!accessToken,
    staleTime: 10 * 1000, // 10 seconds — saves change frequently
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: savedPropertyKeys.all });
  }, [queryClient]);

  return { ...query, invalidate };
}

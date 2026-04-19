/**
 * useSavedProperties Hook
 * Fetches the authenticated user's saved properties list with pagination.
 */

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import type { FeedProperty } from './useFeed';
import { withDerivedPropertyImageData } from '../utils/property-image';
import type { MapMarketState } from '@/src/lib/sharedMapFilters';

interface SavedPropertyApiResponse {
  id: string;
  nationalId: string | null;
  countryCode: string;
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  address: string;
  city: string;
  postalCode: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  imageryGeometry?: { type: 'Point'; coordinates: [number, number] } | null;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  status: 'active' | 'inactive' | 'demolished';
  officialValuation: number | null;
  hasListing: boolean;
  hasActiveListing?: boolean;
  marketState?: MapMarketState;
  latestListingStatus?: 'active' | 'sold' | 'rented' | 'withdrawn' | null;
  askingPrice: number | null;
  thumbnailUrl: string | null;
  socialScore?: number;
  recentSocialScore?: number;
  lastSocialAt?: string | null;
  topLevelCommentCount?: number;
  replyCount?: number;
  propertyLikeCount?: number;
  commentLikeCount?: number;
  guessCount: number;
  viewCount?: number;
  uniqueViewerCount?: number;
  recentTopLevelCommentCount?: number;
  recentReplyCount?: number;
  recentPropertyLikeCount?: number;
  recentCommentLikeCount?: number;
  recentGuessCount?: number;
  recentViewCount?: number;
  recentUniqueViewerCount?: number;
  savedAt: string;
  isSaved?: true;
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

export function transformSavedProperty(property: SavedPropertyApiResponse): FeedProperty {
  const activityLevel: 'hot' | 'warm' | 'cold' =
    (property.recentSocialScore ?? 0) > 0
      ? 'hot'
      : (property.socialScore ?? 0) > 0 || property.hasActiveListing
        ? 'warm'
        : 'cold';

  return withDerivedPropertyImageData({
    id: property.id,
    address: property.address,
    city: property.city,
    countryCode: property.countryCode,
    geometry: property.geometry,
    imageryGeometry: property.imageryGeometry,
    zipCode: property.postalCode ?? '',
    postalCode: property.postalCode,
    coordinates: property.geometry
      ? { lon: property.geometry.coordinates[0], lat: property.geometry.coordinates[1] }
      : null,
    officialValuation: property.officialValuation,
    askingPrice: property.askingPrice,
    fmv: null,
    fmvValue: undefined,
    thumbnailUrl: property.thumbnailUrl,
    likeCount: property.propertyLikeCount ?? 0,
    activityLevel,
    lastActivityAt: property.lastSocialAt ?? property.savedAt,
    hasListing: property.hasListing,
    hasActiveListing: property.hasActiveListing ?? false,
    marketState: property.marketState ?? null,
    socialScore: property.socialScore ?? 0,
    recentSocialScore: property.recentSocialScore ?? 0,
    topLevelCommentCount: property.topLevelCommentCount ?? 0,
    replyCount: property.replyCount ?? 0,
    propertyLikeCount: property.propertyLikeCount ?? 0,
    commentLikeCount: property.commentLikeCount ?? 0,
    commentCount: property.topLevelCommentCount ?? 0,
    guessCount: property.guessCount,
    viewCount: property.viewCount ?? 0,
    uniqueViewerCount: property.uniqueViewerCount ?? 0,
    recentTopLevelCommentCount: property.recentTopLevelCommentCount ?? 0,
    recentReplyCount: property.recentReplyCount ?? 0,
    recentPropertyLikeCount: property.recentPropertyLikeCount ?? 0,
    recentCommentLikeCount: property.recentCommentLikeCount ?? 0,
    recentGuessCount: property.recentGuessCount ?? 0,
    recentViewCount: property.recentViewCount ?? 0,
    recentUniqueViewerCount: property.recentUniqueViewerCount ?? 0,
    isSaved: property.isSaved ?? true,
    yearBuilt: property.yearBuilt,
    floorAreaM2: property.floorAreaM2,
  });
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

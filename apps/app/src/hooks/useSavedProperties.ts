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
import type { SavedProperty } from '@huishype/shared';
import {
  getViewerCacheKey,
  resolvePropertyActivityLevel,
  resolvePropertyCommentCount,
} from './useProperties';

interface SavedPropertiesApiResponse {
  data: SavedProperty[];
  total: number;
  hasMore: boolean;
}

export const savedPropertyKeys = {
  all: ['saved-properties'] as const,
  list: (viewerKey: string) => [...savedPropertyKeys.all, 'list', viewerKey] as const,
};

const PAGE_SIZE = 20;

export function transformSavedProperty(property: SavedProperty): FeedProperty {
  const commentCount = resolvePropertyCommentCount(property);

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
    officialValuationYear: property.officialValuationYear,
    askingPrice: property.askingPrice,
    fmv: null,
    fmvValue: undefined,
    thumbnailUrl: property.thumbnailUrl,
    likeCount: property.propertyLikeCount ?? 0,
    activityLevel: resolvePropertyActivityLevel(property),
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
    commentCount,
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
  const { user, getAccessToken, isAuthenticated } = useAuthContext();
  const queryClient = useQueryClient();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);

  const query = useInfiniteQuery({
    queryKey: savedPropertyKeys.list(viewerKey),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchSavedProperties(accessToken, pageParam, PAGE_SIZE);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: isAuthenticated && !!user,
    staleTime: 10 * 1000, // 10 seconds — saves change frequently
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: savedPropertyKeys.all });
  }, [queryClient]);

  return { ...query, invalidate };
}

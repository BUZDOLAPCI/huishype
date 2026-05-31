/**
 * useFeed Hook
 * Fetches the feed from the dedicated /feed backend endpoint.
 * Server-side sorting/filtering replaces the old client-side approach.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { API_URL, type OfficialValuationSourceFetch } from '../utils/api';
import type { CountryCode, MapMarketState, PropertyFeedFilter } from '@huishype/shared';
import { getPropertyThumbnailFromGeometry } from '../lib/propertyThumbnail';
import {
  useVisibleOfficialValuationHydration,
  type OfficialValuationPatch,
} from './useVisibleOfficialValuationHydration';
import {
  MAP_MARKET_STATES,
  normalizeMapFilters,
  serializeLocationFilterToken,
  type MapFilters,
} from '../lib/sharedMapFilters';

export type { FeedTab, PropertyFeedFilter } from '@huishype/shared';

const FEED_PAGE_SIZE = Platform.OS === 'web' ? 20 : 3;

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
  officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
  officialValuationHydrationHidden?: boolean;
  thumbnailUrl: string | null;
  aerialImageUrl?: string | null;
  likeCount: number;
  commentCount: number;
  guessCount: number;
  viewCount: number;
  activityLevel: 'hot' | 'warm' | 'cold';
  marketState: MapMarketState | null;
  lastActivityAt: string;
  hasListing: boolean;
  hasActiveListing?: boolean;
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
    officialValuationSourceFetch?: OfficialValuationSourceFetch | null;
    thumbnailUrl: string | null;
    likeCount: number;
    commentCount: number;
    guessCount: number;
    viewCount: number;
    activityLevel: 'hot' | 'warm' | 'cold';
    marketState: MapMarketState;
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
  list: (filter: PropertyFeedFilter, scope?: FeedScope, sharedFilters?: MapFilters) =>
    [
      ...feedKeys.lists(),
      { filter, ...scope, filters: getSharedFeedFilterKey(sharedFilters) },
    ] as const,
  infinite: (filter: PropertyFeedFilter, scope?: FeedScope, sharedFilters?: MapFilters) =>
    [
      ...feedKeys.all,
      'infinite',
      { filter, ...scope, filters: getSharedFeedFilterKey(sharedFilters) },
    ] as const,
};

function getSharedFeedFilterKey(filters?: MapFilters): string {
  if (!filters) {
    return 'default';
  }

  const normalized = normalizeMapFilters(filters);
  const params = new URLSearchParams();
  appendSharedFeedFilterParams(params, normalized);
  const serialized = params.toString();
  return serialized.length > 0 ? serialized : 'default';
}

function appendSharedFeedFilterParams(params: URLSearchParams, filters?: MapFilters): void {
  if (!filters) {
    return;
  }

  const normalized = normalizeMapFilters(filters);
  if (normalized.salePriceFrom != null) {
    params.set('salePriceFrom', String(normalized.salePriceFrom));
  }
  if (normalized.salePriceTo != null) {
    params.set('salePriceTo', String(normalized.salePriceTo));
  }
  if (normalized.rentPriceFrom != null) {
    params.set('rentPriceFrom', String(normalized.rentPriceFrom));
  }
  if (normalized.rentPriceTo != null) {
    params.set('rentPriceTo', String(normalized.rentPriceTo));
  }
  if (normalized.marketState.length !== MAP_MARKET_STATES.length) {
    params.set('marketState', normalized.marketState.join(','));
  }
  for (const area of normalized.areas ?? []) {
    const serialized = serializeLocationFilterToken(area);
    if (serialized) {
      params.append('area', serialized);
    }
  }
}

// Transform API item to FeedProperty (adds compat fields used by PropertyFeedCard)
function transformFeedItem(item: FeedApiResponse['items'][0]): FeedProperty {
  const property = {
    ...item,
    aerialImageUrl:
      Platform.OS === 'web'
        ? getPropertyThumbnailFromGeometry(item.geometry, item.countryCode as CountryCode)
        : null,
    // PropertyFeedCard compat fields
    postalCode: item.zipCode,
    coordinates: item.geometry
      ? { lon: item.geometry.coordinates[0], lat: item.geometry.coordinates[1] }
      : null,
    fmvValue: item.fmv ?? undefined,
    hasActiveListing: item.hasListing,
    yearBuilt: null, // not returned by feed endpoint
    floorAreaM2: null, // not returned by feed endpoint
  };

  return property;
}

function applyOfficialValuationPatchToFeedProperty(
  property: FeedProperty,
  patch: OfficialValuationPatch
): FeedProperty {
  if (property.id !== patch.propertyId) {
    return property;
  }
  return {
    ...property,
    officialValuation: patch.officialValuation,
    officialValuationYear: patch.officialValuationYear,
    officialValuationHydrationHidden: false,
    officialValuationSourceFetch: property.officialValuationSourceFetch
      ? {
          ...property.officialValuationSourceFetch,
          expectedValuationYear: patch.expectedValuationYear,
        }
      : property.officialValuationSourceFetch,
  };
}

function hideOfficialValuationForFeedProperty(
  property: FeedProperty,
  propertyId: string
): FeedProperty {
  return property.id === propertyId
    ? { ...property, officialValuationHydrationHidden: true }
    : property;
}

// Fetch from dedicated /feed endpoint
async function fetchFeed(
  page: number = 1,
  limit: number = 20,
  filter: PropertyFeedFilter = 'trending',
  scope?: FeedScope,
  sharedFilters?: MapFilters
): Promise<{
  properties: FeedProperty[];
  meta: { page: number; limit: number; hasMore: boolean };
}> {
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
  appendSharedFeedFilterParams(params, sharedFilters);

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
  sharedFilters?: MapFilters
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: feedKeys.list(filter, scope, sharedFilters),
    queryFn: () => fetchFeed(1, FEED_PAGE_SIZE, filter, scope, sharedFilters),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });
  const visibleProperties = useMemo(() => query.data?.properties ?? [], [query.data?.properties]);
  const patchFeedProperty = useCallback(
    (patch: OfficialValuationPatch) => {
      queryClient.setQueriesData<{
        properties: FeedProperty[];
        meta: { page: number; limit: number; hasMore: boolean };
      }>({ queryKey: feedKeys.lists() }, (current) =>
        current
          ? {
              ...current,
              properties: current.properties.map((property) =>
                applyOfficialValuationPatchToFeedProperty(property, patch)
              ),
            }
          : current
      );
    },
    [queryClient]
  );
  const hideFeedProperty = useCallback(
    (propertyId: string) => {
      queryClient.setQueriesData<{
        properties: FeedProperty[];
        meta: { page: number; limit: number; hasMore: boolean };
      }>({ queryKey: feedKeys.lists() }, (current) =>
        current
          ? {
              ...current,
              properties: current.properties.map((property) =>
                hideOfficialValuationForFeedProperty(property, propertyId)
              ),
            }
          : current
      );
    },
    [queryClient]
  );
  useVisibleOfficialValuationHydration({
    properties: visibleProperties,
    enabled,
    onValue: patchFeedProperty,
    onHidden: hideFeedProperty,
  });

  return query;
}

/**
 * Hook to fetch feed properties with infinite scrolling
 */
export function useInfiniteFeed(
  filter: PropertyFeedFilter = 'trending',
  scope?: FeedScope,
  enabled = true,
  sharedFilters?: MapFilters
) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: feedKeys.infinite(filter, scope, sharedFilters),
    queryFn: ({ pageParam = 1 }) =>
      fetchFeed(pageParam, FEED_PAGE_SIZE, filter, scope, sharedFilters),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      return lastPage.meta.hasMore ? lastPage.meta.page + 1 : undefined;
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });
  const visibleProperties = useMemo(
    () => query.data?.pages.flatMap((page) => page.properties) ?? [],
    [query.data?.pages]
  );
  const patchFeedProperty = useCallback(
    (patch: OfficialValuationPatch) => {
      queryClient.setQueriesData<{
        pages: Array<{
          properties: FeedProperty[];
          meta: { page: number; limit: number; hasMore: boolean };
        }>;
        pageParams: unknown[];
      }>({ queryKey: [...feedKeys.all, 'infinite'] }, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                properties: page.properties.map((property) =>
                  applyOfficialValuationPatchToFeedProperty(property, patch)
                ),
              })),
            }
          : current
      );
    },
    [queryClient]
  );
  const hideFeedProperty = useCallback(
    (propertyId: string) => {
      queryClient.setQueriesData<{
        pages: Array<{
          properties: FeedProperty[];
          meta: { page: number; limit: number; hasMore: boolean };
        }>;
        pageParams: unknown[];
      }>({ queryKey: [...feedKeys.all, 'infinite'] }, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                properties: page.properties.map((property) =>
                  hideOfficialValuationForFeedProperty(property, propertyId)
                ),
              })),
            }
          : current
      );
    },
    [queryClient]
  );
  useVisibleOfficialValuationHydration({
    properties: visibleProperties,
    enabled,
    onValue: patchFeedProperty,
    onHidden: hideFeedProperty,
  });

  return query;
}

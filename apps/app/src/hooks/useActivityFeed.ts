/**
 * useActivityFeed Hook
 * Fetches grouped property activity posts for the public or following feed tabs.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import {
  MAP_MARKET_STATES,
  normalizeMapFilters,
  serializeLocationFilterToken,
  type MapFilters,
} from '../lib/sharedMapFilters';
import type {
  ActivityActor,
  ActivityProperty,
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
  GroupedPropertyActivityResponse,
  PublicActivityEventType,
} from '@huishype/shared';

// Re-export shared types for convenience
export type {
  ActivityActor,
  ActivityProperty,
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
  PublicActivityEventType,
};

// --- Query Keys ---

export const activityFeedKeys = {
  all: ['activity-feed'] as const,
  infinite: (scope: 'public' | 'following', viewerKey: string, filters?: MapFilters) =>
    [
      ...activityFeedKeys.all,
      'infinite',
      scope,
      viewerKey,
      getSharedActivityFilterKey(filters),
    ] as const,
};

function appendSharedActivityFilterParams(params: URLSearchParams, filters?: MapFilters): void {
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

function getSharedActivityFilterKey(filters?: MapFilters): string {
  if (!filters) {
    return 'default';
  }

  const params = new URLSearchParams();
  appendSharedActivityFilterParams(params, filters);
  const serialized = params.toString();
  return serialized.length > 0 ? serialized : 'default';
}

// --- API Function ---

async function fetchActivityFeed(
  scope: 'public' | 'following',
  limit: number,
  offset: number,
  accessToken?: string | null,
  filters?: MapFilters
): Promise<GroupedPropertyActivityResponse> {
  const params = new URLSearchParams({
    scope,
    limit: String(limit),
    offset: String(offset),
  });
  appendSharedActivityFilterParams(params, filters);

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const resp = await fetch(`${API_URL}/activity/properties?${params.toString()}`, {
    headers,
  });

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: 'Failed to fetch grouped property activity feed' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hook ---

const PAGE_SIZE = 20;

/** Fetch the public or following social activity feed with infinite scroll. */
export function useActivityFeed(
  scope: 'public' | 'following' = 'public',
  enabled = true,
  filters?: MapFilters
) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = scope === 'following' ? (user?.id ?? 'anon') : 'public';

  return useInfiniteQuery({
    queryKey: activityFeedKeys.infinite(scope, viewerKey, filters),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = scope === 'following' ? await getAccessToken() : null;

      if (scope === 'following' && !accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchActivityFeed(scope, PAGE_SIZE, pageParam, accessToken, filters);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: enabled && (scope === 'public' || (isAuthenticated && !!user)),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

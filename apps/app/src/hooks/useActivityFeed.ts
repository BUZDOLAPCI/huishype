/**
 * useActivityFeed Hook
 * Fetches the public or following social activity feed.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import type {
  ActivityItem,
  ActivityActor,
  ActivityProperty,
  PublicActivityEventType,
  PublicActivityResponse,
} from '@huishype/shared';

// Re-export shared types for convenience
export type { ActivityItem, ActivityActor, ActivityProperty, PublicActivityEventType };

// --- Query Keys ---

export const activityFeedKeys = {
  all: ['activity-feed'] as const,
  infinite: (scope: 'public' | 'following', viewerKey: string) =>
    [...activityFeedKeys.all, 'infinite', scope, viewerKey] as const,
};

// --- API Function ---

async function fetchActivityFeed(
  scope: 'public' | 'following',
  limit: number,
  offset: number,
  accessToken?: string | null,
): Promise<PublicActivityResponse> {
  const params = new URLSearchParams({
    scope,
    limit: String(limit),
    offset: String(offset),
  });

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const resp = await fetch(`${API_URL}/activity?${params.toString()}`, {
    headers,
  });

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: 'Failed to fetch activity feed' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hook ---

const PAGE_SIZE = 20;

/** Fetch the public or following social activity feed with infinite scroll. */
export function useActivityFeed(scope: 'public' | 'following' = 'public') {
  const { accessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = scope === 'following' ? (user?.id ?? 'anon') : 'public';

  return useInfiniteQuery({
    queryKey: activityFeedKeys.infinite(scope, viewerKey),
    queryFn: ({ pageParam = 0 }) =>
      fetchActivityFeed(scope, PAGE_SIZE, pageParam, accessToken),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: scope === 'public' || (isAuthenticated && !!accessToken),
    staleTime: 30 * 1000,
  });
}

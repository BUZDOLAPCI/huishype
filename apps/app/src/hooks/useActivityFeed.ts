/**
 * useActivityFeed Hook
 * Fetches the public social activity feed (likes, comments, guesses).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import type {
  ActivityItem,
  ActivityActor,
  ActivityProperty,
  ActivityEventType,
} from './useUserActivity';

// Re-export shared types for convenience
export type { ActivityItem, ActivityActor, ActivityProperty, ActivityEventType };

interface ActivityFeedApiResponse {
  items: ActivityItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// --- Query Keys ---

export const activityFeedKeys = {
  all: ['activity-feed'] as const,
  infinite: () => [...activityFeedKeys.all, 'infinite'] as const,
};

// --- API Function ---

async function fetchActivityFeed(
  limit: number,
  offset: number
): Promise<ActivityFeedApiResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/activity?${params.toString()}`);

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

/** Fetch the public social activity feed with infinite scroll. */
export function useActivityFeed() {
  return useInfiniteQuery({
    queryKey: activityFeedKeys.infinite(),
    queryFn: ({ pageParam = 0 }) =>
      fetchActivityFeed(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    staleTime: 30 * 1000,
  });
}

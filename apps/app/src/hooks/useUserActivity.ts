/**
 * useUserActivity Hook
 * Fetches the authenticated user's personal activity history.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';

// --- Types ---

export type ActivityEventType = 'property_like' | 'comment' | 'price_guess' | 'save';

export interface ActivityActor {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
}

export interface ActivityProperty {
  id: string;
  address: string;
  city: string;
  thumbnailUrl: string | null;
}

export interface ActivityItem {
  id: string;
  eventType: ActivityEventType;
  actor: ActivityActor;
  property: ActivityProperty;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

interface ActivityApiResponse {
  items: ActivityItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// --- Query Keys ---

export const userActivityKeys = {
  all: ['user-activity'] as const,
  mine: () => [...userActivityKeys.all, 'mine'] as const,
};

// --- API Function ---

async function fetchMyActivity(
  accessToken: string,
  limit: number,
  offset: number
): Promise<ActivityApiResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/users/me/activity?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ message: 'Failed to fetch activity' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hook ---

const PAGE_SIZE = 20;

/** Fetch the authenticated user's personal activity history with infinite scroll. */
export function useUserActivity() {
  const { accessToken, isAuthenticated } = useAuthContext();

  return useInfiniteQuery({
    queryKey: userActivityKeys.mine(),
    queryFn: ({ pageParam = 0 }) =>
      fetchMyActivity(accessToken!, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: isAuthenticated && !!accessToken,
    staleTime: 30 * 1000,
  });
}

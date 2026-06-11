/**
 * useUserActivity Hook
 * Fetches the authenticated user's personal activity history.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';
import type {
  ActivityEventType,
  ActivityActor,
  ActivityProperty,
  ActivityItem,
  ActivityResponse,
  PublicActivityResponse,
} from '@huishype/shared';

export type { ActivityEventType, ActivityActor, ActivityProperty, ActivityItem };

// --- Query Keys ---

export const userActivityKeys = {
  all: ['user-activity'] as const,
  mine: (viewerKey: string) => [...userActivityKeys.all, 'mine', viewerKey] as const,
  user: (userId: string) => [...userActivityKeys.all, 'user', userId] as const,
};

// --- API Function ---

async function fetchMyActivity(
  accessToken: string,
  limit: number,
  offset: number
): Promise<ActivityResponse> {
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

async function fetchPublicUserActivity(
  userId: string,
  limit: number,
  offset: number
): Promise<PublicActivityResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/users/${encodeURIComponent(userId)}/activity?${params}`);

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
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useInfiniteQuery({
    queryKey: userActivityKeys.mine(viewerKey),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchMyActivity(accessToken, PAGE_SIZE, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: isAuthenticated && !!user,
    staleTime: 30 * 1000,
  });
}

/** Fetch one public user's public activity history with infinite scroll. */
export function usePublicUserActivity(userId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: userActivityKeys.user(userId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      if (!userId) {
        throw new Error('User id is required');
      }

      return fetchPublicUserActivity(userId, PAGE_SIZE, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

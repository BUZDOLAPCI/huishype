/**
 * useNotifications Hook
 * Fetches notifications, unread count, and provides mark-read mutations.
 */

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';
import type {
  NotificationActor,
  NotificationItem,
  NotificationsResponse,
  UnreadCountResponse,
} from '@huishype/shared';

export type { NotificationActor, NotificationItem };

// --- Query Keys ---

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (viewerKey: string) => [...notificationKeys.all, 'list', viewerKey] as const,
  infinite: (viewerKey: string) => [...notificationKeys.all, 'infinite', viewerKey] as const,
  unreadCount: (viewerKey: string) => [...notificationKeys.all, 'unread-count', viewerKey] as const,
};

// --- API Functions ---

async function fetchNotifications(
  accessToken: string,
  limit: number,
  offset: number
): Promise<NotificationsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/notifications?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch notifications' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function fetchUnreadCount(accessToken: string): Promise<number> {
  const resp = await fetch(`${API_URL}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch unread count' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  const data: UnreadCountResponse = await resp.json();
  return data.count;
}

async function markAllNotificationsRead(
  accessToken: string
): Promise<{ markedCount: number }> {
  const resp = await fetch(`${API_URL}/notifications/read-all`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to mark all read' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function markNotificationRead(
  accessToken: string,
  notificationId: string
): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_URL}/notifications/${notificationId}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to mark notification read' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

// --- Hooks ---

const PAGE_SIZE = 20;

/** Fetch paginated notifications with infinite scroll. */
export function useNotifications() {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useInfiniteQuery({
    queryKey: notificationKeys.infinite(viewerKey),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchNotifications(accessToken, PAGE_SIZE, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: isAuthenticated && !!user,
    staleTime: 15 * 1000,
  });
}

/** Fetch unread notification count. Polls frequently for badge updates. */
export function useUnreadNotificationCount() {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: notificationKeys.unreadCount(viewerKey),
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchUnreadCount(accessToken);
    },
    enabled: isAuthenticated && !!user,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Poll every minute
  });
}

/** Mark all notifications as read. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return markAllNotificationsRead(accessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Mark a single notification as read. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return markNotificationRead(accessToken, notificationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

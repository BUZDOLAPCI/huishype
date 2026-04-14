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

// --- Types ---

export interface NotificationActor {
  id: string;
  displayName: string;
  profilePhotoUrl: string | null;
}

export interface NotificationItem {
  id: string;
  eventType: string;
  propertyId: string | null;
  commentId: string | null;
  guessId: string | null;
  reactionId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActor | null;
}

interface NotificationsApiResponse {
  items: NotificationItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface UnreadCountResponse {
  count: number;
}

// --- Query Keys ---

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  infinite: () => [...notificationKeys.all, 'infinite'] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

// --- API Functions ---

async function fetchNotifications(
  limit: number,
  offset: number
): Promise<NotificationsApiResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/notifications?${params.toString()}`, {
    credentials: 'include',
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch notifications' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function fetchUnreadCount(): Promise<number> {
  const resp = await fetch(`${API_URL}/notifications/unread-count`, {
    credentials: 'include',
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch unread count' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  const data: UnreadCountResponse = await resp.json();
  return data.count;
}

async function markAllNotificationsRead(): Promise<{ markedCount: number }> {
  const resp = await fetch(`${API_URL}/notifications/read-all`, {
    method: 'PUT',
    credentials: 'include',
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to mark all read' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
  const resp = await fetch(`${API_URL}/notifications/${notificationId}/read`, {
    method: 'PUT',
    credentials: 'include',
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
  const { isAuthenticated } = useAuthContext();

  return useInfiniteQuery({
    queryKey: notificationKeys.infinite(),
    queryFn: ({ pageParam = 0 }) => fetchNotifications(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + PAGE_SIZE;
    },
    enabled: isAuthenticated,
    staleTime: 15 * 1000,
  });
}

/** Fetch unread notification count. Polls frequently for badge updates. */
export function useUnreadNotificationCount() {
  const { isAuthenticated } = useAuthContext();

  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => fetchUnreadCount(),
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Poll every minute
  });
}

/** Mark all notifications as read. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Mark a single notification as read. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

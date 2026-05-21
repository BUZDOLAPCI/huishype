/**
 * useUserProfile Hook
 * Provides user profile data fetching and profile update mutations.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';
import { activityFeedKeys } from './useActivityFeed';
import { commentKeys } from './useComments';
import { feedKeys } from './useFeed';
import { leaderboardKeys } from './useLeaderboard';
import { getViewerCacheKey, propertyKeys } from './useProperties';
import { userActivityKeys } from './useUserActivity';
import type {
  PublicUserProfile as PublicProfile,
  MyUserProfile as MyProfile,
  FollowListResponse,
  FollowRelationshipResponse,
} from '@huishype/shared';

export type { PublicProfile, MyProfile, FollowListResponse, FollowRelationshipResponse };

export interface GuessHistoryItem {
  propertyId: string;
  propertyAddress: string;
  guessAmount: number;
  guessedAt: string;
  outcome: 'pending' | 'accurate' | 'close' | 'inaccurate' | null;
  actualPrice: number | null;
}

export interface GuessHistoryResponse {
  items: GuessHistoryItem[];
  total: number;
  hasMore: boolean;
}

export type UserSearchRelationship =
  | 'self'
  | 'none'
  | 'following'
  | 'followed_by'
  | 'mutual';

export interface UserSearchResult {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  relationship: UserSearchRelationship;
  followerCount: number;
}

export interface UserSearchResponse {
  items: UserSearchResult[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface UpdateMyProfileInput {
  displayName?: string;
  handle?: string;
  profilePhotoUrl?: string;
  homeCountry?: string | null;
}

export interface UpdateMyProfileResponse {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  homeCountry: string | null;
  lastDisplayNameChangeAt: string | null;
  lastHandleChangeAt: string | null;
  displayNameChangeAvailableAt: string | null;
  handleChangeAvailableAt: string | null;
  lastNameChangeAt?: string | null;
}

export type SocialFollowAnalyticsEventName =
  | 'follow_button_impression'
  | 'follow_button_click'
  | 'follow_created'
  | 'unfollow'
  | 'following_feed_opened'
  | 'following_feed_empty_viewed'
  | 'following_feed_post_clicked';

export interface SocialFollowAnalyticsEvent {
  name: SocialFollowAnalyticsEventName;
  properties: Record<string, unknown>;
  timestamp: string;
}

interface AnalyticsGlobal {
  __HUISHYPE_ANALYTICS_EVENTS__?: SocialFollowAnalyticsEvent[];
  __HUISHYPE_ANALYTICS_LISTENER__?: (event: SocialFollowAnalyticsEvent) => void;
}

export function emitSocialFollowAnalyticsEvent(
  name: SocialFollowAnalyticsEventName,
  properties: Record<string, unknown> = {}
) {
  const event: SocialFollowAnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  const analyticsGlobal = globalThis as typeof globalThis &
    AnalyticsGlobal & {
      dispatchEvent?: (event: Event) => boolean;
      CustomEvent?: typeof CustomEvent;
    };

  analyticsGlobal.__HUISHYPE_ANALYTICS_LISTENER__?.(event);
  analyticsGlobal.__HUISHYPE_ANALYTICS_EVENTS__?.push(event);

  if (
    typeof analyticsGlobal.dispatchEvent === 'function' &&
    typeof analyticsGlobal.CustomEvent === 'function'
  ) {
    analyticsGlobal.dispatchEvent(
      new analyticsGlobal.CustomEvent('huishype:analytics', {
        detail: event,
      })
    );
  }
}

const FOLLOW_LIST_PAGE_SIZE = 20;

// --- Query Keys ---

export const userKeys = {
  all: ['users'] as const,
  publicProfile: (id: string, viewerKey: string) => [...userKeys.all, 'profile', id, viewerKey] as const,
  me: (viewerKey: string) => [...userKeys.all, 'me', viewerKey] as const,
  followers: (viewerKey: string, pageSize = FOLLOW_LIST_PAGE_SIZE) =>
    [...userKeys.all, 'me', 'followers', viewerKey, pageSize] as const,
  following: (viewerKey: string, pageSize = FOLLOW_LIST_PAGE_SIZE) =>
    [...userKeys.all, 'me', 'following', viewerKey, pageSize] as const,
  search: (viewerKey: string, query: string, limit = FOLLOW_LIST_PAGE_SIZE, offset = 0) =>
    [...userKeys.all, 'search', viewerKey, { query, limit, offset }] as const,
  myGuesses: (viewerKey: string, limit?: number, offset?: number) =>
    [...userKeys.all, 'me', 'guesses', viewerKey, { limit, offset }] as const,
};

// --- API Functions ---

async function fetchPublicProfile(
  userId: string,
  accessToken?: string | null
): Promise<PublicProfile> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const resp = await fetch(`${API_URL}/users/${userId}/profile`, {
    headers,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function fetchMyProfile(accessToken: string): Promise<MyProfile> {
  const resp = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function updateMyProfile(
  accessToken: string,
  data: UpdateMyProfileInput
): Promise<UpdateMyProfileResponse> {
  const resp = await fetch(`${API_URL}/users/me/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to update profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function fetchFollowList(
  accessToken: string,
  kind: 'followers' | 'following',
  limit: number,
  offset: number
): Promise<FollowListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const resp = await fetch(`${API_URL}/users/me/${kind}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: `Failed to fetch ${kind}` }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

export function normalizeUserSearchQuery(query: string): string {
  return query.trim().replace(/^@+/, '').trim();
}

async function fetchUserSearch(
  query: string,
  accessToken?: string | null,
  limit = FOLLOW_LIST_PAGE_SIZE,
  offset = 0
): Promise<UserSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: String(offset),
  });
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const resp = await fetch(`${API_URL}/users/search?${params.toString()}`, {
    headers,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to search users' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function updateFollowRelationship(
  accessToken: string,
  userId: string,
  method: 'PUT' | 'DELETE'
): Promise<FollowRelationshipResponse> {
  const resp = await fetch(`${API_URL}/users/${userId}/follow`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to update follow state' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  return resp.json();
}

async function fetchMyGuesses(
  accessToken: string,
  limit: number,
  offset: number
): Promise<GuessHistoryResponse> {
  const resp = await fetch(
    `${API_URL}/users/me/guesses?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch guesses' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// --- Hooks ---

/** Fetch a public user profile by ID */
export function usePublicProfile(userId: string | null) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);

  return useQuery({
    queryKey: userKeys.publicProfile(userId ?? '', viewerKey),
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID is required');
      }

      if (viewerKey === 'anon') {
        return fetchPublicProfile(userId);
      }

      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Authenticated profile fetch requires an access token');
      }

      return fetchPublicProfile(userId, accessToken);
    },
    enabled: !!userId,
  });
}

/** Fetch the authenticated user's full profile */
export function useMyProfile() {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.me(viewerKey),
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return fetchMyProfile(token);
    },
    enabled: isAuthenticated && !!user,
  });
}

/** Update authenticated user's profile */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { getAccessToken, updateAuthUserProfile, user } = useAuthContext();

  return useMutation({
    mutationFn: async (data: UpdateMyProfileInput) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateMyProfile(token, data);
    },
    onSuccess: async (updated) => {
      await updateAuthUserProfile?.({
        displayName: updated.displayName,
        handle: updated.handle,
        profilePhotoUrl: updated.profilePhotoUrl,
      });

      queryClient.setQueriesData<MyProfile>(
        {
          queryKey: userKeys.all,
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'users' &&
            query.queryKey[1] === 'me',
        },
        (old) =>
          old
            ? {
                ...old,
                displayName: updated.displayName,
                handle: updated.handle,
                profilePhotoUrl: updated.profilePhotoUrl,
                homeCountry: updated.homeCountry,
                lastNameChangeAt:
                  updated.lastDisplayNameChangeAt ?? updated.lastNameChangeAt ?? null,
                lastDisplayNameChangeAt: updated.lastDisplayNameChangeAt,
                lastHandleChangeAt: updated.lastHandleChangeAt,
                displayNameChangeAvailableAt: updated.displayNameChangeAvailableAt,
                handleChangeAvailableAt: updated.handleChangeAvailableAt,
              }
            : old
      );

      if (user?.id) {
        queryClient.setQueriesData<PublicProfile>(
          {
            queryKey: userKeys.all,
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'users' &&
              query.queryKey[1] === 'profile' &&
              query.queryKey[2] === user.id,
          },
          (old) =>
            old
              ? {
                  ...old,
                  displayName: updated.displayName,
                  handle: updated.handle,
                  profilePhotoUrl: updated.profilePhotoUrl,
                }
              : old
        );
      }

      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({ queryKey: activityFeedKeys.all });
      queryClient.invalidateQueries({ queryKey: userActivityKeys.all });
      queryClient.invalidateQueries({ queryKey: feedKeys.all });
      queryClient.invalidateQueries({ queryKey: commentKeys.all });
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.all });
    },
  });
}

export function useFollowers(pageSize = FOLLOW_LIST_PAGE_SIZE, enabled = true) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useInfiniteQuery({
    queryKey: userKeys.followers(viewerKey, pageSize),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchFollowList(accessToken, 'followers', pageSize, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + lastPage.pagination.limit;
    },
    enabled: enabled && isAuthenticated && !!user,
    staleTime: 15 * 1000,
  });
}

export function useFollowing(pageSize = FOLLOW_LIST_PAGE_SIZE, enabled = true) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useInfiniteQuery({
    queryKey: userKeys.following(viewerKey, pageSize),
    queryFn: async ({ pageParam = 0 }) => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      return fetchFollowList(accessToken, 'following', pageSize, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.pagination.hasMore) return undefined;
      return lastPageParam + lastPage.pagination.limit;
    },
    enabled: enabled && isAuthenticated && !!user,
    staleTime: 15 * 1000,
  });
}

export function useUserSearch(query: string, limit = FOLLOW_LIST_PAGE_SIZE, offset = 0) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);
  const normalizedQuery = normalizeUserSearchQuery(query);

  return useQuery({
    queryKey: userKeys.search(viewerKey, normalizedQuery, limit, offset),
    queryFn: async () => {
      const accessToken = isAuthenticated && user ? await getAccessToken() : null;
      return fetchUserSearch(normalizedQuery, accessToken, limit, offset);
    },
    enabled: normalizedQuery.length >= 2,
    staleTime: 15 * 1000,
  });
}

export function useFollowUser() {
  const queryClient = useQueryClient();
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);

  return useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateFollowRelationship(token, userId, 'PUT');
    },
    onSuccess: (data, userId) => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({ queryKey: activityFeedKeys.all });
      queryClient.invalidateQueries({
        queryKey: propertyKeys.followingViewportRoot(viewerKey),
      });
      emitSocialFollowAnalyticsEvent('follow_created', {
        targetUserId: userId,
        relationship: data.relationship,
        followerCount: data.followerCount,
        followingCount: data.followingCount,
      });
    },
  });
}

export function useUnfollowUser() {
  const queryClient = useQueryClient();
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = getViewerCacheKey(user, isAuthenticated);

  return useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateFollowRelationship(token, userId, 'DELETE');
    },
    onSuccess: (data, userId) => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({ queryKey: activityFeedKeys.all });
      queryClient.invalidateQueries({
        queryKey: propertyKeys.followingViewportRoot(viewerKey),
      });
      emitSocialFollowAnalyticsEvent('unfollow', {
        targetUserId: userId,
        relationship: data.relationship,
        followerCount: data.followerCount,
        followingCount: data.followingCount,
      });
    },
  });
}

/** Fetch authenticated user's guess history */
export function useMyGuesses(limit = 20, offset = 0) {
  const { getAccessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.myGuesses(viewerKey, limit, offset),
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return fetchMyGuesses(token, limit, offset);
    },
    enabled: isAuthenticated && !!user,
  });
}

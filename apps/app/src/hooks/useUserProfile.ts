/**
 * useUserProfile Hook
 * Provides user profile data fetching and profile update mutations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';
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

// --- Query Keys ---

export const userKeys = {
  all: ['users'] as const,
  publicProfile: (id: string, viewerKey: string) => [...userKeys.all, 'profile', id, viewerKey] as const,
  me: (viewerKey: string) => [...userKeys.all, 'me', viewerKey] as const,
  followers: (viewerKey: string, limit?: number, offset?: number) =>
    [...userKeys.all, 'me', 'followers', viewerKey, { limit, offset }] as const,
  following: (viewerKey: string, limit?: number, offset?: number) =>
    [...userKeys.all, 'me', 'following', viewerKey, { limit, offset }] as const,
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
  data: { displayName?: string; profilePhotoUrl?: string; homeCountry?: string | null }
): Promise<{ id: string; displayName: string; profilePhotoUrl: string | null; lastNameChangeAt: string | null }> {
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
  const { accessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = isAuthenticated && user ? user.id : 'anon';

  return useQuery({
    queryKey: userKeys.publicProfile(userId ?? '', viewerKey),
    queryFn: () => fetchPublicProfile(userId!, accessToken),
    enabled: !!userId,
  });
}

/** Fetch the authenticated user's full profile */
export function useMyProfile() {
  const { getAccessToken, isAuthenticated, accessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.me(viewerKey),
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return fetchMyProfile(token);
    },
    enabled: isAuthenticated && !!accessToken,
  });
}

/** Update authenticated user's profile */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async (data: { displayName?: string; profilePhotoUrl?: string; homeCountry?: string | null }) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateMyProfile(token, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useFollowers(limit = 20, offset = 0) {
  const { accessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.followers(viewerKey, limit, offset),
    queryFn: () => fetchFollowList(accessToken!, 'followers', limit, offset),
    enabled: isAuthenticated && !!accessToken,
    staleTime: 15 * 1000,
  });
}

export function useFollowing(limit = 20, offset = 0) {
  const { accessToken, isAuthenticated, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.following(viewerKey, limit, offset),
    queryFn: () => fetchFollowList(accessToken!, 'following', limit, offset),
    enabled: isAuthenticated && !!accessToken,
    staleTime: 15 * 1000,
  });
}

export function useFollowUser() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateFollowRelationship(token, userId, 'PUT');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useUnfollowUser() {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuthContext();

  return useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return updateFollowRelationship(token, userId, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

/** Fetch authenticated user's guess history */
export function useMyGuesses(limit = 20, offset = 0) {
  const { getAccessToken, isAuthenticated, accessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anon';

  return useQuery({
    queryKey: userKeys.myGuesses(viewerKey, limit, offset),
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      return fetchMyGuesses(token, limit, offset);
    },
    enabled: isAuthenticated && !!accessToken,
  });
}

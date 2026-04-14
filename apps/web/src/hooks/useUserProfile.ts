/**
 * useUserProfile Hook
 * Provides user profile data fetching and profile update mutations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../providers/AuthProvider';
import { API_URL } from '../utils/api';

// --- Types ---

export interface KarmaRank {
  title: string;
  level: number;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  karma: number;
  karmaRank: KarmaRank;
  guessCount: number;
  commentCount: number;
  joinedAt: string;
}

export interface MyProfile extends PublicProfile {
  email: string;
  averageAccuracy?: number;
  savedCount: number;
  likedCount: number;
  lastNameChangeAt: string | null;
}

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
  publicProfile: (id: string) => [...userKeys.all, 'profile', id] as const,
  me: () => [...userKeys.all, 'me'] as const,
  myGuesses: (limit?: number, offset?: number) =>
    [...userKeys.all, 'me', 'guesses', { limit, offset }] as const,
};

// --- API Functions ---

async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
  const resp = await fetch(`${API_URL}/users/${userId}/profile`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function fetchMyProfile(): Promise<MyProfile> {
  const resp = await fetch(`${API_URL}/users/me`, {
    credentials: 'include',
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to fetch profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function updateMyProfile(
  data: { displayName?: string; profilePhotoUrl?: string }
): Promise<{ id: string; displayName: string; profilePhotoUrl: string | null; lastNameChangeAt: string | null }> {
  const resp = await fetch(`${API_URL}/users/me/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: 'Failed to update profile' }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function fetchMyGuesses(
  limit: number,
  offset: number
): Promise<GuessHistoryResponse> {
  const resp = await fetch(
    `${API_URL}/users/me/guesses?limit=${limit}&offset=${offset}`,
    { credentials: 'include' }
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
  return useQuery({
    queryKey: userKeys.publicProfile(userId ?? ''),
    queryFn: () => fetchPublicProfile(userId!),
    enabled: !!userId,
  });
}

/** Fetch the authenticated user's full profile */
export function useMyProfile() {
  const { isAuthenticated } = useAuthContext();

  return useQuery({
    queryKey: userKeys.me(),
    queryFn: async () => fetchMyProfile(),
    enabled: isAuthenticated,
  });
}

/** Update authenticated user's profile */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { displayName?: string; profilePhotoUrl?: string }) => {
      return updateMyProfile(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.me() });
    },
  });
}

/** Fetch authenticated user's guess history */
export function useMyGuesses(limit = 20, offset = 0) {
  const { isAuthenticated } = useAuthContext();

  return useQuery({
    queryKey: userKeys.myGuesses(limit, offset),
    queryFn: async () => {
      return fetchMyGuesses(limit, offset);
    },
    enabled: isAuthenticated,
  });
}
